import { createRng, type Rng } from './rng';

/** A single dungeon cell: 0 = solid rock, 1 = walkable floor. */
export const SOLID = 0;
export const FLOOR = 1;

export type RoomKind = 'entrance' | 'normal' | 'vault' | 'king';

export interface Room {
  /** Centre cell. */
  x: number;
  z: number;
  /** Half extents in cells (a 5x5 room has radius 2). */
  radius: number;
  kind: RoomKind;
}

export interface FloorLayout {
  width: number;
  height: number;
  /** width * height cells, row-major as z * width + x. */
  cells: Uint8Array;
  rooms: Room[];
}

export interface ChestSpot {
  x: number;
  z: number;
  floor: number;
  locked: boolean;
}

export interface KeySpot {
  x: number;
  z: number;
  floor: number;
}

export interface GuardSpot {
  x: number;
  z: number;
  floor: number;
}

export interface StairLink {
  x: number;
  z: number;
  fromFloor: 0;
  toFloor: 1;
}

export interface Dungeon {
  seed: number;
  floors: [FloorLayout, FloorLayout];
  entrance: { x: number; z: number };
  stairs: StairLink;
  king: Room;
  vault: Room;
  chests: ChestSpot[];
  keys: KeySpot[];
  guards: GuardSpot[];
}

export interface DungeonOptions {
  width?: number;
  height?: number;
  attempts?: number;
}

interface Point {
  x: number;
  z: number;
}

const DEFAULTS = { width: 23, height: 23, attempts: 40 };

/** Deterministic castle generation: two connected floors, objectives, loot. */
export function generateDungeon(seed: number, options: DungeonOptions = {}): Dungeon {
  const width = options.width ?? DEFAULTS.width;
  const height = options.height ?? DEFAULTS.height;
  const attempts = options.attempts ?? DEFAULTS.attempts;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = tryGenerate((seed + attempt) >>> 0, width, height);
    if (candidate) {
      return candidate;
    }
  }
  // Fallback: return the last attempt even if validation is unhappy.
  const rng = createRng(seed);
  return tryGenerate(seed, width, height, rng) ?? forceGenerate(seed, width, height);
}

function tryGenerate(seed: number, width: number, height: number, _rng?: unknown): Dungeon | null {
  const rng = createRng(seed);
  const floor0 = carveMaze(rng, width, height);
  const floor1 = carveMaze(rng, width, height);

  // Entrance room on floor 0, near a corner.
  const entrance = { x: 3, z: 3 };
  carveRoom(floor0, entrance.x, entrance.z, 2, 'entrance');

  // Stairwell: a shared cell both floors must reach.
  const stairCell = pickFarCell(rng, floor0, entrance, 1);
  forceConnect(floor1, stairCell, rng);

  // King's chamber high up, vault below.
  const kingCell = pickFarCell(rng, floor1, stairCell, 3);
  const king: Room = { x: kingCell.x, z: kingCell.z, radius: 2, kind: 'king' };
  carveRoom(floor1, king.x, king.z, king.radius, 'king');

  const vaultCell = pickFarCell(rng, floor0, entrance, 3);
  const vault: Room = { x: vaultCell.x, z: vaultCell.z, radius: 2, kind: 'vault' };
  carveRoom(floor0, vault.x, vault.z, vault.radius, 'vault');

  // Loot, keys and guards on walkable cells.
  const chests: ChestSpot[] = [];
  const keys: KeySpot[] = [];
  const guards: GuardSpot[] = [];

  for (let i = 0; i < 7; i += 1) {
    const floor = rng.chance(0.4) ? 1 : 0;
    const spot = pickRandomFloor(rng, floor === 0 ? floor0 : floor1, [entrance, stairCell]);
    chests.push({ x: spot.x, z: spot.z, floor, locked: i % 4 === 3 });
  }
  for (let i = 0; i < 2; i += 1) {
    const spot = pickRandomFloor(rng, floor0, [entrance]);
    keys.push({ x: spot.x, z: spot.z, floor: 0 });
  }
  for (let i = 0; i < 6; i += 1) {
    const floor = rng.chance(0.5) ? 1 : 0;
    const spot = pickRandomFloor(rng, floor === 0 ? floor0 : floor1, [entrance]);
    guards.push({ x: spot.x, z: spot.z, floor });
  }

  const dungeon: Dungeon = {
    seed,
    floors: [floor0, floor1],
    entrance,
    stairs: { x: stairCell.x, z: stairCell.z, fromFloor: 0, toFloor: 1 },
    king,
    vault,
    chests,
    keys,
    guards,
  };

  return isPlayable(dungeon) ? dungeon : null;
}

/** Last-resort valid dungeon: a simple connected layout. */
function forceGenerate(seed: number, width: number, height: number): Dungeon {
  const rng = createRng(seed);
  const floor0 = carveMaze(rng, width, height);
  const floor1 = carveMaze(rng, width, height);
  const entrance = { x: 3, z: 3 };
  carveRoom(floor0, entrance.x, entrance.z, 2, 'entrance');
  const stairCell = pickFarCell(rng, floor0, entrance, 1);
  forceConnect(floor1, stairCell, rng);
  const kingCell = pickFarCell(rng, floor1, stairCell, 2);
  const vaultCell = pickFarCell(rng, floor0, entrance, 2);
  const king: Room = { x: kingCell.x, z: kingCell.z, radius: 2, kind: 'king' };
  const vault: Room = { x: vaultCell.x, z: vaultCell.z, radius: 2, kind: 'vault' };
  carveRoom(floor1, king.x, king.z, 2, 'king');
  carveRoom(floor0, vault.x, vault.z, 2, 'vault');
  return {
    seed,
    floors: [floor0, floor1],
    entrance,
    stairs: { x: stairCell.x, z: stairCell.z, fromFloor: 0, toFloor: 1 },
    king,
    vault,
    chests: [{ x: vault.x, z: vault.z - 1, floor: 0, locked: false }],
    keys: [{ x: entrance.x + 2, z: entrance.z, floor: 0 }],
    guards: [{ x: king.x - 2, z: king.z, floor: 1 }],
  };
}

function carveMaze(rng: Rng, width: number, height: number): FloorLayout {
  const cells = new Uint8Array(width * height);
  const start = { x: 1, z: 1 };
  set(cells, width, start.x, start.z, FLOOR);

  const stack: Point[] = [start];
  const directions = [
    { x: 2, z: 0 },
    { x: -2, z: 0 },
    { x: 0, z: 2 },
    { x: 0, z: -2 },
  ];

  while (stack.length > 0) {
    const current = stack[stack.length - 1] as Point;
    const options = rng.shuffle(directions).filter((dir) => {
      const nx = current.x + dir.x;
      const nz = current.z + dir.z;
      return nx > 0 && nz > 0 && nx < width - 1 && nz < height - 1 && get(cells, width, nx, nz) === SOLID;
    });
    if (options.length === 0) {
      stack.pop();
      continue;
    }
    const dir = options[0] as Point;
    set(cells, width, current.x + dir.x / 2, current.z + dir.z / 2, FLOOR);
    set(cells, width, current.x + dir.x, current.z + dir.z, FLOOR);
    stack.push({ x: current.x + dir.x, z: current.z + dir.z });
  }

  braid(rng, cells, width, height);
  return { width, height, cells, rooms: [] };
}

/** Knock out some dead-end walls so the maze has loops for stealth routes. */
function braid(rng: Rng, cells: Uint8Array, width: number, height: number): void {
  for (let z = 1; z < height - 1; z += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (get(cells, width, x, z) !== FLOOR) {
        continue;
      }
      let open = 0;
      for (const dir of NEIGHBOURS) {
        if (get(cells, width, x + dir.x, z + dir.z) === FLOOR) {
          open += 1;
        }
      }
      if (open <= 1 && rng.chance(0.35)) {
        const dir = rng.pick(NEIGHBOURS);
        const nx = x + dir.x;
        const nz = z + dir.z;
        if (nx > 0 && nz > 0 && nx < width - 1 && nz < height - 1) {
          set(cells, width, nx, nz, FLOOR);
        }
      }
    }
  }
}

function carveRoom(floor: FloorLayout, cx: number, cz: number, radius: number, kind: RoomKind): void {
  for (let z = cz - radius; z <= cz + radius; z += 1) {
    for (let x = cx - radius; x <= cx + radius; x += 1) {
      if (x > 0 && z > 0 && x < floor.width - 1 && z < floor.height - 1) {
        set(floor.cells, floor.width, x, z, FLOOR);
      }
    }
  }
  floor.rooms.push({ x: cx, z: cz, radius, kind });
}

/** Carve an L-shaped corridor from the nearest floor cell to the target. */
function forceConnect(floor: FloorLayout, target: Point, rng: Rng): void {
  set(floor.cells, floor.width, target.x, target.z, FLOOR);
  const nearest = nearestFloor(floor, target);
  if (!nearest) {
    return;
  }
  const horizontalFirst = rng.chance(0.5);
  const stepX = Math.sign(target.x - nearest.x);
  const stepZ = Math.sign(target.z - nearest.z);
  const carveXThenZ = (): void => {
    for (let x = nearest.x; x !== target.x; x += stepX || 1) {
      set(floor.cells, floor.width, x, nearest.z, FLOOR);
    }
    for (let z = nearest.z; z !== target.z; z += stepZ || 1) {
      set(floor.cells, floor.width, target.x, z, FLOOR);
    }
  };
  const carveZThenX = (): void => {
    for (let z = nearest.z; z !== target.z; z += stepZ || 1) {
      set(floor.cells, floor.width, nearest.x, z, FLOOR);
    }
    for (let x = nearest.x; x !== target.x; x += stepX || 1) {
      set(floor.cells, floor.width, x, target.z, FLOOR);
    }
  };
  if (horizontalFirst) {
    carveXThenZ();
  } else {
    carveZThenX();
  }
}

function pickFarCell(rng: Rng, floor: FloorLayout, from: Point, minDistance: number): Point {
  const distances = bfs(floor, from);
  const candidates: Point[] = [];
  for (let z = 1; z < floor.height - 1; z += 1) {
    for (let x = 1; x < floor.width - 1; x += 1) {
      const index = z * floor.width + x;
      const distance = distances[index] ?? -1;
      if (get(floor.cells, floor.width, x, z) === FLOOR && distance >= minDistance + 6) {
        candidates.push({ x, z });
      }
    }
  }
  if (candidates.length === 0) {
    return { x: floor.width - 3, z: floor.height - 3 };
  }
  return rng.pick(candidates);
}

function pickRandomFloor(rng: Rng, floor: FloorLayout, avoid: Point[]): Point {
  for (let i = 0; i < 200; i += 1) {
    const x = rng.intBetween(1, floor.width - 2);
    const z = rng.intBetween(1, floor.height - 2);
    if (get(floor.cells, floor.width, x, z) !== FLOOR) {
      continue;
    }
    if (avoid.some((point) => Math.abs(point.x - x) <= 1 && Math.abs(point.z - z) <= 1)) {
      continue;
    }
    return { x, z };
  }
  return { x: 1, z: 1 };
}

function nearestFloor(floor: FloorLayout, target: Point): Point | null {
  for (let radius = 1; radius < Math.max(floor.width, floor.height); radius += 1) {
    for (let z = target.z - radius; z <= target.z + radius; z += 1) {
      for (let x = target.x - radius; x <= target.x + radius; x += 1) {
        if (x < 1 || z < 1 || x >= floor.width - 1 || z >= floor.height - 1) {
          continue;
        }
        if (get(floor.cells, floor.width, x, z) === FLOOR && (x !== target.x || z !== target.z)) {
          return { x, z };
        }
      }
    }
  }
  return null;
}

/** Breadth-first distance field from a start cell; -1 marks unreachable. */
export function bfs(floor: FloorLayout, from: Point): Int32Array {
  const distances = new Int32Array(floor.width * floor.height).fill(-1);
  const queue: number[] = [from.z * floor.width + from.x];
  distances[from.z * floor.width + from.x] = 0;
  while (queue.length > 0) {
    const index = queue.shift() as number;
    const x = index % floor.width;
    const z = Math.floor(index / floor.width);
    const distance = distances[index] ?? 0;
    for (const dir of NEIGHBOURS) {
      const nx = x + dir.x;
      const nz = z + dir.z;
      if (nx < 0 || nz < 0 || nx >= floor.width || nz >= floor.height) {
        continue;
      }
      const nextIndex = nz * floor.width + nx;
      if (get(floor.cells, floor.width, nx, nz) !== FLOOR || distances[nextIndex] !== -1) {
        continue;
      }
      distances[nextIndex] = distance + 1;
      queue.push(nextIndex);
    }
  }
  return distances;
}

export function isFloor(floor: FloorLayout, x: number, z: number): boolean {
  return get(floor.cells, floor.width, x, z) === FLOOR;
}

export function reachable(floor: FloorLayout, from: Point, to: Point): boolean {
  const distances = bfs(floor, from);
  return (distances[to.z * floor.width + to.x] ?? -1) >= 0;
}

/** All objectives must be reachable from the entrance through the stair link. */
export function isPlayable(dungeon: Dungeon): boolean {
  const [floor0, floor1] = dungeon.floors;
  const fromEntrance = bfs(floor0, dungeon.entrance);
  if ((fromEntrance[dungeon.stairs.z * floor0.width + dungeon.stairs.x] ?? -1) < 0) {
    return false;
  }
  if ((fromEntrance[dungeon.vault.z * floor0.width + dungeon.vault.x] ?? -1) < 0) {
    return false;
  }
  for (const key of dungeon.keys) {
    if (key.floor === 0 && (fromEntrance[key.z * floor0.width + key.x] ?? -1) < 0) {
      return false;
    }
  }
  for (const chest of dungeon.chests) {
    if (chest.floor === 0 && (fromEntrance[chest.z * floor0.width + chest.x] ?? -1) < 0) {
      return false;
    }
  }

  const fromStair = bfs(floor1, dungeon.stairs);
  if ((fromStair[dungeon.king.z * floor1.width + dungeon.king.x] ?? -1) < 0) {
    return false;
  }
  for (const chest of dungeon.chests) {
    if (chest.floor === 1 && (fromStair[chest.z * floor1.width + chest.x] ?? -1) < 0) {
      return false;
    }
  }
  return true;
}

const NEIGHBOURS: ReadonlyArray<Point> = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
];

function get(cells: Uint8Array, width: number, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= width) {
    return SOLID;
  }
  const index = z * width + x;
  return index >= 0 && index < cells.length ? (cells[index] as number) : SOLID;
}

function set(cells: Uint8Array, width: number, x: number, z: number, value: number): void {
  const index = z * width + x;
  if (index >= 0 && index < cells.length) {
    cells[index] = value;
  }
}
