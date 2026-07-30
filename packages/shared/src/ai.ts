import type { EntityState, MatchState } from './types.js';
import { AI_SPEED, MAP_HEIGHT, MAP_WIDTH } from './types.js';
import { createRng } from './rng.js';
import {
  DEFAULT_MEADOW_SEED,
  ENTITY_COLLIDE_RADIUS,
  getSolidObstacles,
  resolveSolidCollisions,
  type SolidObstacle,
} from './meadowLayout.js';

type AiBrain = {
  targetX: number;
  targetY: number;
  idleMs: number;
  /** Accumulated ms with near-zero progress while trying to move (anti-stick). */
  stuckMs: number;
  lastX: number;
  lastY: number;
};

/** Keyed by `${roomId}:${entityId}` so concurrent rooms never share brains. */
const brains = new Map<string, AiBrain>();

const solidsCache = new Map<number, SolidObstacle[]>();

function solidsForSeed(seed: number): SolidObstacle[] {
  const key = seed >>> 0;
  let s = solidsCache.get(key);
  if (!s) {
    s = getSolidObstacles(key);
    solidsCache.set(key, s);
  }
  return s;
}

function brainKey(roomId: string, entityId: string): string {
  return `${roomId}:${entityId}`;
}

/** Clear all brains, or only those belonging to a room. */
export function resetAiBrains(roomId?: string): void {
  if (!roomId) {
    brains.clear();
    return;
  }
  const prefix = `${roomId}:`;
  for (const key of [...brains.keys()]) {
    if (key.startsWith(prefix)) brains.delete(key);
  }
}

/** Test helper: whether a brain exists for room+entity. */
export function hasAiBrain(roomId: string, entityId: string): boolean {
  return brains.has(brainKey(roomId, entityId));
}

/** Effective move speed for AI rabbits — must equal human rabbit speed. */
export function aiRabbitMoveSpeed(): number {
  return AI_SPEED;
}

/**
 * 8 unit directions humans can express with WASD/arrows (cardinals + diagonals).
 * Diagonals are normalized so speed magnitude stays equal.
 */
export const EIGHT_DIR_UNIT: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

/**
 * Snap a free aim vector onto the nearest 8-direction unit vector.
 * Zero (or near-zero) input → {0,0}.
 */
export function quantizeTo8Dir(
  dx: number,
  dy: number,
  eps = 1e-6,
): { nx: number; ny: number } {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return { nx: 0, ny: 0 };
  const len = Math.hypot(dx, dy);
  if (len < eps) return { nx: 0, ny: 0 };
  const ix = dx / len;
  const iy = dy / len;
  let best = EIGHT_DIR_UNIT[0]!;
  let bestDot = -Infinity;
  for (const d of EIGHT_DIR_UNIT) {
    const dot = ix * d[0] + iy * d[1];
    if (dot > bestDot) {
      bestDot = dot;
      best = d;
    }
  }
  return { nx: best[0], ny: best[1] };
}

/** True if (vx,vy) is ~0 or lies on an 8-dir ray at the given speed. */
export function isEightDirVelocity(
  vx: number,
  vy: number,
  speed: number,
  tol = 0.5,
): boolean {
  const mag = Math.hypot(vx, vy);
  if (mag < tol) return true;
  const { nx, ny } = quantizeTo8Dir(vx, vy);
  const ex = nx * speed;
  const ey = ny * speed;
  return Math.hypot(vx - ex, vy - ey) <= tol;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Point not deep inside a solid (resolved free position). */
export function freePointNear(
  x: number,
  y: number,
  solids: readonly SolidObstacle[],
  entityRadius = ENTITY_COLLIDE_RADIUS,
  mapW = MAP_WIDTH,
  mapH = MAP_HEIGHT,
): { x: number; y: number } {
  const hit = resolveSolidCollisions(x, y, entityRadius, solids);
  return {
    x: clamp(hit.x, 24, mapW - 24),
    y: clamp(hit.y, 24, mapH - 24),
  };
}

/**
 * How far an entity would travel in `dtSec` along unit dir after solid resolution.
 * Small moved ⇒ that direction is blocked (stuck into tree/rock).
 */
export function probeDirTravel(
  x: number,
  y: number,
  nx: number,
  ny: number,
  speed: number,
  dtSec: number,
  solids: readonly SolidObstacle[],
  entityRadius = ENTITY_COLLIDE_RADIUS,
  mapW = MAP_WIDTH,
  mapH = MAP_HEIGHT,
): number {
  const step = speed * dtSec;
  const rawX = x + nx * step;
  const rawY = y + ny * step;
  const hit = resolveSolidCollisions(rawX, rawY, entityRadius, solids);
  const px = clamp(hit.x, 16, mapW - 16);
  const py = clamp(hit.y, 16, mapH - 16);
  return Math.hypot(px - x, py - y);
}

/**
 * Pick an 8-dir that actually moves, preferring progress toward (tx,ty).
 * Returns null if every direction is blocked (then brain should re-path).
 */
export function pickUnblockedEightDir(
  x: number,
  y: number,
  tx: number,
  ty: number,
  speed: number,
  solids: readonly SolidObstacle[],
  entityRadius = ENTITY_COLLIDE_RADIUS,
  mapW = MAP_WIDTH,
  mapH = MAP_HEIGHT,
  dtSec = 0.05,
): { nx: number; ny: number } | null {
  const desired = quantizeTo8Dir(tx - x, ty - y);
  const minTravel = speed * dtSec * 0.28;
  const ranked = [...EIGHT_DIR_UNIT].sort((a, b) => {
    const da = a[0] * desired.nx + a[1] * desired.ny;
    const db = b[0] * desired.nx + b[1] * desired.ny;
    return db - da;
  });
  let best: { nx: number; ny: number; score: number } | null = null;
  for (const d of ranked) {
    const travel = probeDirTravel(x, y, d[0], d[1], speed, dtSec, solids, entityRadius, mapW, mapH);
    if (travel < minTravel) continue;
    // Prefer dirs that both move and head toward target
    const toward = d[0] * desired.nx + d[1] * desired.ny;
    const score = travel + toward * speed * dtSec;
    if (!best || score > best.score) {
      best = { nx: d[0], ny: d[1], score };
    }
  }
  return best ? { nx: best.nx, ny: best.ny } : null;
}

function rollWaypoint(
  rng: () => number,
  mapW: number,
  mapH: number,
  solids: readonly SolidObstacle[],
): { targetX: number; targetY: number; idleMs: number } {
  let x = 40 + rng() * (mapW - 80);
  let y = 40 + rng() * (mapH - 80);
  const free = freePointNear(x, y, solids, ENTITY_COLLIDE_RADIUS, mapW, mapH);
  return {
    targetX: free.x,
    targetY: free.y,
    idleMs: 350 + rng() * 1400,
  };
}

/**
 * Update AI velocities with waypoint / idle patterns.
 * Velocities are 8-dir and prefer unblocked paths so AI does not grind into trees.
 */
export function stepAiCrowd(state: MatchState, dtMs: number, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  const rng = createRng(seed + state.tick);
  const entities: Record<string, EntityState> = { ...state.entities };
  const roomId = state.roomId;
  const speed = aiRabbitMoveSpeed();
  const mapW = state.config.mapWidth;
  const mapH = state.config.mapHeight;
  const solids = solidsForSeed(state.meadowSeed ?? DEFAULT_MEADOW_SEED);
  const stuckLimitMs = 450;

  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'ai' || !e.alive) continue;
    const key = brainKey(roomId, e.id);
    let brain = brains.get(key);
    if (!brain || brain.idleMs <= 0) {
      const wp = rollWaypoint(rng, mapW, mapH, solids);
      brain = {
        ...wp,
        stuckMs: 0,
        lastX: e.x,
        lastY: e.y,
      };
      brains.set(key, brain);
    }

    // Detect physical stick: asked to move but almost no position change
    const moved = Math.hypot(e.x - brain.lastX, e.y - brain.lastY);
    const wasTrying = Math.hypot(e.vx, e.vy) > 1;
    if (wasTrying && moved < 1.2) {
      brain.stuckMs += dtMs;
    } else {
      brain.stuckMs = Math.max(0, brain.stuckMs - dtMs * 0.5);
    }
    brain.lastX = e.x;
    brain.lastY = e.y;

    if (brain.stuckMs >= stuckLimitMs) {
      const wp = rollWaypoint(rng, mapW, mapH, solids);
      brain.targetX = wp.targetX;
      brain.targetY = wp.targetY;
      brain.idleMs = wp.idleMs;
      brain.stuckMs = 0;
    }

    const dx = brain.targetX - e.x;
    const dy = brain.targetY - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 14) {
      brain.idleMs -= dtMs;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
    } else {
      const dir = pickUnblockedEightDir(
        e.x,
        e.y,
        brain.targetX,
        brain.targetY,
        speed,
        solids,
        ENTITY_COLLIDE_RADIUS,
        mapW,
        mapH,
        0.05,
      );
      if (!dir) {
        // Fully boxed — repath next tick
        brain.idleMs = 0;
        brain.stuckMs = stuckLimitMs;
        entities[e.id] = { ...e, vx: 0, vy: 0 };
      } else {
        entities[e.id] = { ...e, vx: dir.nx * speed, vy: dir.ny * speed };
      }
    }
  }

  return { ...state, entities };
}
