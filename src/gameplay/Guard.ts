import {
  AnimationGroup,
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  StandardMaterial,
  TransformNode,
  type Scene,
} from '@babylonjs/core';
import {
  COMBAT,
  canTakedown,
  guardCanSee,
  hasLineOfSight,
  type Point2,
} from '../core/combat';
import { findPath, isFloor, type FloorLayout } from '../core/dungeon';
import { resolveCircle, type Aabb2 } from '../core/collision';
import type { Rng } from '../core/rng';
import type { AssetLibrary } from '../world/AssetLibrary';

const MODEL_YAW_OFFSET = Math.PI;

export type GuardState = 'patrol' | 'suspicious' | 'alert' | 'search' | 'dead';

export interface GuardSpawn {
  x: number;
  z: number;
  floor: number;
}

export interface GuardContext {
  scene: Scene;
  library: AssetLibrary;
  floor: FloorLayout;
  floorIndex: number;
  colliders: readonly Aabb2[];
  tile: number;
  floorY: number;
  rng: Rng;
  index: number;
  isBlocked?: (x: number, z: number) => boolean;
}

export interface GuardPlayerView {
  x: number;
  z: number;
  floor: number;
  crouching: boolean;
  moving: boolean;
}

/**
 * A single patrolling guard. The AI is deliberately simple and readable:
 * patrol until something is seen or heard, investigate, then chase and attack
 * when alerted. All movement stays on the guard's own floor.
 */
export class Guard {
  readonly root: TransformNode;
  readonly floor: number;
  readonly radius = COMBAT.guardRadius;
  readonly height = COMBAT.guardHeight;
  state: GuardState = 'patrol';
  health = COMBAT.guardHealth;
  x: number;
  z: number;
  yaw: number;
  onAttack: ((damage: number) => void) | null = null;
  onDeath: (() => void) | null = null;

  private readonly floorLayout: FloorLayout;
  private readonly colliders: readonly Aabb2[];
  private readonly tile: number;
  private readonly floorY: number;
  private readonly rng: Rng;
  private readonly isBlocked: ((x: number, z: number) => boolean) | undefined;
  private readonly spawnCell: Point2;
  private readonly animations = new Map<string, AnimationGroup>();
  private readonly marker: Mesh;
  private readonly markerTexture: DynamicTexture;
  private animationName = '';
  private hitAnimTimer = 0;

  private path: Point2[] = [];
  private pathIndex = 0;
  private pauseTimer = 0;
  private searchTimer = 0;
  private lostSightTimer = 0;
  private attackCooldown = 0;
  private attackWindup = 0;
  private attacking = false;
  private repathTimer = 0;
  private deadTimer = 0;
  private markerState = '';
  private lastKnown: Point2 | null = null;
  private moving = false;

  private constructor(
    context: GuardContext,
    spawn: GuardSpawn,
    root: TransformNode,
    animations: Map<string, AnimationGroup>,
  ) {
    this.floor = context.floorIndex;
    this.floorLayout = context.floor;
    this.colliders = context.colliders;
    this.tile = context.tile;
    this.floorY = context.floorY;
    this.rng = context.rng;
    this.isBlocked = context.isBlocked;
    this.spawnCell = { x: spawn.x, z: spawn.z };
    this.x = spawn.x * context.tile;
    this.z = spawn.z * context.tile;
    this.yaw = context.rng.floatBetween(0, Math.PI * 2);
    this.root = root;
    this.animations = animations;

    this.root.position.set(this.x, this.floorY, this.z);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;

    const marker = MeshBuilder.CreatePlane(`guard-marker-${context.index}`, { size: 0.55 }, context.scene);
    marker.parent = this.root;
    marker.position.y = 2.2;
    marker.billboardMode = Mesh.BILLBOARDMODE_ALL;
    marker.isPickable = false;
    this.marker = marker;

    this.markerTexture = new DynamicTexture(
      `guard-marker-tex-${context.index}`,
      { width: 128, height: 128 },
      context.scene,
      false,
    );
    this.markerTexture.hasAlpha = true;
    const markerMaterial = new StandardMaterial(`guard-marker-mat-${context.index}`, context.scene);
    markerMaterial.diffuseTexture = this.markerTexture;
    markerMaterial.opacityTexture = this.markerTexture;
    markerMaterial.emissiveColor = Color3.White();
    markerMaterial.disableLighting = true;
    markerMaterial.backFaceCulling = false;
    markerMaterial.fogEnabled = false;
    marker.material = markerMaterial;
    marker.setEnabled(false);

    this.setAnimation('idle_stand', true);
  }

  static async create(
    context: GuardContext,
    spawn: GuardSpawn,
    parent: TransformNode,
  ): Promise<Guard | null> {
    const container = await context.library.load('custom', 'guard');
    if (!container) {
      return null;
    }
    const instantiated = container.instantiateModelsToScene(
      (sourceName) => `guard-${context.index}-${sourceName}`,
      true,
    );
    const root = new TransformNode(`guard-root-${context.index}`, context.scene);
    root.parent = parent;
    for (const node of instantiated.rootNodes) {
      node.parent = root;
    }
    for (const group of instantiated.animationGroups) {
      group.stop();
    }
    for (const mesh of root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
      if (mesh.material instanceof PBRMaterial) {
        mesh.material.emissiveColor = new Color3(0.045, 0.045, 0.055);
      }
    }

    const animations = new Map<string, AnimationGroup>();
    for (const group of instantiated.animationGroups) {
      const shortName = group.name.replace(`guard-${context.index}-`, '');
      animations.set(shortName, group);
    }
    return new Guard(context, spawn, root, animations);
  }

  get isAlive(): boolean {
    return this.state !== 'dead';
  }

  get isAlerted(): boolean {
    return this.state === 'alert';
  }

  /**
   * Update perception, movement and attacks. `visionRange` and `noiseRadius`
   * are supplied by the combat system so training/sneaking remain player-side.
   */
  update(
    dt: number,
    player: GuardPlayerView,
    visionRange: number,
    noiseRadius: number,
  ): void {
    if (this.state === 'dead') {
      this.updateDead(dt);
      return;
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.repathTimer = Math.max(0, this.repathTimer - dt);
    this.hitAnimTimer = Math.max(0, this.hitAnimTimer - dt);
    this.moving = false;

    const distance = Math.hypot(player.x - this.x, player.z - this.z);
    const sameFloor = player.floor === this.floor;
    const sees =
      sameFloor &&
      guardCanSee(this.x, this.z, this.yaw, player.x, player.z, visionRange) &&
      hasLineOfSight(this.floorLayout, this.x, this.z, player.x, player.z, this.tile);
    const hears =
      sameFloor &&
      noiseRadius > 0 &&
      distance <= noiseRadius &&
      this.state !== 'alert';

    if (sees) {
      this.lastKnown = { x: player.x, z: player.z };
      this.lostSightTimer = 0;
      if (this.state !== 'alert') {
        this.enterAlert();
      }
    } else if (this.state === 'alert') {
      this.lostSightTimer += dt;
      if (this.lostSightTimer > 1.2) {
        this.state = 'search';
        this.searchTimer = COMBAT.guardSearchSeconds;
        this.setPathToCell(this.cellOf(player.x, player.z));
        this.updateMarker();
      }
    }

    if (hears) {
      const noisePoint = { x: player.x, z: player.z };
      if (this.state === 'patrol') {
        this.state = 'suspicious';
        this.lastKnown = noisePoint;
        this.searchTimer = 3;
        this.setPathToCell(this.cellOf(player.x, player.z));
        this.updateMarker();
      } else if (this.state === 'suspicious' || this.state === 'search') {
        this.lastKnown = noisePoint;
      }
    }

    switch (this.state) {
      case 'patrol':
        this.updatePatrol(dt);
        break;
      case 'suspicious':
        this.updateInvestigation(dt, 3);
        break;
      case 'search':
        this.updateInvestigation(dt, COMBAT.guardSearchSeconds);
        break;
      case 'alert':
        this.updateAlert(dt, player, distance, sees);
        break;
      default:
        break;
    }

    this.applyMovementAnimation();
  }

  /** Keep the guard stationary until it is disturbed. Used by /combat. */
  hold(seconds: number): void {
    this.pauseTimer = seconds;
    this.path = [];
  }

  /** Make the guard investigate a point, e.g. an arrow impact or a body. */
  alertAt(x: number, z: number): void {
    if (this.state === 'dead') {
      return;
    }
    if (this.state === 'alert') {
      this.lastKnown = { x, z };
      return;
    }
    this.state = 'suspicious';
    this.lastKnown = { x, z };
    this.searchTimer = 3;
    this.setPathToCell(this.cellOf(x, z));
    this.updateMarker();
  }

  takeDamage(amount: number, source: Point2): void {
    if (this.state === 'dead') {
      return;
    }
    this.health -= amount;
    if (this.health <= 0) {
      this.die();
      return;
    }
    this.state = 'alert';
    this.lastKnown = { x: source.x, z: source.z };
    this.lostSightTimer = 0;
    this.attackCooldown = Math.max(this.attackCooldown, 0.35);
    this.hitAnimTimer = 0.55;
    this.setAnimation('hit_spear', false);
    this.updateMarker();
  }

  canBeTakenDown(playerX: number, playerZ: number, crouching: boolean): boolean {
    return canTakedown(
      this.x,
      this.z,
      this.yaw,
      playerX,
      playerZ,
      crouching,
      this.state === 'alert' || this.state === 'dead',
    );
  }

  takeDown(): void {
    if (this.state === 'dead') {
      return;
    }
    this.die();
  }

  dispose(): void {
    for (const group of this.animations.values()) {
      group.dispose();
    }
    this.animations.clear();
    this.root.dispose(false, true);
  }

  private updatePatrol(dt: number): void {
    if (this.pauseTimer > 0) {
      this.pauseTimer -= dt;
      this.setAnimation('idle_stand', true);
      return;
    }
    if (this.path.length === 0 && !this.pickPatrolTarget()) {
      this.pauseTimer = 1.5;
      return;
    }
    if (this.followPath(dt, COMBAT.guardSpeed)) {
      this.setAnimation('idle_walk', true);
    } else {
      this.pauseTimer = this.rng.floatBetween(1.2, 3);
      this.path = [];
      this.setAnimation('idle_stand', true);
    }
  }

  private updateInvestigation(dt: number, seconds: number): void {
    if (this.path.length > 0) {
      if (this.followPath(dt, COMBAT.guardSpeed)) {
        this.setAnimation('idle_walk', true);
      } else {
        this.path = [];
        this.searchTimer = Math.max(this.searchTimer, seconds);
      }
      return;
    }

    this.searchTimer = Math.max(0, this.searchTimer - dt);
    if (this.searchTimer > 0) {
      if (this.lastKnown) {
        this.face(this.lastKnown.x, this.lastKnown.z);
      }
      this.setAnimation('idle_stand', true);
      return;
    }

    this.state = 'patrol';
    this.lastKnown = null;
    this.pauseTimer = this.rng.floatBetween(0.5, 1.5);
    this.updateMarker();
  }

  private updateAlert(dt: number, player: GuardPlayerView, distance: number, sees: boolean): void {
    if (this.attacking) {
      this.attackWindup -= dt;
      if (this.attackWindup <= 0) {
        this.attacking = false;
        this.attackCooldown = COMBAT.guardAttackCooldown;
        if (distance <= COMBAT.guardAttackRange + 0.5) {
          this.onAttack?.(COMBAT.guardDamage);
        }
        this.setAnimation('alerted_stand', true);
      }
      return;
    }

    if (sees && distance <= COMBAT.guardAttackRange && this.attackCooldown <= 0) {
      this.attacking = true;
      this.attackWindup = COMBAT.guardAttackWindup;
      this.hitAnimTimer = COMBAT.guardAttackWindup + 0.2;
      this.face(player.x, player.z);
      this.setAnimation('hit_spear', false);
      return;
    }

    if (this.repathTimer <= 0) {
      this.setPathToCell(this.cellOf(player.x, player.z));
      this.repathTimer = 0.45;
    }

    if (sees && distance < 8) {
      // Close the final gap directly; pathfinding is still used for corners.
      if (this.moveTowards(player.x, player.z, COMBAT.guardChaseSpeed, dt)) {
        this.setAnimation('alerted_stand', true);
      } else {
        this.setAnimation('alerted_walk', true);
      }
      return;
    }

    if (this.followPath(dt, COMBAT.guardChaseSpeed)) {
      this.setAnimation('alerted_walk', true);
    } else {
      this.setAnimation('alerted_stand', true);
    }
  }

  private enterAlert(): void {
    this.state = 'alert';
    this.lostSightTimer = 0;
    this.repathTimer = 0;
    this.updateMarker();
  }

  private pickPatrolTarget(): boolean {
    const origin = this.cellOf(this.x, this.z);
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const cellX = this.spawnCell.x + this.rng.intBetween(-7, 7);
      const cellZ = this.spawnCell.z + this.rng.intBetween(-7, 7);
      if (
        (cellX === origin.x && cellZ === origin.z) ||
        !isFloor(this.floorLayout, cellX, cellZ)
      ) {
        continue;
      }
      if (this.setPathToCell({ x: cellX, z: cellZ })) {
        return true;
      }
    }
    return false;
  }

  private setPathToCell(cell: Point2): boolean {
    const from = this.cellOf(this.x, this.z);
    const path = findPath(this.floorLayout, from, cell, this.isBlocked);
    if (path.length === 0) {
      return false;
    }
    this.path = path;
    this.pathIndex = path.length > 1 && path[0]?.x === from.x && path[0]?.z === from.z ? 1 : 0;
    return true;
  }

  /** Move along the current path. Returns true while still moving. */
  private followPath(dt: number, speed: number): boolean {
    if (this.path.length === 0) {
      return false;
    }
    while (this.pathIndex < this.path.length) {
      const target = this.path[this.pathIndex];
      if (!target) {
        break;
      }
      const arrived = this.moveTowards(target.x * this.tile, target.z * this.tile, speed, dt);
      if (!arrived) {
        return true;
      }
      this.pathIndex += 1;
    }
    this.path = [];
    return false;
  }

  /** Move toward a world point, resolving against the floor's walls. */
  private moveTowards(targetX: number, targetZ: number, speed: number, dt: number): boolean {
    const dx = targetX - this.x;
    const dz = targetZ - this.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.22) {
      return true;
    }
    const step = Math.min(distance, speed * dt);
    const nextX = this.x + (dx / distance) * step;
    const nextZ = this.z + (dz / distance) * step;
    const resolved = resolveCircle(
      nextX,
      nextZ,
      this.radius,
      this.colliders,
      undefined,
      3,
      {
        minY: this.floorY + 0.1,
        maxY: this.floorY + this.height,
      },
    );
    this.x = resolved.x;
    this.z = resolved.z;
    this.face(targetX, targetZ);
    this.moving = true;
    this.root.position.x = this.x;
    this.root.position.z = this.z;
    return false;
  }

  private face(targetX: number, targetZ: number): void {
    this.yaw = Math.atan2(targetX - this.x, targetZ - this.z);
    this.root.rotation.y = this.yaw + MODEL_YAW_OFFSET;
  }

  private applyMovementAnimation(): void {
    if (this.attacking || this.hitAnimTimer > 0) {
      return;
    }
    if (this.state === 'alert') {
      this.setAnimation(this.moving ? 'alerted_walk' : 'alerted_stand', true);
    } else if (this.state === 'patrol' || this.state === 'suspicious' || this.state === 'search') {
      this.setAnimation(this.moving ? 'idle_walk' : 'idle_stand', true);
    }
  }

  private setAnimation(name: string, loop: boolean): void {
    if (this.animationName === name) {
      return;
    }
    const group = this.animations.get(name);
    if (!group) {
      return;
    }
    for (const other of this.animations.values()) {
      other.stop();
    }
    this.animationName = name;
    group.start(loop, 1);
  }

  private updateMarker(): void {
    if (this.state === 'dead') {
      this.marker.setEnabled(false);
      return;
    }
    const next = this.state === 'alert' ? '!' : this.state === 'patrol' ? '' : '?';
    if (next === this.markerState) {
      return;
    }
    this.markerState = next;
    if (!next) {
      this.marker.setEnabled(false);
      return;
    }
    const color = next === '!' ? '#e05a45' : '#e6b84c';
    const context = this.markerTexture.getContext() as CanvasRenderingContext2D;
    context.clearRect(0, 0, 128, 128);
    this.markerTexture.drawText(next, null, 100, 'bold 104px Segoe UI', color, 'transparent', true);
    this.marker.setEnabled(true);
  }

  private die(): void {
    if (this.state === 'dead') {
      return;
    }
    this.state = 'dead';
    this.health = 0;
    this.deadTimer = 0;
    this.marker.setEnabled(false);
    for (const group of this.animations.values()) {
      group.stop();
    }
    this.onDeath?.();
  }

  private updateDead(dt: number): void {
    this.deadTimer += dt;
    if (this.deadTimer < 1.1) {
      this.root.rotation.x = Math.min(Math.PI / 2, this.deadTimer * 2.4);
    } else if (this.deadTimer > 3.2) {
      this.root.setEnabled(false);
    }
  }

  private cellOf(x: number, z: number): Point2 {
    return {
      x: Math.round(x / this.tile),
      z: Math.round(z / this.tile),
    };
  }
}
