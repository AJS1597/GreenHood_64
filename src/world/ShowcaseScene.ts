import {
  ArcRotateCamera,
  Color3,
  DirectionalLight,
  DynamicTexture,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  ShadowGenerator,
  StandardMaterial,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import { AssetLibrary } from './AssetLibrary';
import { SHOWCASE, type ShowcaseEntry } from './AssetCatalog';

/**
 * Development scene used to verify assets while the real hub and dungeon
 * scenes are built. Loads a spread of Kenney and custom props onto a grid.
 */
export class ShowcaseScene {
  private readonly shadows: ShadowGenerator;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
  ) {
    const camera = new ArcRotateCamera(
      'showcase-camera',
      -Math.PI / 2.4,
      Math.PI / 3.1,
      34,
      new Vector3(0, 1.4, 0),
      scene,
    );
    camera.attachControl(true);
    camera.wheelPrecision = 12;
    camera.lowerRadiusLimit = 4;
    camera.upperRadiusLimit = 120;
    camera.panningSensibility = 0;

    const sky = new HemisphericLight('showcase-sky', new Vector3(0.2, 1, 0.1), scene);
    sky.intensity = 0.55;
    sky.diffuse = new Color3(0.72, 0.86, 0.72);
    sky.groundColor = new Color3(0.12, 0.16, 0.12);

    const sun = new DirectionalLight('showcase-sun', new Vector3(-0.6, -1, 0.45), scene);
    sun.position = new Vector3(24, 40, -20);
    sun.intensity = 1.1;
    sun.diffuse = new Color3(1, 0.94, 0.8);

    this.shadows = new ShadowGenerator(2048, sun);
    this.shadows.useBlurExponentialShadowMap = true;
    this.shadows.blurKernel = 24;
    this.shadows.darkness = 0.35;

    this.buildGround();
  }

  /** Load and lay out every showcase entry. Missing files become grey boxes. */
  async build(): Promise<void> {
    const columns = Math.ceil(Math.sqrt(SHOWCASE.length));
    const spacing = 7;
    const totalRows = Math.ceil(SHOWCASE.length / columns);

    const loads = SHOWCASE.map(async (entry, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = (col - (columns - 1) / 2) * spacing;
      const z = (row - (totalRows - 1) / 2) * spacing;
      await this.placeEntry(entry, new Vector3(x, 0, z));
    });

    await Promise.all(loads);
  }

  private async placeEntry(entry: ShowcaseEntry, position: Vector3): Promise<void> {
    const container = await this.library.load(entry.kit, entry.name);
    if (!container) {
      this.placePlaceholder(entry, position);
      return;
    }

    const instantiated = container.instantiateModelsToScene();
    const roots = instantiated.rootNodes;
    const meshes: Mesh[] = [];
    for (const node of roots) {
      if (node instanceof Mesh) {
        meshes.push(node);
      }
    }
    if (meshes.length === 0) {
      this.placePlaceholder(entry, position);
      return;
    }

    // Fit tall showpieces (rooms, stairs) into the display cell.
    const bounds = computeBounds(meshes);
    const size = bounds.max.subtract(bounds.min);
    const largest = Math.max(size.x, size.y, size.z);
    const targetSize = Math.max(size.y, 4.5);
    const fit = entry.scale ?? Math.min(1, targetSize / Math.max(largest, 0.001));

    for (const mesh of meshes) {
      mesh.scaling.scaleInPlace(fit);
      mesh.position = mesh.position.add(position);
      mesh.receiveShadows = true;
      this.shadows.addShadowCaster(mesh);
    }

    for (const group of instantiated.animationGroups) {
      group.stop();
    }

    this.addLabel(entry.label, position.add(new Vector3(0, Math.max(size.y * fit, 1) + 0.6, 0)));
  }

  private placePlaceholder(entry: ShowcaseEntry, position: Vector3): void {
    const box = MeshBuilder.CreateBox(`missing-${entry.name}`, { size: 1.2 }, this.scene);
    box.position = position.add(new Vector3(0, 0.6, 0));
    const material = new StandardMaterial(`missing-mat-${entry.name}`, this.scene);
    material.diffuseColor = new Color3(0.25, 0.25, 0.28);
    material.emissiveColor = new Color3(0.06, 0.02, 0.02);
    box.material = material;
    box.receiveShadows = true;
    this.shadows.addShadowCaster(box);
    this.addLabel(`${entry.label} (missing)`, position.add(new Vector3(0, 1.6, 0)));
  }

  private addLabel(text: string, position: Vector3): void {
    const plane = MeshBuilder.CreatePlane(`label-${text}`, { width: 3.2, height: 0.8 }, this.scene);
    plane.position = position;
    plane.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const texture = new DynamicTexture(
      `label-tex-${text}`,
      { width: 256, height: 64 },
      this.scene,
      false,
    );
    texture.hasAlpha = true;
    texture.drawText(text, null, 44, 'bold 30px Segoe UI', '#efe3c2', 'transparent', true);

    const material = new StandardMaterial(`label-mat-${text}`, this.scene);
    material.diffuseTexture = texture;
    material.opacityTexture = texture;
    material.emissiveColor = new Color3(1, 1, 1);
    material.disableLighting = true;
    material.backFaceCulling = false;
    plane.material = material;
  }

  private buildGround(): void {
    const ground = MeshBuilder.CreateGround(
      'showcase-ground',
      { width: 160, height: 160, subdivisions: 2 },
      this.scene,
    );
    ground.position.y = -0.05;
    const material = new StandardMaterial('showcase-ground-mat', this.scene);
    material.diffuseColor = new Color3(0.16, 0.24, 0.15);
    material.specularColor = new Color3(0, 0, 0);
    ground.material = material;
    ground.receiveShadows = true;
  }
}

function computeBounds(meshes: readonly Mesh[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
  for (const mesh of meshes) {
    const vectors = mesh.getHierarchyBoundingVectors(true);
    min.minimizeInPlace(vectors.min);
    max.maximizeInPlace(vectors.max);
  }
  return { min, max };
}
