import { Vector3 } from '@babylonjs/core';
import type { Scene } from '@babylonjs/core';
import {
  BOSS,
  COMBAT,
  bowStats,
  drawTimeToCharge,
  noiseRadius,
  visionDistance,
  type NoiseLevel,
} from '../core/combat';
import { DEBUG } from '../core/config';
import type { SaveStore } from '../app/SaveStore';
import type { AssetLibrary } from '../world/AssetLibrary';
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
  /** Fired when the king boss dies, after the kill is recorded. */
  onBossDeath: (() => void) | null = null;

  private readonly arrows: ArrowSystem;
  private readonly alerted = new Set<Guard>();

  private dungeon: DungeonScene | null = null;
  private active = false;
  private health = COMBAT.playerBaseHealth;
  private maxHealth = COMBAT.playerBaseHealth;
  private charging = false;
  private chargeTime = 0;
  private charge = 0;
  private cooldown = 0;
  private invulnerable = 0;
  private baseFov = 1.15;
  private takedownTarget: Guard | null = null;
  private inputEnabled = false;
  private readonly disposers: Array<() => void> = [];

  constructor(
    scene: Scene,
    library: AssetLibrary,
    private readonly canvas: HTMLCanvasElement,
    private readonly player: PlayerController,
    private readonly bow: BowViewModel,
    private readonly hud: Hud,
    private readonly save: SaveStore,
  ) {
    this.arrows = new ArrowSystem(scene, library);
    this.baseFov = save.current.settings.fov;
    this.bindInput();
  }

  async loadAssets(): Promise<void> {
    await this.arrows.load();
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
  }

  enterCastle(dungeon: DungeonScene, maxHealth: number): void {
    this.dungeon = dungeon;
    this.active = true;
    this.inputEnabled = false;
    this.maxHealth = maxHealth;
    this.health = maxHealth;
    this.charging = false;
    this.charge = 0;
    this.chargeTime = 0;
    this.cooldown = 0;
    this.invulnerable = 0;
    this.takedownTarget = null;
    this.alerted.clear();
    this.arrows.clear();
    this.bow.setDraw(0);
    this.bow.setCharging(false);
    this.hud.setHealth(this.health, this.maxHealth);
    this.hud.setAlert(false);
    this.hud.setCharge(0);
    this.player.camera.fov = this.baseFov;

    for (const guard of dungeon.guards) {
      this.attachGuard(guard, guard.isBoss);
    }
  }

  attachGuard(guard: Guard, isBoss = false): void {
    guard.onAttack = (damage) => this.damagePlayer(damage);
    guard.onDeath = () => {
      this.save.update((data) => {
        data.stats.guardsKilled += 1;
      });
      if (isBoss) {
        this.onBossDeath?.();
      }
    };
  }

  leaveCastle(): void {
    this.active = false;
    this.inputEnabled = false;
    this.dungeon = null;
    this.charging = false;
    this.charge = 0;
    this.takedownTarget = null;
    this.alerted.clear();
    this.arrows.clear();
    this.bow.setDraw(0);
    this.bow.setCharging(false);
    this.player.camera.fov = this.baseFov;
    this.hud.setHealth(null);
    this.hud.setBoss(null, 0, 0);
    this.hud.setAlert(false);
    this.hud.setCharge(0);
  }

  cancel(): void {
    this.charging = false;
    this.charge = 0;
    this.chargeTime = 0;
    this.bow.setDraw(0);
    this.bow.setCharging(false);
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

    // Sprint widens the view to sell a dash; crouch tightens it so low
    // movement feels deliberate without reducing the actual crouch speed.
    const sprintFov = this.player.isSprinting ? 0.15 : 0;
    const crouchFov = this.player.isCrouching ? -0.09 : 0;
    const targetFov = this.baseFov + sprintFov + crouchFov;
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
    const boss = this.dungeon.boss;
    this.hud.setBoss(
      boss && boss.isAlive && boss.floor === floor ? BOSS.name : null,
      boss?.health ?? 0,
      boss?.maxHealth ?? 0,
    );
    this.hud.setAlert(this.dungeon.guards.some((guard) => guard.isAlerted));
  }

  takedownPrompt(): string | null {
    return this.takedownTarget ? 'Takedown guard' : null;
  }

  takedownHint(): string | null {
    if (!this.active || !this.dungeon) {
      return null;
    }
    if (this.takedownTarget) {
      return 'Takedown guard';
    }
    const pos = this.player.position;
    for (const guard of this.dungeon.guards) {
      if (
        !guard.isAlive ||
        guard.isBoss ||
        guard.floor !== this.dungeon.currentFloor ||
        guard.isAlerted
      ) {
        continue;
      }
      if (Math.hypot(guard.x - pos.x, guard.z - pos.z) <= 3.0) {
        return 'Crouch behind guard to takedown';
      }
    }
    return null;
  }

  debugLabel(): string {
    const alive = this.dungeon?.guards.filter((guard) => guard.isAlive).length ?? 0;
    const boss = this.dungeon?.boss;
    const king = boss && boss.isAlive ? ` · king ${Math.ceil(boss.health)}/${boss.maxHealth}` : '';
    return `${Math.ceil(this.health)}/${this.maxHealth} hp · ${alive} guards${king}`;
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
      if (!this.active || !this.inputEnabled) {
        return;
      }
      if (event.button !== 0 || this.cooldown > 0 || this.charging) {
        return;
      }
      // Do not preventDefault here: it can suppress the mousemove stream that
      // drives camera look while the button is held.
      this.charging = true;
      this.chargeTime = 0;
      this.charge = 0;
      this.bow.setCharging(true);
    };
    const onMouseUp = (event: MouseEvent): void => {
      if (!this.active) {
        return;
      }
      if (event.button === 2) {
            return;
      }
      if (event.button === 0 && this.charging) {
        this.fire();
      }
    };
    // Bind on both the canvas and window, using mouse and pointer events.
    // Pointer lock retargets input to the canvas, while some browsers only
    // deliver one event family. The charging guard makes duplicates harmless.
    const targets: EventTarget[] = [this.canvas, window];
    for (const target of targets) {
      target.addEventListener('mousedown', onMouseDown as EventListener);
      target.addEventListener('mouseup', onMouseUp as EventListener);
      target.addEventListener('pointerdown', onMouseDown as EventListener);
      target.addEventListener('pointerup', onMouseUp as EventListener);
      this.disposers.push(
        () => target.removeEventListener('mousedown', onMouseDown as EventListener),
        () => target.removeEventListener('mouseup', onMouseUp as EventListener),
        () => target.removeEventListener('pointerdown', onMouseDown as EventListener),
        () => target.removeEventListener('pointerup', onMouseUp as EventListener),
      );
    }
  }

  private fire(): void {
    if (!this.active || !this.dungeon) {
      return;
    }
    const stats = bowStats(this.save.current.bowTier, this.charge);
    const camera = this.player.camera;
    const forward = camera.getForwardRay(1).direction.normalize();
    const right = camera.getDirection(Vector3.Right()).normalize();
    const up = camera.getDirection(Vector3.Up()).normalize();
    // Start near the bow, then converge on the crosshair so the white streak is
    // visible instead of collapsing to a dot straight down the view axis.
    const origin = camera.position
      .add(forward.scale(COMBAT.arrowSpawnOffset))
      .add(right.scale(0.25))
      .add(up.scale(-0.14));
    const target = camera.position.add(forward.scale(100));
    const direction = target.subtract(origin).normalize();
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
    this.bow.setCharging(false);
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
