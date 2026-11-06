import type { SaveStore } from '../app/SaveStore';
import {
  canPurchase,
  itemsForTab,
  rankOf,
  maxRank,
  purchase,
  type ShopItem,
  type ShopTab,
} from '../core/shop';

const TABS: Array<{ id: ShopTab; label: string }> = [
  { id: 'bows', label: 'Bows' },
  { id: 'abilities', label: 'Abilities' },
  { id: 'training', label: 'Training' },
  { id: 'crowns', label: 'Crown Exchange' },
];

/** HTML shop overlay shared by every merchant stall. */
export class ShopPanel {
  onClose: (() => void) | null = null;
  onChange: (() => void) | null = null;

  private readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly items: HTMLElement;
  private readonly wallet: HTMLElement;
  private tab: ShopTab = 'bows';
  private open = false;

  constructor(
    document: Document,
    private readonly store: SaveStore,
  ) {
    this.root = require(document, 'shop');
    this.title = require(document, 'shop-title');
    this.tabs = require(document, 'shop-tabs');
    this.items = require(document, 'shop-items');
    this.wallet = require(document, 'shop-wallet');

    require(document, 'shop-close').addEventListener('click', () => this.close());
    document.addEventListener('keydown', (event) => {
      if (this.open && event.code === 'Escape') {
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(tab: ShopTab): void {
    this.tab = tab;
    this.open = true;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.root.hidden = true;
    this.onClose?.();
  }

  private render(): void {
    this.title.textContent = TABS.find((entry) => entry.id === this.tab)?.label ?? 'Merchant';

    this.tabs.replaceChildren(
      ...TABS.map((entry) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = entry.label;
        button.className = entry.id === this.tab ? 'shop-tab is-active' : 'shop-tab';
        button.addEventListener('click', () => {
          this.tab = entry.id;
          this.render();
        });
        return button;
      }),
    );

    const save = this.store.current;
    this.wallet.textContent = `Gold ${save.wallet.gold}   Crowns ${save.wallet.crowns}`;

    const cards = itemsForTab(this.tab).map((item) => this.renderCard(item));
    this.items.replaceChildren(...cards);
  }

  private renderCard(item: ShopItem): HTMLElement {
    const save = this.store.current;
    const rank = rankOf(save, item);
    const check = canPurchase(save, item);

    const card = document.createElement('article');
    card.className = 'shop-card';

    const header = document.createElement('header');
    const name = document.createElement('h3');
    name.textContent = item.name;
    const pips = document.createElement('span');
    pips.className = 'shop-pips';
    pips.textContent = `${rank}/${maxRank(item)}`;
    header.append(name, pips);

    const description = document.createElement('p');
    description.textContent = item.description;

    const footer = document.createElement('footer');
    const price = document.createElement('span');
    if (check.price === null) {
      price.textContent = 'Maxed';
    } else {
      price.textContent = `${check.price} ${item.currency}`;
    }
    price.className = item.currency === 'crowns' ? 'shop-price is-crown' : 'shop-price';

    const buy = document.createElement('button');
    buy.type = 'button';
    buy.className = 'shop-buy';
    buy.textContent = check.price === null ? 'Owned' : 'Buy';
    buy.disabled = !check.ok;
    buy.addEventListener('click', () => {
      let bought = false;
      this.store.update((state) => {
        bought = purchase(state, item);
      });
      if (bought) {
        this.onChange?.();
        this.render();
      }
    });

    footer.append(price, buy);
    card.append(header, description, footer);
    return card;
  }
}

function require(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}
