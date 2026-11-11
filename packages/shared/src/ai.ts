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

export type AiBrain = {
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
  /**
   * Point past the mission marker — approach always aims here so the path
   * crosses the visit radius (never aims at exact marker coords).
   */
  approachX: number;
  approachY: number;
  /** Last position for stuck / thrash detection. */
  lastX: number;
  lastY: number;
  /** Ms spent barely moving while supposed to be walking. */
  stuckMs: number;
  /** True after we observed real displacement (integrateMotion running). */
  sawMotion: boolean;
  /**
   * While > 0, keep dirNx/dirNy locked (no preferred flip).
   * Used near goals so 8-dir does not L↔R thrash every frame.
   */
  escapeHoldMs: number;
  /**
   * Cached touch_fox surround intercept. Recomputed only when refresh
   * timer elapses or the goal is reached — avoids thrash when fox velocity
   * changes every host tick.
   */
  surroundGoalX: number;
  surroundGoalY: number;
  surroundRefreshMs: number;
};

/** Min/max hold when locking a direction (keyboard-like). */
export const AI_DIR_HOLD_MS_MIN = 400;
export const AI_DIR_HOLD_MS_MAX = 850;
/** Near a goal, re-snap direction often so 8-dir does not thrash left↔right. */
export const AI_DIR_HOLD_MS_NEAR = 120;
/** Distance under which we always re-lock preferred 8-dir. */
export const AI_NEAR_GOAL_DIST = 72;
/** Distance under which we treat the waypoint as arrived. */
export const AI_ARRIVAL_DIST = 18;
/** If moved less than this over AI_STUCK_MS while walking, force replan. */
export const AI_STUCK_MOVE_EPS = 3;
export const AI_STUCK_MS = 450;

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
    approachX: targetX,
    approachY: targetY,
    surroundGoalX: targetX,
    surroundGoalY: targetY,
    surroundRefreshMs: 0,
    lastX: targetX,
    lastY: targetY,
    stuckMs: 0,
    sawMotion: false,
    escapeHoldMs: 0,
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
 * When to abandon the held 8-dir for a new preferred dir.
 * Close to the goal we always re-lock — long holds near a point cause L↔R thrash.
 */
export function shouldRelockDir(
  brain: AiBrain,
  preferred: { nx: number; ny: number },
  dx: number,
  dy: number,
  dist = Math.hypot(dx, dy),
): boolean {
  if (brain.dirHoldMs <= 0) return true;
  if (brain.dirNx === 0 && brain.dirNy === 0) return true;
  if (dirsEqual(preferred, brain.dirNx, brain.dirNy)) return false;
  // Near goal: snap as soon as preferred 8-dir changes (don't hold 400ms past a point)
  if (dist < AI_NEAR_GOAL_DIST) return true;
  // Far: only reverse if we are clearly walking away from the goal
  const progress = brain.dirNx * dx + brain.dirNy * dy;
  const reverseThresh = -Math.max(24, dist * 0.35);
  if (progress < reverseThresh) return true;
  return false;
}

/** Pick a far map point distinctly away from (x,y). */
function farAwayFrom(
  rng: () => number,
  x: number,
  y: number,
  mapW: number,
  mapH: number,
  minDist = 180,
): { x: number; y: number } {
  for (let i = 0; i < 8; i++) {
    const p = randomMapPoint(rng, mapW, mapH);
    if (Math.hypot(p.x - x, p.y - y) >= minDist) return p;
  }
  return randomMapPoint(rng, mapW, mapH);
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

function clampMap(
  x: number,
  y: number,
  mapW: number,
  mapH: number,
  pad = 40,
): { x: number; y: number } {
  return {
    x: Math.max(pad, Math.min(mapW - pad, x)),
    y: Math.max(pad, Math.min(mapH - pad, y)),
  };
}

/** Stronger mix so similar ids (ai-0..ai-n) land in different surround slots. */
function surroundSlot(id: string, grantCount: number, nSlots: number): number {
  let h = 0x811c9dc5 ^ (grantCount * 0x9e3779b9);
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x01000193);
  }
  h ^= Math.imul(id.length + 3, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % nSlots;
}

/**
 * touch_fox: fox is faster, so pure chase fails. Each AI owns a stable surround
 * slot and aims at an intercept / flank point (predict fox velocity + side offset).
 * When close enough, close in for the actual touch.
 *
 * Goals should be **cached** by the caller (surroundRefreshMs) — recomputing
 * every tick thrashs 8-dir when fox velocity flickers.
 */
export function touchFoxSurroundGoal(
  rabbit: EntityState,
  seeker: EntityState,
  mapW: number,
  mapH: number,
  grantCount: number,
): { x: number; y: number } {
  const id = rabbit.id;
  const nSlots = 8;
  const slot = surroundSlot(id, grantCount, nSlots);
  const slotAngle = (slot / nSlots) * Math.PI * 2 + (hash01(id, 19) - 0.5) * 0.35;

  const dist = Math.hypot(rabbit.x - seeker.x, rabbit.y - seeker.y);
  const foxSpd = Math.hypot(seeker.vx, seeker.vy);

  // Final close-in: small stable offset toward fox (not exact body → less L↔R thrash)
  if (dist < 72) {
    const ox = Math.cos(slotAngle) * 14;
    const oy = Math.sin(slotAngle) * 14;
    return clampMap(seeker.x + ox, seeker.y + oy, mapW, mapH);
  }

  // Predict fox position a fraction of a second ahead (capped so goals stay sane)
  const predT = foxSpd > 30 ? 0.55 : foxSpd > 10 ? 0.35 : 0.1;
  const predX = seeker.x + seeker.vx * predT;
  const predY = seeker.y + seeker.vy * predT;

  let gx: number;
  let gy: number;

  if (foxSpd > 40) {
    // Moving fox: cut ahead + left/right flanks (box-in), some rear pressure
    const fdx = seeker.vx / foxSpd;
    const fdy = seeker.vy / foxSpd;
    const px = -fdy;
    const py = fdx;
    const sideSign = slot % 2 === 0 ? 1 : -1;
    const sideMag = 55 + (slot % 4) * 28;
    if (slot >= 6) {
      // Rear/side cutters — block escape routes behind fox
      const rear = 50 + (slot - 6) * 40;
      gx = seeker.x - fdx * rear + px * sideSign * (90 + slot * 10);
      gy = seeker.y - fdy * rear + py * sideSign * (90 + slot * 10);
    } else {
      // Front intercept + wide flanks
      const ahead = 70 + Math.floor(slot / 2) * 28;
      gx = seeker.x + fdx * ahead + px * sideSign * sideMag;
      gy = seeker.y + fdy * ahead + py * sideSign * sideMag;
    }
  } else {
    // Stationary / slow fox: ring surround, tighten with distance (stable radii)
    const ring =
      dist > 360 ? 140 : dist > 220 ? 100 : dist > 120 ? 55 : 28;
    gx = predX + Math.cos(slotAngle) * ring;
    gy = predY + Math.sin(slotAngle) * ring;
  }

  // Far approach: still use distinct ring slots (not the same chase point)
  if (dist > 420) {
    const ring = 140 + (slot % 4) * 18;
    gx = predX + Math.cos(slotAngle) * ring;
    gy = predY + Math.sin(slotAngle) * ring;
  }

  return clampMap(gx, gy, mapW, mapH);
}

/**
 * Pick / hold a surround intercept for touch_fox.
 * Returns whether the goal was freshly recomputed (for tests / debug).
 */
export function refreshTouchFoxSurroundGoal(
  brain: AiBrain,
  rabbit: EntityState,
  seeker: EntityState,
  mapW: number,
  mapH: number,
  grantCount: number,
  dtMs: number,
  force = false,
): boolean {
  brain.surroundRefreshMs = Math.max(0, brain.surroundRefreshMs - dtMs);
  const goalDist = Math.hypot(
    rabbit.x - brain.surroundGoalX,
    rabbit.y - brain.surroundGoalY,
  );
  const foxToGoal = Math.hypot(
    seeker.x - brain.surroundGoalX,
    seeker.y - brain.surroundGoalY,
  );
  const distFox = Math.hypot(rabbit.x - seeker.x, rabbit.y - seeker.y);
  // Stale intercept: fox ran far from our planned point
  const interceptStale = foxToGoal > 220 && distFox > 90;
  const arrived = goalDist < AI_ARRIVAL_DIST + 6;
  if (!force && brain.surroundRefreshMs > 0 && !arrived && !interceptStale) {
    return false;
  }
  const g = touchFoxSurroundGoal(rabbit, seeker, mapW, mapH, grantCount);
  brain.surroundGoalX = g.x;
  brain.surroundGoalY = g.y;
  // Hold longer when far (stable approach); refresh sooner when boxing-in
  brain.surroundRefreshMs =
    distFox < 90 ? 200 : distFox < 220 ? 380 : distFox < 380 ? 520 : 640;
  return true;
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

  // Through-point: every pattern approaches a point past the marker
  const thru = beyondPoint(
    e.x,
    e.y,
    m.targetX,
    m.targetY,
    state.config.mapWidth,
    state.config.mapHeight,
    220 + hash01(e.id, grant) * 200,
  );
  brain.approachX = thru.x;
  brain.approachY = thru.y;

  if (brain.visitPattern === 'sweep_by') {
    const off = approachOffset(e.id, m.targetX, m.targetY, grant);
    brain.offsetX = off.x;
    brain.offsetY = off.y;
    brain.visitPhase = 'offset';
  } else {
    brain.visitPhase = 'point';
  }

  // Exit goal after tagging the radius
  if (brain.visitPattern === 'pass_through' || brain.visitPattern === 'sweep_by') {
    brain.afterX = thru.x;
    brain.afterY = thru.y;
  } else if (brain.visitPattern === 'touch_leave') {
    // Leave roughly opposite of arrival
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
  brain.stuckMs = 0;
  brain.escapeHoldMs = 0;
  brain.surroundGoalX = e.x;
  brain.surroundGoalY = e.y;
  brain.surroundRefreshMs = 0;
}

/**
 * Update AI velocities — 8-dir + hold; visit missions use staggered departures
 * and varied pass-through / leave patterns so AI keep moving after the point.
 * Near goals: short hold + arrival replan to avoid L↔R thrash / freeze.
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
      brain.lastX = e.x;
      brain.lastY = e.y;
      brains.set(key, brain);
    } else if (
      typeof brain.stuckMs !== 'number' ||
      typeof brain.escapeHoldMs !== 'number' ||
      typeof brain.surroundRefreshMs !== 'number'
    ) {
      // Hot-reload / older brain shape
      brain.lastX = e.x;
      brain.lastY = e.y;
      brain.stuckMs = 0;
      brain.sawMotion = false;
      brain.escapeHoldMs = 0;
      if (typeof brain.approachX !== 'number') {
        brain.approachX = e.x;
        brain.approachY = e.y;
      }
      if (typeof brain.surroundGoalX !== 'number') {
        brain.surroundGoalX = e.x;
        brain.surroundGoalY = e.y;
        brain.surroundRefreshMs = 0;
      }
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
      // Intentionally sit out this mission — wander only, never pursue goal
      const isSkipper = (mission.skipIds ?? []).includes(e.id);
      if (isSkipper) {
        allowIdleAtGoal = false;
        if (brain.idleMs <= 0) {
          const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
          brain.targetX = p.x;
          brain.targetY = p.y;
          brain.idleMs = 400 + rng() * 1400;
          brain.dirHoldMs = 0;
        }
        goalX = brain.targetX;
        goalY = brain.targetY;
      } else {
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
            const p = farAwayFrom(rng, e.x, e.y, mapW, mapH, 120);
            brain.targetX = p.x;
            brain.targetY = p.y;
            brain.idleMs = 300 + rng() * 900;
            brain.dirHoldMs = 0;
          }
          goalX = brain.targetX;
          goalY = brain.targetY;
        } else if (mission.kind === 'visit_point' && brain.visitPhase === 'after') {
          // After entering completion radius: keep moving (pattern exit)
          allowIdleAtGoal = false;
          const distAfter = Math.hypot(e.x - brain.afterX, e.y - brain.afterY);
          if (distAfter < AI_ARRIVAL_DIST + 10 || brain.idleMs <= 0) {
            if (brain.visitPattern === 'pass_through' || brain.visitPattern === 'sweep_by') {
              const b = beyondPoint(
                mission.targetX,
                mission.targetY,
                brain.afterX,
                brain.afterY,
                mapW,
                mapH,
                200 + rng() * 180,
              );
              brain.afterX = b.x;
              brain.afterY = b.y;
            } else {
              const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
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
          // Always aim through approachX/Y (past marker), never exact target
          allowIdleAtGoal = false;
          if (brain.visitPattern === 'sweep_by' && brain.visitPhase === 'offset') {
            const dOff = Math.hypot(e.x - brain.offsetX, e.y - brain.offsetY);
            if (dOff <= AI_ARRIVAL_DIST + 14) {
              brain.visitPhase = 'point';
              brain.dirHoldMs = 0;
              brain.escapeHoldMs = 0;
              goalX = brain.approachX;
              goalY = brain.approachY;
            } else {
              goalX = brain.offsetX;
              goalY = brain.offsetY;
            }
          } else {
            brain.visitPhase = 'point';
            goalX = brain.approachX;
            goalY = brain.approachY;
          }
        } else {
          // touch_rabbit (user-only T) or completed visit: AI wanders
          allowIdleAtGoal = false;
          if (brain.idleMs <= 0) {
            const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
            brain.targetX = p.x;
            brain.targetY = p.y;
            brain.idleMs = 400 + rng() * 1400;
            brain.dirHoldMs = 0;
          }
          goalX = brain.targetX;
          goalY = brain.targetY;
        }
      }
    } else {
      // No mission: classic waypoint wander
      if (brain.idleMs <= 0) {
        const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
        brain.targetX = p.x;
        brain.targetY = p.y;
        brain.idleMs = 400 + rng() * 1800;
        brain.dirHoldMs = 0;
      }
      goalX = brain.targetX;
      goalY = brain.targetY;
    }

    let dx = goalX - e.x;
    let dy = goalY - e.y;
    let dist = Math.hypot(dx, dy);

    // Non-mission idle only (mission never freezes in place)
    if (allowIdleAtGoal && dist < 12) {
      brain.idleMs -= dtMs;
      brain.dirNx = 0;
      brain.dirNy = 0;
      brain.dirHoldMs = 0;
      brain.stuckMs = 0;
      brain.lastX = e.x;
      brain.lastY = e.y;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
      continue;
    }

    // Arrival: one-shot replan — never aim at self, never jitter goal every tick
    if (!allowIdleAtGoal && dist < AI_ARRIVAL_DIST) {
      if (mission && (brain.visitedPoint || mission.completedIds.includes(e.id))) {
        const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
        brain.afterX = p.x;
        brain.afterY = p.y;
        brain.targetX = p.x;
        brain.targetY = p.y;
        goalX = p.x;
        goalY = p.y;
        brain.dirHoldMs = 0;
      } else if (mission?.kind === 'visit_point' && brain.visitPhase === 'offset') {
        brain.visitPhase = 'point';
        goalX = brain.approachX;
        goalY = brain.approachY;
        brain.dirHoldMs = 0;
        brain.escapeHoldMs = 0;
      } else if (mission?.kind === 'visit_point') {
        // Re-arm through-point past the marker (do not jitter randomly)
        const b = beyondPoint(
          e.x,
          e.y,
          mission.targetX,
          mission.targetY,
          mapW,
          mapH,
          180 + rng() * 100,
        );
        brain.approachX = b.x;
        brain.approachY = b.y;
        goalX = b.x;
        goalY = b.y;
        brain.dirHoldMs = 0;
        brain.escapeHoldMs = 220;
      } else {
        const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
        brain.targetX = p.x;
        brain.targetY = p.y;
        goalX = p.x;
        goalY = p.y;
        brain.dirHoldMs = 0;
      }
      dx = goalX - e.x;
      dy = goalY - e.y;
      dist = Math.hypot(dx, dy);
    }

    // Stuck detection only after we've seen real displacement (host runs integrateMotion).
    // Pure velocity-step unit tests never move x/y — don't false-trigger thrash breaks.
    const moved = Math.hypot(e.x - brain.lastX, e.y - brain.lastY);
    if (moved >= AI_STUCK_MOVE_EPS) {
      brain.stuckMs = 0;
      brain.sawMotion = true;
    } else if (brain.sawMotion && (brain.dirNx !== 0 || brain.dirNy !== 0)) {
      brain.stuckMs += dtMs;
    } else {
      brain.stuckMs = 0;
    }
    brain.lastX = e.x;
    brain.lastY = e.y;

    if (brain.sawMotion && brain.stuckMs >= AI_STUCK_MS) {
      // Break thrash / corner freeze
      if (mission && brain.visitPhase === 'after') {
        const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
        brain.afterX = p.x;
        brain.afterY = p.y;
        goalX = p.x;
        goalY = p.y;
      } else if (mission?.kind === 'visit_point' && brain.visitPhase !== 'after') {
        // Side approach toward mission point
        const ang = Math.atan2(mission.targetY - e.y, mission.targetX - e.x);
        const side = rng() < 0.5 ? 1 : -1;
        goalX = mission.targetX + Math.cos(ang + side * 0.9) * 100;
        goalY = mission.targetY + Math.sin(ang + side * 0.9) * 100;
      } else {
        const p = farAwayFrom(rng, e.x, e.y, mapW, mapH);
        brain.targetX = p.x;
        brain.targetY = p.y;
        goalX = p.x;
        goalY = p.y;
      }
      dx = goalX - e.x;
      dy = goalY - e.y;
      dist = Math.hypot(dx, dy);
      brain.dirHoldMs = 0;
      brain.stuckMs = 0;
      const d = EIGHT_DIR_UNIT[Math.floor(rng() * EIGHT_DIR_UNIT.length)]!;
      brain.dirNx = d[0];
      brain.dirNy = d[1];
      brain.dirHoldMs = AI_DIR_HOLD_MS_NEAR + rng() * 80;
      brain.escapeHoldMs = 300;
    }

    const preferred = quantizeTo8Dir(dx, dy);
    const near = dist < AI_NEAR_GOAL_DIST;
    const onMissionPath =
      !!mission &&
      !allowIdleAtGoal &&
      !(mission.skipIds ?? []).includes(e.id);

    // Near goal / mission approach: commit to one 8-dir for a short escape window
    // so preferred cannot flip L↔R every tick.
    if (brain.escapeHoldMs > 0) {
      brain.escapeHoldMs = Math.max(0, brain.escapeHoldMs - dtMs);
    } else if (near || (onMissionPath && dist < AI_NEAR_GOAL_DIST * 1.4)) {
      const nx = preferred.nx !== 0 || preferred.ny !== 0
        ? preferred.nx
        : EIGHT_DIR_UNIT[Math.floor(rng() * 8)]![0];
      const ny = preferred.nx !== 0 || preferred.ny !== 0
        ? preferred.ny
        : EIGHT_DIR_UNIT[Math.floor(rng() * 8)]![1];
      // If new preferred is ~opposite of current, keep current (anti-thrash)
      const reverse =
        brain.dirNx !== 0 &&
        brain.dirNy !== 0 &&
        nx * brain.dirNx + ny * brain.dirNy < -0.5;
      if (!reverse || (brain.dirNx === 0 && brain.dirNy === 0)) {
        brain.dirNx = nx;
        brain.dirNy = ny;
      }
      brain.escapeHoldMs = 280 + rng() * 120;
      brain.dirHoldMs = brain.escapeHoldMs;
    } else if (shouldRelockDir(brain, preferred, dx, dy, dist)) {
      if (preferred.nx === 0 && preferred.ny === 0) {
        const d = EIGHT_DIR_UNIT[Math.floor(rng() * EIGHT_DIR_UNIT.length)]!;
        brain.dirNx = d[0];
        brain.dirNy = d[1];
      } else {
        brain.dirNx = preferred.nx;
        brain.dirNy = preferred.ny;
      }
      brain.dirHoldMs = freshHoldMs(rng);
    } else {
      brain.dirHoldMs = Math.max(0, brain.dirHoldMs - dtMs);
    }

    // Never motionless mid-walk
    if (brain.dirNx === 0 && brain.dirNy === 0) {
      const d = EIGHT_DIR_UNIT[Math.floor(rng() * EIGHT_DIR_UNIT.length)]!;
      brain.dirNx = d[0];
      brain.dirNy = d[1];
      brain.escapeHoldMs = 300;
      brain.dirHoldMs = 300;
    }

    entities[e.id] = {
      ...e,
      vx: brain.dirNx * speed,
      vy: brain.dirNy * speed,
    };
  }

  return { ...state, entities };
}
