import { describe, expect, it } from 'vitest';
import { createDefaultSave } from '../src/app/SaveStore';
import { canPurchase, itemsForTab, nextPrice, purchase, rankOf, SHOP_ITEMS } from '../src/core/shop';

const bow = SHOP_ITEMS.find((item) => item.id === 'bow')!;
const endurance = SHOP_ITEMS.find((item) => item.id === 'maxHealth')!;
const cloak = SHOP_ITEMS.find((item) => item.id === 'leaf-cloak')!;

describe('shop', () => {
  it('reports starting ranks', () => {
    const save = createDefaultSave();
    expect(rankOf(save, bow)).toBe(0);
    expect(rankOf(save, endurance)).toBe(0);
    expect(nextPrice(save, bow)).toBe(120);
  });

  it('refuses purchases without the funds', () => {
    const save = createDefaultSave();
    const check = canPurchase(save, bow);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('gold');
    expect(purchase(save, bow)).toBe(false);
    expect(save.bowTier).toBe(1);
  });

  it('buys and advances bow tiers with gold', () => {
    const save = createDefaultSave();
    save.wallet.gold = 120;
    expect(purchase(save, bow)).toBe(true);
    expect(save.bowTier).toBe(2);
    expect(save.wallet.gold).toBe(0);
    expect(nextPrice(save, bow)).toBe(280);
  });

  it('buys crown abilities with crowns and auto-equips', () => {
    const save = createDefaultSave();
    save.wallet.crowns = 5;
    expect(purchase(save, cloak)).toBe(true);
    expect(save.abilities['leaf-cloak']).toBe(1);
    expect(save.wallet.crowns).toBe(3);
    expect(save.equipped).toContain('leaf-cloak');
  });

  it('stops at the maximum rank', () => {
    const save = createDefaultSave();
    save.wallet.gold = 10_000;
    for (let i = 0; i < 10; i += 1) {
      purchase(save, endurance);
    }
    expect(save.training.maxHealth).toBe(3);
    expect(nextPrice(save, endurance)).toBeNull();
    expect(canPurchase(save, endurance).reason).toBe('Maxed');
  });

  it('groups items by tab and stocks every shop', () => {
    expect(itemsForTab('bows').map((item) => item.id)).toContain('bow');
    expect(itemsForTab('crowns').every((item) => item.currency === 'crowns')).toBe(true);
    for (const tab of ['bows', 'abilities', 'training', 'crowns'] as const) {
      expect(itemsForTab(tab).length).toBeGreaterThanOrEqual(3);
    }
  });

  it('buys bow upgrades with gold', () => {
    const save = createDefaultSave();
    const longbow = SHOP_ITEMS.find((item) => item.id === 'longbow')!;
    const recurve = SHOP_ITEMS.find((item) => item.id === 'recurve')!;
    save.wallet.gold = 450;
    expect(purchase(save, longbow)).toBe(true);
    expect(save.bowUpgrades.longbow).toBe(1);
    expect(nextPrice(save, longbow)).toBe(900);
    save.wallet.gold = 400;
    expect(purchase(save, recurve)).toBe(true);
    expect(save.bowUpgrades.recurve).toBe(1);
  });
});
