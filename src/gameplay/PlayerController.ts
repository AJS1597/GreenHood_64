import { UniversalCamera, Vector3, type Scene } from '@babylonjs/core';
import { resolveCircle, type Aabb2, type Bounds2 } from '../core/collision';

/** Player-facing settings sourced from the save file. */
export interface PlayerSettings {
  sensitivity: number;
  invertY: boolean;
  headBob: boolean;
}

/** Movement tuning, kept separate so tests and the hub can share defaults. */
export interface PlayerTuning {
  eyeHeight: number;
  crouchEyeHeight: number;
  radius: number;
  bodyHeight: number;
  walkSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  acceleration: number;
}

export const DEFAULT_PLAYER_TUNING: PlayerTuning = {
  eyeHeight: 1.6,
  crouchEyeHeight: 1.1,
  radius: 0.35,
  bodyHeight: 1.75,
  walkSpeed: 3.4,
  sprintSpeed: 6.0,
  crouchSpeed: 1.6,
  acceleration: 14,
};

/**
 * Pointer-locked first-person controller.
 *
 * Owns the camera transform, reads WASD / Shift / C, and resolves movement
 * against a list of 2D boxes. The hub and the dungeon both drive it; they only
 * swap the collider list and bounds.
 */
export class PlayerController {
  colliders: readonly Aabb2[] = [];
  bounds: Bounds2 | null = null;
  baseY = 0;
  /**
   * Optional height sampler for ramps and multi-storey spaces. When set, the
   * controller follows the returned walking surface instead of the flat baseY.
   */
  groundHeight: ((x: number, z: number) => number) | null = null;

  onInteract: (() => void) | null = null;
  onLockChange: ((locked: boolean) => void) | null = null;

  readonly camera: UniversalCamera;

  private readonly tuning: PlayerTuning;
  private readonly settings: PlayerSettings;
  private readonly keys = new Set<string>();
  private readonly disposers: Array<() => void> = [];

  private x = 0;
  private z = 0;
  private yaw = 0;
  private pitch = 0;
  private velocityX = 0;
  private velocityZ = 0;
  private currentEye: number;
  private feetY = 0;
  private lastPointerMoveAt = 0;
  private crouching = false;
  private sprinting = false;
  private locked = false;

  constructor(
    scene: Scene,
    private readonly canvas: HTMLCanvasElement,
    settings: PlayerSettings,
    tuning: PlayerTuning = DEFAULT_PLAYER_TUNING,
  ) {
    this.settings = settings;
    this.tuning = tuning;
    this.currentEye = tuning.eyeHeight;

    this.camera = new UniversalCamera('player-camera', new Vector3(0, tuning.eyeHeight, 0), scene);
    this.camera.minZ = 0.06;
    this.camera.maxZ = 400;
    this.camera.fov = 1.15;
    // We drive rotation manually from pointer-lock deltas.
    this.camera.inputs.clear();

    this.bind();
  }

  get position(): { x: number; z: number } {
    return { x: this.x, z: this.z };
  }

  get isLocked(): boolean {
    return this.locked;
  }

  get isCrouching(): boolean {
    return this.crouching;
  }

  get isSprinting(): boolean {
    return this.sprinting;
  }

  /** Current horizontal speed in metres per second. */
  get speed(): number {
    return Math.hypot(this.velocityX, this.velocityZ);
  }

  /** Height of the walking surface under the player's feet. */
  get feet(): number {
    return this.feetY;
  }

  spawn(x: number, z: number, yaw: number): void {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.pitch = 0;
    this.velocityX = 0;
    this.velocityZ = 0;
    this.feetY = this.groundHeight ? this.groundHeight(x, z) : this.baseY;
    this.syncCamera();
  }

  /** Ask the browser for pointer lock; must be called from a user gesture. */
  requestLock(): void {
    void this.canvas.requestPointerLock();
  }

  releaseLock(): void {
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
  }

  update(deltaMs: number): void {
    const dt = Math.min(deltaMs, 100) / 1000;
    this.updateCrouch();
    if (!this.locked) {
      this.decayVelocity(dt);
      this.updateGroundHeight(dt);
      this.syncCamera(dt);
      return;
    }
    this.updateMovement(dt);
    this.updateGroundHeight(dt);
    this.syncCamera(dt);
  }

  dispose(): void {
    for (const dispose of this.disposers) {
      dispose();
    }
    this.disposers.length = 0;
    this.camera.dispose();
  }

  private bind(): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat) {
        return;
      }
      this.keys.add(event.code);
      if (event.code === 'KeyE') {
        this.onInteract?.();
      }
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      this.keys.delete(event.code);
    };
    const applyLook = (movementX: number, movementY: number): void => {
      if (!this.locked) {
        return;
      }
      const sensitivity = 0.0022 * this.settings.sensitivity;
      this.yaw += movementX * sensitivity;
      this.pitch += movementY * sensitivity * (this.settings.invertY ? -1 : 1);
      const limit = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType && event.pointerType !== 'mouse') {
        return;
      }
      if (event.movementX === 0 && event.movementY === 0) {
        return;
      }
      this.lastPointerMoveAt = performance.now();
      applyLook(event.movementX, event.movementY);
    };
    const onMouseMove = (event: MouseEvent): void => {
      // Pointer events keep firing while a mouse button is held; compatibility
      // mousemove can be suppressed during a drag/charge. Use mousemove only
      // when pointermove is unavailable.
      if (performance.now() - this.lastPointerMoveAt < 50) {
        return;
      }
      applyLook(event.movementX, event.movementY);
    };
    const onLockChange = (): void => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.keys.clear();
        this.velocityX = 0;
        this.velocityZ = 0;
      }
      this.onLockChange?.(this.locked);
    };
    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('pointerlockchange', onLockChange);
    this.canvas.addEventListener('contextmenu', onContextMenu);

    this.disposers.push(
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => document.removeEventListener('pointermove', onPointerMove),
      () => document.removeEventListener('mousemove', onMouseMove),
      () => document.removeEventListener('pointerlockchange', onLockChange),
      () => this.canvas.removeEventListener('contextmenu', onContextMenu),
    );
  }

  private updateCrouch(): void {
    this.crouching = this.keys.has('KeyC');
  }

  private updateMovement(dt: number): void {
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.sprinting =
      !this.crouching &&
      forward > 0 &&
      (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));

    const speed = this.crouching
      ? this.tuning.crouchSpeed
      : this.sprinting
        ? this.tuning.sprintSpeed
        : this.tuning.walkSpeed;

    let dirX = Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe;
    let dirZ = Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe;
    const length = Math.hypot(dirX, dirZ);
    if (length > 1e-4) {
      dirX /= length;
      dirZ /= length;
    } else {
      dirX = 0;
      dirZ = 0;
    }

    const blend = 1 - Math.exp(-this.tuning.acceleration * dt);
    this.velocityX += (dirX * speed - this.velocityX) * blend;
    this.velocityZ += (dirZ * speed - this.velocityZ) * blend;

    const nextX = this.x + this.velocityX * dt;
    const nextZ = this.z + this.velocityZ * dt;
    const resolved = resolveCircle(
      nextX,
      nextZ,
      this.tuning.radius,
      this.colliders,
      this.bounds ?? undefined,
      3,
      {
        minY: this.feetY + 0.1,
        maxY: this.feetY + this.tuning.bodyHeight,
      },
    );
    this.x = resolved.x;
    this.z = resolved.z;
  }

  private updateGroundHeight(dt: number): void {
    const target = this.groundHeight ? this.groundHeight(this.x, this.z) : this.baseY;
    // Fast smoothing keeps stair ramps comfortable without snapping the camera
    // when a floor transition happens.
    const blend = Math.min(1, dt * 16);
    this.feetY += (target - this.feetY) * blend;
    if (Math.abs(target - this.feetY) < 0.002) {
      this.feetY = target;
    }
  }

  private decayVelocity(dt: number): void {
    const blend = 1 - Math.exp(-this.tuning.acceleration * dt);
    this.velocityX += (0 - this.velocityX) * blend;
    this.velocityZ += (0 - this.velocityZ) * blend;
  }

  private syncCamera(dt = 0.016): void {
    const targetEye = this.crouching ? this.tuning.crouchEyeHeight : this.tuning.eyeHeight;
    this.currentEye += (targetEye - this.currentEye) * Math.min(1, dt * 12);

    this.camera.position.set(this.x, this.feetY + this.currentEye, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
