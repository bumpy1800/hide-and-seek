import type { EntityState, MatchState } from './types.js';
import { AI_SPEED } from './types.js';
import { createRng } from './rng.js';

type AiBrain = {
  targetX: number;
  targetY: number;
  idleMs: number;
  /** Locked 8-dir unit vector (keyboard-like hold). */
  dirNx: number;
  dirNy: number;
  /** Ms left before re-picking an 8-dir toward the goal. */
  dirHoldMs: number;
};

/** Min/max hold when locking a direction (feels like key held ~0.4–0.85s). */
export const AI_DIR_HOLD_MS_MIN = 400;
export const AI_DIR_HOLD_MS_MAX = 850;

/** Keyed by `${roomId}:${entityId}` so concurrent rooms never share brains. */
const brains = new Map<string, AiBrain>();

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
 * 8 unit directions (N/S/E/W + diagonals). Diagonals normalized for equal speed.
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
  return Math.hypot(vx - nx * speed, vy - ny * speed) <= tol;
}

function freshHoldMs(rng: () => number): number {
  return AI_DIR_HOLD_MS_MIN + rng() * (AI_DIR_HOLD_MS_MAX - AI_DIR_HOLD_MS_MIN);
}

function emptyBrain(targetX: number, targetY: number, idleMs: number): AiBrain {
  return {
    targetX,
    targetY,
    idleMs,
    dirNx: 0,
    dirNy: 0,
    dirHoldMs: 0,
  };
}

function dirsEqual(
  a: { nx: number; ny: number },
  bx: number,
  by: number,
  eps = 1e-6,
): boolean {
  return Math.abs(a.nx - bx) < eps && Math.abs(a.ny - by) < eps;
}

/**
 * Decide whether to keep the locked 8-dir or re-snap toward the goal.
 * Holds a direction for hundreds of ms so paths don't look like free 30° aim.
 */
export function shouldRelockDir(
  brain: AiBrain,
  preferred: { nx: number; ny: number },
  dx: number,
  dy: number,
): boolean {
  if (brain.dirHoldMs <= 0) return true;
  if (brain.dirNx === 0 && brain.dirNy === 0) return true;
  // Still same preferred 8-dir → keep (refresh not required)
  if (dirsEqual(preferred, brain.dirNx, brain.dirNy)) return false;
  // Locked dir is actively taking us away from goal → break early
  const progress = brain.dirNx * dx + brain.dirNy * dy;
  if (progress < -8) return true;
  return false;
}

/**
 * Update AI velocities — 8-direction only, with keyboard-like direction hold.
 * During visit/touch missions, goals bias toward mission target / fox.
 */
export function stepAiCrowd(state: MatchState, dtMs: number, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  const rng = createRng(seed + state.tick);
  const entities: Record<string, EntityState> = { ...state.entities };
  const roomId = state.roomId;
  const speed = aiRabbitMoveSpeed();
  const mission = state.mission;
  const seeker = state.seekerId ? state.entities[state.seekerId] : null;

  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'ai' || !e.alive) continue;
    const key = brainKey(roomId, e.id);
    let brain = brains.get(key);

    // Mission-driven goals override idle waypoints
    let goalX: number | null = null;
    let goalY: number | null = null;
    if (mission && !mission.completedIds.includes(e.id)) {
      if (mission.kind === 'visit_point') {
        goalX = mission.targetX;
        goalY = mission.targetY;
      } else if (mission.kind === 'touch_fox' && seeker) {
        goalX = seeker.x;
        goalY = seeker.y;
      }
    }

    if (goalX == null || goalY == null) {
      if (!brain || brain.idleMs <= 0) {
        brain = emptyBrain(
          40 + rng() * (state.config.mapWidth - 80),
          40 + rng() * (state.config.mapHeight - 80),
          400 + rng() * 1800,
        );
        brains.set(key, brain);
      }
      goalX = brain.targetX;
      goalY = brain.targetY;
    } else if (!brain) {
      brain = emptyBrain(goalX, goalY, 9999);
      brains.set(key, brain);
    }

    const dx = goalX - e.x;
    const dy = goalY - e.y;
    const dist = Math.hypot(dx, dy);

    // Reach waypoint (non-mission) → idle + clear lock
    if (!mission && dist < 12) {
      brain.idleMs -= dtMs;
      brain.dirNx = 0;
      brain.dirNy = 0;
      brain.dirHoldMs = 0;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
      continue;
    }
    if (dist < 4) {
      brain.dirNx = 0;
      brain.dirNy = 0;
      brain.dirHoldMs = 0;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
      continue;
    }

    const preferred = quantizeTo8Dir(dx, dy);
    if (shouldRelockDir(brain, preferred, dx, dy)) {
      brain.dirNx = preferred.nx;
      brain.dirNy = preferred.ny;
      brain.dirHoldMs = freshHoldMs(rng);
    } else {
      brain.dirHoldMs = Math.max(0, brain.dirHoldMs - dtMs);
    }

    entities[e.id] = {
      ...e,
      vx: brain.dirNx * speed,
      vy: brain.dirNy * speed,
    };
  }

  return { ...state, entities };
}
