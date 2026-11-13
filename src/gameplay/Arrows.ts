import {
  Color3,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  StandardMaterial,
  TransformNode,
  Vector3,
  type AssetContainer,
  type Scene,
} from '@babylonjs/core';
import { COMBAT, pointHitsGuard, pointHitsWall } from '../core/combat';
import type { Aabb2 } from '../core/collision';
import type { AssetLibrary } from '../world/AssetLibrary';
import type { Guard } from './Guard';

/** Narrow world surface needed by arrow simulation (castle or Sherwood). */
export interface ArrowWorld {
  readonly colliders: readonly Aabb2[];
  /** Vertical spacing between stacked storeys. */
  readonly floorHeight: number;
  /** How many walkable storeys are stacked in this world. */
  readonly floorCount: number;
  /**
   * True when the slab between `lowerFloor` and `lowerFloor + 1` has an
   * opening at this position (the castle stairwell, for example).
   */
  isArrowOpening?(x: number, z: number, lowerFloor: number): boolean;
}

interface ArrowProjectile {
  visual: TransformNode;
  position: Vector3;
  velocity: Vector3;
  damage: number;
  floor: number;
  life: number;
}

interface Impact {
  mesh: Mesh;
  life: number;
}

/**
 * Physical arrows. Movement is split into short substeps and each step is
 * point-tested against guards, walls and the storey floor/ceiling, which avoids
 * tunneling without needing a full physics engine.
 */
export class ArrowSystem {
  private readonly root: TransformNode;
  private readonly shaftMaterial: StandardMaterial;
  private readonly arrows: ArrowProjectile[] = [];
  private readonly impacts: Impact[] = [];
  private readonly stuck: TransformNode[] = [];
  private arrowContainer: AssetContainer | null = null;
  private static readonly MAX_STUCK = 20;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
  ) {
    this.root = new TransformNode('arrow-system', scene);
    this.shaftMaterial = new StandardMaterial('arrow-shaft-mat', scene);
    this.shaftMaterial.diffuseColor = Color3.Black();
    this.shaftMaterial.emissiveColor = Color3.White();
    this.shaftMaterial.specularColor = Color3.Black();
    this.shaftMaterial.disableLighting = true;
    this.shaftMaterial.backFaceCulling = false;
    this.shaftMaterial.alpha = 0.95;
  }

  async load(): Promise<void> {
    if (this.arrowContainer) {
      return;
    }
    this.arrowContainer = await this.library.load('custom', 'arrow');
    if (this.arrowContainer) {
      for (const mesh of this.arrowContainer.meshes) {
        const material = mesh.material;
        if (material instanceof PBRMaterial) {
          material.emissiveColor = new Color3(0.1, 0.08, 0.06);
        } else if (material instanceof StandardMaterial) {
          material.emissiveColor = new Color3(0.1, 0.08, 0.06);
        }
      }
    }
  }

  spawn(origin: Vector3, velocity: Vector3, damage: number, floor: number, lifetime: number): void {
    const visual = new TransformNode(`arrow-visual-${this.arrows.length}-${performance.now()}`, this.scene);
    visual.parent = this.root;
    visual.position.copyFrom(origin);
    this.attachVisual(visual);
    this.orient(visual, velocity);
    this.arrows.push({
      visual,
      position: origin.clone(),
      velocity: velocity.clone(),
      damage,
      floor,
      life: lifetime,
    });
  }

  private attachVisual(visual: TransformNode): void {
    if (!this.arrowContainer) {
      const mesh = MeshBuilder.CreateBox(
        `${visual.name}-fallback`,
        { width: 0.05, height: 0.05, depth: 0.8 },
        this.scene,
      );
      mesh.parent = visual;
      mesh.material = this.shaftMaterial;
      mesh.isPickable = false;
      return;
    }
    const instantiated = this.arrowContainer.instantiateModelsToScene(
      (sourceName) => `${visual.name}-${sourceName}`,
      false,
    );
    for (const group of instantiated.animationGroups) {
      group.stop();
    }
    for (const node of instantiated.rootNodes) {
      node.parent = visual;
    }
    for (const mesh of visual.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.alwaysSelectAsActiveMesh = true;
    }
  }

  update(
    dt: number,
    world: ArrowWorld,
    guards: readonly Guard[],
    onGuardHit: (guard: Guard, damage: number, point: Vector3) => void,
    onImpact: (point: Vector3, floor: number) => void,
  ): void {
    const walls = world.colliders;
    const floorHeight = Math.max(0.001, world.floorHeight);
    const floorCount = Math.max(1, world.floorCount);
    const isOpening = world.isArrowOpening?.bind(world) ?? (() => false);

    for (let i = this.arrows.length - 1; i >= 0; i -= 1) {
      const arrow = this.arrows[i];
      if (!arrow) {
        continue;
      }
      arrow.life -= dt;
      if (arrow.life <= 0) {
        this.removeArrow(i);
        continue;
      }

      const speed = arrow.velocity.length();
      const steps = Math.max(1, Math.ceil((speed * dt) / 0.22));
      const stepDt = dt / steps;
      let hit = false;
      let hitGuard: Guard | null = null;

      for (let step = 0; step < steps; step += 1) {
        const previousY = arrow.position.y;
        arrow.velocity.y -= COMBAT.arrowGravity * stepDt;
        arrow.position.addInPlace(arrow.velocity.scale(stepDt));
        const nextY = arrow.position.y;

        if (nextY <= 0) {
          arrow.position.y = 0;
          onImpact(arrow.position.clone(), arrow.floor);
          this.spawnImpact(arrow.position, new Color3(0.55, 0.47, 0.36));
          hit = true;
          break;
        }

        // Storey slabs are solid except where a stairwell opening lets the
        // arrow through. Crossing one changes which floor the arrow belongs to,
        // so an arrow fired up the stairs can hit guards on the floor above.
        if (nextY > previousY) {
          const boundaryFloor = Math.floor(nextY / floorHeight);
          const boundaryY = boundaryFloor * floorHeight;
          if (boundaryFloor > 0 && previousY < boundaryY) {
            const lowerFloor = boundaryFloor - 1;
            if (
              boundaryFloor >= floorCount ||
              !isOpening(arrow.position.x, arrow.position.z, lowerFloor)
            ) {
              arrow.position.y = boundaryY;
              onImpact(arrow.position.clone(), arrow.floor);
              this.spawnImpact(arrow.position, new Color3(0.55, 0.47, 0.36));
              hit = true;
              break;
            }
            arrow.floor = boundaryFloor;
          }
        } else if (nextY < previousY) {
          const boundaryFloor = Math.floor(previousY / floorHeight);
          const boundaryY = boundaryFloor * floorHeight;
          if (boundaryFloor > 0 && nextY < boundaryY) {
            const lowerFloor = boundaryFloor - 1;
            if (!isOpening(arrow.position.x, arrow.position.z, lowerFloor)) {
              arrow.position.y = boundaryY;
              onImpact(arrow.position.clone(), arrow.floor);
              this.spawnImpact(arrow.position, new Color3(0.55, 0.47, 0.36));
              hit = true;
              break;
            }
            arrow.floor = lowerFloor;
          }
        }

        const wallHit = walls.some((box) =>
          pointHitsWall(arrow.position.x, arrow.position.y, arrow.position.z, box),
        );
        if (wallHit) {
          onImpact(arrow.position.clone(), arrow.floor);
          this.spawnImpact(arrow.position, new Color3(0.45, 0.42, 0.4));
          hit = true;
          break;
        }

        for (const guard of guards) {
          if (!guard.isAlive || guard.floor !== arrow.floor) {
            continue;
          }
          if (
            pointHitsGuard(
              arrow.position.x,
              arrow.position.y,
              arrow.position.z,
              guard.x,
              guard.z,
              guard.floor * floorHeight,
              guard.radius,
              guard.height,
            )
          ) {
            onGuardHit(guard, arrow.damage, arrow.position.clone());
            this.spawnImpact(arrow.position, new Color3(0.75, 0.16, 0.12));
            hitGuard = guard;
            hit = true;
            break;
          }
        }
        if (hit) {
          break;
        }

        arrow.visual.position.copyFrom(arrow.position);
        this.orient(arrow.visual, arrow.velocity);
      }

      if (hit) {
        this.stickArrow(i, hitGuard);
      }
    }

    for (let i = this.impacts.length - 1; i >= 0; i -= 1) {
      const impact = this.impacts[i];
      if (!impact) {
        continue;
      }
      impact.life -= dt;
      const scale = 1 + (1 - Math.max(0, impact.life / 0.25)) * 1.8;
      impact.mesh.scaling.setAll(scale);
      if (impact.life <= 0) {
        impact.mesh.dispose(false, true);
        this.impacts.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const arrow of this.arrows) {
      arrow.visual.dispose(false, false);
    }
    this.arrows.length = 0;
    for (const stuck of this.stuck) {
      if (!stuck.isDisposed()) {
        stuck.dispose(false, false);
      }
    }
    this.stuck.length = 0;
    for (const impact of this.impacts) {
      impact.mesh.dispose(false, true);
    }
    this.impacts.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.dispose();
  }

  private stickArrow(index: number, guard: Guard | null): void {
    const arrow = this.arrows[index];
    if (!arrow) {
      return;
    }
    arrow.visual.position.copyFrom(arrow.position);
    this.orient(arrow.visual, arrow.velocity);
    if (guard) {
      // Preserve the world transform while making the arrow follow the guard.
      arrow.visual.setParent(guard.root);
    }
    this.arrows.splice(index, 1);
    this.stuck.push(arrow.visual);
    while (this.stuck.length > ArrowSystem.MAX_STUCK) {
      const oldest = this.stuck.shift();
      if (oldest && !oldest.isDisposed()) {
        oldest.dispose(false, false);
      }
    }
  }

  private removeArrow(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) {
      return;
    }
    arrow.visual.dispose(false, false);
    this.arrows.splice(index, 1);
  }

  private spawnImpact(position: Vector3, color: Color3): void {
    const mesh = MeshBuilder.CreateSphere(
      `arrow-impact-${performance.now()}-${this.impacts.length}`,
      { diameter: 0.12, segments: 6 },
      this.scene,
    );
    mesh.parent = this.root;
    mesh.position.copyFrom(position);
    mesh.isPickable = false;
    const material = new StandardMaterial(`arrow-impact-mat-${performance.now()}`, this.scene);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(0.8);
    material.specularColor = Color3.Black();
    material.disableLighting = true;
    mesh.material = material;
    this.impacts.push({ mesh, life: 0.25 });
  }

  private orient(node: TransformNode, velocity: Vector3): void {
    const horizontal = Math.hypot(velocity.x, velocity.z);
    node.rotation.y = Math.atan2(velocity.x, velocity.z);
    node.rotation.x = -Math.atan2(velocity.y, horizontal);
  }
}
