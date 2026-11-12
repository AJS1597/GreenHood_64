/**
 * Central tunables for GreenHood 64.
 *
 * Everything is in world units where 1 unit = 1 metre. The Modular Dungeon
 * kit is authored on a 4 m grid, so those numbers show up here too.
 */
export const CONFIG = {
  /** Logical rendering settings. */
  RENDER: {
    clearColor: '#070b0d',
    fov: 1.15,
    minZ: 0.1,
    maxZ: 400,
  },

  /** Shared metric facts about the modular kits. */
  WORLD: {
    /** Modular Dungeon cell size in metres. */
    tile: 4,
    /** Modular Dungeon wall / ceiling height. */
    wallHeight: 4.15,
    /** Vertical gap between dungeon floors. */
    floorHeight: 4.15,
    /** Player collision radius. */
    playerRadius: 0.35,
    /** Camera height while standing. */
    playerEye: 1.6,
    /** Camera height while crouched. */
    crouchEye: 1.1,
    /** World vertical offset of the first dungeon floor. */
    groundY: 0,
  },
} as const;

/** Debug flags, overridable from the URL with `?debug=1`. */
export const DEBUG = {
  enabled: false,
};

/** Where runtime assets are served from. */
export const ASSET_BASE = 'assets';

export type Config = typeof CONFIG;
