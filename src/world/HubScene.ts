import {
  AbstractMesh,
  Color3,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Light,
  Mesh,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { createRng, type Rng } from '../core/rng';
import { aabbFromCenter, type Aabb2, type Bounds2 } from '../core/collision';
import type { AssetKit, AssetLibrary } from './AssetLibrary';
import { createForestSky, type Sky } from './Skybox';

/** A place the player can press E at. */
export interface HubInteractable {
  id: string;
  label: string;
  x: number;
  z: number;
  radius: number;
}

interface PlaceOptions {
  rotY?: number;
  scale?: number;
  targetHeight?: number;
  y?: number;
  collider?: { halfX: number; halfZ: number; fit?: boolean };
  /** Shift the visual bounds so their centre lands on x/z. */
  centerXZ?: boolean;
  shadow?: boolean;
}

/** Fixed hub layout. Everything is in metres; the player spawns at +Z looking toward the gate. */
const SPAWN = { x: 0, z: 16, yaw: Math.PI };
const WORLD_BOUNDS: Bounds2 = { minX: -34, minZ: -34, maxX: 34, maxZ: 34 };
const SUN_TRAVEL = new Vector3(-0.5, -1, 0.6);
/** Fixed prop clusters the randomised tree pass must leave clear. */
const CLUTTER_CLEARINGS = [
  { x: -13, z: 12.5 },
  { x: 13.5, z: 11.5 },
  { x: -18, z: -13 },
  { x: 18, z: -12 },
  { x: -11.5, z: 2 },
  { x: 11.5, z: -1 },
  { x: -13, z: -8 },
  { x: 13, z: -9 },
  { x: 12.5, z: 6.5 },
  { x: 10.5, z: 8.5 },
  { x: -4.6, z: 9.2 },
  { x: 4.6, z: 9.2 },
];

/**
 * The Sherwood camp: a safe, hand-authored clearing that never changes between
 * runs. Merchants live at stalls around a central path that leads to the
 * castle gate.
 */
export class HubScene {
  readonly spawn = SPAWN;
  readonly bounds = WORLD_BOUNDS;
  readonly colliders: Aabb2[] = [];
  readonly interactables: HubInteractable[] = [];
  readonly root: TransformNode;

  private readonly scene: Scene;
  private readonly library: AssetLibrary;
  private readonly lights: Light[] = [];
  private readonly shadow: ShadowGenerator;
  private readonly sky: Sky;

  constructor(scene: Scene, library: AssetLibrary) {
    this.scene = scene;
    this.library = library;
    this.root = new TransformNode('hub-root', scene);

    const skyLight = new HemisphericLight('hub-sky', new Vector3(0.1, 1, -0.1), scene);
    skyLight.intensity = 0.66;
    skyLight.diffuse = new Color3(0.72, 0.82, 0.96);
    skyLight.groundColor = new Color3(0.16, 0.2, 0.15);

    const sun = new DirectionalLight('hub-sun', SUN_TRAVEL, scene);
    sun.position = new Vector3(20, 34, -16);
    sun.intensity = 1.1;
    sun.diffuse = new Color3(1, 0.95, 0.84);
    this.lights.push(skyLight, sun);

    this.shadow = new ShadowGenerator(1024, sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = 18;
    this.shadow.darkness = 0.42;

    this.sky = createForestSky(scene, SUN_TRAVEL.scale(-1));
    this.sky.root.parent = this.root;

    scene.fogMode = Scene.FOGMODE_EXP2;
    // Match the sky's horizon so distant ground and trees dissolve into the sky.
    scene.fogColor = new Color3(0.72, 0.86, 0.96);
    scene.fogDensity = 0.011;
    // The dungeon sets its own ambient tint; clear it so the camp is not lit
    // differently after a castle run than on a fresh load.
    scene.ambientColor = Color3.Black();
  }

  /** Per-frame polish for the camp, currently just the drifting clouds. */
  update(dt: number): void {
    this.sky.update?.(dt);
  }

  /** Flat camp floor; arrows use the same world interface as the dungeon. */
  get floorHeight(): number {
    // One outdoor storey; this is only the arrow simulation's ceiling height.
    return 12;
  }

  readonly floorCount = 1;

  async build(): Promise<void> {
    this.buildGround();
    await this.buildPath();
    await this.buildGate();
    await this.buildCastle();
    await this.buildStalls();
    await this.buildCampDressing();
    await this.buildForest();

    this.colliders.push(aabbFromCenter(0, -20.6, 5, 2));
  }

  /** Tear down every mesh, light and shadow this location added. */
  dispose(): void {
    this.sky.dispose();
    this.shadow.dispose();
    for (const light of this.lights) {
      light.dispose();
    }
    this.lights.length = 0;
    // Materials and textures are owned by the cached asset containers; only
    // dispose this scene's meshes or the next area load reuses dead textures.
    this.root.dispose(false, false);
  }

  /** Nearest interactable within its radius, or null. */
  nearest(x: number, z: number): HubInteractable | null {
    let best: HubInteractable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of this.interactables) {
      const distance = Math.hypot(item.x - x, item.z - z);
      if (distance <= item.radius && distance < bestDistance) {
        best = item;
        bestDistance = distance;
      }
    }
    return best;
  }

  private buildGround(): void {
    // Far wider than the playable bounds so the horizon is always ground and
    // haze, never a visible edge. The material is a flat colour, so the extra
    // area costs nothing.
    const ground = MeshBuilder.CreateGround('hub-ground', { width: 700, height: 700 }, this.scene);
    ground.parent = this.root;
    ground.position.y = -0.06;
    const material = new StandardMaterial('hub-ground-mat', this.scene);
    material.diffuseColor = new Color3(0.2, 0.3, 0.18);
    material.specularColor = new Color3(0, 0, 0);
    ground.material = material;
    ground.receiveShadows = true;
  }

  private async buildPath(): Promise<void> {
    for (let z = 15; z >= -18; z -= 3.4) {
      await this.place('town', 'road', 0, z, { scale: 3.4, y: 0.005, shadow: false });
    }
    for (let x = -8; x <= 8; x += 3.4) {
      await this.place('town', 'road', x, 1, { scale: 3.4, y: 0.005, shadow: false });
    }
  }

  private async buildGate(): Promise<void> {
    // The gatehouse portal is 5.4 m wide and 5.8 m tall. Fill it with the gate
    // instead of leaving a black frame around a much smaller door.
    await this.place('mini', 'gate', 0, -20.25, { targetHeight: 5.6 });
    // Two stone pillars hug the door edges and mirror each other.
    for (const side of [-1, 1]) {
      await this.place('town', 'pillar-stone', side * 3.5, -20.25, {
        targetHeight: 6.2,
        collider: { halfX: 0.5, halfZ: 0.5, fit: true },
      });
      await this.place('town', 'banner-green', side * 4.5, -20.0, {
        targetHeight: 3.4,
        y: 3.2,
        rotY: Math.PI,
        centerXZ: true,
      });
    }
    await this.place('town', 'lantern', -4.6, -17.5, { targetHeight: 3.6, collider: { halfX: 0.2, halfZ: 0.2, fit: true } });
    await this.place('town', 'lantern', 4.6, -17.5, { targetHeight: 3.6, collider: { halfX: 0.2, halfZ: 0.2, fit: true } });

    this.interactables.push({
      id: 'castle',
      label: "Enter the King's Castle",
      x: 0,
      z: -16.5,
      radius: 3.6,
    });
  }

  /**
   * A stone keep behind the gate so Sherwood reads as a camp outside a castle,
   * not a gate standing alone in the woods. Purely a backdrop; the gate remains
   * the only way in.
   */
  private async buildCastle(): Promise<void> {
    const stone = new StandardMaterial('hub-castle-stone', this.scene);
    stone.diffuseColor = new Color3(0.5, 0.51, 0.57);
    stone.emissiveColor = new Color3(0.045, 0.047, 0.06);
    stone.specularColor = new Color3(0.02, 0.02, 0.03);

    const shadowStone = new StandardMaterial('hub-castle-shadow-stone', this.scene);
    shadowStone.diffuseColor = new Color3(0.42, 0.43, 0.49);
    shadowStone.emissiveColor = new Color3(0.03, 0.032, 0.04);
    shadowStone.specularColor = new Color3(0, 0, 0);

    const dark = new StandardMaterial('hub-castle-dark', this.scene);
    dark.diffuseColor = new Color3(0.045, 0.045, 0.06);
    dark.emissiveColor = new Color3(0.015, 0.012, 0.008);
    dark.specularColor = new Color3(0, 0, 0);

    // Gatehouse and passage.
    this.addCastleBox('castle-gatehouse', 0, 6, -23.2, 12.5, 12, 4.4, stone);
    this.addCastleBox('castle-portal', 0, 2.9, -20.95, 5.4, 5.8, 0.35, dark);
    this.addCastleBox('castle-gatehouse-top', 0, 12.3, -23.6, 13.5, 0.8, 4.6, shadowStone);

    // Main keep and flanking towers.
    this.addCastleBox('castle-keep', 0, 7, -30, 30, 14, 8, stone);
    this.addCastleBox('castle-keep-band', 0, 10.8, -25.9, 30.5, 0.7, 0.6, shadowStone);
    this.addCastleBox('castle-tower-left', -14.5, 8.5, -26.5, 7, 17, 7, stone);
    this.addCastleBox('castle-tower-right', 14.5, 8.5, -26.5, 7, 17, 7, stone);

    // Crenellations along every roofline.
    for (let x = -13.5; x <= 13.5; x += 2.1) {
      this.addCastleBox(`castle-merlon-keep-${x}`, x, 14.5, -26.1, 1.2, 1.4, 1.2, shadowStone);
    }
    for (let x = -5.5; x <= 5.5; x += 1.9) {
      this.addCastleBox(`castle-merlon-gate-${x}`, x, 13.2, -20.8, 1.05, 1.3, 1.0, shadowStone);
    }
    for (const side of [-1, 1]) {
      const towerX = side * 14.5;
      for (let x = towerX - 2.6; x <= towerX + 2.6; x += 1.7) {
        this.addCastleBox(`castle-merlon-tower-${side}-${x}`, x, 17.5, -23.1, 1.1, 1.2, 1.1, shadowStone);
      }
      await this.place('town', 'roof-high-point', towerX, -26.5, {
        scale: 6.4,
        y: 17.2,
      });
    }

    // A few slit windows break up the flat stone.
    for (const x of [-4.2, 4.2]) {
      this.addCastleBox(`castle-window-${x}`, x, 7.6, -20.9, 0.55, 2.2, 0.3, dark);
    }
    for (const side of [-1, 1]) {
      this.addCastleBox(`castle-tower-window-${side}`, side * 14.5, 10.4, -22.9, 0.8, 2.6, 0.3, dark);
      this.addCastleBox(`castle-tower-window-high-${side}`, side * 14.5, 14.0, -22.9, 0.8, 2.0, 0.3, dark);
    }
  }

  private addCastleBox(
    name: string,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: StandardMaterial,
  ): Mesh {
    const box = MeshBuilder.CreateBox(name, { width, height, depth }, this.scene);
    box.parent = this.root;
    box.position.set(x, y, z);
    box.material = material;
    box.receiveShadows = true;
    this.shadow.addShadowCaster(box);
    return box;
  }

  /**
   * Hand-placed camp dressing: fences, lanterns, benches and clutter that make
   * the clearing feel lived in rather than an empty field.
   */
  private async buildCampDressing(): Promise<void> {
    const rng = createRng(0xca11);

    // Fence panels lining the approach to the gate, broken on one side. The
    // panel is ~2.9 m long once scaled, so step by that much to avoid overlaps.
    for (let z = 14; z >= 8; z -= 3) {
      for (const side of [-1, 1]) {
        const broken = side < 0 && z <= 11;
        await this.place('town', broken ? 'fence-broken' : 'fence', side * 3.1, z, {
          targetHeight: 1.1,
          rotY: Math.PI / 2,
          collider: { halfX: 0.25, halfZ: 1.45, fit: true },
        });
      }
    }

    // Lanterns bracketing the road down to the gate, inside the fence line.
    for (const z of [13, 6.5, 0.5, -5.5, -11.5]) {
      for (const side of [-1, 1]) {
        await this.place('town', 'lantern', side * 2.5, z, {
          targetHeight: 3.1,
          collider: { halfX: 0.2, halfZ: 0.2, fit: true },
        });
      }
    }

    // Clutter clustered out of the walking line.
    const clusters = [
      { x: -13, z: 12.5 },
      { x: 13.5, z: 11.5 },
      { x: -18, z: -13 },
      { x: 18, z: -12 },
      { x: -11.5, z: 2 },
      { x: 11.5, z: -1 },
    ];
    for (const cluster of clusters) {
      await this.place('mini', 'barrel', cluster.x, cluster.z, {
        scale: 3.2,
        rotY: rng.floatBetween(0, Math.PI * 2),
        collider: { halfX: 0.8, halfZ: 0.8, fit: true },
      });
      await this.place('mini', 'barrel', cluster.x + 1.9, cluster.z + 1.1, {
        scale: 2.8,
        rotY: rng.floatBetween(0, Math.PI * 2),
        collider: { halfX: 0.7, halfZ: 0.7, fit: true },
      });
      await this.place('mini', 'pot', cluster.x - 1.8, cluster.z + 1.0, {
        scale: 2.4,
        collider: { halfX: 0.6, halfZ: 0.6, fit: true },
      });
    }

    // A small staging table and planks beside the training stall.
    await this.place('town', 'planks-half', 10.5, 8.5, { scale: 3.2, rotY: 0.4 });
    await this.place('mini', 'table', 12.5, 6.5, {
      scale: 2.6,
      rotY: -0.5,
      collider: { halfX: 1, halfZ: 0.6, fit: true },
    });

    // Second cart and a scatter of stones in the clearing.
    await this.place('town', 'cart', 13, -9, {
      scale: 3,
      rotY: -0.7,
      collider: { halfX: 1.6, halfZ: 1.4, fit: true },
    });
    for (let i = 0; i < 12; i += 1) {
      const angle = rng.floatBetween(0, Math.PI * 2);
      const radius = rng.floatBetween(10, 21);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Keep the road and the gate approach clear.
      if (Math.abs(x) < 4.5 || (Math.abs(x) < 8 && z > -22 && z < 2)) {
        continue;
      }
      // Do not drop stones into the fixed prop clusters.
      if (CLUTTER_CLEARINGS.some((spot) => Math.hypot(x - spot.x, z - spot.z) < 3)) {
        continue;
      }
      await this.place('town', 'rock-small', x, z, {
        scale: rng.floatBetween(0.9, 1.5),
        rotY: rng.floatBetween(0, Math.PI * 2),
        collider: { halfX: 0.3, halfZ: 0.3, fit: true },
      });
    }
  }

  private async buildStalls(): Promise<void> {
    const stalls = [
      { id: 'bows', label: 'Bows', x: -8, z: 5, facing: Math.PI / 2, kit: 'town', name: 'stall-red' },
      { id: 'abilities', label: 'Abilities', x: -8, z: -4, facing: Math.PI / 2, kit: 'town', name: 'stall-green' },
      { id: 'training', label: 'Training', x: 8, z: 5, facing: -Math.PI / 2, kit: 'town', name: 'stall-green' },
      { id: 'crowns', label: 'Crowns', x: 8, z: -4, facing: -Math.PI / 2, kit: 'town', name: 'stall-red' },
    ] as const;

    for (const stall of stalls) {
      await this.place(stall.kit, stall.name, stall.x, stall.z, {
        scale: 4.5,
        rotY: stall.facing,
        collider: { halfX: 2.8, halfZ: 2.2, fit: true },
      });
      await this.place('mini', 'barrel', stall.x, stall.z - 2.6, {
        scale: 3.2,
        collider: { halfX: 0.9, halfZ: 0.9, fit: true },
      });
      await this.place('mini', 'barrel', stall.x, stall.z + 2.6, {
        scale: 3.2,
        collider: { halfX: 0.9, halfZ: 0.9, fit: true },
      });

      // A plane faces -Z, so the sign uses the opposite rotation to the stall
      // in order to face the road.
      const signX = stall.x + (stall.x < 0 ? 1.7 : -1.7);
      this.addSign(stall.label, signX, 2.7, stall.z, -stall.facing);

      // A bench and a stool at the stall front make the merchants feel set up.
      const inward = stall.x < 0 ? 1 : -1;
      await this.place('town', 'stall-bench', stall.x + inward * 2.8, stall.z + 1.5, {
        targetHeight: 1,
        rotY: stall.facing,
        collider: { halfX: 0.8, halfZ: 0.35, fit: true },
      });
      await this.place('town', 'stall-stool', stall.x + inward * 3.2, stall.z - 1.4, {
        targetHeight: 0.8,
        collider: { halfX: 0.3, halfZ: 0.3, fit: true },
      });

      this.interactables.push({
        id: stall.id,
        label: stall.label,
        x: stall.x + (stall.x < 0 ? 2.2 : -2.2),
        z: stall.z,
        radius: 3.4,
      });
    }

    await this.place('town', 'cart', -13, -8, {
      scale: 3,
      rotY: 0.6,
      collider: { halfX: 1.6, halfZ: 1.4, fit: true },
    });
    // Pots sit clear of the stall footprints so their rims do not clip the
    // benches or canopy posts.
    await this.place('mini', 'pot', -4.6, 9.2, {
      scale: 2.6,
      collider: { halfX: 0.6, halfZ: 0.6, fit: true },
    });
    await this.place('mini', 'pot', 4.6, 9.2, {
      scale: 2.6,
      collider: { halfX: 0.6, halfZ: 0.6, fit: true },
    });
  }

  /**
   * Rings the clearing with a dense treeline so Sherwood reads as a camp deep
   * in a forest. The fog fades the furthest bands into the sky, which gives the
   * canopy real depth without any extra work.
   */
  private async buildForest(): Promise<void> {
    const rng = createRng(0x5eed);
    const trees = ['tree', 'tree-high', 'tree-crooked', 'tree-high-crooked'];

    // Loose trees inside the clearing, kept off the road, the camp core and the
    // castle footprint.
    for (let i = 0; i < 36; i += 1) {
      const angle = rng.floatBetween(0, Math.PI * 2);
      const radius = rng.floatBetween(16, 30);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (this.blocksCamp(x, z)) {
        continue;
      }
      await this.placeTree(trees, x, z, rng.floatBetween(6.5, 10), true, rng, true);
    }

    // Saplings and scrub along the base of the treeline so the forest floor has
    // some height to it without walling the view off.
    for (let i = 0; i < 44; i += 1) {
      const angle = rng.floatBetween(0, Math.PI * 2);
      const radius = rng.floatBetween(31, 42);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      await this.placeTree(trees, x, z, rng.floatBetween(2.5, 4.5), false, rng);
    }

    // Three bands of forest close off the horizon. Only the nearest band casts
    // shadows; the outer two sit in the haze and read as depth.
    const bands = [
      { count: 52, min: 36, max: 52, shadow: true, minHeight: 7, maxHeight: 11 },
      { count: 100, min: 54, max: 86, shadow: false, minHeight: 8, maxHeight: 13 },
      { count: 150, min: 88, max: 160, shadow: false, minHeight: 9, maxHeight: 15 },
    ];
    for (const band of bands) {
      for (let i = 0; i < band.count; i += 1) {
        const angle = rng.floatBetween(0, Math.PI * 2);
        const radius = rng.floatBetween(band.min, band.max);
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        const blocked = Math.abs(x) <= 34 && Math.abs(z) <= 34;
        if (z < -18 && Math.abs(x) < 17) {
          // Keep the castle's footprint clear of trees.
          continue;
        }
        await this.placeTree(
          trees,
          x,
          z,
          rng.floatBetween(band.minHeight, band.maxHeight),
          band.shadow,
          rng,
          blocked,
        );
      }
    }

    // Boulders tucked where the clearing meets the trees.
    for (let i = 0; i < 14; i += 1) {
      const angle = rng.floatBetween(0, Math.PI * 2);
      const radius = rng.floatBetween(30, 44);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      await this.place('town', rng.pick(['rock-small', 'rock-small', 'rock-wide']), x, z, {
        scale: rng.floatBetween(1.2, 1.9),
        rotY: rng.floatBetween(0, Math.PI * 2),
        collider:
          Math.abs(x) <= 34 && Math.abs(z) <= 34
            ? { halfX: 0.6, halfZ: 0.6, fit: true }
            : undefined,
      });
    }
  }

  /** True where a tree must not grow: the road, the camp core or the castle. */
  private blocksCamp(x: number, z: number): boolean {
    const onRoad = Math.abs(x) < 7 && z > -22 && z < 18;
    const inCampCore = Math.abs(x) < 12 && z > -12 && z < 12;
    const inCastle = z < -18 && Math.abs(x) < 17;
    const nearClutter = CLUTTER_CLEARINGS.some(
      (spot) => Math.hypot(x - spot.x, z - spot.z) < 4.2,
    );
    return onRoad || inCampCore || inCastle || nearClutter;
  }

  /** One jittered tree, optionally solid if it stands inside the play area. */
  private async placeTree(
    names: readonly string[],
    x: number,
    z: number,
    height: number,
    shadow: boolean,
    rng: Rng,
    collider = false,
  ): Promise<void> {
    await this.place('town', rng.pick(names), x, z, {
      targetHeight: height,
      rotY: rng.floatBetween(0, Math.PI * 2),
      shadow,
      collider: collider ? { halfX: 0.55, halfZ: 0.55 } : undefined,
    });
  }

  private async place(
    kit: AssetKit,
    name: string,
    x: number,
    z: number,
    options: PlaceOptions = {},
  ): Promise<AbstractMesh[]> {
    const container = await this.library.load(kit, name);
    if (!container) {
      return [];
    }
    const instantiated = container.instantiateModelsToScene();
    const roots = instantiated.rootNodes as TransformNode[];
    const meshes: AbstractMesh[] = [];
    for (const node of roots) {
      collectMeshes(node, meshes);
    }
    for (const group of instantiated.animationGroups) {
      group.stop();
    }
    if (meshes.length === 0) {
      return [];
    }

    const bounds = hierarchyBounds(meshes);
    const size = bounds.max.subtract(bounds.min);
    let scale = options.scale ?? 1;
    if (options.targetHeight && size.y > 1e-4) {
      scale = options.targetHeight / size.y;
    }

    const y = options.y ?? 0;
    for (const node of roots) {
      node.scaling.scaleInPlace(scale);
      node.position.addInPlace(new Vector3(x, y, z));
      if (options.rotY) {
        node.rotation.y += options.rotY;
      }
      node.parent = this.root;
    }

    if (options.centerXZ) {
      const world = hierarchyBounds(meshes);
      const dx = x - (world.min.x + world.max.x) / 2;
      const dz = z - (world.min.z + world.max.z) / 2;
      for (const node of roots) {
        node.position.x += dx;
        node.position.z += dz;
      }
    }

    for (const mesh of meshes) {
      mesh.receiveShadows = true;
      if (options.shadow !== false) {
        this.shadow.addShadowCaster(mesh);
      }
      mesh.freezeWorldMatrix();
    }

    if (options.collider) {
      // Derive the collision footprint from the settled visual bounds so props
      // with off-centre pivots do not get offset or undersized colliders.
      const world = hierarchyBounds(meshes);
      const halfX = options.collider.fit
        ? (world.max.x - world.min.x) / 2
        : options.collider.halfX;
      const halfZ = options.collider.fit
        ? (world.max.z - world.min.z) / 2
        : options.collider.halfZ;
      this.colliders.push(
        aabbFromCenter(
          (world.min.x + world.max.x) / 2,
          (world.min.z + world.max.z) / 2,
          halfX,
          halfZ,
        ),
      );
    }
    return meshes;
  }

  /**
   * Draws a readable sign board. The font is auto-fitted so long labels are not
   * cropped, and the caller supplies the rotation that faces the road.
   */
  private addSign(text: string, x: number, y: number, z: number, rotY: number): void {
    const width = 3.4;
    const height = 1.05;
    const texWidth = 512;
    const texHeight = 160;

    const plane = MeshBuilder.CreatePlane(`hub-sign-${text}`, { width, height }, this.scene);
    plane.parent = this.root;
    plane.position.set(x, y, z);
    plane.rotation.y = rotY;
    plane.billboardMode = 0;

    const texture = new DynamicTexture(
      `hub-sign-tex-${text}`,
      { width: texWidth, height: texHeight },
      this.scene,
      false,
    );
    const context = texture.getContext() as CanvasRenderingContext2D;
    const padding = 26;
    let fontSize = 88;
    context.font = `bold ${fontSize}px Segoe UI, sans-serif`;
    while (context.measureText(text).width > texWidth - padding && fontSize > 22) {
      fontSize -= 2;
      context.font = `bold ${fontSize}px Segoe UI, sans-serif`;
    }
    const baseline = texHeight / 2 + fontSize * 0.34;
    texture.drawText(text, null, baseline, `bold ${fontSize}px Segoe UI, sans-serif`, '#f7e7bb', '#243522', true);

    const material = new StandardMaterial(`hub-sign-mat-${text}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.5, 0.5, 0.42);
    material.specularColor = new Color3(0, 0, 0);
    material.backFaceCulling = false;
    material.fogEnabled = false;
    plane.material = material;
  }
}

function collectMeshes(node: TransformNode, out: AbstractMesh[]): void {
  if (node instanceof AbstractMesh) {
    out.push(node);
  }
  for (const child of node.getChildMeshes()) {
    out.push(child);
  }
}

function hierarchyBounds(meshes: readonly AbstractMesh[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const mesh of meshes) {
    const vectors = mesh.getHierarchyBoundingVectors(true);
    min.minimizeInPlace(vectors.min);
    max.maximizeInPlace(vectors.max);
  }
  return { min, max };
}
