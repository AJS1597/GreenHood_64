/**
 * Small controller for the HTML loading overlay.
 *
 * The DOM is the source of truth for the overlay's markup; this only flips
 * classes and text so the game code never builds HTML strings.
 */
export class LoadingScreen {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly fill: HTMLElement;

  constructor(document: Document) {
    this.root = requireElement(document, 'loading-screen');
    this.label = requireElement(document, 'loading-label');
    this.detail = requireElement(document, 'loading-detail');
    this.fill = requireElement(document, 'loading-bar-fill');
  }

  setLabel(text: string): void {
    this.label.textContent = text;
  }

  setProgress(fraction: number): void {
    const clamped = Math.min(1, Math.max(0, fraction));
    const percent = Math.round(clamped * 100);
    this.fill.style.width = `${percent}%`;
    this.detail.textContent = `${percent}%`;
  }

  async hide(): Promise<void> {
    this.root.classList.add('is-hidden');
    await wait(500);
    this.root.hidden = true;
  }
}

function requireElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
