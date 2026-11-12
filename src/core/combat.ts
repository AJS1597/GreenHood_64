import type { Aabb2 } from './collision';
import { isFloor, type FloorLayout } from './dungeon';

/**
 * Engine-independent combat tuning and math. Keeping this separate from the
 * Babylon entities makes the perception, damage and projectile rules testable.
 */
export const COMBAT = {
  playerBaseHealth: 100,
  playerHealthPerRank: 20,
  guardHealth: 90,
  guardDamage: 25,
  guardAttackRange: 1.8,
  guardAttackWindup: 0.45,
  guardAttackCooldown: 1.3,
  guardVisionDistance: 14,
  guardVisionFov: (110 * Math.PI) / 180,
  guardAlertRadius: 10,
  guardSearchSeconds: 8,
  guardSpeed: 1.15,
  guardChaseSpeed: 2.3,
  guardRadius: 0.42,
  guardHeight: 1.7,
  takedownRange: 2.8,
  takedownRearDot: -0.1,
  hitInvulnerability: 0.6,
  minDrawTime: 0.2,
  maxDrawTime: 1.2,
  fireCooldown: 0.45,
  minRange: 12,
  maxRange: 55,
  minArrowSpeed: 22,
  maxArrowSpeed: 60,
  minDamageMultiplier: 0.55,
  maxDamageMultiplier: 1,
  arrowGravity: 4.2,
  arrowRadius: 0.05,
  arrowSpawnOffset: 0.55,
  bowTierDamage: [30, 40, 50, 62, 75],
};

export type NoiseLevel = 'still' | 'crouch' | 'walk' | 'sprint';

/**
 * The king boss. He shares the guard rig but is bigger, redder, much tougher
 * and attacks with a telegraphed radial slam instead of a spear.
 */
export const BOSS = {
  name: 'The King',
  health: 240,
  /** Larger capsule so arrows still connect on the scaled model. */
  radius: 0.55,
  height: 2.15,
  /** Uniform model scale applied to the guard rig. */
  scale: 1.25,
  /** Radial slam: telegraph, damage radius, cadence and trigger distance. */
  aoeRadius: 5,
  aoeWindup: 1.1,
  aoeCooldown: 3.2,
  aoeDamage: 30,
  aoeTriggerRange: 6.5,
  /** Crowns awarded to the player when the king falls. */
  crownReward: 2,
  /** Albedo tint that marks the king out from his guards. */
  tint: { r: 0.92, g: 0.22, b: 0.18 },
};

/** True when (bx, bz) lies within `radius` of (ax, az). Drives the boss slam. */
export function withinRadius(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number,
): boolean {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz <= radius * radius;
}

export interface BowStats {
  range: number;
  speed: number;
  damageMultiplier: number;
  damage: number;
  lifetime: number;
}

export interface Point2 {
  x: number;
  z: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function drawTimeToCharge(drawTime: number): number {
  return clamp(
    (drawTime - COMBAT.minDrawTime) / (COMBAT.maxDrawTime - COMBAT.minDrawTime),
    0,
    1,
  );
}

export function bowStats(tier: number, charge: number): BowStats {
  const t = clamp(charge, 0, 1);
  const tierIndex = clamp(Math.floor(tier), 1, COMBAT.bowTierDamage.length) - 1;
  const range = lerp(COMBAT.minRange, COMBAT.maxRange, t);
  const speed = lerp(COMBAT.minArrowSpeed, COMBAT.maxArrowSpeed, t);
  const damageMultiplier = lerp(COMBAT.minDamageMultiplier, COMBAT.maxDamageMultiplier, t);
  const baseDamage = COMBAT.bowTierDamage[tierIndex] ?? COMBAT.bowTierDamage[0] ?? 30;
  return {
    range,
    speed,
    damageMultiplier,
    damage: baseDamage * damageMultiplier,
    lifetime: range / speed + 0.3,
  };
}

export function playerMaxHealth(maxHealthRank: number): number {
  return COMBAT.playerBaseHealth + COMBAT.playerHealthPerRank * clamp(maxHealthRank, 0, 3);
}

/**
 * How far a player's movement can be heard. The quietSteps training rank
 * halves the radius per rank.
 */
export function noiseRadius(level: NoiseLevel, quietStepsRank = 0): number {
  const base = level === 'still' ? 0 : level === 'crouch' ? 2 : level === 'walk' ? 6 : 12;
  return base * Math.pow(0.5, clamp(quietStepsRank, 0, 3));
}

/** How far guards can notice the player; stealth training reduces it. */
export function visionDistance(stealthRank = 0): number {
  return COMBAT.guardVisionDistance * (1 - 0.2 * clamp(stealthRank, 0, 3));
}

export function guardCanSee(
  guardX: number,
  guardZ: number,
  guardYaw: number,
  playerX: number,
  playerZ: number,
  maxDistance: number,
): boolean {
  const dx = playerX - guardX;
  const dz = playerZ - guardZ;
  const distance = Math.hypot(dx, dz);
  if (distance > maxDistance || distance < 1e-4) {
    return distance <= maxDistance;
  }
  const forwardX = Math.sin(guardYaw);
  const forwardZ = Math.cos(guardYaw);
  const dot = (dx * forwardX + dz * forwardZ) / distance;
  return dot >= Math.cos(COMBAT.guardVisionFov / 2);
}

/**
 * Sample a floor-grid line for solid cells. The castle is a 4 m grid of
 * axis-aligned walls, so a fine sample is enough for sight checks.
 */
export function hasLineOfSight(
  floor: FloorLayout,
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  tile: number,
): boolean {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.35));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const x = fromX + dx * t;
    const z = fromZ + dz * t;
    const cellX = Math.round(x / tile);
    const cellZ = Math.round(z / tile);
    if (!isFloor(floor, cellX, cellZ)) {
      return false;
    }
  }
  return true;
}

/** True when a point is inside a guard's vertical capsule. */
export function pointHitsGuard(
  x: number,
  y: number,
  z: number,
  guardX: number,
  guardZ: number,
  guardFeetY: number,
  radius = COMBAT.guardRadius,
  height = COMBAT.guardHeight,
): boolean {
  if (y < guardFeetY || y > guardFeetY + height) {
    return false;
  }
  const dx = x - guardX;
  const dz = z - guardZ;
  return dx * dx + dz * dz <= radius * radius;
}

/** True when a point is inside a wall box, including its optional storey span. */
export function pointHitsWall(
  x: number,
  y: number,
  z: number,
  box: Aabb2,
  defaultMinY = -Infinity,
  defaultMaxY = Infinity,
): boolean {
  if (x < box.minX || x > box.maxX || z < box.minZ || z > box.maxZ) {
    return false;
  }
  const minY = box.minY ?? defaultMinY;
  const maxY = box.maxY ?? defaultMaxY;
  return y >= minY && y <= maxY;
}

/** Rear-angle check used by the stealth takedown. */
export function canTakedown(
  guardX: number,
  guardZ: number,
  guardYaw: number,
  playerX: number,
  playerZ: number,
  crouching: boolean,
  guardAlerted: boolean,
): boolean {
  if (!crouching || guardAlerted) {
    return false;
  }
  const dx = playerX - guardX;
  const dz = playerZ - guardZ;
  const distance = Math.hypot(dx, dz);
  if (distance > COMBAT.takedownRange || distance < 1e-4) {
    return false;
  }
  const forwardX = Math.sin(guardYaw);
  const forwardZ = Math.cos(guardYaw);
  return (dx * forwardX + dz * forwardZ) / distance < COMBAT.takedownRearDot;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
