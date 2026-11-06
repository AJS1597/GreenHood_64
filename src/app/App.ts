import { AssetLibrary } from '../world/AssetLibrary';
import { HubScene } from '../world/HubScene';
import { SceneHost } from '../world/SceneHost';
import { ShowcaseScene } from '../world/ShowcaseScene';
import { LoadingScreen } from '../ui/LoadingScreen';
import { Hud } from '../ui/Hud';
import { ShopPanel } from '../ui/ShopPanel';
import { PlayerController } from '../gameplay/PlayerController';
import { DEBUG } from '../core/config';
import type { ShopTab } from '../core/shop';
import { SaveStore } from './SaveStore';

/** Which tab a merchant stall opens. */
const STALL_TABS: Record<string, ShopTab> = {
  bows: 'bows',
  abilities: 'abilities',
  training: 'training',
  crowns: 'crowns',
};

type AppState = 'boot' | 'playing' | 'paused' | 'shop';

/**
 * Top-level application and scene-state machine. For now it boots straight into
 * the fixed Sherwood hub; the castle run will be added as another state.
 */
export class App {
  private readonly host: SceneHost;
  private readonly loading: LoadingScreen;
  private readonly library: AssetLibrary;
  private readonly hud: Hud;
  private readonly shop: ShopPanel;
  private readonly player: PlayerController;
  private readonly clickOverlay: HTMLElement;
  private readonly debugState: HTMLElement | null;
  private readonly debugPos: HTMLElement | null;
  private readonly debugSeed: HTMLElement | null;
  private readonly debugFps: HTMLElement | null;

  readonly save: SaveStore;

  private hub: HubScene | null = null;
  private state: AppState = 'boot';
  private debugTimer = 0;

  constructor(canvas: HTMLCanvasElement, document: Document) {
    this.loading = new LoadingScreen(document);
    this.host = new SceneHost(canvas);
    this.library = new AssetLibrary(this.host.scene);
    this.save = new SaveStore();
    this.hud = new Hud(document);
    this.shop = new ShopPanel(document, this.save);
    this.player = new PlayerController(this.host.scene, canvas, this.save.current.settings);

    this.clickOverlay = requiredElement(document, 'click-to-play');
    this.debugState = document.getElementById('debug-state');
    this.debugPos = document.getElementById('debug-pos');
    this.debugSeed = document.getElementById('debug-seed');
    this.debugFps = document.getElementById('debug-fps');
  }

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    DEBUG.enabled = params.has('debug');

    // Development viewer: `?view=assets` shows every asset on a grid.
    if (params.get('view') === 'assets') {
      await this.startShowcase();
      return;
    }

    this.loading.setLabel('Building Sherwood camp…');
    this.loading.setProgress(0.35);

    this.hub = new HubScene(this.host.scene, this.library);
    await this.hub.build();
    this.loading.setProgress(0.9);

    this.player.colliders = this.hub.colliders;
    this.player.bounds = this.hub.bounds;
    this.player.camera.fov = this.save.current.settings.fov;
    this.player.spawn(this.hub.spawn.x, this.hub.spawn.z, this.hub.spawn.yaw);

    this.wireUi();
    this.hud.show();
    this.hud.setWallet(this.save.current.wallet.gold, this.save.current.wallet.crowns);
    this.host.start();

    this.loading.setLabel('Ready.');
    await this.loading.hide();

    this.pause();
  }

  private wireUi(): void {
    this.clickOverlay.addEventListener('click', () => {
      if (this.state === 'paused') {
        this.player.requestLock();
      }
    });

    this.player.onLockChange = (locked) => {
      if (locked) {
        this.clickOverlay.hidden = true;
        if (this.state === 'paused') {
          this.state = 'playing';
        }
      } else if (this.state === 'playing') {
        this.pause();
      }
    };

    this.player.onInteract = () => this.handleInteract();

    this.shop.onClose = () => {
      this.pause();
    };
    this.shop.onChange = () => {
      const save = this.save.current;
      this.hud.setWallet(save.wallet.gold, save.wallet.crowns);
      this.player.camera.fov = save.settings.fov;
    };

    this.host.onFrame((deltaMs) => this.update(deltaMs));
  }

  private update(deltaMs: number): void {
    this.player.update(deltaMs);
    this.updatePrompt();

    if (DEBUG.enabled) {
      this.debugTimer += deltaMs;
      if (this.debugTimer > 250) {
        this.debugTimer = 0;
        const pos = this.player.position;
        if (this.debugFps) this.debugFps.textContent = this.host.fps.toFixed(0);
        if (this.debugState) this.debugState.textContent = this.state;
        if (this.debugPos)
          this.debugPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
        if (this.debugSeed) this.debugSeed.textContent = 'hub';
      }
    }
  }

  private updatePrompt(): void {
    if (this.state !== 'playing' || !this.player.isLocked || !this.hub) {
      this.hud.setPrompt(null);
      return;
    }
    const pos = this.player.position;
    const interactable = this.hub.nearest(pos.x, pos.z);
    this.hud.setPrompt(interactable ? interactable.label : null);
  }

  private handleInteract(): void {
    if (this.state !== 'playing' || !this.hub) {
      return;
    }
    const pos = this.player.position;
    const interactable = this.hub.nearest(pos.x, pos.z);
    if (!interactable) {
      return;
    }

    if (interactable.id === 'castle') {
      this.hud.showToast('The castle gates are sealed for now — the dungeon is the next milestone.');
      return;
    }

    const tab = STALL_TABS[interactable.id] ?? 'bows';
    this.openShop(tab);
  }

  private openShop(tab: ShopTab): void {
    this.state = 'shop';
    this.hud.setPrompt(null);
    this.player.releaseLock();
    this.shop.show(tab);
  }

  private pause(): void {
    this.state = 'paused';
    this.clickOverlay.hidden = false;
    this.hud.setPrompt(null);
  }

  private async startShowcase(): Promise<void> {
    this.loading.setLabel('Loading the asset viewer…');
    this.hud.hide();
    const showcase = new ShowcaseScene(this.host.scene, this.library);
    await showcase.build();
    this.host.start();
    this.loading.setProgress(1);
    await this.loading.hide();
  }
}

function requiredElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}
