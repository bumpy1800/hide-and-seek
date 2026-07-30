import type { EntityState, MatchState } from './types.js';
import { AI_SPEED } from './types.js';
import { createRng } from './rng.js';
import { MISSION_VISIT_RADIUS } from './mission.js';

/** Visit-mission approach / exit style for one AI rabbit. */
export type AiVisitPattern =
  | 'pass_through' // keep going past the point
  | 'touch_leave' // tag the point then leave opposite-ish
  | 'sweep_by' // offset approach then continue past
  | 'linger_then_go'; // near point briefly then wander away

/** One-way visit approach stages (never thrash offset↔point). */
export type AiVisitPhase = 'offset' | 'point' | 'after';

type AiBrain = {
  targetX: number;
  targetY: number;
  idleMs: number;
  dirNx: number;
  dirNy: number;
  dirHoldMs: number;
  /** Mission identity (tick+kind+target) when we last armed mission plan. */
  missionKey: string | null;
  /** Ms before this AI starts mission-directed motion. */
  missionDepartDelayMs: number;
  visitPattern: AiVisitPattern;
  /** After tagging point: secondary goal. */
  afterX: number;
  afterY: number;
  /** True once inside MISSION_VISIT_RADIUS this mission. */
  visitedPoint: boolean;
  /**
   * Monotonic visit approach phase:
   * offset → point → after (only advances forward; prevents sweep_by thrash).
   */
  visitPhase: AiVisitPhase;
  /** Cached offset approach waypoint for sweep_by. */
  offsetX: number;
  offsetY: number;
};

/** Min/max hold when locking a direction (keyboard-like). */
export const AI_DIR_HOLD_MS_MIN = 400;
export const AI_DIR_HOLD_MS_MAX = 850;

/** Stagger window so AI don't all bolt on the same tick. */
export const AI_MISSION_STAGGER_MS_MAX = 4500;

const VISIT_PATTERNS: AiVisitPattern[] = [
  'pass_through',
  'touch_leave',
  'sweep_by',
  'linger_then_go',
];

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

/** Test helper: read mission plan fields for an AI (after stepAiCrowd). */
export function getAiMissionPlan(
  roomId: string,
  entityId: string,
): {
  departDelayMs: number;
  visitPattern: AiVisitPattern;
  missionKey: string | null;
  visitedPoint: boolean;
  visitPhase: AiVisitPhase;
} | null {
  const b = brains.get(brainKey(roomId, entityId));
  if (!b) return null;
  return {
    departDelayMs: b.missionDepartDelayMs,
    visitPattern: b.visitPattern,
    missionKey: b.missionKey,
    visitedPoint: b.visitedPoint,
    visitPhase: b.visitPhase,
  };
}

export function aiRabbitMoveSpeed(): number {
  return AI_SPEED;
}

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
    missionKey: null,
    missionDepartDelayMs: 0,
    visitPattern: 'pass_through',
    afterX: targetX,
    afterY: targetY,
    visitedPoint: false,
    visitPhase: 'point',
    offsetX: targetX,
    offsetY: targetY,
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

export function shouldRelockDir(
  brain: AiBrain,
  preferred: { nx: number; ny: number },
  dx: number,
  dy: number,
): boolean {
  if (brain.dirHoldMs <= 0) return true;
  if (brain.dirNx === 0 && brain.dirNy === 0) return true;
  if (dirsEqual(preferred, brain.dirNx, brain.dirNy)) return false;
  const progress = brain.dirNx * dx + brain.dirNy * dy;
  if (progress < -8) return true;
  return false;
}

function missionKeyOf(state: MatchState): string | null {
  const m = state.mission;
  if (!m) return null;
  return `${m.kind}:${Math.round(m.targetX)}:${Math.round(m.targetY)}:${state.missionGrantCount}`;
}

function hash01(id: string, salt: number): number {
  let h = salt >>> 0;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function pickPattern(id: string, grantCount: number): AiVisitPattern {
  // Spread patterns evenly by entity id so packs always show variety
  let sum = grantCount * 17;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i) * (i + 3);
  return VISIT_PATTERNS[Math.abs(sum) % VISIT_PATTERNS.length]!;
}

function randomMapPoint(
  rng: () => number,
  mapW: number,
  mapH: number,
): { x: number; y: number } {
  return {
    x: 60 + rng() * (mapW - 120),
    y: 60 + rng() * (mapH - 120),
  };
}

/** Goal beyond the visit point along approach vector (pass-through). */
function beyondPoint(
  fromX: number,
  fromY: number,
  tx: number,
  ty: number,
  mapW: number,
  mapH: number,
  dist = 280,
): { x: number; y: number } {
  const dx = tx - fromX;
  const dy = ty - fromY;
  const len = Math.hypot(dx, dy) || 1;
  const x = Math.max(40, Math.min(mapW - 40, tx + (dx / len) * dist));
  const y = Math.max(40, Math.min(mapH - 40, ty + (dy / len) * dist));
  return { x, y };
}

/** Offset approach target so paths aren't identical. */
function approachOffset(
  id: string,
  tx: number,
  ty: number,
  grantCount: number,
): { x: number; y: number } {
  const a = hash01(id, grantCount * 11) * Math.PI * 2;
  const r = 40 + hash01(id, grantCount * 19) * 90;
  return { x: tx + Math.cos(a) * r, y: ty + Math.sin(a) * r };
}

function armMissionPlan(
  brain: AiBrain,
  e: EntityState,
  state: MatchState,
  key: string,
  rng: () => number,
): void {
  const m = state.mission!;
  const grant = state.missionGrantCount ?? 1;
  brain.missionKey = key;
  brain.visitedPoint = false;
  brain.visitPattern = pickPattern(e.id, grant);
  // Independent stagger 0..AI_MISSION_STAGGER_MS_MAX
  brain.missionDepartDelayMs =
    hash01(e.id, grant * 31 + Math.round(m.targetX)) * AI_MISSION_STAGGER_MS_MAX;

  // One-way approach phase: sweep_by starts at offset, others go straight to point
  if (brain.visitPattern === 'sweep_by') {
    const off = approachOffset(e.id, m.targetX, m.targetY, grant);
    brain.offsetX = off.x;
    brain.offsetY = off.y;
    brain.visitPhase = 'offset';
  } else if (brain.visitPattern === 'pass_through') {
    // Aim beyond immediately so path crosses the completion circle
    brain.visitPhase = 'point'; // still track until tagged; goal uses after
    const b = beyondPoint(
      e.x,
      e.y,
      m.targetX,
      m.targetY,
      state.config.mapWidth,
      state.config.mapHeight,
      220 + hash01(e.id, grant) * 200,
    );
    brain.afterX = b.x;
    brain.afterY = b.y;
  } else {
    brain.visitPhase = 'point';
  }

  // Precompute after-goal for variety
  if (brain.visitPattern === 'pass_through' || brain.visitPattern === 'sweep_by') {
    if (brain.visitPattern === 'sweep_by') {
      const b = beyondPoint(
        e.x,
        e.y,
        m.targetX,
        m.targetY,
        state.config.mapWidth,
        state.config.mapHeight,
        220 + hash01(e.id, grant) * 200,
      );
      brain.afterX = b.x;
      brain.afterY = b.y;
    }
  } else if (brain.visitPattern === 'touch_leave') {
    const leave = beyondPoint(
      m.targetX,
      m.targetY,
      e.x,
      e.y,
      state.config.mapWidth,
      state.config.mapHeight,
      200 + rng() * 180,
    );
    brain.afterX = leave.x + (rng() - 0.5) * 120;
    brain.afterY = leave.y + (rng() - 0.5) * 120;
  } else {
    const p = randomMapPoint(rng, state.config.mapWidth, state.config.mapHeight);
    brain.afterX = p.x;
    brain.afterY = p.y;
  }
  brain.dirHoldMs = 0;
}

/**
 * Update AI velocities — 8-dir + hold; visit missions use staggered departures
 * and varied pass-through / leave patterns so AI keep moving after the point.
 */
export function stepAiCrowd(state: MatchState, dtMs: number, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  const rng = createRng(seed + state.tick);
  const entities: Record<string, EntityState> = { ...state.entities };
  const roomId = state.roomId;
  const speed = aiRabbitMoveSpeed();
  const mission = state.mission;
  const seeker = state.seekerId ? state.entities[state.seekerId] : null;
  const mKey = missionKeyOf(state);
  const mapW = state.config.mapWidth;
  const mapH = state.config.mapHeight;

  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'ai' || !e.alive) continue;
    const key = brainKey(roomId, e.id);
    let brain = brains.get(key);
    if (!brain) {
      const p = randomMapPoint(rng, mapW, mapH);
      brain = emptyBrain(p.x, p.y, 200 + rng() * 400);
      brains.set(key, brain);
    }

    // New mission → arm staggered plan
    if (mission && mKey && brain.missionKey !== mKey) {
      armMissionPlan(brain, e, state, mKey, rng);
    }
    if (!mission) {
      brain.missionKey = null;
      brain.missionDepartDelayMs = 0;
      brain.visitedPoint = false;
      brain.visitPhase = 'point';
    }

    let goalX: number;
    let goalY: number;
    let allowIdleAtGoal = true;

    if (mission) {
      const completed = mission.completedIds.includes(e.id);
      const distToPoint = Math.hypot(e.x - mission.targetX, e.y - mission.targetY);
      // Only count a visit when inside the SAME radius used for mission completion
      if (mission.kind === 'visit_point' && distToPoint <= MISSION_VISIT_RADIUS) {
        brain.visitedPoint = true;
        brain.visitPhase = 'after';
      }
      if (completed && brain.visitPhase !== 'after') {
        brain.visitPhase = 'after';
        brain.visitedPoint = true;
      }

      // Still waiting to depart — wander (not freeze, not all rush together)
      if (brain.missionDepartDelayMs > 0 && brain.visitPhase !== 'after') {
        brain.missionDepartDelayMs = Math.max(0, brain.missionDepartDelayMs - dtMs);
        allowIdleAtGoal = false;
        if (brain.idleMs <= 0) {
          const p = randomMapPoint(rng, mapW, mapH);
          brain.targetX = p.x;
          brain.targetY = p.y;
          brain.idleMs = 300 + rng() * 900;
          brain.dirHoldMs = 0;
        }
        goalX = brain.targetX;
        goalY = brain.targetY;
      } else if (mission.kind === 'visit_point' && brain.visitPhase === 'after') {
        // After actually entering completion radius: keep moving (pattern exit)
        allowIdleAtGoal = false;
        const distAfter = Math.hypot(e.x - brain.afterX, e.y - brain.afterY);
        if (distAfter < 28 || brain.idleMs <= 0) {
          if (brain.visitPattern === 'pass_through' || brain.visitPattern === 'sweep_by') {
            const b = beyondPoint(
              mission.targetX,
              mission.targetY,
              brain.afterX,
              brain.afterY,
              mapW,
              mapH,
              160 + rng() * 160,
            );
            brain.afterX = b.x;
            brain.afterY = b.y;
          } else {
            const p = randomMapPoint(rng, mapW, mapH);
            brain.afterX = p.x;
            brain.afterY = p.y;
          }
          brain.idleMs = 500 + rng() * 1200;
          brain.dirHoldMs = 0;
        } else {
          brain.idleMs -= dtMs * 0.15;
        }
        goalX = brain.afterX;
        goalY = brain.afterY;
      } else if (mission.kind === 'visit_point') {
        // Monotonic approach: never flip offset↔point each tick
        allowIdleAtGoal = false;
        if (brain.visitPattern === 'pass_through') {
          // Aim beyond so path crosses completion circle (phase stays point until tagged)
          goalX = brain.afterX;
          goalY = brain.afterY;
        } else if (brain.visitPattern === 'sweep_by') {
          if (brain.visitPhase === 'offset') {
            const dOff = Math.hypot(e.x - brain.offsetX, e.y - brain.offsetY);
            if (dOff <= 40) {
              // Advance once — never go back to offset
              brain.visitPhase = 'point';
              brain.dirHoldMs = 0;
              goalX = mission.targetX;
              goalY = mission.targetY;
            } else {
              goalX = brain.offsetX;
              goalY = brain.offsetY;
            }
          } else {
            // phase === 'point': hold until inside visit radius
            goalX = mission.targetX;
            goalY = mission.targetY;
          }
        } else {
          // touch_leave / linger_then_go: go to the point itself first
          brain.visitPhase = 'point';
          goalX = mission.targetX;
          goalY = mission.targetY;
        }
      } else if (mission.kind === 'touch_fox' && seeker && !completed) {
        allowIdleAtGoal = false;
        if (brain.missionDepartDelayMs > 0) {
          brain.missionDepartDelayMs = Math.max(0, brain.missionDepartDelayMs - dtMs);
          if (brain.idleMs <= 0) {
            const p = randomMapPoint(rng, mapW, mapH);
            brain.targetX = p.x;
            brain.targetY = p.y;
            brain.idleMs = 200 + rng() * 600;
          }
          goalX = brain.targetX;
          goalY = brain.targetY;
        } else {
          goalX = seeker.x;
          goalY = seeker.y;
        }
      } else {
        // Completed touch_fox or no seeker: wander
        allowIdleAtGoal = false;
        if (brain.idleMs <= 0) {
          const p = randomMapPoint(rng, mapW, mapH);
          brain.targetX = p.x;
          brain.targetY = p.y;
          brain.idleMs = 400 + rng() * 1400;
          brain.dirHoldMs = 0;
        }
        goalX = brain.targetX;
        goalY = brain.targetY;
      }
    } else {
      // No mission: classic waypoint wander
      if (brain.idleMs <= 0) {
        const p = randomMapPoint(rng, mapW, mapH);
        brain.targetX = p.x;
        brain.targetY = p.y;
        brain.idleMs = 400 + rng() * 1800;
        brain.dirHoldMs = 0;
      }
      goalX = brain.targetX;
      goalY = brain.targetY;
    }

    const dx = goalX - e.x;
    const dy = goalY - e.y;
    const dist = Math.hypot(dx, dy);

    if (allowIdleAtGoal && dist < 12) {
      brain.idleMs -= dtMs;
      brain.dirNx = 0;
      brain.dirNy = 0;
      brain.dirHoldMs = 0;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
      continue;
    }

    // Mission / post-visit: never hard-stop at goal — pick next if very close
    if (!allowIdleAtGoal && dist < 10) {
      if (mission && (brain.visitedPoint || mission.completedIds.includes(e.id))) {
        const p = randomMapPoint(rng, mapW, mapH);
        brain.afterX = p.x;
        brain.afterY = p.y;
        brain.dirHoldMs = 0;
      } else if (mission?.kind === 'visit_point') {
        // Nudge toward actual point / beyond so we don't freeze
        goalX = mission.targetX + (rng() - 0.5) * 20;
        goalY = mission.targetY + (rng() - 0.5) * 20;
      }
    }

    const dx2 = goalX - e.x;
    const dy2 = goalY - e.y;
    const preferred = quantizeTo8Dir(dx2, dy2);
    if (shouldRelockDir(brain, preferred, dx2, dy2)) {
      brain.dirNx = preferred.nx;
      brain.dirNy = preferred.ny;
      brain.dirHoldMs = freshHoldMs(rng);
    } else {
      brain.dirHoldMs = Math.max(0, brain.dirHoldMs - dtMs);
    }

    // If somehow zero dir, force a random 8-dir so we never stick motionless mid-mission
    if (brain.dirNx === 0 && brain.dirNy === 0) {
      const d = EIGHT_DIR_UNIT[Math.floor(rng() * EIGHT_DIR_UNIT.length)]!;
      brain.dirNx = d[0];
      brain.dirNy = d[1];
      brain.dirHoldMs = freshHoldMs(rng);
    }

    entities[e.id] = {
      ...e,
      vx: brain.dirNx * speed,
      vy: brain.dirNy * speed,
    };
  }

  return { ...state, entities };
}
