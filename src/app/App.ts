import { AssetLibrary } from '../world/AssetLibrary';
import { SceneHost } from '../world/SceneHost';
import { ShowcaseScene } from '../world/ShowcaseScene';
import { LoadingScreen } from '../ui/LoadingScreen';
import { DEBUG } from '../core/config';
import { SaveStore } from './SaveStore';

/**
 * Top-level application.
 *
 * For now it boots the engine and a development showcase scene so the asset
 * pipeline can be verified. Later this becomes a state machine that swaps the
 * hub and dungeon scenes.
 */
export class App {
  private readonly host: SceneHost;
  private readonly loading: LoadingScreen;
  private readonly library: AssetLibrary;
  readonly save: SaveStore;

  constructor(canvas: HTMLCanvasElement, document: Document) {
    this.loading = new LoadingScreen(document);
    this.host = new SceneHost(canvas);
    this.library = new AssetLibrary(this.host.scene);
    this.save = new SaveStore();
  }

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    DEBUG.enabled = params.has('debug');

    this.loading.setLabel('Loading the assets…');
    this.loading.setProgress(0.2);

    const showcase = new ShowcaseScene(this.host.scene, this.library);
    await showcase.build();
    this.loading.setProgress(0.95);

    this.setupDebugHud(document);
    this.host.start();
    this.loading.setLabel('Ready.');
    await this.loading.hide();
  }

  private setupDebugHud(document: Document): void {
    const hud = document.getElementById('debug-hud');
    const fps = document.getElementById('debug-fps');
    const state = document.getElementById('debug-state');
    if (!hud || !fps || !state || !DEBUG.enabled) {
      return;
    }
    hud.hidden = false;
    state.textContent = 'showcase';
    let elapsed = 0;
    this.host.onFrame((deltaMs) => {
      elapsed += deltaMs;
      if (elapsed < 250) {
        return;
      }
      elapsed = 0;
      fps.textContent = this.host.fps.toFixed(0);
    });
  }
}
