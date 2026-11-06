/** Small controller for the in-game HUD overlays. */
export class Hud {
  private readonly root: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly promptText: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly crowns: HTMLElement;
  private toastTimer = 0;

  constructor(document: Document) {
    this.root = require(document, 'hud');
    this.prompt = require(document, 'hud-prompt');
    this.promptText = require(document, 'hud-prompt-text');
    this.toast = require(document, 'hud-toast');
    this.gold = require(document, 'hud-gold');
    this.crowns = require(document, 'hud-crowns');
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

  setPrompt(text: string | null): void {
    if (!text) {
      this.prompt.hidden = true;
      return;
    }
    this.promptText.textContent = text;
    this.prompt.hidden = false;
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
