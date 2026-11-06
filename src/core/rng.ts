/**
 * Small deterministic pseudo-random number generator.
 *
 * Dungeon generation must be reproducible from a seed, so all layout code
 * pulls its randomness through this type rather than `Math.random`.
 */
export interface Rng {
  /** Next float in [0, 1). */
  next(): number;
  /** Integer in [min, max] inclusive. */
  intBetween(min: number, max: number): number;
  /** Float in [min, max). */
  floatBetween(min: number, max: number): number;
  /** True with the given probability. */
  chance(probability: number): boolean;
  /** Uniformly pick one element. Throws on an empty list. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle, returning a new array. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Mulberry32: tiny, fast, good enough for level generation. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const intBetween = (min: number, max: number): number =>
    Math.floor(next() * (max - min + 1)) + min;

  return {
    next,
    intBetween,
    floatBetween: (min, max) => min + next() * (max - min),
    chance: (probability) => next() < probability,
    pick: <T,>(items: readonly T[]): T => {
      if (items.length === 0) {
        throw new Error('Cannot pick from an empty list');
      }
      const index = Math.floor(next() * items.length);
      return items[index] as T;
    },
    shuffle: <T,>(items: readonly T[]): T[] => {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const a = copy[i] as T;
        const b = copy[j] as T;
        copy[i] = b;
        copy[j] = a;
      }
      return copy;
    },
  };
}

/** Turn arbitrary text into a stable unsigned 32-bit seed. */
export function hashSeed(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Produce a fresh random seed (not reproducible). */
export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Short, human-readable seed label for the HUD. */
export function formatSeed(seed: number): string {
  return seed.toString(16).toUpperCase().padStart(8, '0');
}
