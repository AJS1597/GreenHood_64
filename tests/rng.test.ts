import { describe, expect, it } from 'vitest';
import { createRng, formatSeed, hashSeed } from '../src/core/rng';

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const first = [a.next(), a.next(), a.next()];
    const second = [b.next(), b.next(), b.next()];
    expect(first).toEqual(second);
  });

  it('produces different streams for different seeds', () => {
    const a = createRng(1).next();
    const b = createRng(2).next();
    expect(a).not.toBe(b);
  });

  it('keeps intBetween within inclusive bounds', () => {
    const rng = createRng(99);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.intBetween(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(7);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('shuffles without losing elements', () => {
    const rng = createRng(7);
    const source = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(source);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(source);
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('throws when picking from an empty list', () => {
    const rng = createRng(1);
    expect(() => rng.pick([])).toThrow();
  });
});

describe('hashSeed', () => {
  it('is stable and unsigned', () => {
    const first = hashSeed('castle');
    expect(first).toBe(hashSeed('castle'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(0x100000000);
  });

  it('formats as an eight-character hex label', () => {
    expect(formatSeed(0x00abcdef)).toBe('00ABCDEF');
  });
});
