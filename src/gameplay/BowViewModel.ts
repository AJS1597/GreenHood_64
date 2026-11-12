import {
  Color3,
  MeshBuilder,
  PBRMaterial,
  TransformNode,
  Vector3,
  VertexBuffer,
  type Node,
  type Scene,
} from '@babylonjs/core';
import type { AssetLibrary } from '../world/AssetLibrary';

/**
 * First-person bow held in the lower-right of the camera. This is presentation
 * only for now; combat will drive the draw/release animations later.
 */
export class BowViewModel {
  private readonly root: TransformNode;
  private tier: number;
  private request = 0;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
    camera: Node,
    tier: number,
  ) {
    this.tier = clampTier(tier);
    this.root = new TransformNode('bow-viewmodel', scene);
    this.root.parent = camera;
    this.root.position.set(0.3, -0.14, 0.62);
    this.root.rotation.set(0.06, -0.38, -0.22);
    this.root.scaling.setAll(0.4);
  }

  async build(): Promise<void> {
    await this.showTier(this.tier);
  }

  async setTier(tier: number): Promise<void> {
    const next = clampTier(tier);
    if (next === this.tier) {
      return;
    }
    this.tier = next;
    await this.showTier(next);
  }

  dispose(): void {
    this.root.dispose(false, true);
  }

  private async showTier(tier: number): Promise<void> {
    const request = ++this.request;
    const container = await this.library.load('custom', `bow-tier-${tier}`);
    // A newer tier was requested while this one was loading.
    if (request !== this.request) {
      return;
    }
    this.clear();
    if (!container) {
      return;
    }

    const instantiated = container.instantiateModelsToScene(
      (sourceName) => `bow-view-${tier}-${sourceName}`,
      true,
    );
    for (const group of instantiated.animationGroups) {
      group.stop();
    }
    for (const node of instantiated.rootNodes) {
      node.parent = this.root;
    }
    for (const mesh of this.root.getChildMeshes()) {
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true;
      mesh.receiveShadows = false;
      const material = mesh.material;
      if (material instanceof PBRMaterial) {
        // Keep the bow readable in the castle's dim torch light.
        material.emissiveColor = new Color3(0.11, 0.09, 0.06);
      }
      this.addString(mesh, tier);
    }
  }

  /** Join the stave tips with a light line so the model reads as a bow. */
  private addString(mesh: ReturnType<TransformNode['getChildMeshes']>[number], tier: number): void {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (!positions) {
      return;
    }
    let top: Vector3 | null = null;
    let bottom: Vector3 | null = null;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] ?? 0;
      const y = positions[i + 1] ?? 0;
      const z = positions[i + 2] ?? 0;
      if (!top || y > top.y) {
        top = new Vector3(x, y, z);
      }
      if (!bottom || y < bottom.y) {
        bottom = new Vector3(x, y, z);
      }
    }
    if (!top || !bottom || Math.abs(top.y - bottom.y) < 0.5) {
      return;
    }
    const string = MeshBuilder.CreateLines(
      `bow-string-${tier}`,
      { points: [top, bottom], updatable: false },
      this.scene,
    );
    string.parent = mesh;
    string.color = new Color3(0.8, 0.76, 0.62);
    string.isPickable = false;
    string.alwaysSelectAsActiveMesh = true;
  }

  private clear(): void {
    for (const child of this.root.getChildren()) {
      child.dispose(false, true);
    }
  }
}

function clampTier(tier: number): number {
  return Math.min(5, Math.max(1, Math.floor(tier)));
}
