import type { AbilityId, SaveData } from '../app/types';

export type ShopCategory = 'bows' | 'abilities' | 'training';
export type ShopTab = ShopCategory | 'crowns';
export type Currency = 'gold' | 'crowns';

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  description: string;
  currency: Currency;
  /** Cost to advance from rank r to r+1, so length === max rank. */
  prices: readonly number[];
  abilityId?: AbilityId;
  trainingKey?: 'maxHealth' | 'moveSpeed' | 'quietSteps' | 'stealth';
}

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: 'bow',
    category: 'bows',
    name: "Hunter's Bow",
    description: 'Stronger draws and faster shots. Five tiers.',
    currency: 'gold',
    prices: [120, 280, 550, 950],
  },
  {
    id: 'forest-step',
    category: 'abilities',
    name: 'Forest Step',
    description: 'A silent burst of speed. Three levels.',
    currency: 'gold',
    prices: [150, 300, 500],
    abilityId: 'forest-step',
  },
  {
    id: 'coin-toss',
    category: 'abilities',
    name: 'Coin Toss',
    description: 'Throw a coin to lure guards toward the noise. Three levels.',
    currency: 'gold',
    prices: [200, 350, 600],
    abilityId: 'coin-toss',
  },
  {
    id: 'leaf-cloak',
    category: 'abilities',
    name: 'Leaf Cloak',
    description: 'Fade into the foliage while standing still.',
    currency: 'crowns',
    prices: [2, 4, 6],
    abilityId: 'leaf-cloak',
  },
  {
    id: 'hunters-focus',
    category: 'abilities',
    name: "Hunter's Focus",
    description: 'Slow the world, steady your aim, mark your prey.',
    currency: 'crowns',
    prices: [3, 5, 8],
    abilityId: 'hunters-focus',
  },
  {
    id: 'maxHealth',
    category: 'training',
    name: 'Endurance',
    description: '+20 maximum health per rank.',
    currency: 'gold',
    prices: [100, 200, 350],
    trainingKey: 'maxHealth',
  },
  {
    id: 'moveSpeed',
    category: 'training',
    name: 'Fleet Footed',
    description: 'Move 10% faster.',
    currency: 'gold',
    prices: [250],
    trainingKey: 'moveSpeed',
  },
  {
    id: 'quietSteps',
    category: 'training',
    name: 'Silent Steps',
    description: 'Your footsteps make half the noise.',
    currency: 'gold',
    prices: [180],
    trainingKey: 'quietSteps',
  },
  {
    id: 'stealth',
    category: 'training',
    name: 'Woodcraft',
    description: 'Guards notice you from 20% closer.',
    currency: 'gold',
    prices: [220],
    trainingKey: 'stealth',
  },
];

/** Ranks already purchased (0 = untrained, for bows 0 = tier 1). */
export function rankOf(save: SaveData, item: ShopItem): number {
  if (item.id === 'bow') {
    return save.bowTier - 1;
  }
  if (item.abilityId) {
    return save.abilities[item.abilityId];
  }
  if (item.trainingKey) {
    return save.training[item.trainingKey];
  }
  return 0;
}

export function maxRank(item: ShopItem): number {
  return item.prices.length;
}

/** Cost of the next rank, or null when maxed. */
export function nextPrice(save: SaveData, item: ShopItem): number | null {
  const rank = rankOf(save, item);
  if (rank >= maxRank(item)) {
    return null;
  }
  return item.prices[rank] ?? null;
}

export function walletOf(save: SaveData, currency: Currency): number {
  return currency === 'gold' ? save.wallet.gold : save.wallet.crowns;
}

export interface PurchaseCheck {
  ok: boolean;
  reason?: string;
  price: number | null;
}

export function canPurchase(save: SaveData, item: ShopItem): PurchaseCheck {
  const price = nextPrice(save, item);
  if (price === null) {
    return { ok: false, reason: 'Maxed', price: null };
  }
  if (walletOf(save, item.currency) < price) {
    return { ok: false, reason: 'Not enough ' + item.currency, price };
  }
  return { ok: true, price };
}

/** Spend and advance one rank. Returns false when the purchase is invalid. */
export function purchase(save: SaveData, item: ShopItem): boolean {
  const check = canPurchase(save, item);
  if (!check.ok || check.price === null) {
    return false;
  }
  if (item.currency === 'gold') {
    save.wallet.gold -= check.price;
  } else {
    save.wallet.crowns -= check.price;
  }

  if (item.id === 'bow') {
    save.bowTier = Math.min(5, save.bowTier + 1);
  } else if (item.abilityId) {
    save.abilities[item.abilityId] = Math.min(3, save.abilities[item.abilityId] + 1);
    equipIfEmpty(save, item.abilityId);
  } else if (item.trainingKey) {
    save.training[item.trainingKey] = Math.min(3, save.training[item.trainingKey] + 1);
  }
  return true;
}

function equipIfEmpty(save: SaveData, ability: AbilityId): void {
  if (save.equipped[0] === ability || save.equipped[1] === ability) {
    return;
  }
  if (save.equipped[0] === null) {
    save.equipped[0] = ability;
  } else if (save.equipped[1] === null) {
    save.equipped[1] = ability;
  }
}

/** Items shown under a shop tab. The crown tab shows every crown-priced item. */
export function itemsForTab(tab: ShopTab): ShopItem[] {
  if (tab === 'crowns') {
    return SHOP_ITEMS.filter((item) => item.currency === 'crowns');
  }
  return SHOP_ITEMS.filter((item) => item.category === tab);
}
