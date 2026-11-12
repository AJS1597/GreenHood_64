/** Small controller for the in-game HUD overlays. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly crowns: HTMLElement;
  private readonly keysPill: HTMLElement;
  private readonly keysValue: HTMLElement;
  private readonly floor: HTMLElement;
  private readonly health: HTMLElement;
  private readonly healthFill: HTMLElement;
  private readonly healthValue: HTMLElement;
  private readonly healthMax: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossValue: HTMLElement;
  private readonly bossMax: HTMLElement;
  private readonly alert: HTMLElement;
  private readonly chargeRing: HTMLElement;
  private readonly hitMarker: HTMLElement;
  private readonly damageFlash: HTMLElement;
  private toastTimer = 0;

  constructor(document: Document) {
    this.root = require(document, 'hud');
    this.prompt = require(document, 'hud-prompt');
    this.promptText = require(document, 'hud-prompt-text');
    this.toast = require(document, 'hud-toast');
    this.gold = require(document, 'hud-gold');
    this.crowns = require(document, 'hud-crowns');
    this.keysPill = require(document, 'hud-keys-pill');
    this.keysValue = require(document, 'hud-keys');
    this.floor = require(document, 'hud-floor');
    this.health = require(document, 'hud-health');
    this.healthFill = require(document, 'hud-health-fill');
    this.healthValue = require(document, 'hud-health-value');
    this.healthMax = require(document, 'hud-health-max');
    this.boss = require(document, 'hud-boss');
    this.bossName = require(document, 'hud-boss-name');
    this.bossFill = require(document, 'hud-boss-fill');
    this.bossValue = require(document, 'hud-boss-value');
    this.bossMax = require(document, 'hud-boss-max');
    this.alert = require(document, 'hud-alert');
    this.chargeRing = require(document, 'charge-ring');
    this.hitMarker = require(document, 'hit-marker');
    this.damageFlash = require(document, 'damage-flash');
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  setWallet(gold: number, crowns: number): void {
    this.gold.textContent = String(gold);
    this.crowns.textContent = String(crowns);
  }

  setKeys(count: number | null): void {
    if (count === null) {
      this.keysPill.hidden = true;
      return;
    }
    this.keysPill.hidden = false;
    this.keysValue.textContent = String(count);
  }

  setPrompt(text: string | null): void {
    if (!text) {
      this.prompt.hidden = true;
      return;
    }
    this.promptText.textContent = text;
    this.prompt.hidden = false;
  }

  setFloor(text: string | null): void {
    if (!text) {
      this.floor.hidden = true;
      return;
    }
    this.floor.textContent = text;
    this.floor.hidden = false;
  }

  setHealth(current: number | null, max = 100): void {
    if (current === null) {
      this.health.hidden = true;
      return;
    }
    const clamped = Math.max(0, Math.min(current, max));
    const percent = max > 0 ? (clamped / max) * 100 : 0;
    this.health.hidden = false;
    this.healthFill.style.width = `${percent}%`;
    this.healthValue.textContent = String(Math.ceil(clamped));
    this.healthMax.textContent = String(Math.ceil(max));
  }

  setBoss(name: string | null, current: number, max = 1): void {
    if (!name) {
      this.boss.hidden = true;
      return;
    }
    const clamped = Math.max(0, Math.min(current, max));
    const percent = max > 0 ? (clamped / max) * 100 : 0;
    this.boss.hidden = false;
    this.bossName.textContent = name;
    this.bossFill.style.width = `${percent}%`;
    this.bossValue.textContent = String(Math.ceil(clamped));
    this.bossMax.textContent = String(Math.ceil(max));
  }

  setAlert(active: boolean): void {
    this.alert.hidden = !active;
  }

  setCharge(value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.chargeRing.style.setProperty('--charge', clamped.toFixed(3));
    this.chargeRing.classList.toggle('is-active', clamped > 0.001);
  }

  showHitMarker(): void {
    this.hitMarker.classList.remove('is-active');
    void this.hitMarker.offsetWidth;
    this.hitMarker.classList.add('is-active');
  }

  flashDamage(): void {
    this.damageFlash.classList.remove('is-active');
    void this.damageFlash.offsetWidth;
    this.damageFlash.classList.add('is-active');
  }

  showToast(text: string, durationMs = 2600): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toast.hidden = true;
    }, durationMs);
  }
}

function require(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}
