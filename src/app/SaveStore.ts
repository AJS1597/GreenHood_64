import { SAVE_KEY, type AbilityId, type BowUpgradeId, type SaveData } from './types';

/** Every ability starts locked; level 1 is the first unlock. */
const DEFAULT_ABILITIES: Record<AbilityId, number> = {
  'forest-step': 0,
  'coin-toss': 0,
  'leaf-cloak': 0,
  'hunters-focus': 0,
  'smoke-veil': 0,
  'keen-eye': 0,
};

const DEFAULT_BOW_UPGRADES: Record<BowUpgradeId, number> = {
  longbow: 0,
  recurve: 0,
};

const ABILITY_IDS: readonly AbilityId[] = Object.keys(DEFAULT_ABILITIES) as AbilityId[];

/** Fresh-save template. Returned by value so callers can't mutate the default. */
export function createDefaultSave(): SaveData {
  return {
    version: 1,
    wallet: { gold: 0, crowns: 0 },
    bowTier: 1,
    bowUpgrades: { ...DEFAULT_BOW_UPGRADES },
    abilities: { ...DEFAULT_ABILITIES },
    training: { maxHealth: 0, moveSpeed: 0, quietSteps: 0, stealth: 0 },
    equipped: ['forest-step', null],
    settings: {
      sensitivity: 1,
      invertY: false,
      fov: 1.15,
      masterVolume: 0.8,
      headBob: true,
    },
    stats: { runs: 0, guardsKilled: 0, crownsEarned: 0, goldEarned: 0 },
  };
}

/**
 * Thin wrapper around `localStorage` that validates what it reads.
 *
 * The game must never crash because a save is old, corrupt or from a future
 * build, so loading always falls back to a fresh save on any problem.
 */
export class SaveStore {
  private data: SaveData;
  private readonly storage: Storage | null;

  constructor(storage: Storage | null = safeLocalStorage()) {
    this.storage = storage;
    this.data = this.read();
  }

  get current(): SaveData {
    return this.data;
  }

  /** Replace the in-memory save and persist it. */
  update(mutate: (data: SaveData) => void): void {
    mutate(this.data);
    this.write();
  }

  /** Start over from a fresh save. */
  reset(): void {
    this.data = createDefaultSave();
    this.write();
  }

  private read(): SaveData {
    if (!this.storage) {
      return createDefaultSave();
    }
    const raw = this.storage.getItem(SAVE_KEY);
    if (!raw) {
      return createDefaultSave();
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return mergeWithDefaults(parsed);
    } catch {
      return createDefaultSave();
    }
  }

  private write(): void {
    if (!this.storage) {
      return;
    }
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: keep playing from memory.
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const probe = '__greenhood_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Deep-merge a partial/unknown object over the defaults so older saves keep
 * working when new fields are added.
 */
function mergeWithDefaults(value: unknown): SaveData {
  const defaults = createDefaultSave();
  if (!isRecord(value)) {
    return defaults;
  }
  const wallet = isRecord(value.wallet) ? value.wallet : {};
  const bowUpgrades = isRecord(value.bowUpgrades) ? value.bowUpgrades : {};
  const abilities = isRecord(value.abilities) ? value.abilities : {};
  const training = isRecord(value.training) ? value.training : {};
  const settings = isRecord(value.settings) ? value.settings : {};
  const stats = isRecord(value.stats) ? value.stats : {};

  return {
    version: 1,
    wallet: {
      gold: numberOr(wallet.gold, defaults.wallet.gold),
      crowns: numberOr(wallet.crowns, defaults.wallet.crowns),
    },
    bowTier: clamp(numberOr(value.bowTier, defaults.bowTier), 1, 5),
    bowUpgrades: {
      longbow: rankOr(bowUpgrades.longbow),
      recurve: rankOr(bowUpgrades.recurve),
    },
    abilities: {
      'forest-step': rankOr(abilities['forest-step']),
      'coin-toss': rankOr(abilities['coin-toss']),
      'leaf-cloak': rankOr(abilities['leaf-cloak']),
      'hunters-focus': rankOr(abilities['hunters-focus']),
      'smoke-veil': rankOr(abilities['smoke-veil']),
      'keen-eye': rankOr(abilities['keen-eye']),
    },
    training: {
      maxHealth: rankOr(training.maxHealth),
      moveSpeed: rankOr(training.moveSpeed),
      quietSteps: rankOr(training.quietSteps),
      stealth: rankOr(training.stealth),
    },
    equipped: [
      abilityOr(value.equipped, 0, defaults.equipped[0]),
      abilityOr(value.equipped, 1, defaults.equipped[1]),
    ],
    settings: {
      sensitivity: numberOr(settings.sensitivity, defaults.settings.sensitivity),
      invertY: booleanOr(settings.invertY, defaults.settings.invertY),
      fov: numberOr(settings.fov, defaults.settings.fov),
      masterVolume: numberOr(settings.masterVolume, defaults.settings.masterVolume),
      headBob: booleanOr(settings.headBob, defaults.settings.headBob),
    },
    stats: {
      runs: numberOr(stats.runs, 0),
      guardsKilled: numberOr(stats.guardsKilled, 0),
      crownsEarned: numberOr(stats.crownsEarned, 0),
      goldEarned: numberOr(stats.goldEarned, 0),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function rankOr(value: unknown): number {
  return clamp(Math.floor(numberOr(value, 0)), 0, 3);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function abilityOr(
  equipped: unknown,
  index: number,
  fallback: AbilityId | null,
): AbilityId | null {
  if (!Array.isArray(equipped)) {
    return fallback;
  }
  const candidate = equipped[index];
  return typeof candidate === 'string' && (ABILITY_IDS as readonly string[]).includes(candidate)
    ? (candidate as AbilityId)
    : null;
}
