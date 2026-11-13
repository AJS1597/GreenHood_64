import { describe, expect, it } from 'vitest';
import { SaveStore, createDefaultSave } from '../src/app/SaveStore';
import { SAVE_KEY } from '../src/app/types';

/** Minimal in-memory Storage for tests (Node has no localStorage). */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe('SaveStore', () => {
  it('starts from defaults with an empty storage', () => {
    const store = new SaveStore(new MemoryStorage());
    expect(store.current).toEqual(createDefaultSave());
  });

  it('persists updates across instances', () => {
    const storage = new MemoryStorage();
    const first = new SaveStore(storage);
    first.update((save) => {
      save.wallet.gold = 420;
      save.bowTier = 3;
    });

    const second = new SaveStore(storage);
    expect(second.current.wallet.gold).toBe(420);
    expect(second.current.bowTier).toBe(3);
  });

  it('falls back to defaults on corrupt data', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    const store = new SaveStore(storage);
    expect(store.current).toEqual(createDefaultSave());
  });

  it('merges partial saves over defaults', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ wallet: { gold: 12 } }));
    const store = new SaveStore(storage);
    expect(store.current.wallet.gold).toBe(12);
    expect(store.current.wallet.crowns).toBe(0);
    expect(store.current.settings.headBob).toBe(true);
    expect(store.current.equipped[0]).toBe('forest-step');
    expect(store.current.bowUpgrades).toEqual({ longbow: 0, recurve: 0 });
  });

  it('clamps bow tier and abilities to valid ranks', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      SAVE_KEY,
      JSON.stringify({
        bowTier: 99,
        bowUpgrades: { longbow: 12, recurve: -2 },
        abilities: { 'leaf-cloak': 12 },
      }),
    );
    const store = new SaveStore(storage);
    expect(store.current.bowTier).toBe(5);
    expect(store.current.bowUpgrades).toEqual({ longbow: 3, recurve: 0 });
    expect(store.current.abilities['leaf-cloak']).toBe(3);
  });

  it('rejects unknown equipped abilities', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ equipped: ['bogus', 'coin-toss'] }));
    const store = new SaveStore(storage);
    expect(store.current.equipped).toEqual([null, 'coin-toss']);
  });

  it('resets to a fresh save', () => {
    const store = new SaveStore(new MemoryStorage());
    store.update((save) => {
      save.wallet.gold = 100;
    });
    store.reset();
    expect(store.current.wallet.gold).toBe(0);
  });
});
