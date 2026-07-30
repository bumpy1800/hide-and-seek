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
import type { ActiveMission, CaughtHuman, MatchState, MissionKind } from './types.js';
import {
  CATCH_RANGE,
  MAP_HEIGHT,
  MAP_WIDTH,
} from './types.js';
import { createRng } from './rng.js';

export const MISSION_FIRST_DELAY_MS = 10_000;
export const MISSION_DURATION_MS = 30_000;
export const MISSION_COOLDOWN_MS = 30_000;
/** Remaining hunt time must be at least this to schedule another mission. */
export const MISSION_MIN_REMAINING_TO_GRANT_MS = 60_000;
export const MISSION_VISIT_RADIUS = 56;
/** Touch fox uses same range as catch for fairness. */
export const MISSION_TOUCH_RANGE = CATCH_RANGE;

export function emptyMissionState(): {
  mission: ActiveMission | null;
  /** -1 not armed; null no more; >=0 countdown to next grant */
  missionNextMs: number | null;
  missionGrantCount: number;
} {
  return { mission: null, missionNextMs: -1, missionGrantCount: 0 };
}

export function missionKindLabel(kind: MissionKind): string {
  return kind === 'touch_fox'
    ? '30초 안에 여우를 터치(Space)하세요'
    : '30초 안에 목표 지점을 지나가세요';
}

/** Top-center banner title (shared fox + rabbits). */
export const MISSION_BANNER_TITLE = '돌발 미션 발생!! 토끼들은 미션을 수행해주세요';

/** Top-center banner lines for active mission (pure helper for tests + UI). */
export function missionBannerLines(state: MatchState): string[] | null {
  const m = state.mission;
  if (!m || state.phase !== 'playing') return null;
  if (state.mode !== 'normal' && state.mode !== 'practice') return null;
  const sec = Math.max(0, Math.ceil(m.remainingMs / 1000));
  return [
    MISSION_BANNER_TITLE,
    `현재 미션: ${missionKindLabel(m.kind)} (${sec}초)`,
  ];
}

export function missionHudLines(state: MatchState, you: string): string[] {
  const m = state.mission;
  if (!m || state.phase !== 'playing') return [];
  if (state.mode !== 'normal' && state.mode !== 'practice') return [];
  // Compact left-HUD complement; primary alert is top-center banner
  const isFox = state.seekerId === you || state.practiceRole === 'fox';
  const lines: string[] = [];
  if (!isFox) {
    const done = m.completedIds.includes(you);
    lines.push(done ? '미션  완료' : '미션  진행 중 · 실패 시 즉사');
  } else {
    const rabbits = rabbitIds(state);
    const done = rabbits.filter((id) => m.completedIds.includes(id)).length;
    lines.push(`미션 완료  ${done}/${rabbits.length}`);
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

export function canGrantAnotherMission(state: MatchState): boolean {
  return state.timeRemainingMs >= MISSION_MIN_REMAINING_TO_GRANT_MS;
}

export function pickMissionKind(
  rng: () => number,
  opts?: { hasSeeker?: boolean },
): MissionKind {
  // No fox (practice rabbit mode) → only visit_point is completable
  if (opts?.hasSeeker === false) return 'visit_point';
  return rng() < 0.5 ? 'touch_fox' : 'visit_point';
}

export function pickVisitPoint(
  rng: () => number,
  mapW = MAP_WIDTH,
  mapH = MAP_HEIGHT,
): { x: number; y: number } {
  const margin = 120;
  return {
    x: margin + rng() * (mapW - margin * 2),
    y: margin + rng() * (mapH - margin * 2),
  };
}

export function grantMission(state: MatchState, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  const rng = createRng(seed + state.tick * 17);
  const hasSeeker = state.seekerId != null && state.entities[state.seekerId] != null;
  const kind = pickMissionKind(rng, { hasSeeker });
  const pt = pickVisitPoint(rng, state.config.mapWidth, state.config.mapHeight);
  const mission: ActiveMission = {
    kind,
    remainingMs: MISSION_DURATION_MS,
    targetX: pt.x,
    targetY: pt.y,
    completedIds: [],
  };
  return {
    ...state,
    mission,
    missionNextMs: null, // idle until mission ends
    missionGrantCount: (state.missionGrantCount ?? 0) + 1,
  };
}

/** Kill every alive rabbit that has not completed the active mission. */
export function failIncompleteRabbits(state: MatchState): MatchState {
  const m = state.mission;
  if (!m) return state;
  const completed = new Set(m.completedIds);
  const entities = { ...state.entities };
  const prevCaught: CaughtHuman[] = Array.isArray(state.caughtHumans)
    ? state.caughtHumans.map((c) => ({ id: c.id, name: c.name }))
    : [];
  let caughtHumans = prevCaught;
  for (const id of rabbitIds(state)) {
    if (completed.has(id)) continue;
    const e = entities[id];
    if (!e || !e.alive) continue;
    entities[id] = { ...e, alive: false, vx: 0, vy: 0 };
    if (e.kind === 'human') {
      caughtHumans = [...caughtHumans, { id, name: e.name || id }];
    }
  }
  // Practice: revive human rabbits after fail so solo testing can continue
  if (state.mode === 'practice') {
    for (const id of state.humans) {
      if (id === state.seekerId) continue;
      const e = entities[id];
      if (!e || e.alive) continue;
      entities[id] = {
        ...e,
        alive: true,
        vx: 0,
        vy: 0,
        x: 80 + ((id.length * 97) % Math.max(1, state.config.mapWidth - 160)),
        y: 80 + ((id.length * 53) % Math.max(1, state.config.mapHeight - 160)),
      };
    }
  }

  let next: MatchState = {
    ...state,
    entities,
    caughtHumans,
    mission: null,
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
  const e = state.entities[rabbitId];
  if (!e || !e.alive || rabbitId === state.seekerId) return state;
  return {
    ...state,
    mission: {
      ...m,
      completedIds: [...m.completedIds, rabbitId],
    },
  };
}

/**
 * Rabbit Space / mission_action: complete touch_fox if in range of seeker.
 */
export function attemptMissionTouch(
  state: MatchState,
  rabbitId: string,
): MatchState {
  const m = state.mission;
  if (!m || m.kind !== 'touch_fox') return state;
  if (state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  const rabbit = state.entities[rabbitId];
  const seekerId = state.seekerId;
  if (!rabbit || !rabbit.alive || !seekerId) return state;
  if (rabbitId === seekerId) return state;
  const seeker = state.entities[seekerId];
  if (!seeker) return state;
  const d = Math.hypot(rabbit.x - seeker.x, rabbit.y - seeker.y);
  if (d > MISSION_TOUCH_RANGE) return state;
  return markMissionComplete(state, rabbitId);
}

/** Auto-complete visit_point (and AI touch when adjacent). */
export function checkMissionProximityCompletions(state: MatchState): MatchState {
  const m = state.mission;
  if (!m || state.phase !== 'playing') return state;
  if (state.mode !== 'normal' && state.mode !== 'practice') return state;
  let next = state;
  const seeker = state.seekerId ? state.entities[state.seekerId] : null;
  for (const id of rabbitIds(state)) {
    if (m.completedIds.includes(id) || next.mission!.completedIds.includes(id)) {
      continue;
    }
    const e = next.entities[id];
    if (!e || !e.alive) continue;
    if (m.kind === 'visit_point') {
      const d = Math.hypot(e.x - m.targetX, e.y - m.targetY);
      if (d <= MISSION_VISIT_RADIUS) {
        next = markMissionComplete(next, id);
      }
    } else if (m.kind === 'touch_fox' && e.kind === 'ai' && seeker) {
      // AI auto-touch when in range (humans must press Space)
      const d = Math.hypot(e.x - seeker.x, e.y - seeker.y);
      if (d <= MISSION_TOUCH_RANGE) {
        next = markMissionComplete(next, id);
      }
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
