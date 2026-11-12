import type { Scene } from '@babylonjs/core';
import {
  COMBAT,
  bowStats,
  drawTimeToCharge,
  noiseRadius,
  visionDistance,
  type NoiseLevel,
} from '../core/combat';
import { DEBUG } from '../core/config';
import type { SaveStore } from '../app/SaveStore';
import type { DungeonScene } from '../world/DungeonScene';
import { ArrowSystem } from './Arrows';
import type { BowViewModel } from './BowViewModel';
import type { Guard } from './Guard';
import type { PlayerController } from './PlayerController';
import type { Hud } from '../ui/Hud';

/**
 * Owns the player's combat state for one castle run: health, bow charge, arrow
 * projectiles, guard attacks and the stealth takedown window.
 */
export class CombatSystem {
  onDeath: (() => void) | null = null;

  private readonly arrows: ArrowSystem;
  private readonly alerted = new Set<Guard>();

  private dungeon: DungeonScene | null = null;
  private active = false;
  private health = COMBAT.playerBaseHealth;
  private maxHealth = COMBAT.playerBaseHealth;
  private charging = false;
  private chargeTime = 0;
  private charge = 0;
  private aiming = false;
  private cooldown = 0;
  private invulnerable = 0;
  private baseFov = 1.15;
  private takedownTarget: Guard | null = null;
  private readonly disposers: Array<() => void> = [];

  constructor(
    scene: Scene,
    private readonly player: PlayerController,
    private readonly bow: BowViewModel,
    private readonly hud: Hud,
    private readonly save: SaveStore,
  ) {
    this.arrows = new ArrowSystem(scene);
    this.baseFov = save.current.settings.fov;
    this.bindInput();
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  enterCastle(dungeon: DungeonScene, maxHealth: number): void {
    this.dungeon = dungeon;
    this.active = true;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.charging = false;
    this.aiming = false;
    this.charge = 0;
    this.chargeTime = 0;
    this.cooldown = 0;
    this.invulnerable = 0;
    this.takedownTarget = null;
    this.alerted.clear();
    this.arrows.clear();
    this.bow.setAiming(false);
    this.bow.setDraw(0);
    this.hud.setHealth(this.health, this.maxHealth);
    this.hud.setAlert(false);
    this.hud.setCharge(0);
    this.player.camera.fov = this.baseFov;

    for (const guard of dungeon.guards) {
      guard.onAttack = (damage) => this.damagePlayer(damage);
      guard.onDeath = () => {
        this.save.update((data) => {
          data.stats.guardsKilled += 1;
        });
      };
    }
  }

  leaveCastle(): void {
    this.active = false;
    this.dungeon = null;
    this.charging = false;
    this.aiming = false;
    this.charge = 0;
    this.takedownTarget = null;
    this.alerted.clear();
    this.arrows.clear();
    this.bow.setAiming(false);
    this.bow.setDraw(0);
    this.player.camera.fov = this.baseFov;
    this.hud.setHealth(null);
    this.hud.setAlert(false);
    this.hud.setCharge(0);
  }

  cancel(): void {
    this.charging = false;
    this.aiming = false;
    this.charge = 0;
    this.chargeTime = 0;
    this.bow.setAiming(false);
    this.bow.setDraw(0);
    this.player.camera.fov = this.baseFov;
    this.hud.setCharge(0);
  }

  update(deltaMs: number): void {
    if (!this.active || !this.dungeon) {
      return;
    }
    const dt = Math.min(deltaMs, 50) / 1000;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.bow.update(dt);

    if (this.charging) {
      this.chargeTime += dt;
      this.charge = drawTimeToCharge(this.chargeTime);
      this.bow.setDraw(this.charge);
      this.hud.setCharge(this.charge);
    } else {
      this.bow.setDraw(0);
      this.hud.setCharge(0);
    }

    this.bow.setAiming(this.aiming);
    const targetFov = this.aiming ? this.baseFov * 0.78 : this.baseFov;
    this.player.camera.fov += (targetFov - this.player.camera.fov) * Math.min(1, dt * 12);

    const floor = this.dungeon.currentFloor;
    const playerView = {
      x: this.player.position.x,
      z: this.player.position.z,
      floor,
      crouching: this.player.isCrouching,
      moving: this.player.speed > 0.35,
    };
    const level: NoiseLevel = !playerView.moving
      ? 'still'
      : this.player.isCrouching
        ? 'crouch'
        : this.player.isSprinting
          ? 'sprint'
          : 'walk';
    const noise = noiseRadius(level, this.save.current.training.quietSteps);
    const viewDistance = visionDistance(this.save.current.training.stealth);

    for (const guard of this.dungeon.guards) {
      if (guard.floor !== floor) {
        continue;
      }
      guard.update(dt, playerView, viewDistance, noise);
      if (guard.isAlerted && !this.alerted.has(guard)) {
        this.alerted.add(guard);
        for (const other of this.dungeon.guards) {
          if (other === guard || other.floor !== guard.floor || !other.isAlive) {
            continue;
          }
          if (Math.hypot(other.x - guard.x, other.z - guard.z) <= COMBAT.guardAlertRadius) {
            other.alertAt(guard.x, guard.z);
          }
        }
      }
    }
    for (const guard of this.alerted) {
      if (!guard.isAlerted) {
        this.alerted.delete(guard);
      }
    }

    this.arrows.update(
      dt,
      this.dungeon,
      this.dungeon.guards,
      (guard, damage, point) => {
        guard.takeDamage(damage, this.player.position);
        this.hud.showHitMarker();
        this.makeNoise(point.x, point.z, floor, 6);
      },
      (point, impactFloor) => {
        this.makeNoise(point.x, point.z, impactFloor, 5);
      },
    );

    this.takedownTarget = null;
    if (this.player.isCrouching) {
      let best = COMBAT.takedownRange;
      for (const guard of this.dungeon.guards) {
        if (guard.floor !== floor || !guard.isAlive) {
          continue;
        }
        const target = this.player.position;
        if (!guard.canBeTakenDown(target.x, target.z, true)) {
          continue;
        }
        const distance = Math.hypot(guard.x - target.x, guard.z - target.z);
        if (distance <= best) {
          best = distance;
          this.takedownTarget = guard;
        }
      }
    }

    this.hud.setHealth(this.health, this.maxHealth);
    this.hud.setAlert(this.dungeon.guards.some((guard) => guard.isAlerted));
  }

  takedownPrompt(): string | null {
    return this.takedownTarget ? 'Takedown guard' : null;
  }

  debugLabel(): string {
    const alive = this.dungeon?.guards.filter((guard) => guard.isAlive).length ?? 0;
    return `${Math.ceil(this.health)}/${this.maxHealth} hp · ${alive} guards`;
  }

  tryTakedown(): boolean {
    if (!this.takedownTarget) {
      return false;
    }
    this.takedownTarget.takeDown();
    this.hud.showToast('Guard taken down');
    this.hud.showHitMarker();
    this.takedownTarget = null;
    return true;
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.arrows.dispose();
  }

  private bindInput(): void {
    const onMouseDown = (event: MouseEvent): void => {
      if (!this.active || !this.player.isLocked) {
        return;
      }
      if (event.button === 2) {
        this.aiming = true;
        event.preventDefault();
        return;
      }
      if (event.button !== 0 || this.cooldown > 0) {
        return;
      }
      this.charging = true;
      this.chargeTime = 0;
      this.charge = 0;
    };
    const onMouseUp = (event: MouseEvent): void => {
      if (!this.active) {
        return;
      }
      if (event.button === 2) {
        this.aiming = false;
        return;
      }
      if (event.button === 0 && this.charging) {
        this.fire();
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    this.disposers.push(
      () => window.removeEventListener('mousedown', onMouseDown),
      () => window.removeEventListener('mouseup', onMouseUp),
    );
  }

  private fire(): void {
    if (!this.active || !this.dungeon) {
      return;
    }
    const stats = bowStats(this.save.current.bowTier, this.charge);
    const direction = this.player.camera.getForwardRay(1).direction.normalize();
    const origin = this.player.camera.position.add(direction.scale(COMBAT.arrowSpawnOffset));
    this.arrows.spawn(
      origin,
      direction.scale(stats.speed),
      stats.damage,
      this.dungeon.currentFloor,
      stats.lifetime,
    );
    this.makeNoise(origin.x, origin.z, this.dungeon.currentFloor, 14);
    this.cooldown = COMBAT.fireCooldown;
    this.charging = false;
    this.charge = 0;
    this.chargeTime = 0;
    this.bow.release();
    this.hud.setCharge(0);
  }

  private makeNoise(x: number, z: number, floor: number, radius: number): void {
    if (!this.dungeon) {
      return;
    }
    for (const guard of this.dungeon.guards) {
      if (!guard.isAlive || guard.floor !== floor) {
        continue;
      }
      if (Math.hypot(guard.x - x, guard.z - z) <= radius) {
        guard.alertAt(x, z);
      }
    }
  }

  private damagePlayer(damage: number): void {
    if (!this.active || this.invulnerable > 0 || DEBUG.godMode) {
      return;
    }
    this.health = Math.max(0, this.health - damage);
    this.invulnerable = COMBAT.hitInvulnerability;
    this.hud.setHealth(this.health, this.maxHealth);
    this.hud.flashDamage();
    if (this.health <= 0) {
      this.active = false;
      this.cancel();
      this.onDeath?.();
    }
  }
}
