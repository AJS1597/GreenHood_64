import { Color4, Engine, Scene } from '@babylonjs/core';
import { CONFIG, DEBUG } from '../core/config';

/**
 * Owns the Babylon engine, the active scene and the render loop.
 *
 * Views (hub, dungeon, asset viewer) build their own content on top of the
 * scene this exposes; nothing else in the game talks to the engine directly.
 */
export class SceneHost {
  readonly engine: Engine;
  readonly scene: Scene;

  private frameCallback: ((deltaMs: number) => void) | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: true,
      powerPreference: 'high-performance',
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = Color4.FromHexString(`${CONFIG.RENDER.clearColor}ff`);
    this.scene.autoClear = true;
    this.scene.blockMaterialDirtyMechanism = true;

    window.addEventListener('resize', this.handleResize);
  }

  /** Register the per-frame update used by gameplay systems. */
  onFrame(callback: (deltaMs: number) => void): void {
    this.frameCallback = callback;
  }

  start(): void {
    this.engine.runRenderLoop(() => {
      const deltaMs = this.engine.getDeltaTime();
      this.frameCallback?.(deltaMs);
      this.scene.render();
    });
  }

  get fps(): number {
    return this.engine.getFps();
  }

  get debugEnabled(): boolean {
    return DEBUG.enabled;
  }

  dispose(): void {
    window.removeEventListener('resize', this.handleResize);
    this.engine.stopRenderLoop();
    this.scene.dispose();
    this.engine.dispose();
  }

  private readonly handleResize = (): void => {
    this.engine.resize();
    void this.canvas;
  };
}
