/** Ability identifiers that persist between runs. */
export type AbilityId =
  | 'forest-step'
  | 'coin-toss'
  | 'leaf-cloak'
  | 'hunters-focus'
  | 'smoke-veil'
  | 'keen-eye';

/** Permanent bow attachments sold alongside the bow tiers. */
export type BowUpgradeId = 'longbow' | 'recurve';

/** Progression currencies. Crowns are the rare tier. */
export interface Wallet {
  gold: number;
  crowns: number;
}

/** Player-tunable settings, stored alongside the save. */
export interface Settings {
  sensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  headBob: boolean;
}

/** Lifetime counters shown on the title screen. */
export interface Stats {
  runs: number;
  guardsKilled: number;
  crownsEarned: number;
  goldEarned: number;
}

/** Fully persisted game state. */
export interface SaveData {
  version: 1;
  wallet: Wallet;
  /** Bow tier, 1..5. */
  bowTier: number;
  /** Ranks for the alternate bow attachments, 0 = not owned. */
  bowUpgrades: Record<BowUpgradeId, number>;
  /** Ability levels, 0 = locked. */
  abilities: Record<AbilityId, number>;
  /** Training ranks, 0 = untrained. */
  training: {
    maxHealth: number;
    moveSpeed: number;
    quietSteps: number;
    stealth: number;
  };
  /** Two equipped ability slots. */
  equipped: [AbilityId | null, AbilityId | null];
  settings: Settings;
  stats: Stats;
}

export const SAVE_KEY = 'greenhood64.save.v1';
