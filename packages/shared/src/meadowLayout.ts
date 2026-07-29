import { MAP_HEIGHT, MAP_WIDTH } from './types.js';

export type DecorKind = 'bush' | 'tree' | 'rock';
export type DecorSpec = { kind: DecorKind; x: number; y: number; scale: number };

/** Must match client `buildMeadowWorld(scene, seed)` default / lobby. */
export const DEFAULT_MEADOW_SEED = 7;

/**
 * Mix an arbitrary integer into a well-spread 32-bit meadow seed.
 * Used at room create (and in tests for fixed layouts).
 */
export function meadowSeedFromMatchSeed(raw: number): number {
  let h = Math.imul(raw ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0) ^ (h >>> 16);
  return h >>> 0;
}

/** Fresh random layout seed for a newly created room. */
export function newRoomMeadowSeed(roomId = ''): number {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i++) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const entropy =
    (Date.now() >>> 0) ^
    ((Math.random() * 0x100000000) >>> 0) ^
    (h >>> 0);
  return meadowSeedFromMatchSeed(entropy);
}

/** Circle radius for player/AI vs solid props (world units). */
export const ENTITY_COLLIDE_RADIUS = 16;

export type SolidObstacle = {
  x: number;
  y: number;
  radius: number;
  kind: 'tree' | 'rock';
};

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure meadow decor placement for the expanded animal/grassland arena. */
export function generateMeadowDecor(seed = 7, count = 48): DecorSpec[] {
  const rng = mulberry32(seed);
  const specs: DecorSpec[] = [];
  const margin = 80;
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const kind: DecorKind = roll < 0.45 ? 'bush' : roll < 0.75 ? 'rock' : 'tree';
    const x = margin + rng() * (MAP_WIDTH - margin * 2);
    const y = margin + rng() * (MAP_HEIGHT - margin * 2);
    const scale =
      kind === 'tree' ? 0.85 + rng() * 0.45 : kind === 'bush' ? 0.7 + rng() * 0.5 : 0.65 + rng() * 0.4;
    specs.push({ kind, x, y, scale });
  }
  return specs;
}

/**
 * Full decor list used by the client map (main + thickets).
 * Thickets convert rock→bush so dense cover stays walkable foliage.
 */
export function listMeadowDecor(seed: number = DEFAULT_MEADOW_SEED): DecorSpec[] {
  const main = generateMeadowDecor(seed, 48);
  const thickets = generateMeadowDecor(seed + 99, 24).map((s) => ({
    ...s,
    kind: (s.kind === 'rock' ? 'bush' : s.kind) as DecorKind,
  }));
  return [...main, ...thickets];
}

/**
 * Collision radius for solid props. Bushes are passable (cover only).
 * Tuned to pixel-art prop display scales in MeadowMap.
 */
export function solidRadiusFor(kind: DecorKind, scale: number): number | null {
  if (kind === 'tree') return Math.max(20, 28 * scale);
  if (kind === 'rock') return Math.max(18, 26 * scale);
  return null;
}

/** Solid tree/rock obstacles for the default meadow layout. */
export function getSolidObstacles(seed: number = DEFAULT_MEADOW_SEED): SolidObstacle[] {
  const out: SolidObstacle[] = [];
  for (const s of listMeadowDecor(seed)) {
    const radius = solidRadiusFor(s.kind, s.scale);
    if (radius == null) continue;
    out.push({
      x: s.x,
      y: s.y,
      radius,
      kind: s.kind as 'tree' | 'rock',
    });
  }
  return out;
}

/**
 * Push a point out of overlapping solid circles (iterative separation).
 */
export function resolveSolidCollisions(
  x: number,
  y: number,
  entityRadius: number,
  obstacles: readonly SolidObstacle[],
  iterations = 4,
): { x: number; y: number } {
  let px = x;
  let py = y;
  for (let iter = 0; iter < iterations; iter++) {
    for (const o of obstacles) {
      const minDist = o.radius + entityRadius;
      const dx = px - o.x;
      const dy = py - o.y;
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) {
        px = o.x + minDist;
        py = o.y;
        continue;
      }
      if (d < minDist) {
        const push = (minDist - d) / d;
        px += dx * push;
        py += dy * push;
      }
    }
  }
  return { x: px, y: py };
}

export function isInsideMeadow(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= MAP_WIDTH && y <= MAP_HEIGHT;
}
