import {
  AbstractMesh,
  Color3,
  HemisphericLight,
  Light,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointLight,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { aabbFromCenter, type Aabb2, type Bounds2 } from '../core/collision';
import {
  FLOOR,
  generateDungeon,
  isFloor,
  worldBoundsFor,
  type Dungeon,
  type FloorLayout,
} from '../core/dungeon';
import { createRng } from '../core/rng';
import { Guard } from '../gameplay/Guard';
import type { AssetLibrary } from './AssetLibrary';
import { createCastleSky, type Sky } from './Skybox';

const TILE = 4;
const WALL_H = 4.15;
const FLOOR_H = WALL_H;
/**
 * Wall meshes are 4.15 m tall, the same as the ceiling plane. Shrinking them a
 * hair stops their top faces z-fighting with the ceiling tiles.
 */
const WALL_SKIN = 0.985;
/** Ceilings sit a hair below the storey plane so they never fight a floor. */
const CEILING_DROP = 0.02;
/** The stair flight is fitted into a single storey. */
const STAIR_TOP_LOCAL_Z = 2.0;
const STAIR_BOTTOM_LOCAL_Z = 3.4;

export interface DungeonInteractable {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
  floor: number;
  mesh?: Mesh | null;
  collider?: Aabb2;
  auraLight?: PointLight | null;
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
  readonly guards: Guard[] = [];
  interactables: DungeonInteractable[] = [];
  currentFloor = 0;

  private readonly library: AssetLibrary;
  private readonly scene: Scene;
  private readonly lights: Light[] = [];
  private readonly lightPool: PointLight[] = [];
  private readonly sky: Sky;
  private readonly floorRoots: [TransformNode, TransformNode];
  private readonly floors: [FloorData, FloorData];
  private readonly stairZ: number;
  private readonly stairTopZ: number;
  private readonly stairBottomZ: number;
  private readonly stairHoleSouthZ: number;
  private cloneCounter = 0;

  constructor(scene: Scene, library: AssetLibrary, seed: number) {
    this.library = library;
    this.scene = scene;
    this.dungeon = generateDungeon(seed);
    this.root = new TransformNode('dungeon-root', scene);

    // The flight starts at the bottom landing and reaches one storey at the
    // top landing; these anchors drive both the geometry and the height ramp.
    this.stairZ = (this.dungeon.stairs.z - 1) * TILE;
    this.stairTopZ = this.stairZ - STAIR_TOP_LOCAL_Z;
    this.stairBottomZ = this.stairZ + STAIR_BOTTOM_LOCAL_Z;
    this.stairHoleSouthZ = this.dungeon.stairs.z * TILE + TILE / 2;
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
      {
        colliders: [],
        bounds: worldBoundsFor(
          this.dungeon.floors[0].width,
          this.dungeon.floors[0].height,
          TILE,
        ),
        torches: [],
      },
      {
        colliders: [],
        bounds: worldBoundsFor(
          this.dungeon.floors[1].width,
          this.dungeon.floors[1].height,
          TILE,
        ),
        torches: [],
      },
    ];
  }

  async build(): Promise<void> {
    await this.buildFloor(0);
    await this.buildFloor(1);
    await this.buildStairs();
    await this.buildEntrance();
    await this.buildLoot();
    await this.buildGuards();
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
    for (const guard of this.guards) {
      guard.dispose();
    }
    this.guards.length = 0;
    this.lights.length = 0;
    this.lightPool.length = 0;
    // Shared kit materials/textures live in the AssetLibrary cache.
    this.root.dispose(false, false);
  }

  get colliders(): Aabb2[] {
    return [...this.floors[0]!.colliders, ...this.floors[1]!.colliders];
  }

  get bounds(): Bounds2 {
    return this.floors[0]!.bounds;
  }

  get baseY(): number {
    return 0;
  }

  get floorHeight(): number {
    return FLOOR_H;
  }

  get wallHeight(): number {
    return WALL_H;
  }

  /**
   * Walking-surface height at a world position. Outside the stairwell this is
   * the active storey; inside it is the smooth ramp so the player walks up
   * rather than teleporting.
   */
  groundHeightAt(x: number, z: number): number {
    const stairX = this.dungeon.stairs.x * TILE;
    const inStairWidth = Math.abs(x - stairX) <= TILE / 2;
    if (inStairWidth && z <= this.stairHoleSouthZ && z >= this.stairTopZ) {
      // Inside the upper-floor opening the stair ramp is the only surface.
      return this.rampHeight(z);
    }
    if (inStairWidth && this.currentFloor === 0 && z > this.stairHoleSouthZ) {
      // The first part of the flight runs underneath the upper floor. Only a
      // ground-floor player can be down here; an upper-floor player walking
      // over this spot is on the floor above, not on the ramp.
      if (z < this.stairBottomZ) {
        return this.rampHeight(z);
      }
      return 0;
    }
    return this.currentFloor * FLOOR_H;
  }

  private rampHeight(z: number): number {
    const t = (this.stairBottomZ - z) / (this.stairBottomZ - this.stairTopZ);
    return Math.max(0, Math.min(1, t)) * FLOOR_H;
  }

  /** Keep the visible storey and HUD in sync with the player's feet. */
  syncPlayer(feetY: number): boolean {
    const floor = feetY > FLOOR_H / 2 ? 1 : 0;
    if (floor === this.currentFloor) {
      return false;
    }
    this.setFloor(floor);
    return true;
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

  /** Remove a collected chest/key from the world and the interaction list. */
  take(item: DungeonInteractable): void {
    const index = this.interactables.indexOf(item);
    if (index >= 0) {
      this.interactables.splice(index, 1);
    }
    if (item.collider) {
      const colliders = this.floors[item.floor]!.colliders;
      const index = colliders.indexOf(item.collider);
      if (index >= 0) {
        colliders.splice(index, 1);
      }
      item.collider = undefined;
    }
    if (item.auraLight) {
      const lightIndex = this.lights.indexOf(item.auraLight);
      if (lightIndex >= 0) {
        this.lights.splice(lightIndex, 1);
      }
      item.auraLight.dispose();
      item.auraLight = null;
    }
    item.mesh?.dispose(false, false);
    item.mesh = null;
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
    // Both storeys stay visible so the stairwell reads as a real connection;
    // vertical collider spans keep the other floor's walls out of the way.
    this.floorRoots[0]!.setEnabled(true);
    this.floorRoots[1]!.setEnabled(true);
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
      scaleY = 1,
    ): boolean => {
      const target = placed
        ? base.createInstance(`${base.name}-i${this.cloneCounter++}`)
        : base;
      // glTF clones come with a rotationQuaternion set, which overrides the
      // euler `rotation`; clear it so yaw/pitch actually apply.
      target.rotationQuaternion = null;
      target.position.set(x, y, z);
      target.rotation.set(rotationX, rotationY, 0);
      target.scaling.set(1, scaleY, 1);
      return true;
    };

    const addWallCollider = (cx: number, cz: number, halfX: number, halfZ: number): void => {
      colliders.push({
        ...aabbFromCenter(cx, cz, halfX, halfZ),
        minY: baseY,
        maxY: baseY + WALL_H,
      });
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
        // Always build the lower ceiling. The upper floor tile is left in
        // place above it, but its underside samples the kit's blue back-face;
        // a 2 cm drop makes this tile the visible ceiling from below and stops
        // the two coplanar surfaces fighting.
        if (!this.isCeilingHole(floorIndex, x, z)) {
          floorPlaced = place(
            floorMesh,
            floorPlaced,
            worldX,
            baseY + WALL_H - CEILING_DROP,
            worldZ,
            Math.PI,
            0,
          );
        }

        if (!isFloor(layout, x, z - 1)) {
          wallPlaced = place(
            wallMesh,
            wallPlaced,
            worldX,
            baseY,
            worldZ - TILE / 2,
            0,
            0,
            WALL_SKIN,
          );
          addWallCollider(worldX, worldZ - TILE / 2, TILE / 2, 0.2);
        }
        if (!isFloor(layout, x, z + 1)) {
          wallPlaced = place(
            wallMesh,
            wallPlaced,
            worldX,
            baseY,
            worldZ + TILE / 2,
            0,
            Math.PI,
            WALL_SKIN,
          );
          addWallCollider(worldX, worldZ + TILE / 2, TILE / 2, 0.2);
        }
        if (!isFloor(layout, x - 1, z)) {
          wallPlaced = place(
            wallMesh,
            wallPlaced,
            worldX - TILE / 2,
            baseY,
            worldZ,
            0,
            Math.PI / 2,
            WALL_SKIN,
          );
          addWallCollider(worldX - TILE / 2, worldZ, 0.2, TILE / 2);
        }
        if (!isFloor(layout, x + 1, z)) {
          wallPlaced = place(
            wallMesh,
            wallPlaced,
            worldX + TILE / 2,
            baseY,
            worldZ,
            0,
            -Math.PI / 2,
            WALL_SKIN,
          );
          addWallCollider(worldX + TILE / 2, worldZ, 0.2, TILE / 2);
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
    // The column asset is 1.1 m tall; stretch it to meet the ceiling.
    const columnScale = WALL_H / 1.1;
    // The scaled column is about 1.89 m across; give it a solid footprint.
    const columnHalf = 0.9;
    for (const room of layout.rooms) {
      const offset = Math.max(2.4, room.radius * TILE - 2.2);
      const corners = [
        { x: room.x * TILE - offset, z: room.z * TILE - offset },
        { x: room.x * TILE + offset, z: room.z * TILE - offset },
        { x: room.x * TILE - offset, z: room.z * TILE + offset },
        { x: room.x * TILE + offset, z: room.z * TILE + offset },
      ];
      for (const corner of corners) {
        const column = await this.cloneMesh('mini', 'column', parent);
        if (column) {
          column.position = new Vector3(corner.x, baseY, corner.z);
          // Keep the top face just below the next floor's floor plane; at full
          // height it is coplanar with the upper-floor tiles and z-fights.
          column.scaling.set(columnScale, columnScale * WALL_SKIN, columnScale);
          this.floors[floorIndex]!.colliders.push({
            ...aabbFromCenter(corner.x, corner.z, columnHalf, columnHalf),
            minY: baseY,
            maxY: baseY + WALL_H,
          });
        }
      }
      const banner = await this.cloneMesh('mini', 'banner', parent);
      if (banner) {
        banner.position = new Vector3(room.x * TILE, baseY + 2.1, room.z * TILE - (room.radius * TILE - 2));
      }
    }
  }

  private async buildStairs(): Promise<void> {
    const stairX = this.dungeon.stairs.x * TILE;

    // Build an open stone staircase from steps rather than the kit's fully
    // walled stairwell chunk, whose closed ends fight the shaft design.
    const stepCount = 14;
    const run = (this.stairBottomZ - this.stairTopZ) / stepCount;
    const rise = FLOOR_H / stepCount;
    const stairMaterial = new StandardMaterial('dungeon-stairs-mat', this.scene);
    stairMaterial.disableLighting = true;
    stairMaterial.diffuseColor = Color3.Black();
    stairMaterial.emissiveColor = new Color3(0.35, 0.36, 0.43);
    stairMaterial.specularColor = Color3.Black();
    stairMaterial.backFaceCulling = false;
    stairMaterial.fogEnabled = true;
    for (let i = 0; i < stepCount; i += 1) {
      const height = rise * (i + 1);
      const step = MeshBuilder.CreateBox(
        `dungeon-step-${i}`,
        { width: TILE - 0.3, height, depth: run },
        this.scene,
      );
      step.parent = this.floorRoots[0]!;
      step.position.set(stairX, height / 2, this.stairBottomZ - (i + 0.5) * run);
      step.material = stairMaterial;
      step.receiveShadows = false;
    }

    const addThinWall = async (
      parent: TransformNode,
      x: number,
      y: number,
      z: number,
      rotY: number,
    ): Promise<void> => {
      const wall = await this.cloneMesh('dungeon', 'template-wall', parent);
      if (!wall) {
        return;
      }
      wall.rotationQuaternion = null;
      wall.position.set(x, y, z);
      wall.rotation.set(0, rotY, 0);
      wall.scaling.set(1, WALL_SKIN, 0.125);
      this.applyTileMaterial(wall, new Color3(0.55, 0.56, 0.64));
    };

    const floor0 = this.dungeon.floors[0];
    const floor1 = this.dungeon.floors[1];
    const stairCellX = this.dungeon.stairs.x;

    // Close off the space underneath the upper landing on the ground floor,
    // but only when that side is open. If it is solid the normal wall mesh is
    // already there and a second wall would z-fight.
    const northOpen = isFloor(floor0, stairCellX, this.dungeon.stairs.z - 2);
    if (northOpen) {
      await addThinWall(this.floorRoots[0]!, stairX, 0, this.stairTopZ, Math.PI);
    }

    // The normal floor-0 wall at the stair head is full height and would stop a
    // climber just short of the landing. Replace it with a low barrier that
    // still blocks someone walking under the stairs from the north.
    this.floors[0]!.colliders = this.floors[0]!.colliders.filter((box) => {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      return !(Math.abs(cx - stairX) < 0.01 && Math.abs(cz - this.stairTopZ) < 0.01);
    });
    this.floors[0]!.colliders.push({
      ...aabbFromCenter(stairX, this.stairTopZ, TILE / 2, 0.2),
      minY: 0,
      maxY: FLOOR_H - 0.6,
    });

    // The upper floor opens into the stairwell; the south lip is closed and
    // both flanks are kept solid up to the storey ceiling.
    const holeCentreZ = (this.stairTopZ + this.stairHoleSouthZ) / 2;
    const holeHalfZ = (this.stairHoleSouthZ - this.stairTopZ) / 2;
    this.floors[1]!.colliders.push({
      ...aabbFromCenter(stairX, this.stairHoleSouthZ, TILE / 2, 0.2),
      minY: FLOOR_H,
      maxY: FLOOR_H + WALL_H,
    });
    for (const side of [-1, 1]) {
      this.floors[0]!.colliders.push({
        ...aabbFromCenter(stairX + side * (TILE / 2), holeCentreZ, 0.2, holeHalfZ),
        minY: 0,
        maxY: FLOOR_H + WALL_H,
      });
    }

    // Close the upper-floor sides and the south lip with walls. Only add a
    // wall where the neighbouring cell is open; solid neighbours already have
    // a normal wall. Thin slabs keep hallways outside the shaft usable.
    await addThinWall(this.floorRoots[1]!, stairX, FLOOR_H, this.stairHoleSouthZ, Math.PI);
    for (const side of [-1, 1]) {
      for (let zCell = this.dungeon.stairs.z - 1; zCell <= this.dungeon.stairs.z; zCell += 1) {
        const z = zCell * TILE;
        const wallX = stairX + side * (TILE / 2 + 0.25);
        if (isFloor(floor0, stairCellX + side, zCell)) {
          await addThinWall(this.floorRoots[0]!, wallX, 0, z, side * (Math.PI / 2));
        }
        if (isFloor(floor1, stairCellX + side, zCell)) {
          await addThinWall(this.floorRoots[1]!, wallX, FLOOR_H, z, side * (Math.PI / 2));
        }
      }
    }

  }

  private async buildEntrance(): Promise<void> {
    const entrance = this.dungeon.entrance;
    const entranceRoom = this.dungeon.floors[0].rooms.find((room) => room.kind === 'entrance');
    const radius = entranceRoom?.radius ?? 2;
    // The room's north wall face is one half-cell beyond its last floor cell.
    const backWallZ = (entrance.z - radius - 0.5) * TILE;

    const mesh = await this.cloneMesh('dungeon', 'gate-door', this.floorRoots[0]!);
    if (mesh) {
      mesh.rotationQuaternion = null;
      mesh.rotation.set(0, 0, 0);
      // Keep the door flush with the wall face instead of floating a couple of
      // cells into the room, and thin it so its front lines up with collision.
      mesh.position.set(entrance.x * TILE, 0, backWallZ + 0.2);
      mesh.scaling.set(1, WALL_H / 4.4, 0.4 / 1.4);
    }
    this.interactables.push({
      id: 'exit',
      label: 'Leave the castle',
      x: entrance.x * TILE,
      z: backWallZ + 2.5,
      radius: 2.8,
      floor: 0,
    });
  }

  private async buildLoot(): Promise<void> {
    for (const spot of this.dungeon.chests) {
      const x = spot.x * TILE;
      const z = spot.z * TILE;
      const mesh = await this.cloneMesh('mini', 'chest', this.floorRoots[spot.floor]!);
      if (mesh) {
        mesh.position = new Vector3(x, spot.floor * FLOOR_H, z);
        // The kit chest is only 0.5 m wide; scale it up to a readable hoard.
        mesh.scaling.setAll(3.2);
      }
      const collider = {
        ...aabbFromCenter(x, z, 0.8, 0.8),
        minY: spot.floor * FLOOR_H,
        maxY: spot.floor * FLOOR_H + 2.2,
      };
      this.floors[spot.floor]!.colliders.push(collider);
      let auraLight: PointLight | null = null;
      if (spot.locked && mesh) {
        const goldMaterial = mesh.material?.clone(`${mesh.material.name}-locked-gold`);
        if (goldMaterial) {
          if (goldMaterial instanceof PBRMaterial) {
            goldMaterial.albedoColor = new Color3(1, 0.82, 0.42);
            goldMaterial.emissiveColor = new Color3(0.34, 0.22, 0.05);
          } else if (goldMaterial instanceof StandardMaterial) {
            goldMaterial.diffuseColor = new Color3(1, 0.82, 0.42);
            goldMaterial.emissiveColor = new Color3(0.34, 0.22, 0.05);
          }
          mesh.material = goldMaterial;
          for (const child of mesh.getChildMeshes()) {
            child.material = goldMaterial;
          }
        }
        auraLight = new PointLight(
          `locked-chest-aura-${this.cloneCounter++}`,
          new Vector3(x, spot.floor * FLOOR_H + 1.1, z),
          this.scene,
        );
        auraLight.diffuse = new Color3(1, 0.8, 0.35);
        auraLight.intensity = 0.55;
        auraLight.range = 5;
        this.lights.push(auraLight);
      }
      this.interactables.push({
        id: spot.locked ? 'chest-locked' : 'chest',
        label: spot.locked ? 'Locked chest' : 'Open chest',
        x,
        z,
        radius: 2.4,
        floor: spot.floor,
        mesh,
        collider,
        auraLight,
      });
    }

    for (const spot of this.dungeon.keys) {
      const mesh = await this.cloneMesh('mini', 'key', this.floorRoots[0]!);
      if (mesh) {
        mesh.position = new Vector3(spot.x * TILE, 1.05, spot.z * TILE);
        mesh.scaling.setAll(2.3);
      }
      this.interactables.push({
        id: 'key',
        label: 'Take key',
        x: spot.x * TILE,
        z: spot.z * TILE,
        radius: 2,
        floor: 0,
        mesh,
      });
    }
  }

  private async buildGuards(): Promise<void> {
    for (const spot of this.dungeon.guards) {
      if (!spot) {
        continue;
      }
      await this.spawnGuardAt(spot.floor, spot.x, spot.z);
    }
  }

  /** Spawn an extra guard at a grid cell. Used by the combat test route. */
  async spawnGuardAt(floorIndex: number, cellX: number, cellZ: number): Promise<Guard | null> {
    const layout = this.dungeon.floors[floorIndex];
    if (!layout) {
      return null;
    }
    const stair = this.dungeon.stairs;
    const index = this.guards.length;
    const guard = await Guard.create(
      {
        scene: this.scene,
        library: this.library,
        floor: layout,
        floorIndex,
        colliders: this.floors[floorIndex]!.colliders,
        tile: TILE,
        floorY: floorIndex * FLOOR_H,
        rng: createRng(
          (this.dungeon.seed ^
            (cellX * 73856093) ^
            (cellZ * 19349663) ^
            (floorIndex * 83492791)) >>>
            0,
        ),
        index,
        isBlocked: (x, z) => x === stair.x && (z === stair.z || z === stair.z - 1),
      },
      { x: cellX, z: cellZ, floor: floorIndex },
      this.root,
    );
    if (guard) {
      this.guards.push(guard);
    }
    return guard;
  }

  clearGuards(): void {
    for (const guard of this.guards) {
      guard.dispose();
    }
    this.guards.length = 0;
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
    // Ground floor: the stair footprint plus the bottom landing.
    for (let z = this.dungeon.stairs.z - 1; z <= this.dungeon.stairs.z + 1; z += 1) {
      setFloorCell(floor0, x, z);
    }
    // Upper floor: open the hole cells and keep the landings connected.
    for (let z = this.dungeon.stairs.z - 2; z <= this.dungeon.stairs.z + 1; z += 1) {
      setFloorCell(floor1, x, z);
    }
  }
}

function setFloorCell(layout: FloorLayout, x: number, z: number): void {
  if (x > 0 && z > 0 && x < layout.width - 1 && z < layout.height - 1) {
    layout.cells[z * layout.width + x] = FLOOR;
  }
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
