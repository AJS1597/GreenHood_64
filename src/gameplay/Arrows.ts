import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import { COMBAT, pointHitsGuard, pointHitsWall } from '../core/combat';
import type { DungeonScene } from '../world/DungeonScene';
import type { Guard } from './Guard';

interface ArrowProjectile {
  mesh: Mesh;
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

  constructor(private readonly scene: Scene) {
    this.root = new TransformNode('arrow-system', scene);
    this.shaftMaterial = new StandardMaterial('arrow-shaft-mat', scene);
    this.shaftMaterial.diffuseColor = new Color3(0.45, 0.31, 0.17);
    this.shaftMaterial.emissiveColor = new Color3(0.16, 0.1, 0.05);
    this.shaftMaterial.specularColor = Color3.Black();
  }

  spawn(origin: Vector3, velocity: Vector3, damage: number, floor: number, lifetime: number): void {
    const mesh = MeshBuilder.CreateBox(
      `arrow-${this.arrows.length}-${performance.now()}`,
      { width: 0.045, height: 0.045, depth: 0.6 },
      this.scene,
    );
    mesh.parent = this.root;
    mesh.material = this.shaftMaterial;
    mesh.isPickable = false;
    mesh.position.copyFrom(origin);
    this.orient(mesh, velocity);
    this.arrows.push({
      mesh,
      position: origin.clone(),
      velocity: velocity.clone(),
      damage,
      floor,
      life: lifetime,
    });
  }

  update(
    dt: number,
    dungeon: DungeonScene,
    guards: readonly Guard[],
    onGuardHit: (guard: Guard, damage: number, point: Vector3) => void,
    onImpact: (point: Vector3, floor: number) => void,
  ): void {
    const walls = dungeon.colliders;
    const floorHeight = dungeon.floorHeight;
    const wallHeight = dungeon.wallHeight;

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

      for (let step = 0; step < steps; step += 1) {
        arrow.velocity.y -= COMBAT.arrowGravity * stepDt;
        arrow.position.addInPlace(arrow.velocity.scale(stepDt));

        const floorBase = arrow.floor * floorHeight;
        const ceiling = floorBase + wallHeight;
        if (arrow.position.y <= floorBase || arrow.position.y >= ceiling) {
          onImpact(arrow.position.clone(), arrow.floor);
          this.spawnImpact(arrow.position, new Color3(0.55, 0.47, 0.36));
          hit = true;
          break;
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
            )
          ) {
            onGuardHit(guard, arrow.damage, arrow.position.clone());
            this.spawnImpact(arrow.position, new Color3(0.75, 0.16, 0.12));
            hit = true;
            break;
          }
        }
        if (hit) {
          break;
        }

        arrow.mesh.position.copyFrom(arrow.position);
        this.orient(arrow.mesh, arrow.velocity);
      }

      if (hit) {
        this.removeArrow(i);
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
      arrow.mesh.dispose();
    }
    this.arrows.length = 0;
    for (const impact of this.impacts) {
      impact.mesh.dispose(false, true);
    }
    this.impacts.length = 0;
  }

  dispose(): void {
    this.clear();
    this.root.dispose();
  }

  private removeArrow(index: number): void {
    const arrow = this.arrows[index];
    if (!arrow) {
      return;
    }
    arrow.mesh.dispose();
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

  private orient(mesh: Mesh, velocity: Vector3): void {
    const horizontal = Math.hypot(velocity.x, velocity.z);
    mesh.rotation.y = Math.atan2(velocity.x, velocity.z);
    mesh.rotation.x = -Math.atan2(velocity.y, horizontal);
  }
}
