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
  private readonly restPosition = new Vector3(0.3, -0.14, 0.62);
  private readonly aimPosition = new Vector3(0.16, -0.05, 0.52);
  private readonly restRotation = new Vector3(0.06, -0.38, -0.22);
  private readonly aimRotation = new Vector3(0.02, -0.22, -0.08);
  private tier: number;
  private request = 0;
  private aiming = false;
  private draw = 0;
  private recoil = 0;

  constructor(
    private readonly scene: Scene,
    private readonly library: AssetLibrary,
    camera: Node,
    tier: number,
  ) {
    this.tier = clampTier(tier);
    this.root = new TransformNode('bow-viewmodel', scene);
    this.root.parent = camera;
    this.root.position.copyFrom(this.restPosition);
    this.root.rotation.copyFrom(this.restRotation);
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

  setAiming(aiming: boolean): void {
    this.aiming = aiming;
  }

  setDraw(charge: number): void {
    this.draw = Math.max(0, Math.min(1, charge));
  }

  /** Kick the viewmodel back when an arrow leaves the string. */
  release(): void {
    this.draw = 0;
    this.recoil = 1;
  }

  update(dt: number): void {
    this.recoil = Math.max(0, this.recoil - dt * 5);
    const aim = this.aiming ? 1 : 0;
    const draw = this.draw;

    const targetPosition = Vector3.Lerp(this.restPosition, this.aimPosition, aim);
    targetPosition.z -= draw * 0.13;
    targetPosition.y += draw * 0.01;
    targetPosition.z += this.recoil * 0.06;
    targetPosition.y += this.recoil * 0.03;

    const targetRotation = Vector3.Lerp(this.restRotation, this.aimRotation, aim);
    targetRotation.z += draw * 0.06;
    targetRotation.x -= this.recoil * 0.12;

    const targetScale = 0.4 + aim * 0.04 - draw * 0.02;
    const blend = Math.min(1, dt * 14);
    this.root.position.copyFrom(Vector3.Lerp(this.root.position, targetPosition, blend));
    this.root.rotation.copyFrom(Vector3.Lerp(this.root.rotation, targetRotation, blend));
    const scale = this.root.scaling.x + (targetScale - this.root.scaling.x) * blend;
    this.root.scaling.setAll(scale);
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
