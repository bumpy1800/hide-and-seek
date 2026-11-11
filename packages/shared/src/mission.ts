/**
 * Sudden shared missions for rabbits during normal multiplayer hunts.
 *
 * Schedule (after seeker prep ends and hunt timer runs):
 * - First grant after MISSION_FIRST_DELAY_MS (10s).
 * - Each mission lasts MISSION_DURATION_MS (30s).
 * - After a mission ends: if timeRemainingMs >= 60s, wait MISSION_COOLDOWN_MS
 *   then grant again; if remaining < 60s, no further grants.
 * - “Start” for the 10s delay = when prep is over and timeRemainingMs starts
 *   decreasing (not roulette / not seeker-blind prep).
 */
import type {
  ActiveMission,
  FoxMissionBuffAnnounce,
  MatchState,
  MissionKind,
  MissionResult,
} from './types.js';
import {
  CATCH_RANGE,
  MAP_HEIGHT,
  MAP_WIDTH,
  SEEKER_SPEED,
} from './types.js';
import { createRng, pickRandom } from './rng.js';

export const MISSION_FIRST_DELAY_MS = 10_000;
export const MISSION_DURATION_MS = 30_000;
export const MISSION_COOLDOWN_MS = 30_000;
/** Remaining hunt time must be at least this to schedule another mission. */
export const MISSION_MIN_REMAINING_TO_GRANT_MS = 60_000;
export const MISSION_VISIT_RADIUS = 56;
/** Touch fox uses same range as catch for fairness. */
export const MISSION_TOUCH_RANGE = CATCH_RANGE;
/** How long the fox can see post-mission results. */
export const MISSION_RESULT_DISPLAY_MS = 8_000;
/** Global blackout duration when human mission 1st place spends their charge (K). */
export const DARKNESS_DURATION_MS = 3_000;
/** How long everyone sees the fox mission-buff announce banner. */
export const FOX_MISSION_BUFF_DISPLAY_MS = 8_000;
/** Seeker speed + per failed human rabbit on a mission. */
export const FOX_SPEED_BONUS_PER_FAILED_HUMAN = 15;
/** Soft cap on cumulative fox speed bonus from missions. */
export const FOX_SPEED_BONUS_MAX = 90;

export function emptyMissionState(): {
  mission: ActiveMission | null;
  missionResult: MissionResult | null;
  /** -1 not armed; null no more; >=0 countdown to next grant */
  missionNextMs: number | null;
  missionGrantCount: number;
  lastVisitPoint: { x: number; y: number } | null;
  darknessChargeId: string | null;
  darknessRemainingMs: number;
  foxSpeedBonus: number;
  foxMissionBuff: FoxMissionBuffAnnounce | null;
} {
  return {
    mission: null,
    missionResult: null,
    missionNextMs: -1,
    missionGrantCount: 0,
    lastVisitPoint: null,
    darknessChargeId: null,
    darknessRemainingMs: 0,
    foxSpeedBonus: 0,
    foxMissionBuff: null,
  };
}

/** Effective seeker move speed (base + mission fail bonus). */
export function seekerMoveSpeed(state: MatchState): number {
  const bonus = Math.max(0, state.foxSpeedBonus ?? 0);
  return SEEKER_SPEED + bonus;
}

/** Visible key hints (HUD / mission banner). */
export const KEY_HINT_CATCH = '[Space] 잡기';
/** @deprecated Use KEY_HINT_TOUCH_RABBIT */
export const KEY_HINT_TOUCH_FOX = '[T] 유저 토끼 터치';
export const KEY_HINT_TOUCH_RABBIT = '[T] 유저 토끼 터치';
export const KEY_HINT_DARKNESS = '[K] 암흑';

export function missionKindLabel(kind: MissionKind): string {
  return kind === 'touch_rabbit'
    ? `30초 안에 ${KEY_HINT_TOUCH_RABBIT} 하세요`
    : '30초 안에 목표 지점을 지나가세요';
}

/** Compact one-line mission kind for top banner (less screen cover). */
export function missionKindLabelShort(kind: MissionKind): string {
  return kind === 'touch_rabbit' ? KEY_HINT_TOUCH_RABBIT : '목표 지점 통과';
}

/** Top banner title (compact — full sentence was too large on screen). */
export const MISSION_BANNER_TITLE = '돌발 미션';

/** Shared outcome line on top banner (compact). */
export const MISSION_OUTCOME_BANNER_LINE =
  '성공: 스킬 획득 · 실패: 유저 실패 시 여우 강화';

function isFoxViewer(state: MatchState, you: string | undefined): boolean {
  if (!you) return false;
  return state.seekerId === you || state.practiceRole === 'fox';
}

/** Display name for the rabbit holding an unused darkness charge. */
export function darknessChargeHolderName(state: MatchState): string | null {
  const id = state.darknessChargeId;
  if (!id) return null;
  const e = state.entities[id];
  if (!e || e.kind !== 'human') return null;
  return (e.name && e.name.trim()) || id;
}

/**
 * Banner lines for who earned darkness (rabbits only — fox must not see holder).
 */
export function darknessChargeBannerLines(
  state: MatchState,
  you?: string,
): string[] | null {
  if (state.phase !== 'playing') return null;
  if (state.mode !== 'normal' && state.mode !== 'practice') return null;
  if ((state.darknessRemainingMs ?? 0) > 0) return null;
  // Fox only knows mission start/end — never who got the skill
  if (isFoxViewer(state, you)) return null;
  const name = darknessChargeHolderName(state);
  if (!name) return null;
  return [`🌑 ${name} · ${KEY_HINT_DARKNESS} (1회·3초)`];
}

/**
 * Top-center banner lines.
 * - Active mission: kind + timer (everyone).
 * - Rabbits: outcome rules + skill holder (if any).
 * - Fox: start/end only — no skill-holder identity, no mid-mission skill fluff.
 * - After end: result counts for fox; skill holder still hidden from fox.
 */
export function missionBannerLines(
  state: MatchState,
  you?: string,
): string[] | null {
  if (state.phase !== 'playing') return null;
  if (state.mode !== 'normal' && state.mode !== 'practice') return null;

  const isFox = isFoxViewer(state, you);
  const chargeLines = darknessChargeBannerLines(state, you);
  const m = state.mission;
  if (m) {
    const sec = Math.max(0, Math.ceil(m.remainingMs / 1000));
    if (isFox) {
      // Start awareness only (no who-got-skill)
      return [
        `${MISSION_BANNER_TITLE} 발생!`,
        `${missionKindLabelShort(m.kind)} · ${sec}초`,
      ];
    }
    const lines = [
      `${MISSION_BANNER_TITLE} 발생!`,
      m.kind === 'touch_rabbit'
        ? `조작 ${KEY_HINT_TOUCH_RABBIT} · ${sec}초`
        : `목표 지점 통과 · ${sec}초`,
      MISSION_OUTCOME_BANNER_LINE,
    ];
    if (chargeLines) lines.push(...chargeLines);
    return lines;
  }

  const foxBuff = foxMissionBuffBannerLines(state);
  // Charge announce: rabbits only (already filtered). Prefer with fox buff for rabbits.
  if (chargeLines && foxBuff && !isFox) return [...chargeLines, ...foxBuff];
  if (chargeLines) return chargeLines;
  if (foxBuff) return foxBuff;

  const r = state.missionResult;
  if (r && r.remainingMs > 0 && isFox) {
    // End only: counts, not who earned skill
    return [
      `미션 종료 · 성공 ${r.survivedIds.length} · 실패 ${r.failedIds.length}`,
    ];
  }
  return null;
}

/** Top banner: fox gained speed/catch from failed human rabbits (everyone). */
export function foxMissionBuffBannerLines(state: MatchState): string[] | null {
  const b = state.foxMissionBuff;
  if (!b || b.remainingMs <= 0) return null;
  if (state.phase !== 'playing') return null;
  if (b.failedHumanCount <= 0) return null;
  const parts: string[] = [
    `🦊 여우 강화 · 실패 ${b.failedHumanCount}명`,
  ];
  if (b.catchRestored > 0) {
    parts.push(`잡기 +${b.catchRestored} (${b.catchRemaining}/${b.catchMax})`);
  } else {
    parts.push(`잡기 ${b.catchRemaining}/${b.catchMax}`);
  }
  if (b.speedGained > 0) {
    parts.push(`속도 +${b.speedGained}`);
  }
  return [parts.join(' · ')];
}

/**
 * Left-HUD mission lines.
 * - Rabbit: own complete / in-progress only (not others).
 * - Fox during mission: no live completion count (results after end only).
 * - Fox after mission: result summary while missionResult is active.
 */
export function missionHudLines(state: MatchState, you: string): string[] {
  if (state.phase !== 'playing') return [];
  if (state.mode !== 'normal' && state.mode !== 'practice') return [];
  const isFox = isFoxViewer(state, you);
  const m = state.mission;
  const lines: string[] = [];
  if (m) {
    if (isFox) {
      // Start only — no skill-holder, no “성공=스킬” mid-mission
      lines.push('미션 진행 중');
    } else {
      const done = m.completedIds.includes(you);
      if (done) {
        lines.push('미션 성공 · 스킬 획득');
      } else {
        lines.push('미션 중 · 성공=스킬 획득');
        if (m.kind === 'touch_rabbit') {
          lines.push(`조작 ${KEY_HINT_TOUCH_RABBIT}`);
        }
      }
    }
  } else {
    const r = state.missionResult;
    if (r && r.remainingMs > 0 && isFox) {
      lines.push(
        `미션 종료 · 성공 ${r.survivedIds.length}/실패 ${r.failedIds.length}`,
      );
    }
  }
  // Skill charge HUD: holder only (never fox) — key command highly visible
  if (
    !isFox &&
    state.darknessChargeId === you &&
    (state.darknessRemainingMs ?? 0) <= 0
  ) {
    lines.push(`조작 ${KEY_HINT_DARKNESS} (1회·3초)`);
  }
  // Fox speed bonus already on fox objective line; rabbits only need a short hint
  const bonus = state.foxSpeedBonus ?? 0;
  if (bonus > 0 && !isFox) {
    lines.push(`여우 가속 +${bonus}`);
  }
  return lines;
}

/** Living rabbits that must complete the mission (human hiders + AI). */
export function rabbitIds(state: MatchState): string[] {
  return Object.values(state.entities)
    .filter(
      (e) =>
        e.alive &&
        e.id !== state.seekerId &&
        (e.role === 'hider' || e.kind === 'ai'),
    )
    .map((e) => e.id);
}

/** Living human hiders (user rabbits) — excludes fox and AI. */
export function livingHumanRabbitIds(state: MatchState): string[] {
  return rabbitIds(state).filter((id) => state.entities[id]?.kind === 'human');
}

export function canGrantAnotherMission(state: MatchState): boolean {
  return state.timeRemainingMs >= MISSION_MIN_REMAINING_TO_GRANT_MS;
}

/**
 * Pick mission type.
 * - No seeker (practice rabbit): visit_point only.
 * - touch_rabbit only when ≥2 living user rabbits; otherwise visit_point.
 * - With ≥2 user rabbits: fair 50/50 with visit_point.
 */
export function pickMissionKind(
  rng: () => number,
  opts?: { hasSeeker?: boolean; livingHumanRabbits?: number },
): MissionKind {
  // No fox (practice rabbit mode) → only visit_point is completable
  if (opts?.hasSeeker === false) return 'visit_point';
  const humans = opts?.livingHumanRabbits ?? 0;
  // Need two user rabbits to touch each other
  if (humans < 2) return 'visit_point';
  return pickRandom(['touch_rabbit', 'visit_point'] as const, rng);
}

/** Min distance from previous visit target when re-rolling. */
export const VISIT_POINT_MIN_SEPARATION = 320;

/**
 * Pick a random visit_point on the map.
 * - Divides the playable area into a grid and picks a random cell first so
 *   points spread across the meadow instead of clustering.
 * - Optionally avoids a previous point (and retries if too close).
 */
export function pickVisitPoint(
  rng: () => number,
  mapW = MAP_WIDTH,
  mapH = MAP_HEIGHT,
  opts?: {
    avoid?: { x: number; y: number } | null;
    minSeparation?: number;
  },
): { x: number; y: number } {
  const margin = 100;
  const usableW = Math.max(1, mapW - margin * 2);
  const usableH = Math.max(1, mapH - margin * 2);
  // 4×3 zones → 12 regions covering the map
  const cols = 4;
  const rows = 3;
  const cellW = usableW / cols;
  const cellH = usableH / rows;
  const minSep = opts?.minSeparation ?? VISIT_POINT_MIN_SEPARATION;
  const avoid = opts?.avoid ?? null;

  const zoneOrder: number[] = [];
  for (let i = 0; i < cols * rows; i++) zoneOrder.push(i);
  // Fisher–Yates shuffle zones so each grant samples different regions first
  for (let i = zoneOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = zoneOrder[i]!;
    zoneOrder[i] = zoneOrder[j]!;
    zoneOrder[j] = t;
  }

  const sampleInZone = (zoneIdx: number): { x: number; y: number } => {
    const cx = zoneIdx % cols;
    const cy = Math.floor(zoneIdx / cols);
    // Keep a small pad inside each cell so markers don't sit on grid lines only
    const pad = 0.12;
    const lx = pad + rng() * (1 - pad * 2);
    const ly = pad + rng() * (1 - pad * 2);
    return {
      x: margin + cx * cellW + lx * cellW,
      y: margin + cy * cellH + ly * cellH,
    };
  };

  // Prefer zones far from the previous point when possible
  let best: { x: number; y: number } | null = null;
  let bestDist = -1;
  for (const zi of zoneOrder) {
    const p = sampleInZone(zi);
    if (!avoid) return p;
    const d = Math.hypot(p.x - avoid.x, p.y - avoid.y);
    if (d >= minSep) return p;
    if (d > bestDist) {
      bestDist = d;
      best = p;
    }
  }
  // Fallback: farthest sample if map is small / avoid dominates
  return best ?? sampleInZone(zoneOrder[0]!);
}

/**
 * Pick 1–3 living AI rabbits that will not pursue this mission (count as fail).
 *
 * Intentional skippers only when enough AI remain after the skips relative to
 * living human rabbits: remaining AI ≥ humanRabbits × 2. If that floor cannot
 * be kept, return [] (no deliberate sit-outs). Mission fail no longer kills —
 * human fails buff the fox instead (see failIncompleteRabbits).
 */
export function pickMissionSkipAiIds(
  state: MatchState,
  rng: () => number,
): string[] {
  const rabbits = rabbitIds(state);
  const ais = rabbits.filter((id) => state.entities[id]?.kind === 'ai');
  if (ais.length === 0) return [];

  const humanRabbitCount = rabbits.filter(
    (id) => state.entities[id]?.kind === 'human',
  ).length;
  const minKeep = humanRabbitCount * 2;
  const maxSkip = Math.min(3, ais.length - minKeep);
  if (maxSkip <= 0) return [];

  const want = 1 + Math.floor(rng() * maxSkip); // 1..maxSkip
  // Fisher–Yates partial shuffle
  const pool = [...ais];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = t;
  }
  return pool.slice(0, want);
}

/** 32-bit avalanche mix so nearby ticks/grants don't map to the same first RNG draw. */
export function mix32(n: number): number {
  let x = n >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Mix grant seed so consecutive missions / rematches don't reuse the same stream. */
export function missionGrantRngSeed(state: MatchState, seed = 1): number {
  const grant = state.missionGrantCount ?? 0;
  const meadow = state.meadowSeed ?? 0;
  // XOR + avalanche: linear sum of primes made first-grant kinds sticky in practice
  return mix32(
    mix32(seed >>> 0) ^
      mix32(state.tick) ^
      mix32(grant * 0x9e3779b9) ^
      mix32(meadow >>> 0) ^
      mix32(state.timeRemainingMs ?? 0) ^
      mix32((state.humans?.length ?? 0) + (state.seekerId ? 17 : 0)),
  );
}

/**
 * Grant a sudden mission. When `seed` is omitted (live host ticks), wall-clock
 * entropy is mixed in so matches are not stuck in a fixed kind order.
 * Tests pass an explicit seed for determinism.
 */
export function grantMission(state: MatchState, seed?: number): MatchState {
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  const liveSalt =
    seed === undefined
      ? (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
      : 0;
  const base = seed === undefined ? 1 : seed;
  const rng = createRng(missionGrantRngSeed(state, mix32(base ^ liveSalt)));
  // Warm the stream so the first mission-kind draw is not seed-correlated
  rng();
  rng();
  const hasSeeker = state.seekerId != null && state.entities[state.seekerId] != null;
  const livingHumanRabbits = livingHumanRabbitIds(state).length;
  const kind = pickMissionKind(rng, { hasSeeker, livingHumanRabbits });
  const pt = pickVisitPoint(rng, state.config.mapWidth, state.config.mapHeight, {
    avoid: state.lastVisitPoint ?? null,
    minSeparation: VISIT_POINT_MIN_SEPARATION,
  });
  const skipIds = pickMissionSkipAiIds(state, rng);
  const mission: ActiveMission = {
    kind,
    remainingMs: MISSION_DURATION_MS,
    targetX: pt.x,
    targetY: pt.y,
    completedIds: [],
    skipIds,
  };
  return {
    ...state,
    mission,
    missionResult: null, // clear previous result when a new mission starts
    missionNextMs: null, // idle until mission ends
    missionGrantCount: (state.missionGrantCount ?? 0) + 1,
    // Remember visit targets so the next visit_point is elsewhere
    lastVisitPoint:
      kind === 'visit_point' ? { x: pt.x, y: pt.y } : (state.lastVisitPoint ?? null),
  };
}

/**
 * End active mission: incomplete rabbits stay alive (no mission death).
 * Result lists count *user rabbits only* (AI never in survived/failed UI counts).
 * Failed *human* rabbits still grant fox catch restore + speed (capped).
 */
export function failIncompleteRabbits(state: MatchState): MatchState {
  const m = state.mission;
  if (!m) return state;
  const completed = new Set(m.completedIds);
  const survivedIds: string[] = [];
  const failedIds: string[] = [];
  // Only living user rabbits (hiders) appear in success/fail counts
  for (const id of livingHumanRabbitIds(state)) {
    const e = state.entities[id];
    if (!e || !e.alive) continue;
    if (completed.has(id)) {
      survivedIds.push(id);
    } else {
      failedIds.push(id);
    }
  }
  const failedHumanCount = failedIds.length;

  const missionResult: MissionResult = {
    kind: m.kind,
    survivedIds,
    failedIds,
    remainingMs: MISSION_RESULT_DISPLAY_MS,
  };

  // Fox buff from failed *user* rabbits: restore catch (capped) + speed stack
  let catchBudgetRemaining = state.catchBudgetRemaining;
  let foxSpeedBonus = state.foxSpeedBonus ?? 0;
  let foxMissionBuff: FoxMissionBuffAnnounce | null = state.foxMissionBuff ?? null;
  if (failedHumanCount > 0 && state.mode === 'normal') {
    const catchMax = Math.max(0, state.config.catchBudget);
    const room = Math.max(0, catchMax - catchBudgetRemaining);
    const catchRestored = Math.min(failedHumanCount, room);
    catchBudgetRemaining = Math.min(
      catchMax,
      catchBudgetRemaining + catchRestored,
    );
    const prevBonus = foxSpeedBonus;
    const rawGain = failedHumanCount * FOX_SPEED_BONUS_PER_FAILED_HUMAN;
    foxSpeedBonus = Math.min(FOX_SPEED_BONUS_MAX, prevBonus + rawGain);
    const speedGained = foxSpeedBonus - prevBonus;
    foxMissionBuff = {
      failedHumanCount,
      catchRestored,
      speedGained,
      speedBonusTotal: foxSpeedBonus,
      catchRemaining: catchBudgetRemaining,
      catchMax,
      remainingMs: FOX_MISSION_BUFF_DISPLAY_MS,
    };
  }

  let next: MatchState = {
    ...state,
    mission: null,
    missionResult,
    catchBudgetRemaining,
    foxSpeedBonus,
    foxMissionBuff,
  };
  // Schedule next grant: practice always loops; normal needs remaining ≥ 60s
  if (state.mode === 'practice' || canGrantAnotherMission(next)) {
    next = { ...next, missionNextMs: MISSION_COOLDOWN_MS };
  } else {
    next = { ...next, missionNextMs: null };
  }
  return next;
}

export function markMissionComplete(
  state: MatchState,
  rabbitId: string,
): MatchState {
  const m = state.mission;
  if (!m) return state;
  if (m.completedIds.includes(rabbitId)) return state;
  // Skippers never complete (they sit out and count as fail on timeout)
  if ((m.skipIds ?? []).includes(rabbitId)) return state;
  const e = state.entities[rabbitId];
  if (!e || !e.alive || rabbitId === state.seekerId) return state;
  // Only the first *human* rabbit to finish earns darkness (AI never).
  const humanAlreadyDone = m.completedIds.some(
    (id) => state.entities[id]?.kind === 'human',
  );
  const earnsDarkness = e.kind === 'human' && !humanAlreadyDone;
  return {
    ...state,
    mission: {
      ...m,
      completedIds: [...m.completedIds, rabbitId],
    },
    darknessChargeId: earnsDarkness ? rabbitId : state.darknessChargeId,
  };
}

/**
 * Spend darkness charge: black out every client's screen for DARKNESS_DURATION_MS.
 * Only the human charge holder (first user rabbit this mission) may activate.
 */
export function applyDarknessSkill(
  state: MatchState,
  playerId: string,
): MatchState {
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  if (state.darknessChargeId !== playerId) return state;
  if ((state.darknessRemainingMs ?? 0) > 0) return state;
  const e = state.entities[playerId];
  if (!e || !e.alive || e.kind !== 'human') return state;
  if (playerId === state.seekerId) return state;
  return {
    ...state,
    darknessChargeId: null,
    darknessRemainingMs: DARKNESS_DURATION_MS,
  };
}

/** Countdown active blackout. Call from tickTimer while playing. */
export function tickDarkness(state: MatchState, dtMs: number): MatchState {
  const rem = state.darknessRemainingMs ?? 0;
  if (rem <= 0) return state;
  return {
    ...state,
    darknessRemainingMs: Math.max(0, rem - dtMs),
  };
}

/**
 * Rabbit T / mission_action: complete touch_rabbit when near another living user rabbit.
 * First human to complete still earns darkness via markMissionComplete.
 */
export function attemptMissionTouch(
  state: MatchState,
  rabbitId: string,
): MatchState {
  const m = state.mission;
  if (!m || m.kind !== 'touch_rabbit') return state;
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  const rabbit = state.entities[rabbitId];
  if (!rabbit || !rabbit.alive) return state;
  if (rabbitId === state.seekerId) return state;
  // Only user rabbits may press T to complete
  if (rabbit.kind !== 'human') return state;
  const partnerNear = livingHumanRabbitIds(state).some((otherId) => {
    if (otherId === rabbitId) return false;
    const other = state.entities[otherId];
    if (!other?.alive) return false;
    return Math.hypot(rabbit.x - other.x, rabbit.y - other.y) <= MISSION_TOUCH_RANGE;
  });
  if (!partnerNear) return state;
  return markMissionComplete(state, rabbitId);
}

/** Auto-complete visit_point on proximity (touch_rabbit is T-only for humans). */
export function checkMissionProximityCompletions(state: MatchState): MatchState {
  const m = state.mission;
  if (!m || state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  if (m.kind !== 'visit_point') return state;
  let next = state;
  const skip = new Set(m.skipIds ?? []);
  for (const id of rabbitIds(state)) {
    if (skip.has(id)) continue;
    if (m.completedIds.includes(id) || next.mission!.completedIds.includes(id)) {
      continue;
    }
    const e = next.entities[id];
    if (!e || !e.alive) continue;
    const d = Math.hypot(e.x - m.targetX, e.y - m.targetY);
    if (d <= MISSION_VISIT_RADIUS) {
      next = markMissionComplete(next, id);
    }
  }
  return next;
}

/**
 * Advance mission timers. Call from tickTimer only while hunt timer is running
 * (post-prep, normal playing).
 *
 * missionNextMs semantics:
 * - `-1`: not armed yet → arm to FIRST_DELAY on first call
 * - `null`: no more missions this match
 * - `>= 0`: countdown to next grant
 */
export function tickMission(state: MatchState, dtMs: number): MatchState {
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;

  let next = state;

  // Active mission countdown
  if (next.mission) {
    const left = Math.max(0, next.mission.remainingMs - dtMs);
    if (left <= 0) {
      return failIncompleteRabbits({
        ...next,
        mission: { ...next.mission, remainingMs: 0 },
      });
    }
    next = {
      ...next,
      mission: { ...next.mission, remainingMs: left },
    };
    return checkMissionProximityCompletions(next);
  }

  // Fox result + fox buff announce countdowns (only while no active mission)
  if (next.missionResult && next.missionResult.remainingMs > 0) {
    const rLeft = Math.max(0, next.missionResult.remainingMs - dtMs);
    next =
      rLeft <= 0
        ? { ...next, missionResult: null }
        : {
            ...next,
            missionResult: { ...next.missionResult, remainingMs: rLeft },
          };
  }
  if (next.foxMissionBuff && next.foxMissionBuff.remainingMs > 0) {
    const bLeft = Math.max(0, next.foxMissionBuff.remainingMs - dtMs);
    next =
      bLeft <= 0
        ? { ...next, foxMissionBuff: null }
        : {
            ...next,
            foxMissionBuff: { ...next.foxMissionBuff, remainingMs: bLeft },
          };
  }

  // Idle: arm or countdown to next grant
  let delay = next.missionNextMs;
  if (delay === -1) {
    // First arm when hunt clock is running
    delay = MISSION_FIRST_DELAY_MS;
    next = { ...next, missionNextMs: delay };
  }
  if (delay == null) return next;

  const left = Math.max(0, delay - dtMs);
  if (left > 0) {
    return { ...next, missionNextMs: left };
  }
  // Countdown finished.
  // First grant (missionGrantCount === 0) always fires even if rem < 60s.
  // Subsequent cooldown: normal mode re-checks remaining; practice always loops.
  const grants = next.missionGrantCount ?? 0;
  if (
    grants > 0 &&
    next.mode === 'normal' &&
    !canGrantAnotherMission(next)
  ) {
    return { ...next, missionNextMs: null };
  }
  return grantMission({ ...next, missionNextMs: 0 });
}
