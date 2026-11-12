import { isFloor, type Dungeon, type FloorLayout } from '../core/dungeon';

const TILE = 4;
const PADDING = 12;
const REVEAL_RADIUS = 2.6;

/**
 * Small MGS-style floor map. Only explored floor cells are drawn, and guards
 * are deliberately never shown.
 */
export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly wrapper: HTMLElement;
  private readonly label: HTMLElement;
  private readonly discovered: [Set<number>, Set<number>] = [new Set(), new Set()];

  constructor(document: Document) {
    this.canvas = requireElement(document, 'minimap-canvas') as HTMLCanvasElement;
    this.wrapper = requireElement(document, 'hud-minimap');
    this.label = requireElement(document, 'minimap-floor');
    const context = this.canvas.getContext('2d');
    if (!context) {
      throw new Error('Minimap canvas has no 2D context');
    }
    this.context = context;
  }

  show(): void {
    this.wrapper.hidden = false;
  }

  hide(): void {
    this.wrapper.hidden = true;
  }

  reset(): void {
    this.discovered[0].clear();
    this.discovered[1].clear();
    this.label.textContent = 'Floor 1';
  }

  update(dungeon: Dungeon, floor: number, x: number, z: number, yaw: number): void {
    const layout = dungeon.floors[floor];
    if (!layout) {
      return;
    }
    this.reveal(layout, floor, x, z);
    this.render(dungeon, layout, floor, x, z, yaw);
  }

  private reveal(layout: FloorLayout, floor: number, x: number, z: number): void {
    const set = this.discovered[floor]!;
    const cx = Math.round(x / TILE);
    const cz = Math.round(z / TILE);
    const radius = Math.ceil(REVEAL_RADIUS);
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.hypot(dx, dz) > REVEAL_RADIUS) {
          continue;
        }
        const cellX = cx + dx;
        const cellZ = cz + dz;
        if (isFloor(layout, cellX, cellZ)) {
          set.add(cellZ * layout.width + cellX);
        }
      }
    }
  }

  private render(
    dungeon: Dungeon,
    layout: FloorLayout,
    floor: number,
    playerX: number,
    playerZ: number,
    yaw: number,
  ): void {
    const ctx = this.context;
    const size = this.canvas.width;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#080d0b';
    ctx.fillRect(0, 0, size, size);

    const span = Math.max(layout.width, layout.height);
    const cellSize = (size - PADDING * 2) / span;
    const offsetX = (size - layout.width * cellSize) / 2;
    const offsetY = (size - layout.height * cellSize) / 2;
    const set = this.discovered[floor]!;
    const roomCells = roomCellSet(layout);

    for (let cz = 0; cz < layout.height; cz += 1) {
      for (let cx = 0; cx < layout.width; cx += 1) {
        const index = cz * layout.width + cx;
        if (!set.has(index)) {
          continue;
        }
        const px = offsetX + cx * cellSize;
        const py = offsetY + cz * cellSize;
        ctx.fillStyle = roomCells.has(index) ? '#4b5d72' : '#344554';
        ctx.fillRect(px, py, cellSize + 0.5, cellSize + 0.5);
      }
    }

    // Stair marker: up on floor 1, down on the top floor.
    const stairIndex = dungeon.stairs.z * layout.width + dungeon.stairs.x;
    if (set.has(stairIndex)) {
      const px = offsetX + (dungeon.stairs.x + 0.5) * cellSize;
      const py = offsetY + (dungeon.stairs.z + 0.5) * cellSize;
      ctx.fillStyle = '#e6b84c';
      ctx.font = `bold ${Math.max(10, cellSize * 1.25)}px Segoe UI, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(floor === 0 ? '↑' : '↓', px, py);
    }

    // Player arrow, north-up.
    const px = offsetX + (playerX / TILE) * cellSize;
    const py = offsetY + (playerZ / TILE) * cellSize;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - yaw);
    ctx.fillStyle = '#f5e7c7';
    ctx.beginPath();
    ctx.moveTo(0, -cellSize * 0.48);
    ctx.lineTo(cellSize * 0.32, cellSize * 0.36);
    ctx.lineTo(0, cellSize * 0.18);
    ctx.lineTo(-cellSize * 0.32, cellSize * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = 'rgba(230, 184, 76, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX - 1, offsetY - 1, layout.width * cellSize + 2, layout.height * cellSize + 2);
    this.label.textContent = `Floor ${floor + 1}`;
  }
}

function roomCellSet(layout: FloorLayout): Set<number> {
  const cells = new Set<number>();
  for (const room of layout.rooms) {
    for (let z = room.z - room.radius; z <= room.z + room.radius; z += 1) {
      for (let x = room.x - room.radius; x <= room.x + room.radius; x += 1) {
        cells.add(z * layout.width + x);
      }
    }
  }
  return cells;
}

function requireElement(document: Document, id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }
  return element;
}
