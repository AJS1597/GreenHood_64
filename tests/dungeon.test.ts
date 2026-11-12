import { describe, expect, it } from 'vitest';
import { bodyguardCells, bfs, findPath, generateDungeon, isFloor, isPlayable, reachable, worldBoundsFor } from '../src/core/dungeon';

function hashCells(cells: Uint8Array): number {
  let hash = 2166136261 >>> 0;
  for (const value of cells) {
    hash ^= value;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

describe('dungeon generation', () => {
  it('uses half-tile playable bounds at the edge cells', () => {
    const bounds = worldBoundsFor(23, 23, 4);
    expect(bounds).toEqual({ minX: 2, minZ: 2, maxX: 86, maxZ: 86 });
  });

  it('is deterministic for the same seed', () => {
    const a = generateDungeon(4242);
    const b = generateDungeon(4242);
    expect(b.seed).toBe(a.seed);
    expect(hashCells(b.floors[0].cells)).toBe(hashCells(a.floors[0].cells));
    expect(hashCells(b.floors[1].cells)).toBe(hashCells(a.floors[1].cells));
  });

  it('produces playable two-floor layouts across many seeds', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const dungeon = generateDungeon(seed);
      expect(isPlayable(dungeon)).toBe(true);
      expect(dungeon.floors).toHaveLength(2);
    }
  });

  it('connects the entrance to the vault and stairs on floor 0', () => {
    const dungeon = generateDungeon(7);
    const floor0 = dungeon.floors[0]!;
    expect(reachable(floor0, dungeon.entrance, dungeon.vault)).toBe(true);
    expect(reachable(floor0, dungeon.entrance, dungeon.stairs)).toBe(true);
  });

  it('connects the stair landing to the king on floor 1', () => {
    const dungeon = generateDungeon(11);
    const floor1 = dungeon.floors[1]!;
    expect(reachable(floor1, dungeon.stairs, dungeon.king)).toBe(true);
  });

  it('always leaves room for two bodyguards around the king', () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const dungeon = generateDungeon(seed);
      const floor1 = dungeon.floors[1]!;
      const cells = bodyguardCells(floor1, dungeon.king);
      expect(cells.length).toBeGreaterThanOrEqual(2);
      // Distinct floor cells, never on top of the king.
      expect(new Set(cells.map((cell) => `${cell.x},${cell.z}`)).size).toBe(cells.length);
      for (const cell of cells) {
        expect(isFloor(floor1, cell.x, cell.z)).toBe(true);
        expect(cell.x === dungeon.king.x && cell.z === dungeon.king.z).toBe(false);
      }
    }
  });

  it('carves full square objective rooms', () => {
    const dungeon = generateDungeon(3);
    const floor1 = dungeon.floors[1]!;
    for (let z = dungeon.king.z - 2; z <= dungeon.king.z + 2; z += 1) {
      for (let x = dungeon.king.x - 2; x <= dungeon.king.x + 2; x += 1) {
        expect(isFloor(floor1, x, z)).toBe(true);
      }
    }
  });

  it('puts both floor tiles of the stairwell on walkable ground', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const dungeon = generateDungeon(seed);
      expect(isFloor(dungeon.floors[0]!, dungeon.stairs.x, dungeon.stairs.z)).toBe(true);
      expect(isFloor(dungeon.floors[1]!, dungeon.stairs.x, dungeon.stairs.z)).toBe(true);
    }
  });

  it('places loot, keys and guards', () => {
    const dungeon = generateDungeon(21);
    expect(dungeon.chests.length).toBe(7);
    expect(dungeon.keys.length).toBe(2);
    expect(dungeon.guards.length).toBe(6);
    for (const chest of dungeon.chests) {
      expect(isFloor(dungeon.floors[chest.floor]!, chest.x, chest.z)).toBe(true);
    }
  });

  it('varies between seeds', () => {
    const hashes = new Set<number>();
    for (let seed = 1; seed <= 12; seed += 1) {
      hashes.add(hashCells(generateDungeon(seed).floors[0].cells));
    }
    expect(hashes.size).toBeGreaterThan(8);
  });

  it('finds a walkable path between two cells', () => {
    const dungeon = generateDungeon(21);
    const floor = dungeon.floors[0]!;
    const path = findPath(floor, dungeon.entrance, dungeon.vault);
    expect(path.length).toBeGreaterThan(1);
    expect(path[0]).toEqual(dungeon.entrance);
    for (let i = 1; i < path.length; i += 1) {
      const previous = path[i - 1]!;
      const current = path[i]!;
      expect(Math.abs(previous.x - current.x) + Math.abs(previous.z - current.z)).toBe(1);
    }
  });

  it('bfs marks solid cells unreachable', () => {
    const dungeon = generateDungeon(5);
    const distances = bfs(dungeon.floors[0]!, dungeon.entrance);
    expect(distances[0]).toBe(-1); // the (0,0) border is always solid
  });
});
