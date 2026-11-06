import {
  AbstractMesh,
  Color3,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  MeshBuilder,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { createRng } from '../core/rng';
import { aabbFromCenter, type Aabb2, type Bounds2 } from '../core/collision';
import type { AssetKit, AssetLibrary } from './AssetLibrary';

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
  collider?: { halfX: number; halfZ: number };
  shadow?: boolean;
}

/** Fixed hub layout. Everything is in metres; the player spawns at +Z looking toward the gate. */
const SPAWN = { x: 0, z: 16, yaw: Math.PI };
const WORLD_BOUNDS: Bounds2 = { minX: -34, minZ: -34, maxX: 34, maxZ: 34 };

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

  private readonly shadow: ShadowGenerator;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
  ) {
    const sky = new HemisphericLight('hub-sky', new Vector3(0.1, 1, -0.1), scene);
    sky.intensity = 0.5;
    sky.diffuse = new Color3(0.68, 0.8, 0.66);
    sky.groundColor = new Color3(0.1, 0.14, 0.1);

    const sun = new DirectionalLight('hub-sun', new Vector3(-0.5, -1, 0.6), scene);
    sun.position = new Vector3(20, 34, -16);
    sun.intensity = 1.15;
    sun.diffuse = new Color3(1, 0.93, 0.78);

    this.shadow = new ShadowGenerator(1024, sun);
    this.shadow.useBlurExponentialShadowMap = true;
    this.shadow.blurKernel = 18;
    this.shadow.darkness = 0.42;

    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogColor = new Color3(0.09, 0.14, 0.11);
    scene.fogDensity = 0.016;
  }

  async build(): Promise<void> {
    this.buildGround();
    await this.buildPath();
    await this.buildGate();
    await this.buildStalls();
    await this.scatterForest();

    // Keep the clearing clear of the road so the player always has a route.
    this.colliders.push(aabbFromCenter(0, -20.6, 5, 2));
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
    const ground = MeshBuilder.CreateGround('hub-ground', { width: 96, height: 96 }, this.scene);
    ground.position.y = -0.06;
    const material = new StandardMaterial('hub-ground-mat', this.scene);
    material.diffuseColor = new Color3(0.13, 0.2, 0.12);
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
    await this.place('town', 'wall-arch', 0, -19, { targetHeight: 6.4, collider: { halfX: 4.2, halfZ: 1.4 } });
    await this.place('mini', 'gate', 0, -19.2, { targetHeight: 4.4, y: 0.02 });
    await this.place('town', 'banner-green', -3.6, -19.1, { targetHeight: 3.4, y: 3.2, rotY: Math.PI });
    await this.place('town', 'banner-green', 3.6, -19.1, { targetHeight: 3.4, y: 3.2, rotY: Math.PI });
    await this.place('town', 'lantern', -4.6, -17.5, { targetHeight: 3.6, collider: { halfX: 0.2, halfZ: 0.2 } });
    await this.place('town', 'lantern', 4.6, -17.5, { targetHeight: 3.6, collider: { halfX: 0.2, halfZ: 0.2 } });

    this.interactables.push({
      id: 'castle',
      label: "Enter the King's Castle",
      x: 0,
      z: -16.5,
      radius: 3.6,
    });
  }

  private async buildStalls(): Promise<void> {
    const stalls = [
      { id: 'bows', label: 'Browse Bows', x: -8, z: 5, rotY: Math.PI / 2, kit: 'town', name: 'stall-red' },
      { id: 'abilities', label: 'Learn Abilities', x: -8, z: -4, rotY: Math.PI / 2, kit: 'town', name: 'stall-green' },
      { id: 'training', label: 'Train', x: 8, z: 5, rotY: -Math.PI / 2, kit: 'town', name: 'stall-green' },
      { id: 'crowns', label: 'Crown Exchange', x: 8, z: -4, rotY: -Math.PI / 2, kit: 'town', name: 'stall-red' },
    ] as const;

    for (const stall of stalls) {
      await this.place(stall.kit, stall.name, stall.x, stall.z, {
        scale: 4.5,
        rotY: stall.rotY,
        collider: { halfX: 2.8, halfZ: 2.2 },
      });
      // Flanking barrels.
      await this.place('mini', 'barrel', stall.x, stall.z - 2.6, { scale: 3.2, collider: { halfX: 0.9, halfZ: 0.9 } });
      await this.place('mini', 'barrel', stall.x, stall.z + 2.6, { scale: 3.2, collider: { halfX: 0.9, halfZ: 0.9 } });

      const signX = stall.x + (stall.x < 0 ? 1.6 : -1.6);
      this.addSign(stall.label.toUpperCase(), signX, 2.8, stall.z, stall.rotY);

      this.interactables.push({
        id: stall.id,
        label: stall.label,
        x: stall.x + (stall.x < 0 ? 2.2 : -2.2),
        z: stall.z,
        radius: 3.4,
      });
    }

    // A little dressing around the market.
    await this.place('town', 'cart', -13, -8, { scale: 3, rotY: 0.6, collider: { halfX: 1.6, halfZ: 1.4 } });
    await this.place('mini', 'pot', -5.5, 6.5, { scale: 2.6, collider: { halfX: 0.6, halfZ: 0.6 } });
    await this.place('mini', 'pot', 5.5, 6.5, { scale: 2.6, collider: { halfX: 0.6, halfZ: 0.6 } });
  }

  private async scatterForest(): Promise<void> {
    const rng = createRng(0x5eed);
    const trees = ['tree', 'tree-high', 'tree-crooked', 'tree-high-crooked'];

    for (let i = 0; i < 46; i += 1) {
      const angle = rng.floatBetween(0, Math.PI * 2);
      const radius = rng.floatBetween(17, 31);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (Math.abs(x) < 7 && z > -22 && z < 18) {
        continue;
      }
      const name = rng.pick(trees);
      await this.place('town', name, x, z, {
        targetHeight: rng.floatBetween(6.5, 10),
        rotY: rng.floatBetween(0, Math.PI * 2),
        collider: { halfX: 0.5, halfZ: 0.5 },
      });
    }

    for (let i = 0; i < 34; i += 1) {
      const angle = (i / 34) * Math.PI * 2;
      const radius = 33;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      await this.place('town', i % 5 === 0 ? 'hedge-large' : 'hedge', x, z, {
        scale: 3.6,
        rotY: -angle,
      });
    }
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
    }

    for (const mesh of meshes) {
      mesh.receiveShadows = true;
      if (options.shadow !== false) {
        this.shadow.addShadowCaster(mesh);
      }
      mesh.freezeWorldMatrix();
    }

    if (options.collider) {
      this.colliders.push(aabbFromCenter(x, z, options.collider.halfX, options.collider.halfZ));
    }
    return meshes;
  }

  private addSign(text: string, x: number, y: number, z: number, rotY: number): void {
    const plane = MeshBuilder.CreatePlane(`hub-sign-${text}`, { width: 2.6, height: 0.9 }, this.scene);
    plane.position.set(x, y, z);
    plane.rotation.y = rotY;
    plane.billboardMode = 0;

    const texture = new DynamicTexture(
      `hub-sign-tex-${text}`,
      { width: 512, height: 180 },
      this.scene,
      false,
    );
    texture.drawText(text, null, 120, 'bold 76px Segoe UI', '#f7e7bb', '#22331d', true);

    const material = new StandardMaterial(`hub-sign-mat-${text}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.55, 0.55, 0.45);
    material.specularColor = new Color3(0, 0, 0);
    material.backFaceCulling = false;
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
