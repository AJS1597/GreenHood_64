import type { AssetContainer, Scene } from '@babylonjs/core';
import { LoadAssetContainerAsync } from '@babylonjs/core';
import { GLTFLoaderAnimationStartMode } from '@babylonjs/loaders/glTF';

/** Runtime folders produced by `pnpm assets:prepare`. */
export const ASSET_ROOTS = {
  dungeon: 'assets/kenney/modular-dungeon',
  mini: 'assets/kenney/mini-dungeon',
  town: 'assets/kenney/fantasy-town',
  custom: 'assets/custom',
} as const;

export type AssetKit = keyof typeof ASSET_ROOTS;

export interface LoadedAsset {
  key: string;
  container: AssetContainer;
}

/**
 * Loads and caches glTF/GLB asset containers.
 *
 * Generation code requests assets by key; the library handles URL building,
 * caching and de-duplication. Missing files resolve to `null` so the game can
 * boot with an incomplete asset set during development.
 */
export class AssetLibrary {
  private readonly containers = new Map<string, AssetContainer>();
  private readonly pending = new Map<string, Promise<AssetContainer | null>>();

  constructor(private readonly scene: Scene) {}

  /** Build the URL for a `.glb` inside a kit folder. */
  static url(kit: AssetKit, name: string): string {
    return `${ASSET_ROOTS[kit]}/${name}.glb`;
  }

  /** Load (or reuse) a container, returning `null` when the file is missing. */
  async load(kit: AssetKit, name: string): Promise<AssetContainer | null> {
    const key = `${kit}/${name}`;
    const cached = this.containers.get(key);
    if (cached) {
      return cached;
    }
    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.loadInternal(key, AssetLibrary.url(kit, name));
    this.pending.set(key, promise);
    const result = await promise;
    this.pending.delete(key);
    return result;
  }

  /** Look up an already-loaded container without touching the network. */
  get(kit: AssetKit, name: string): AssetContainer | null {
    return this.containers.get(`${kit}/${name}`) ?? null;
  }

  private async loadInternal(key: string, url: string): Promise<AssetContainer | null> {
    try {
      const container = await LoadAssetContainerAsync(url, this.scene, {
        pluginOptions: {
          gltf: {
            animationStartMode: GLTFLoaderAnimationStartMode.NONE,
          },
        },
      });
      // Never auto-play source animations. These containers are cached and
      // reused by every scene; a door/chest left mid-animation would leak that
      // state into the next area.
      for (const group of container.animationGroups) {
        group.stop();
      }
      this.containers.set(key, container);
      return container;
    } catch (error) {
      if (this.isVerbose) {
        console.warn(`[assets] failed to load ${url}`, error);
      }
      return null;
    }
  }

  private get isVerbose(): boolean {
    return import.meta.env.DEV;
  }
}
