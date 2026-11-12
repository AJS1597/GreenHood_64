/**
 * 2D collision helpers.
 *
 * The game is a first-person crawler on mostly axis-aligned architecture, so
 * movement is resolved in the XZ plane against a list of boxes. Keeping this
 * engine-independent makes it easy to unit test and reuse for the dungeon.
 */

export interface Aabb2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  /**
   * Optional vertical extent. A box with no Y range blocks at every height
   * (the hub), while a dungeon wall can be limited to the storey it belongs to.
   */
  minY?: number;
  maxY?: number;
}

/** Vertical extent of a moving body used to filter storey-specific colliders. */
export interface VerticalSpan {
  minY: number;
  maxY: number;
}

export interface Bounds2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface Point2 {
  x: number;
  z: number;
}

/** Build an axis-aligned box from a centre and half extents. */
export function aabbFromCenter(cx: number, cz: number, halfX: number, halfZ: number): Aabb2 {
  return { minX: cx - halfX, minZ: cz - halfZ, maxX: cx + halfX, maxZ: cz + halfZ };
}

/** True when a circle overlaps the box (touching counts). */
export function circleIntersectsAabb(box: Aabb2, x: number, z: number, radius: number): boolean {
  const nearestX = clamp(x, box.minX, box.maxX);
  const nearestZ = clamp(z, box.minZ, box.maxZ);
  const dx = x - nearestX;
  const dz = z - nearestZ;
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * Push a circle out of every box it overlaps and clamp it into the world
 * bounds. A couple of relaxation passes handle corners where two boxes meet.
 */
export function resolveCircle(
  x: number,
  z: number,
  radius: number,
  boxes: readonly Aabb2[],
  bounds?: Bounds2,
  passes = 3,
  span?: VerticalSpan,
): Point2 {
  let px = x;
  let pz = z;

  for (let pass = 0; pass < passes; pass += 1) {
    let moved = false;
    for (const box of boxes) {
      if (!overlapsVertically(box, span)) {
        continue;
      }
      const nearestX = clamp(px, box.minX, box.maxX);
      const nearestZ = clamp(pz, box.minZ, box.maxZ);
      const dx = px - nearestX;
      const dz = pz - nearestZ;
      const distanceSq = dx * dx + dz * dz;

      if (distanceSq > radius * radius) {
        continue;
      }

      if (distanceSq > 1e-8) {
        const distance = Math.sqrt(distanceSq);
        const push = (radius - distance) / distance;
        px += dx * push;
        pz += dz * push;
      } else {
        // Circle centre is inside the box: escape through the closest face.
        const left = px - box.minX;
        const right = box.maxX - px;
        const top = pz - box.minZ;
        const bottom = box.maxZ - pz;
        const smallest = Math.min(left, right, top, bottom);
        if (smallest === left) {
          px = box.minX - radius;
        } else if (smallest === right) {
          px = box.maxX + radius;
        } else if (smallest === top) {
          pz = box.minZ - radius;
        } else {
          pz = box.maxZ + radius;
        }
      }
      moved = true;
    }
    if (!moved) {
      break;
    }
  }

  if (bounds) {
    px = clamp(px, bounds.minX + radius, bounds.maxX - radius);
    pz = clamp(pz, bounds.minZ + radius, bounds.maxZ - radius);
  }

  return { x: px, z: pz };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Distance from a point to a box (0 when inside). */
export function distanceToAabb(box: Aabb2, x: number, z: number): number {
  const dx = Math.max(box.minX - x, 0, x - box.maxX);
  const dz = Math.max(box.minZ - z, 0, z - box.maxZ);
  return Math.hypot(dx, dz);
}

/** True when a body's vertical span intersects a box's optional storey span. */
export function overlapsVertically(box: Aabb2, span?: VerticalSpan): boolean {
  if (!span) {
    return true;
  }
  if (box.minY !== undefined && span.maxY <= box.minY) {
    return false;
  }
  if (box.maxY !== undefined && span.minY >= box.maxY) {
    return false;
  }
  return true;
}
