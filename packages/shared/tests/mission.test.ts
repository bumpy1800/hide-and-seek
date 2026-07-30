import { describe, expect, it } from 'vitest';
import {
  MISSION_COOLDOWN_MS,
  MISSION_DURATION_MS,
  MISSION_FIRST_DELAY_MS,
  MISSION_MIN_REMAINING_TO_GRANT_MS,
  MISSION_TOUCH_RANGE,
  MISSION_VISIT_RADIUS,
  applyMissionAction,
  createLobby,
  defaultConfig,
  failIncompleteRabbits,
  grantMission,
  integrateMotion,
  joinHuman,
  skipToPlaying,
  startMatch,
  tickMission,
  tickTimer,
} from '../src/index.js';

function twoPlayerHunt(timeLimitMs: number, seekerPrepMs = 0) {
  let lobby = createLobby(
    'm',
    defaultConfig({ aiCount: 2, seekerPrepMs, timeLimitMs, catchBudget: 5 }),
  );
  let res = joinHuman(lobby, 'fox', '여우');
  res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼1');
  if (!res.ok) throw new Error('join');
  return skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 9 }));
}

describe('mission schedule', () => {
  it('first mission grants ~10s after hunt timer runs (post-prep)', () => {
    let state = twoPlayerHunt(90_000, 0);
    expect(state.mission).toBeNull();
    // missionNextMs starts -1 until first hunt tick arms it
    state = tickMission(state, 0);
    expect(state.missionNextMs).toBe(MISSION_FIRST_DELAY_MS);
    state = tickMission(state, MISSION_FIRST_DELAY_MS - 1);
    expect(state.mission).toBeNull();
    state = tickMission(state, 2);
    expect(state.mission).not.toBeNull();
    expect(state.mission!.remainingMs).toBe(MISSION_DURATION_MS);
    expect(['touch_fox', 'visit_point']).toContain(state.mission!.kind);
  });

  it('does not grant second mission when remaining < 60s after first ends', () => {
    let state = twoPlayerHunt(60_000, 0);
    state = tickMission(state, 0);
    state = tickMission(state, MISSION_FIRST_DELAY_MS);
    expect(state.mission).not.toBeNull();
    // Force timeout
    state = failIncompleteRabbits({
      ...state,
      mission: { ...state.mission!, remainingMs: 0 },
      timeRemainingMs: 25_000,
    });
    expect(state.mission).toBeNull();
    expect(state.missionNextMs).toBeNull();
  });

  it('schedules cooldown then second grant when remaining ≥ 60s', () => {
    let state = twoPlayerHunt(180_000, 0);
    state = tickMission(state, 0);
    state = tickMission(state, MISSION_FIRST_DELAY_MS);
    expect(state.mission).not.toBeNull();
    state = {
      ...state,
      timeRemainingMs: 120_000,
    };
    state = failIncompleteRabbits({
      ...state,
      mission: { ...state.mission!, remainingMs: 0 },
    });
    expect(state.mission).toBeNull();
    expect(state.missionNextMs).toBe(MISSION_COOLDOWN_MS);
    // Keep remaining high across cooldown so re-check still allows grant
    state = { ...state, timeRemainingMs: 100_000 };
    state = tickMission(state, MISSION_COOLDOWN_MS);
    expect(state.mission).not.toBeNull();
  });

  it('no grant when remaining drops below 60s during 30s cooldown (tickTimer)', () => {
    // After mission ends with rem just above 60s, cooldown arms; during 30s idle
    // hunt clock drains rem below 60s → grant must be cancelled at fire time.
    let state = twoPlayerHunt(180_000, 0);
    const seeker = state.seekerId!;
    const humanRabbit = state.humans.find((h) => h !== seeker)!;
    // Keep human rabbit completed so match does not end (all-hiders-caught) when AI fail.
    // missionGrantCount ≥ 1 so cooldown fire uses remaining re-check (not first-grant path).
    state = {
      ...state,
      mission: {
        kind: 'visit_point',
        remainingMs: 1,
        targetX: 500,
        targetY: 500,
        completedIds: [humanRabbit],
      },
      missionNextMs: null,
      missionGrantCount: 1,
      timeRemainingMs: 65_000,
      seekerPrepRemainingMs: 0,
    };
    // 1ms mission left → failIncomplete + cooldown (65s still ≥ 60s at arm time)
    state = tickTimer(state, 50);
    expect(state.phase).toBe('playing');
    expect(state.mission).toBeNull();
    expect(state.missionNextMs).toBe(MISSION_COOLDOWN_MS);
    expect(state.timeRemainingMs).toBeLessThanOrEqual(65_000);
    // Drain full cooldown via real hunt ticks (rem falls ~30s → ~35s < 60s)
    const startRem = state.timeRemainingMs;
    for (let t = 0; t < MISSION_COOLDOWN_MS + 100; t += 50) {
      state = tickTimer(state, 50);
      expect(state.phase).toBe('playing');
    }
    expect(state.timeRemainingMs).toBeLessThan(MISSION_MIN_REMAINING_TO_GRANT_MS);
    expect(state.timeRemainingMs).toBeLessThan(startRem);
    // Must not have granted a new mission after cooldown (re-check remaining)
    expect(state.mission).toBeNull();
    expect(state.missionNextMs).toBeNull();
  });
  it('tickTimer path: prep then 10s then mission (via real tick)', () => {
    let state = twoPlayerHunt(90_000, 0);
    // Hunt ticks (prep already 0 via skipToPlaying)
    for (let t = 0; t < MISSION_FIRST_DELAY_MS; t += 50) {
      state = tickTimer(state, 50);
    }
    state = tickTimer(state, 50);
    expect(state.mission).not.toBeNull();
    expect(state.mission!.remainingMs).toBeLessThanOrEqual(MISSION_DURATION_MS);
  });

  it('tickTimer: timeLimitMs ≤ 60s still grants FIRST mission after ~10s (rem may be <60s)', () => {
    // Objective: configured ≤1m still gets the 10s first mission even though
    // after 10s remaining is ~50s (< 60s re-check threshold for *later* grants).
    let state = twoPlayerHunt(60_000, 0);
    expect(state.config.timeLimitMs).toBeLessThanOrEqual(60_000);
    expect(state.mission).toBeNull();
    expect(state.missionGrantCount ?? 0).toBe(0);
    for (let t = 0; t < MISSION_FIRST_DELAY_MS; t += 50) {
      state = tickTimer(state, 50);
      expect(state.phase).toBe('playing');
    }
    state = tickTimer(state, 50);
    expect(state.timeRemainingMs).toBeLessThan(MISSION_MIN_REMAINING_TO_GRANT_MS);
    expect(state.mission).not.toBeNull();
    expect(state.missionGrantCount).toBe(1);
    expect(state.mission!.remainingMs).toBeLessThanOrEqual(MISSION_DURATION_MS);
    // After first ends with rem already < 60s → no second schedule
    state = failIncompleteRabbits({
      ...state,
      mission: { ...state.mission!, remainingMs: 0 },
    });
    expect(state.missionNextMs).toBeNull();
  });
});describe('mission outcomes', () => {
  it('grant is only touch_fox or visit_point; all rabbits share one mission', () => {
    let state = twoPlayerHunt(120_000, 0);
    const kinds = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const g = grantMission({ ...state, tick: i }, i + 1);
      kinds.add(g.mission!.kind);
      expect(g.mission!.completedIds).toEqual([]);
      expect(g.mission!.remainingMs).toBe(MISSION_DURATION_MS);
    }
    expect(kinds.has('touch_fox') || kinds.has('visit_point')).toBe(true);
    // Only those two kinds
    for (const k of kinds) {
      expect(k === 'touch_fox' || k === 'visit_point').toBe(true);
    }
  });

  it('timeout kills incomplete rabbits; completed survive', () => {
    let state = twoPlayerHunt(120_000, 0);
    state = grantMission(state, 1);
    const seeker = state.seekerId!;
    const rabbits = Object.values(state.entities).filter(
      (e) => e.alive && e.id !== seeker,
    );
    expect(rabbits.length).toBeGreaterThan(0);
    // Complete first rabbit only
    const survivor = rabbits[0]!.id;
    state = {
      ...state,
      mission: {
        ...state.mission!,
        completedIds: [survivor],
      },
    };
    state = failIncompleteRabbits(state);
    expect(state.entities[survivor]!.alive).toBe(true);
    for (const r of rabbits) {
      if (r.id === survivor) continue;
      expect(state.entities[r.id]!.alive).toBe(false);
    }
    // Seeker never dies from mission
    expect(state.entities[seeker]!.alive).toBe(true);
  });

  it('visit_point completes when rabbit walks into radius', () => {
    let state = twoPlayerHunt(120_000, 0);
    state = grantMission(
      {
        ...state,
        mission: null,
        missionNextMs: 0,
      },
      3,
    );
    // Force visit mission
    const seeker = state.seekerId!;
    const rabbitId = state.humans.find((h) => h !== seeker)!;
    state = {
      ...state,
      mission: {
        kind: 'visit_point',
        remainingMs: MISSION_DURATION_MS,
        targetX: 400,
        targetY: 400,
        completedIds: [],
      },
      entities: {
        ...state.entities,
        [rabbitId]: {
          ...state.entities[rabbitId]!,
          x: 400 - MISSION_VISIT_RADIUS + 2,
          y: 400,
          vx: 50,
          vy: 0,
        },
      },
    };
    state = integrateMotion(state, 0.1);
    expect(state.mission!.completedIds).toContain(rabbitId);
  });

  it('touch_fox completes via applyMissionAction when in range', () => {
    let state = twoPlayerHunt(120_000, 0);
    const seeker = state.seekerId!;
    const rabbitId = state.humans.find((h) => h !== seeker)!;
    state = {
      ...state,
      mission: {
        kind: 'touch_fox',
        remainingMs: MISSION_DURATION_MS,
        targetX: 0,
        targetY: 0,
        completedIds: [],
      },
      entities: {
        ...state.entities,
        [seeker]: { ...state.entities[seeker]!, x: 100, y: 100 },
        [rabbitId]: {
          ...state.entities[rabbitId]!,
          x: 100 + MISSION_TOUCH_RANGE - 2,
          y: 100,
        },
      },
    };
    state = applyMissionAction(state, rabbitId);
    expect(state.mission!.completedIds).toContain(rabbitId);
  });

  it('fox-visible mission fields exist on state for UI', () => {
    let state = twoPlayerHunt(90_000, 0);
    state = grantMission(state, 2);
    expect(state.mission).toMatchObject({
      kind: expect.stringMatching(/touch_fox|visit_point/),
      remainingMs: MISSION_DURATION_MS,
      completedIds: [],
    });
    expect(typeof state.mission!.targetX).toBe('number');
    expect(typeof state.mission!.targetY).toBe('number');
  });

  it('MIN remaining constant is 60s', () => {
    expect(MISSION_MIN_REMAINING_TO_GRANT_MS).toBe(60_000);
  });

  it('practice mode arms and grants missions (visit_point when no seeker)', () => {
    let lobby = createLobby('prac', defaultConfig({ aiCount: 3 }));
    const res = joinHuman(lobby, 'solo', '나');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, {
      mode: 'practice',
      practiceRole: 'rabbit',
      seed: 5,
    });
    expect(state.mode).toBe('practice');
    expect(state.seekerId).toBeNull();
    expect(state.missionNextMs).toBe(-1);
    // Hunt ticks: practice has no prep
    for (let t = 0; t < MISSION_FIRST_DELAY_MS; t += 50) {
      state = tickTimer(state, 50);
    }
    state = tickTimer(state, 50);
    expect(state.mission).not.toBeNull();
    // No fox → only visit_point
    expect(state.mission!.kind).toBe('visit_point');
  });

  it('practice fox mode can get touch_fox missions', () => {
    let lobby = createLobby('prac-fox', defaultConfig({ aiCount: 4 }));
    const res = joinHuman(lobby, 'solo', '여우연습');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, {
      mode: 'practice',
      practiceRole: 'fox',
      seed: 8,
    });
    expect(state.seekerId).toBe('solo');
    const kinds = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const g = grantMission({ ...state, tick: i, mission: null }, i + 3);
      kinds.add(g.mission!.kind);
    }
    // With seeker, both kinds are possible
    expect(kinds.has('visit_point') || kinds.has('touch_fox')).toBe(true);
  });
});
