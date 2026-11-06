import type { AssetKit } from './AssetLibrary';

/** A prop that is loaded and displayed by the development showcase scene. */
export interface ShowcaseEntry {
  /** Display label. */
  label: string;
  kit: AssetKit;
  /** File name without the `.glb` extension. */
  name: string;
  /** Optional uniform scale override. */
  scale?: number;
}

/**
 * Hand-picked assets used by the scaffold viewer to prove the Kenney kits and
 * custom exports load correctly. Real scenes load exactly what they need.
 */
export const SHOWCASE: readonly ShowcaseEntry[] = [
  // Fantasy Town: the forest hub dressing.
  { label: 'Tree', kit: 'town', name: 'tree' },
  { label: 'Tall Tree', kit: 'town', name: 'tree-high' },
  { label: 'Crooked Tree', kit: 'town', name: 'tree-crooked' },
  { label: 'Hedge', kit: 'town', name: 'hedge' },
  { label: 'Fence', kit: 'town', name: 'fence' },
  { label: 'Stall', kit: 'town', name: 'stall-green' },
  { label: 'Lantern', kit: 'town', name: 'lantern' },
  { label: 'Cart', kit: 'town', name: 'cart' },
  { label: 'Arch', kit: 'town', name: 'wall-arch' },

  // Modular Dungeon: the castle.
  { label: 'Floor Tile', kit: 'dungeon', name: 'template-floor' },
  { label: 'Wall', kit: 'dungeon', name: 'template-wall' },
  { label: 'Corridor', kit: 'dungeon', name: 'corridor' },
  { label: 'Room Small', kit: 'dungeon', name: 'room-small' },
  { label: 'Room Medium', kit: 'dungeon', name: 'room-wide' },
  { label: 'Room Large', kit: 'dungeon', name: 'room-large' },
  { label: 'Room Corner', kit: 'dungeon', name: 'room-corner' },
  { label: 'Stairs', kit: 'dungeon', name: 'stairs' },
  { label: 'Gate', kit: 'dungeon', name: 'gate-door' },

  // Mini Dungeon: loot and props.
  { label: 'Chest', kit: 'mini', name: 'chest' },
  { label: 'Key', kit: 'mini', name: 'key' },
  { label: 'Coin', kit: 'mini', name: 'coin' },
  { label: 'Potion', kit: 'mini', name: 'potion' },
  { label: 'Barrel', kit: 'mini', name: 'barrel' },
  { label: 'Column', kit: 'mini', name: 'column' },
  { label: 'Table', kit: 'mini', name: 'table' },

  // Custom exports.
  { label: 'Guard', kit: 'custom', name: 'guard' },
  { label: 'Bow T1', kit: 'custom', name: 'bow-tier-1' },
  { label: 'Bow T3', kit: 'custom', name: 'bow-tier-3' },
  { label: 'Bow T5', kit: 'custom', name: 'bow-tier-5' },
];
