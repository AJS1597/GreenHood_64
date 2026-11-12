import { Color4 } from '@babylonjs/core';
import { AssetLibrary } from '../world/AssetLibrary';
import { DungeonScene } from '../world/DungeonScene';
import { HubScene } from '../world/HubScene';
import { SceneHost } from '../world/SceneHost';
import { ShowcaseScene } from '../world/ShowcaseScene';
import { LoadingScreen } from '../ui/LoadingScreen';
import { Hud } from '../ui/Hud';
import { ShopPanel } from '../ui/ShopPanel';
import { PlayerController } from '../gameplay/PlayerController';
import { BowViewModel } from '../gameplay/BowViewModel';
import { DEBUG } from '../core/config';
import { formatSeed, randomSeed } from '../core/rng';
import type { ShopTab } from '../core/shop';
import { SaveStore } from './SaveStore';

/** Which tab a merchant stall opens. */
const STALL_TABS: Record<string, ShopTab> = {
  bows: 'bows',
  abilities: 'abilities',
  training: 'training',
  crowns: 'crowns',
};

const HUB_CLEAR = Color4.FromHexString('#c9d6ddff');
const CASTLE_CLEAR = Color4.FromHexString('#030405ff');

type AppState = 'boot' | 'playing' | 'paused' | 'shop';
type Location = 'hub' | 'castle';

/**
 * Top-level application. Owns the location swap (fixed hub <-> generated
 * castle), the player, the HUD and the shop. Only one location exists at once;
 * the other is disposed so the scene never accumulates geometry.
 */
export class App {
  private readonly host: SceneHost;
  private readonly loading: LoadingScreen;
  private readonly library: AssetLibrary;
  private readonly hud: Hud;
  private readonly shop: ShopPanel;
  private readonly player: PlayerController;
  private readonly bow: BowViewModel;
  private readonly resumeHint: HTMLElement;
  private readonly fade: HTMLElement;
  private readonly debugState: HTMLElement | null;
  private readonly debugPos: HTMLElement | null;
  private readonly debugSeed: HTMLElement | null;
  private readonly debugFps: HTMLElement | null;

  readonly save: SaveStore;

  private hub: HubScene | null = null;
  private castle: DungeonScene | null = null;
  private location: Location = 'hub';
  private state: AppState = 'boot';
  private debugTimer = 0;

  private runGold = 0;
  private runKeys = 0;
  private runSeed = 0;
  private debugAt: string | null = null;

  constructor(canvas: HTMLCanvasElement, document: Document) {
    this.loading = new LoadingScreen(document);
    this.host = new SceneHost(canvas);
    this.library = new AssetLibrary(this.host.scene);
    this.save = new SaveStore();
    this.hud = new Hud(document);
    this.shop = new ShopPanel(document, this.save);
    this.player = new PlayerController(this.host.scene, canvas, this.save.current.settings);
    this.bow = new BowViewModel(
      this.host.scene,
      this.library,
      this.player.camera,
      this.save.current.bowTier,
    );

    this.resumeHint = requiredElement(document, 'click-to-play');
    this.fade = requiredElement(document, 'fade');
    this.debugState = document.getElementById('debug-state');
    this.debugPos = document.getElementById('debug-pos');
    this.debugSeed = document.getElementById('debug-seed');
    this.debugFps = document.getElementById('debug-fps');
  }

  async start(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    DEBUG.enabled = params.has('debug');
    this.debugAt = params.get('at');

    if (params.get('view') === 'assets') {
      await this.startShowcase();
      return;
    }

    this.loading.setLabel('Building Sherwood camp…');
    this.loading.setProgress(0.35);
    await this.loadHub();
    await this.bow.build();
    this.loading.setProgress(0.9);

    this.wireUi();
    this.hud.show();
    this.refreshWallet();
    this.host.start();

    this.loading.setLabel('Ready.');
    await this.loading.hide();

    if (import.meta.env.DEV) {
      (window as unknown as { __ghApp: App }).__ghApp = this;
    }

    // Debug entry point straight into a castle run.
    if (params.has('castle')) {
      await this.enterCastle();
    } else {
      this.pause();
    }
  }

  private wireUi(): void {
    this.player.onLockChange = (locked) => {
      if (locked) {
        this.resumeHint.hidden = true;
        this.state = 'playing';
      } else if (this.state === 'playing') {
        this.pause();
      }
    };

    this.player.onInteract = () => {
      void this.handleInteract();
    };

    this.shop.onClose = () => {
      this.resume();
    };
    this.shop.onChange = () => {
      const save = this.save.current;
      this.refreshWallet();
      this.player.camera.fov = save.settings.fov;
      void this.bow.setTier(save.bowTier);
    };

    // Clicking anywhere while paused recaptures the mouse; Escape also resumes
    // (rather than forcing a click on a full-screen overlay).
    document.addEventListener('click', () => {
      if (this.state === 'paused') {
        this.resume();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.state === 'paused') {
        this.resume();
      }
    });

    this.host.onFrame((deltaMs) => this.update(deltaMs));
  }

  private update(deltaMs: number): void {
    this.player.update(deltaMs);
    this.updateStairs();
    this.updateLighting();
    this.updatePrompt();

    if (DEBUG.enabled) {
      this.debugTimer += deltaMs;
      if (this.debugTimer > 250) {
        this.debugTimer = 0;
        const pos = this.player.position;
        if (this.debugFps) this.debugFps.textContent = this.host.fps.toFixed(0);
        if (this.debugState) this.debugState.textContent = `${this.location}/${this.state}`;
        if (this.debugPos) this.debugPos.textContent = `${pos.x.toFixed(1)}, ${pos.z.toFixed(1)}`;
        if (this.debugSeed)
          this.debugSeed.textContent = this.location === 'hub' ? 'hub' : formatSeed(this.runSeed);
      }
    }
  }

  private updateStairs(): void {
    if (this.location !== 'castle' || !this.castle || this.state !== 'playing') {
      return;
    }
    if (this.castle.syncPlayer(this.player.feet)) {
      this.applyCastleFloor();
    }
  }

  private updateLighting(): void {
    if (this.location === 'castle' && this.castle) {
      this.castle.updateLighting(this.player.camera.position);
    }
  }

  private updatePrompt(): void {
    if (this.state !== 'playing' || !this.player.isLocked) {
      this.hud.setPrompt(null);
      return;
    }
    const pos = this.player.position;
    const interactable =
      this.location === 'castle' ? this.castle?.nearest(pos.x, pos.z) : this.hub?.nearest(pos.x, pos.z);
    this.hud.setPrompt(interactable ? interactable.label : null);
  }

  private async handleInteract(): Promise<void> {
    if (this.state !== 'playing') {
      return;
    }
    const pos = this.player.position;

    if (this.location === 'hub' && this.hub) {
      const interactable = this.hub.nearest(pos.x, pos.z);
      if (!interactable) {
        return;
      }
      if (interactable.id === 'castle') {
        await this.enterCastle();
        return;
      }
      this.openShop(STALL_TABS[interactable.id] ?? 'bows');
      return;
    }

    if (this.location === 'castle' && this.castle) {
      const interactable = this.castle.nearest(pos.x, pos.z);
      if (!interactable) {
        return;
      }
      switch (interactable.id) {
        case 'exit':
          await this.leaveCastle();
          return;
        case 'chest':
          this.castle.take(interactable);
          this.runGold += 35;
          this.refreshWallet();
          this.hud.showToast('+35 gold');
          return;
        case 'chest-locked':
          this.hud.showToast(this.runKeys > 0 ? 'Locked chest — a key is needed' : 'It is locked tight');
          return;
        case 'key':
          this.castle.take(interactable);
          this.runKeys += 1;
          this.hud.showToast('Key taken');
          return;
        default:
          return;
      }
    }
  }

  private async enterCastle(): Promise<void> {
    this.state = 'boot';
    this.hud.setPrompt(null);
    await this.fadeThrough(async () => {
      this.hub?.dispose();
      this.hub = null;
      this.runSeed = randomSeed();
      this.runGold = 0;
      this.runKeys = 0;
      const castle = new DungeonScene(this.host.scene, this.library, this.runSeed);
      await castle.build();
      this.castle = castle;
      this.location = 'castle';
      this.player.baseY = castle.baseY;
      this.player.groundHeight = (x, z) => castle.groundHeightAt(x, z);
      this.player.colliders = castle.colliders;
      this.player.bounds = castle.bounds;
      this.player.spawn(castle.dungeon.entrance.x * 4, (castle.dungeon.entrance.z + 1) * 4, Math.PI);
      if (this.debugAt === 'vault') {
        this.player.spawn(castle.dungeon.vault.x * 4, castle.dungeon.vault.z * 4, 0);
      }
      this.player.camera.maxZ = 260;
      this.host.scene.clearColor = CASTLE_CLEAR;
      this.hud.setFloor(`Castle ${formatSeed(this.runSeed)} · Floor 1`);
    });
    this.state = 'playing';
    this.hud.showToast('Find the king or raid the vault — then return to the gate.');
  }

  private async leaveCastle(): Promise<void> {
    this.state = 'boot';
    this.hud.setPrompt(null);
    const banked = this.runGold;
    await this.fadeThrough(async () => {
      this.castle?.dispose();
      this.castle = null;
      await this.loadHub();
    });
    if (banked > 0) {
      this.save.update((save) => {
        save.wallet.gold += banked;
        save.stats.goldEarned += banked;
      });
    }
    this.refreshWallet();
    this.state = 'playing';
    this.hud.showToast(banked > 0 ? `Banked ${banked} gold` : 'Back in Sherwood');
  }

  private async loadHub(): Promise<void> {
    this.castle?.dispose();
    this.castle = null;
    const hub = new HubScene(this.host.scene, this.library);
    await hub.build();
    this.hub = hub;
    this.location = 'hub';
    this.player.baseY = 0;
    this.player.groundHeight = null;
    this.player.colliders = hub.colliders;
    this.player.bounds = hub.bounds;
    this.player.spawn(hub.spawn.x, hub.spawn.z, hub.spawn.yaw);
    this.player.camera.maxZ = 400;
    this.host.scene.clearColor = HUB_CLEAR;
    this.hud.setFloor(null);
  }

  private applyCastleFloor(): void {
    if (!this.castle) {
      return;
    }
    this.player.baseY = this.castle.baseY;
    this.player.colliders = this.castle.colliders;
    this.player.bounds = this.castle.bounds;
    this.hud.setFloor(`Castle ${formatSeed(this.runSeed)} · Floor ${this.castle.currentFloor + 1}`);
  }

  private refreshWallet(): void {
    const save = this.save.current;
    this.hud.setWallet(save.wallet.gold + this.runGold, save.wallet.crowns);
  }

  private openShop(tab: ShopTab): void {
    this.state = 'shop';
    this.hud.setPrompt(null);
    this.player.releaseLock();
    this.shop.show(tab);
  }

  /** Recapture the mouse. Safe to call from a click or a key press. */
  private resume(): void {
    this.player.requestLock();
  }

  private pause(): void {
    this.state = 'paused';
    this.resumeHint.hidden = false;
    this.hud.setPrompt(null);
  }

  private async fadeThrough(action: () => Promise<void>): Promise<void> {
    this.fade.hidden = false;
    // Force a reflow so the opacity transition runs from 0.
    void this.fade.offsetHeight;
    this.fade.classList.add('is-active');
    await wait(230);
    await action();
    await wait(80);
    this.fade.classList.remove('is-active');
    await wait(230);
    this.fade.hidden = true;
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function requiredElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}
