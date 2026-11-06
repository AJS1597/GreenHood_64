import {
  AbstractMesh,
  Color3,
  HemisphericLight,
  Light,
  Mesh,
  PBRMaterial,
  PointLight,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { aabbFromCenter, type Aabb2, type Bounds2 } from '../core/collision';
import { FLOOR, generateDungeon, isFloor, type Dungeon, type FloorLayout } from '../core/dungeon';
import type { AssetLibrary } from './AssetLibrary';
import { createCastleSky, type Sky } from './Skybox';

const TILE = 4;
const WALL_H = 4.15;
const FLOOR_H = 8.3;

export interface DungeonInteractable {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  floor: number;
}

interface FloorData {
  colliders: Aabb2[];
  bounds: Bounds2;
  torches: Vector3[];
}

/**
 * Builds a generated castle into the shared scene and owns everything it adds.
 *
 * Both floors exist at once (the upper one 8.3 m up); only the active floor is
 * rendered and collidable. Stairs carry the player between floors with a short
 * transition while a fully walkable ramp is developed.
 */
export class DungeonScene {
  readonly dungeon: Dungeon;
  readonly root: TransformNode;
  interactables: DungeonInteractable[] = [];
  currentFloor = 0;

  private readonly library: AssetLibrary;
  private readonly scene: Scene;
  private readonly lights: Light[] = [];
  private readonly lightPool: PointLight[] = [];
  private readonly sky: Sky;
  private readonly floorRoots: [TransformNode, TransformNode];
  private readonly floors: [FloorData, FloorData];
  private readonly stairBase: { x: number; z: number };
  private readonly stairTop: { x: number; z: number };
  private cloneCounter = 0;
  private transitionCooldown = 0;

  constructor(scene: Scene, library: AssetLibrary, seed: number) {
    this.library = library;
    this.scene = scene;
    this.dungeon = generateDungeon(seed);
    this.root = new TransformNode('dungeon-root', scene);

    this.stairBase = { x: this.dungeon.stairs.x, z: this.dungeon.stairs.z + 1 };
    this.stairTop = { x: this.dungeon.stairs.x, z: this.dungeon.stairs.z - 2 };
    this.carveStairShaft();

    const ambient = new HemisphericLight('dungeon-ambient', new Vector3(0, 1, 0), scene);
    ambient.intensity = 0.62;
    ambient.diffuse = new Color3(0.62, 0.66, 0.78);
    ambient.groundColor = new Color3(0.14, 0.15, 0.19);
    this.lights.push(ambient);
    scene.ambientColor = new Color3(0.16, 0.16, 0.2);

    for (let i = 0; i < 4; i += 1) {
      const light = new PointLight(`dungeon-torch-${i}`, new Vector3(0, 2.4, 0), scene);
      light.diffuse = new Color3(1, 0.78, 0.5);
      light.range = 22;
      light.intensity = 1.3;
      this.lightPool.push(light);
    }

    this.sky = createCastleSky(scene);
    this.sky.root.parent = this.root;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.02, 0.02, 0.03);
    scene.fogDensity = 0.02;

    this.floorRoots = [
      new TransformNode('dungeon-floor-0', scene),
      new TransformNode('dungeon-floor-1', scene),
    ];
    this.floorRoots[0]!.parent = this.root;
    this.floorRoots[1]!.parent = this.root;

    this.floors = [
      { colliders: [], bounds: boundsFor(this.dungeon.floors[0]), torches: [] },
      { colliders: [], bounds: boundsFor(this.dungeon.floors[1]), torches: [] },
    ];
  }

  async build(): Promise<void> {
    await this.buildFloor(0);
    await this.buildFloor(1);
    await this.buildStairs();
    await this.buildEntrance();
    await this.buildLoot();
    this.setFloor(0);
  }

  dispose(): void {
    this.sky.dispose();
    for (const light of this.lights) {
      light.dispose();
    }
    for (const light of this.lightPool) {
      light.dispose();
    }
    this.lights.length = 0;
    this.lightPool.length = 0;
    this.root.dispose(false, true);
  }

  get colliders(): Aabb2[] {
    return this.floors[this.currentFloor]!.colliders;
  }

  get bounds(): Bounds2 {
    return this.floors[this.currentFloor]!.bounds;
  }

  get baseY(): number {
    return this.currentFloor === 0 ? 0 : FLOOR_H;
  }

  nearest(x: number, z: number): DungeonInteractable | null {
    let best: DungeonInteractable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of this.interactables) {
      if (item.floor !== this.currentFloor) {
        continue;
      }
      const distance = Math.hypot(item.x - x, item.z - z);
      if (distance <= item.radius && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * If the player is standing on a stair trigger, move them to the other floor.
   * Returns the destination world position, or null when nothing happened.
   */
  tryUseStairs(x: number, z: number): { x: number; z: number } | null {
    const now = performance.now();
    if (now < this.transitionCooldown) {
      return null;
    }
    if (this.currentFloor === 0 && distanceToCell(x, z, this.stairBase) < TILE * 0.7) {
      this.setFloor(1);
      this.transitionCooldown = now + 900;
      return { x: this.dungeon.stairs.x * TILE, z: (this.stairTop.z - 1) * TILE };
    }
    if (this.currentFloor === 1 && distanceToCell(x, z, this.stairTop) < TILE * 0.7) {
      this.setFloor(0);
      this.transitionCooldown = now + 900;
      return { x: this.dungeon.stairs.x * TILE, z: (this.stairBase.z + 1) * TILE };
    }
    return null;
  }

  /** Keep a few torch lights near the player so the castle stays readable. */
  updateLighting(player: Vector3): void {
    const torches = this.floors[this.currentFloor]!.torches;
    if (torches.length === 0) {
      return;
    }
    const sorted = torches
      .map((position) => ({ position, distance: Vector3.DistanceSquared(position, player) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.lightPool.length);
    for (let i = 0; i < this.lightPool.length; i += 1) {
      const light = this.lightPool[i] as PointLight;
      const entry = sorted[i];
      if (!entry) {
        light.setEnabled(false);
        continue;
      }
      light.position.copyFrom(entry.position);
      light.setEnabled(true);
    }
  }

  private setFloor(floor: number): void {
    this.currentFloor = floor;
    this.floorRoots[0]!.setEnabled(floor === 0);
    this.floorRoots[1]!.setEnabled(floor === 1);
  }

  private async buildFloor(floorIndex: number): Promise<void> {
    const layout = this.dungeon.floors[floorIndex] as FloorLayout;
    const parent = this.floorRoots[floorIndex]!;
    const baseY = floorIndex * FLOOR_H;

    const floorMesh = await this.cloneMesh('dungeon', 'template-floor', parent);
    const wallMesh = await this.cloneMesh('dungeon', 'template-wall', parent);
    if (!floorMesh || !wallMesh) {
      return;
    }
    this.applyTileMaterial(floorMesh, new Color3(0.68, 0.66, 0.74));
    this.applyTileMaterial(wallMesh, new Color3(0.55, 0.56, 0.64));
    // Instanced meshes are cheap and cull correctly; keep the source visible.
    floorMesh.alwaysSelectAsActiveMesh = true;
    wallMesh.alwaysSelectAsActiveMesh = true;

    const colliders: Aabb2[] = [];
    const torches: Vector3[] = [];
    let floorPlaced = false;
    let wallPlaced = false;

    const place = (
      base: Mesh,
      placed: boolean,
      x: number,
      y: number,
      z: number,
      rotationX: number,
      rotationY: number,
    ): boolean => {
      const target = placed
        ? base.createInstance(`${base.name}-i${this.cloneCounter++}`)
        : base;
      // glTF clones come with a rotationQuaternion set, which overrides the
      // euler `rotation`; clear it so yaw/pitch actually apply.
      target.rotationQuaternion = null;
      target.position.set(x, y, z);
      target.rotation.set(rotationX, rotationY, 0);
      return true;
    };

    for (let z = 1; z < layout.height - 1; z += 1) {
      for (let x = 1; x < layout.width - 1; x += 1) {
        if (!isFloor(layout, x, z)) {
          continue;
        }
        const worldX = x * TILE;
        const worldZ = z * TILE;

        if (!this.isFloorHole(floorIndex, x, z)) {
          floorPlaced = place(floorMesh, floorPlaced, worldX, baseY, worldZ, 0, 0);
        }
        if (!this.isCeilingHole(floorIndex, x, z)) {
          floorPlaced = place(floorMesh, floorPlaced, worldX, baseY + WALL_H, worldZ, Math.PI, 0);
        }

        if (!isFloor(layout, x, z - 1)) {
          wallPlaced = place(wallMesh, wallPlaced, worldX, baseY, worldZ - TILE / 2, 0, 0);
          colliders.push(aabbFromCenter(worldX, worldZ - TILE / 2, TILE / 2, 0.2));
        }
        if (!isFloor(layout, x, z + 1)) {
          wallPlaced = place(wallMesh, wallPlaced, worldX, baseY, worldZ + TILE / 2, 0, Math.PI);
          colliders.push(aabbFromCenter(worldX, worldZ + TILE / 2, TILE / 2, 0.2));
        }
        if (!isFloor(layout, x - 1, z)) {
          wallPlaced = place(wallMesh, wallPlaced, worldX - TILE / 2, baseY, worldZ, 0, Math.PI / 2);
          colliders.push(aabbFromCenter(worldX - TILE / 2, worldZ, 0.2, TILE / 2));
        }
        if (!isFloor(layout, x + 1, z)) {
          wallPlaced = place(wallMesh, wallPlaced, worldX + TILE / 2, baseY, worldZ, 0, -Math.PI / 2);
          colliders.push(aabbFromCenter(worldX + TILE / 2, worldZ, 0.2, TILE / 2));
        }

        if ((x + z) % 5 === 0) {
          torches.push(new Vector3(worldX, baseY + 2.4, worldZ));
        }
      }
    }

    if (!floorPlaced) {
      floorMesh.setEnabled(false);
    }
    if (!wallPlaced) {
      wallMesh.setEnabled(false);
    }

    this.floors[floorIndex]!.colliders = colliders;
    this.floors[floorIndex]!.torches = torches;

    await this.decorate(layout, parent, floorIndex);
  }

  private async decorate(layout: FloorLayout, parent: TransformNode, floorIndex: number): Promise<void> {
    const baseY = floorIndex * FLOOR_H;
    for (const room of layout.rooms) {
      const column = await this.cloneMesh('mini', 'column', parent);
      if (column) {
        column.position = new Vector3(room.x * TILE - 3, baseY, room.z * TILE - 3);
      }
      const banner = await this.cloneMesh('mini', 'banner', parent);
      if (banner) {
        banner.position = new Vector3(room.x * TILE, baseY + 1.6, room.z * TILE - 3);
      }
    }
  }

  private async buildStairs(): Promise<void> {
    const mesh = await this.cloneMesh('dungeon', 'stairs', this.root);
    if (mesh) {
      mesh.position = new Vector3(this.dungeon.stairs.x * TILE, 0, this.dungeon.stairs.z * TILE);
    }
  }

  private async buildEntrance(): Promise<void> {
    const mesh = await this.cloneMesh('dungeon', 'gate-door', this.floorRoots[0]!);
    if (mesh) {
      mesh.position = new Vector3(
        this.dungeon.entrance.x * TILE,
        0,
        (this.dungeon.entrance.z - 2) * TILE,
      );
    }
    this.interactables.push({
      id: 'exit',
      label: 'Leave the castle',
      x: this.dungeon.entrance.x * TILE,
      z: this.dungeon.entrance.z * TILE,
      radius: 3.2,
      floor: 0,
    });
  }

  private async buildLoot(): Promise<void> {
    for (const spot of this.dungeon.chests) {
      const x = spot.x * TILE;
      const z = spot.z * TILE;
      const mesh = await this.cloneMesh('mini', 'chest', this.floorRoots[spot.floor]!);
      if (mesh) {
        mesh.position = new Vector3(x, 0, z);
      }
      this.interactables.push({
        id: spot.locked ? 'chest-locked' : 'chest',
        label: spot.locked ? 'Locked chest' : 'Open chest',
        x,
        z,
        radius: 2.2,
        floor: spot.floor,
      });
    }

    for (const spot of this.dungeon.keys) {
      const mesh = await this.cloneMesh('mini', 'key', this.floorRoots[0]!);
      if (mesh) {
        mesh.position = new Vector3(spot.x * TILE, 0.6, spot.z * TILE);
      }
      this.interactables.push({
        id: 'key',
        label: 'Take key',
        x: spot.x * TILE,
        z: spot.z * TILE,
        radius: 2,
        floor: 0,
      });
    }
  }

  private async cloneMesh(kit: 'dungeon' | 'mini', name: string, parent: TransformNode): Promise<Mesh | null> {
    const container = await this.library.load(kit, name);
    const base = firstMesh(container?.meshes);
    if (!base) {
      return null;
    }
    const clone = base.clone(`${name}-${this.cloneCounter++}`, null, false);
    if (!clone) {
      return null;
    }
    clone.parent = parent;
    for (const child of clone.getChildMeshes()) {
      child.parent = clone;
    }
    return clone;
  }

  /**
   * Replace a tile's PBR material with an unlit, tinted texture material.
   * The kit's floor tiles contain coplanar faces with opposing normals, which
   * makes PBR lighting unpredictable; this keeps every tile readable.
   */
  private applyTileMaterial(mesh: Mesh, tint: Color3): void {
    const source = mesh.material as PBRMaterial | null;
    const texture = source?.albedoTexture ?? null;
    const material = new StandardMaterial(`dungeon-tile-${this.cloneCounter++}`, this.scene);
    material.disableLighting = true;
    material.diffuseColor = Color3.White();
    material.emissiveColor = tint;
    material.specularColor = Color3.Black();
    material.backFaceCulling = false;
    material.fogEnabled = true;
    if (texture) {
      material.diffuseTexture = texture;
    }
    mesh.material = material;
  }

  private isFloorHole(floorIndex: number, x: number, z: number): boolean {
    if (floorIndex !== 1 || x !== this.dungeon.stairs.x) {
      return false;
    }
    return z >= this.dungeon.stairs.z - 1 && z <= this.dungeon.stairs.z;
  }

  private isCeilingHole(floorIndex: number, x: number, z: number): boolean {
    if (floorIndex !== 0 || x !== this.dungeon.stairs.x) {
      return false;
    }
    return z >= this.dungeon.stairs.z - 1 && z <= this.dungeon.stairs.z;
  }

  /** Open a straight shaft so the staircase and both landings are clear. */
  private carveStairShaft(): void {
    const floor0 = this.dungeon.floors[0];
    const floor1 = this.dungeon.floors[1];
    const { x } = this.dungeon.stairs;
    for (let z = this.dungeon.stairs.z - 3; z <= this.dungeon.stairs.z + 2; z += 1) {
      setFloorCell(floor0, x, z);
    }
    for (let z = this.dungeon.stairs.z - 4; z <= this.dungeon.stairs.z; z += 1) {
      setFloorCell(floor1, x, z);
    }
  }
}

function setFloorCell(layout: FloorLayout, x: number, z: number): void {
  if (x > 0 && z > 0 && x < layout.width - 1 && z < layout.height - 1) {
    layout.cells[z * layout.width + x] = FLOOR;
  }
}

function boundsFor(layout: FloorLayout): Bounds2 {
  return {
    minX: TILE,
    minZ: TILE,
    maxX: (layout.width - 2) * TILE,
    maxZ: (layout.height - 2) * TILE,
  };
}

function firstMesh(meshes: AbstractMesh[] | undefined): Mesh | null {
  if (!meshes) {
    return null;
  }
  for (const mesh of meshes) {
    // glTF containers put an empty "__root__" mesh first; skip anything with no
    // geometry or the clones (and their thin instances) render nothing.
    if (mesh instanceof Mesh && mesh.getTotalVertices() > 0) {
      return mesh;
    }
  }
  return null;
}

function distanceToCell(x: number, z: number, cell: { x: number; z: number }): number {
  return Math.hypot(x - cell.x * TILE, z - cell.z * TILE);
}
