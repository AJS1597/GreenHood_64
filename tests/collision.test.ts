import { describe, expect, it } from 'vitest';
import {
  aabbFromCenter,
  circleIntersectsAabb,
  distanceToAabb,
  resolveCircle,
} from '../src/core/collision';

describe('collision', () => {
  const box = aabbFromCenter(0, 0, 1, 1);

  it('detects overlap and separation', () => {
    expect(circleIntersectsAabb(box, 0.5, 0, 0.5)).toBe(true);
    expect(circleIntersectsAabb(box, 3, 0, 0.5)).toBe(false);
  });

  it('leaves a clear circle untouched', () => {
    const result = resolveCircle(5, 5, 0.5, [box]);
    expect(result).toEqual({ x: 5, z: 5 });
  });

  it('pushes a circle out to exactly the radius', () => {
    const result = resolveCircle(0, 1.2, 0.5, [box]);
    expect(result.z).toBeCloseTo(1.5, 5);
    expect(result.x).toBeCloseTo(0, 5);
  });

  it('pushes a circle out when its centre is inside the box', () => {
    const result = resolveCircle(0.1, 0.1, 0.4, [box]);
    expect(circleIntersectsAabb(box, result.x, result.z, 0.399)).toBe(false);
  });

  it('clamps to world bounds', () => {
    const result = resolveCircle(100, 0, 0.5, [], { minX: -10, minZ: -10, maxX: 10, maxZ: 10 });
    expect(result.x).toBeCloseTo(9.5, 5);
  });

  it('resolves a concave corner without overlap', () => {
    const boxes = [aabbFromCenter(0, 0, 1, 1), aabbFromCenter(0, 2, 1, 1)];
    const result = resolveCircle(0.9, 0.95, 0.4, boxes);
    for (const b of boxes) {
      expect(circleIntersectsAabb(b, result.x, result.z, 0.39)).toBe(false);
    }
  });

  it('ignores colliders from another storey', () => {
    const upperWall = {
      ...aabbFromCenter(0, 0, 1, 1),
      minY: 4.15,
      maxY: 8.3,
    };
    const ground = resolveCircle(0.5, 0, 0.5, [upperWall], undefined, 3, {
      minY: 0.1,
      maxY: 1.85,
    });
    expect(ground).toEqual({ x: 0.5, z: 0 });

    const upstairs = resolveCircle(0.5, 0, 0.5, [upperWall], undefined, 3, {
      minY: 4.25,
      maxY: 6,
    });
    expect(upstairs.x).toBeCloseTo(1.5, 5);
  });

  it('measures distance to a box', () => {
    expect(distanceToAabb(box, 4, 0)).toBeCloseTo(3, 5);
    expect(distanceToAabb(box, 0, 0)).toBe(0);
  });
});
