import { describe, expect, it } from 'vitest';
import {
  COMBAT,
  bowStats,
  canTakedown,
  drawTimeToCharge,
  guardCanSee,
  hasLineOfSight,
  noiseRadius,
  playerMaxHealth,
  pointHitsGuard,
  pointHitsWall,
  visionDistance,
} from '../src/core/combat';
import { FLOOR, type FloorLayout } from '../src/core/dungeon';

function layoutWithWalls(): FloorLayout {
  const width = 5;
  const height = 5;
  const cells = new Uint8Array(width * height);
  for (let z = 1; z < height - 1; z += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      cells[z * width + x] = FLOOR;
    }
  }
  return { width, height, cells, rooms: [] };
}

describe('combat math', () => {
  it('maps draw time to charge', () => {
    expect(drawTimeToCharge(0)).toBe(0);
    expect(drawTimeToCharge(COMBAT.minDrawTime)).toBeCloseTo(0, 5);
    expect(drawTimeToCharge(COMBAT.maxDrawTime)).toBeCloseTo(1, 5);
    expect(drawTimeToCharge(10)).toBe(1);
  });

  it('scales bow range, speed and damage with charge and tier', () => {
    const minimum = bowStats(1, 0);
    expect(minimum.range).toBeCloseTo(12, 5);
    expect(minimum.speed).toBeCloseTo(22, 5);
    expect(minimum.damage).toBeCloseTo(16.5, 5);

    const full = bowStats(1, 1);
    expect(full.range).toBeCloseTo(55, 5);
    expect(full.damage).toBeCloseTo(30, 5);

    expect(bowStats(5, 1).damage).toBeCloseTo(75, 5);
  });

  it('derives player health from training', () => {
    expect(playerMaxHealth(0)).toBe(100);
    expect(playerMaxHealth(3)).toBe(160);
  });

  it('reduces noise and vision distance with training', () => {
    expect(noiseRadius('walk', 0)).toBe(6);
    expect(noiseRadius('walk', 1)).toBe(3);
    expect(noiseRadius('crouch', 0)).toBe(2);
    expect(visionDistance(0)).toBe(14);
    expect(visionDistance(1)).toBeCloseTo(11.2, 5);
  });

  it('checks a guard vision cone', () => {
    expect(guardCanSee(0, 0, 0, 0, 5, 10)).toBe(true);
    expect(guardCanSee(0, 0, 0, 0, -5, 10)).toBe(false);
    expect(guardCanSee(0, 0, 0, 5, 0, 10)).toBe(false);
    expect(guardCanSee(0, 0, 0, 0, 20, 10)).toBe(false);
  });

  it('checks line of sight against solid cells', () => {
    const floor = layoutWithWalls();
    expect(hasLineOfSight(floor, 4, 4, 4, 12, 4)).toBe(true);

    const blocked = layoutWithWalls();
    blocked.cells[2 * blocked.width + 1] = 0;
    expect(hasLineOfSight(blocked, 4, 4, 4, 12, 4)).toBe(false);
  });

  it('tests guard and wall point hits', () => {
    expect(pointHitsGuard(0.1, 1, 0.1, 0, 0, 0)).toBe(true);
    expect(pointHitsGuard(0, 3, 0, 0, 0, 0)).toBe(false);
    expect(
      pointHitsWall(0.5, 1, 0.5, {
        minX: 0,
        minZ: 0,
        maxX: 1,
        maxZ: 1,
        minY: 0,
        maxY: 4.15,
      }),
    ).toBe(true);
  });

  it('only allows a crouched rear takedown on an unaware guard', () => {
    expect(canTakedown(0, 0, 0, 0, -1, true, false)).toBe(true);
    expect(canTakedown(0, 0, 0, 0, 1, true, false)).toBe(false);
    expect(canTakedown(0, 0, 0, 0, -1, false, false)).toBe(false);
    expect(canTakedown(0, 0, 0, 0, -1, true, true)).toBe(false);
    expect(canTakedown(0, 0, 0, 0, -5, true, false)).toBe(false);
  });
});
