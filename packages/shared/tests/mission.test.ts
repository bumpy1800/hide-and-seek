import { describe, expect, it } from 'vitest';
import {
  DARKNESS_DURATION_MS,
  FOX_SPEED_BONUS_PER_FAILED_HUMAN,
  MAP_HEIGHT,
  MAP_WIDTH,
  MISSION_COOLDOWN_MS,
  MISSION_DURATION_MS,
  MISSION_FIRST_DELAY_MS,
  MISSION_MIN_REMAINING_TO_GRANT_MS,
  MISSION_TOUCH_RANGE,
  MISSION_VISIT_RADIUS,
  VISIT_POINT_MIN_SEPARATION,
  applyDarknessAction,
  applyMissionAction,
  checkMissionProximityCompletions,
  createLobby,
  createRng,
  darknessChargeBannerLines,
  defaultConfig,
  failIncompleteRabbits,
  foxMissionBuffBannerLines,
  grantMission,
  integrateMotion,
  joinHuman,
  markMissionComplete,
  missionBannerLines,
  missionGrantRngSeed,
  missionHudLines,
  mix32,
  pickMissionKind,
  pickVisitPoint,
  skipToPlaying,
  startMatch,
  tickDarkness,
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
    // one human rabbit → touch_rabbit not eligible
    expect(state.mission!.kind).toBe('visit_point');
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
        skipIds: [],
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
});function threeHumanHunt(timeLimitMs: number, seekerPrepMs = 0) {
  let lobby = createLobby(
    'm3',
    defaultConfig({ aiCount: 4, seekerPrepMs, timeLimitMs, catchBudget: 5 }),
  );
  let res = joinHuman(lobby, 'fox', '여우');
  res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼1');
  res = joinHuman(res.ok ? res.state : lobby, 'r2', '토끼2');
  if (!res.ok) throw new Error('join');
  return skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 11 }));
}

describe('mission outcomes', () => {
  it('with 1 user rabbit only grants visit_point', () => {
    let state = twoPlayerHunt(120_000, 0);
    const kinds = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const g = grantMission({ ...state, tick: i }, i + 1);
      kinds.add(g.mission!.kind);
      expect(g.mission!.completedIds).toEqual([]);
      expect(g.mission!.remainingMs).toBe(MISSION_DURATION_MS);
    }
    expect([...kinds]).toEqual(['visit_point']);
  });

  it('with ≥2 user rabbits grants touch_rabbit or visit_point randomly', () => {
    let touch = 0;
    let visit = 0;
    for (let s = 1; s <= 200; s++) {
      const rng = createRng(mix32(s * 9973));
      rng();
      rng();
      const k = pickMissionKind(rng, { hasSeeker: true, livingHumanRabbits: 2 });
      if (k === 'touch_rabbit') touch++;
      else visit++;
    }
    expect(touch).toBeGreaterThan(40);
    expect(visit).toBeGreaterThan(40);

    // <2 humans → always visit
    for (let s = 1; s <= 40; s++) {
      const rng = createRng(mix32(s * 13));
      expect(pickMissionKind(rng, { hasSeeker: true, livingHumanRabbits: 1 })).toBe(
        'visit_point',
      );
      expect(pickMissionKind(rng, { hasSeeker: true, livingHumanRabbits: 0 })).toBe(
        'visit_point',
      );
    }

    let state = threeHumanHunt(180_000, 0);
    const seq: string[] = [];
    for (let g = 0; g < 24; g++) {
      const granted = grantMission(
        {
          ...state,
          tick: 100 + g * 17,
          missionGrantCount: g,
          mission: null,
          timeRemainingMs: 150_000 - g * 1000,
          meadowSeed: 42,
        },
        g * 31 + 7,
      );
      seq.push(granted.mission!.kind);
    }
    expect(seq).toContain('touch_rabbit');
    expect(seq).toContain('visit_point');
    const pureAlt =
      seq.every((k, i) => k === (i % 2 === 0 ? 'touch_rabbit' : 'visit_point')) ||
      seq.every((k, i) => k === (i % 2 === 0 ? 'visit_point' : 'touch_rabbit'));
    expect(pureAlt).toBe(false);

    expect(missionGrantRngSeed(state, 1)).not.toBe(
      missionGrantRngSeed({ ...state, tick: state.tick + 1 }, 1),
    );
  });

  it('timeout does not kill rabbits; result counts user rabbits only', () => {
    let state = twoPlayerHunt(120_000, 0);
    state = grantMission(state, 1);
    const seeker = state.seekerId!;
    const rabbits = Object.values(state.entities).filter(
      (e) => e.alive && e.id !== seeker,
    );
    expect(rabbits.length).toBeGreaterThan(0);
    const human = rabbits.find((r) => r.kind === 'human')!;
    const ais = rabbits.filter((r) => r.kind === 'ai');
    // Complete the user rabbit only
    const survivor = human.id;
    state = {
      ...state,
      mission: {
        ...state.mission!,
        completedIds: [survivor],
        skipIds: [],
      },
    };
    state = failIncompleteRabbits(state);
    expect(state.missionResult!.survivedIds).toEqual([survivor]);
    expect(state.missionResult!.failedIds).toEqual([]);
    // AI never appear in result counts
    for (const a of ais) {
      expect(state.missionResult!.survivedIds).not.toContain(a.id);
      expect(state.missionResult!.failedIds).not.toContain(a.id);
      expect(state.entities[a.id]!.alive).toBe(true);
    }
    expect(state.entities[survivor]!.alive).toBe(true);
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
        skipIds: [],
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

  it('touch_rabbit completes via T (mission_action) when near another user rabbit', () => {
    let state = threeHumanHunt(120_000, 0);
    const seeker = state.seekerId!;
    const rabbits = state.humans.filter((h) => h !== seeker);
    expect(rabbits.length).toBeGreaterThanOrEqual(2);
    const r1 = rabbits[0]!;
    const r2 = rabbits[1]!;
    state = {
      ...state,
      mission: {
        kind: 'touch_rabbit',
        remainingMs: MISSION_DURATION_MS,
        targetX: 0,
        targetY: 0,
        completedIds: [],
        skipIds: [],
      },
      entities: {
        ...state.entities,
        [r1]: {
          ...state.entities[r1]!,
          x: 200,
          y: 200,
        },
        [r2]: {
          ...state.entities[r2]!,
          x: 200 + MISSION_TOUCH_RANGE - 2,
          y: 200,
        },
      },
      darknessChargeId: null,
    };
    // First presser gets skill
    state = applyMissionAction(state, r1);
    expect(state.mission!.completedIds).toContain(r1);
    expect(state.darknessChargeId).toBe(r1);
    // Partner also completes by pressing T while still near
    state = applyMissionAction(state, r2);
    expect(state.mission!.completedIds).toContain(r2);
    // Skill stays with first human completer
    expect(state.darknessChargeId).toBe(r1);
  });

  it('touch_rabbit does not complete when alone or out of range', () => {
    let state = threeHumanHunt(120_000, 0);
    const seeker = state.seekerId!;
    const rabbits = state.humans.filter((h) => h !== seeker);
    const r1 = rabbits[0]!;
    const r2 = rabbits[1]!;
    state = {
      ...state,
      mission: {
        kind: 'touch_rabbit',
        remainingMs: MISSION_DURATION_MS,
        targetX: 0,
        targetY: 0,
        completedIds: [],
        skipIds: [],
      },
      entities: {
        ...state.entities,
        [r1]: { ...state.entities[r1]!, x: 100, y: 100 },
        [r2]: { ...state.entities[r2]!, x: 100 + MISSION_TOUCH_RANGE + 40, y: 100 },
      },
      darknessChargeId: null,
    };
    state = applyMissionAction(state, r1);
    expect(state.mission!.completedIds).not.toContain(r1);
    expect(state.darknessChargeId).toBeNull();
  });

  it('fox-visible mission fields exist on state for UI', () => {
    let state = twoPlayerHunt(90_000, 0);
    state = grantMission(state, 2);
    expect(state.mission).toMatchObject({
      kind: expect.stringMatching(/touch_rabbit|visit_point/),
      remainingMs: MISSION_DURATION_MS,
      completedIds: [],
    });
    expect(Array.isArray(state.mission!.skipIds)).toBe(true);
    // 1 human rabbit × 2 = keep 2 AI; twoPlayerHunt only has 2 AI → no intentional skips
    expect(state.mission!.skipIds.length).toBe(0);
    expect(typeof state.mission!.targetX).toBe('number');
    expect(typeof state.mission!.targetY).toBe('number');
  });

  it('fox does not see live completion count; result only after mission ends', () => {
    let state = twoPlayerHunt(120_000, 0);
    state = grantMission(state, 4);
    const fox = state.seekerId!;
    const rabbit = state.humans.find((h) => h !== fox)!;
    // Mid-mission: fox HUD has no X/Y progress; rabbit sees own status
    const midFox = missionHudLines(state, fox);
    expect(midFox.join(' ')).not.toMatch(/\d+\/\d+/);
    // Fox: start only — no skill-holder, no mid-mission “스킬 획득” who-info
    expect(midFox.join(' ')).toMatch(/미션 진행/);
    expect(midFox.join(' ')).not.toMatch(/암흑|스킬 획득/);
    expect(missionHudLines(state, rabbit)[0]).toMatch(/스킬 획득/);
    const bannerFox = missionBannerLines(state, fox);
    expect(bannerFox![0]).toContain('돌발 미션');
    expect(bannerFox!.join(' ')).not.toMatch(/암흑|스킬 획득/);
    const bannerRabbit = missionBannerLines(state, rabbit);
    expect(bannerRabbit!.join(' ')).toMatch(/스킬 획득/);
    expect(bannerRabbit!.join(' ')).toMatch(/여우 강화/);

    // Complete the user rabbit only, then timeout
    state = {
      ...state,
      mission: {
        ...state.mission!,
        completedIds: [rabbit],
        skipIds: [],
      },
    };
    state = failIncompleteRabbits(state);
    expect(state.mission).toBeNull();
    expect(state.missionResult).not.toBeNull();
    expect(state.missionResult!.survivedIds).toEqual([rabbit]);
    // Only user rabbits count — AI fails do not inflate the number
    expect(state.missionResult!.failedIds).toEqual([]);

    // Fox sees result; rabbit does not
    const rabbitHud = missionHudLines(state, rabbit);
    expect(rabbitHud.join(' ')).not.toMatch(/결과.*성공|성공 \d/);
    const foxLines = missionHudLines(state, fox);
    expect(foxLines.join(' ')).toMatch(/결과|성공/);
    expect(missionBannerLines(state, fox)).not.toBeNull();
    expect(missionBannerLines(state, fox)![0]).toMatch(/미션 종료|미션 결과/);
    // Rabbit: no fox-only end result banner (skill holder may still show if charged)
    const endRabbit = missionBannerLines(state, rabbit);
    expect(endRabbit?.join(' ') ?? '').not.toMatch(/미션 종료/);
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

  it('each grant picks 1–3 AI skippers who never complete (stay alive on fail)', () => {
    let lobby = createLobby(
      'skip',
      defaultConfig({ aiCount: 10, seekerPrepMs: 0, timeLimitMs: 180_000 }),
    );
    let res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 3 }));
    state = grantMission(state, 9);
    expect(state.mission).not.toBeNull();
    const skip = state.mission!.skipIds ?? [];
    // 1 human rabbit → keep ≥2 AI; 10 AI → maxSkip 3
    expect(skip.length).toBeGreaterThanOrEqual(1);
    expect(skip.length).toBeLessThanOrEqual(3);
    expect(10 - skip.length).toBeGreaterThanOrEqual(2);
    for (const id of skip) {
      expect(state.entities[id]?.kind).toBe('ai');
    }
    // Skippers cannot be marked complete
    const skipId = skip[0]!;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [skipId]: {
          ...state.entities[skipId]!,
          x: state.mission!.targetX,
          y: state.mission!.targetY,
        },
      },
      mission: { ...state.mission!, kind: 'visit_point' },
    };
    state = checkMissionProximityCompletions(state);
    expect(state.mission!.completedIds).not.toContain(skipId);

    state = failIncompleteRabbits({
      ...state,
      mission: { ...state.mission!, remainingMs: 0 },
    });
    // Mission fail no longer kills — AI skippers stay alive and are not in UI counts
    expect(state.entities[skipId]!.alive).toBe(true);
    expect(state.missionResult!.failedIds).not.toContain(skipId);
    // Only living user rabbits (not AI) appear in fail/success counts
    const humanHid = state.humans.filter((h) => h !== state.seekerId);
    expect(state.missionResult!.failedIds).toEqual(humanHid);
    expect(state.missionResult!.survivedIds).toEqual([]);
    for (const id of state.missionResult!.failedIds) {
      expect(state.entities[id]?.kind).toBe('human');
    }
  });

  it('does not pick intentional AI skippers unless remaining AI ≥ humanRabbits×2', () => {
    // 2 human rabbits → minKeep 4. With 4 AI, maxSkip 0.
    let lobby = createLobby(
      'gate-none',
      defaultConfig({ aiCount: 4, seekerPrepMs: 0, timeLimitMs: 180_000 }),
    );
    let res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R1');
    res = joinHuman(res.ok ? res.state : lobby, 'r2', 'R2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 4 }));
    for (let seed = 0; seed < 20; seed++) {
      const g = grantMission({ ...state, tick: seed, mission: null }, seed + 1);
      expect(g.mission!.skipIds).toEqual([]);
    }

    // 5 AI + 2 human rabbits → minKeep 4 → maxSkip 1 → exactly 1 skipper
    lobby = createLobby(
      'gate-one',
      defaultConfig({ aiCount: 5, seekerPrepMs: 0, timeLimitMs: 180_000 }),
    );
    res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R1');
    res = joinHuman(res.ok ? res.state : lobby, 'r2', 'R2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 5 }));
    const g = grantMission(state, 11);
    expect(g.mission!.skipIds).toHaveLength(1);
    expect(state.entities[g.mission!.skipIds[0]!]?.kind).toBe('ai');
  });

  it('first human rabbit completer gets darkness; AI never; banner shows name', () => {
    let state = twoPlayerHunt(120_000, 0);
    state = grantMission(state, 7);
    const fox = state.seekerId!;
    const humanRabbit = state.humans.find((h) => h !== fox)!;
    const aiId = Object.values(state.entities).find(
      (e) => e.kind === 'ai' && e.alive,
    )!.id;
    expect(state.darknessChargeId).toBeNull();

    // AI finishes first — no charge
    state = markMissionComplete(state, aiId);
    expect(state.darknessChargeId).toBeNull();
    expect(darknessChargeBannerLines(state)).toBeNull();

    // First human completer earns charge
    state = markMissionComplete(state, humanRabbit);
    expect(state.darknessChargeId).toBe(humanRabbit);
    const announce = darknessChargeBannerLines(state);
    expect(announce).not.toBeNull();
    expect(announce![0]).toMatch(/암흑/);
    expect(announce![0]).toContain(state.entities[humanRabbit]!.name);
    // Fox never sees who got the skill
    expect(darknessChargeBannerLines(state, fox)).toBeNull();
    expect(missionBannerLines(state, fox)!.join(' ')).not.toMatch(/암흑/);
    // Rabbit banner includes the announce
    const banner = missionBannerLines(state, humanRabbit);
    expect(banner!.some((l) => l.includes('암흑'))).toBe(true);

    // Second human would not steal (only one human rabbit in twoPlayerHunt — use AI already done)
    // Non-holder cannot activate
    expect(applyDarknessAction(state, aiId).darknessRemainingMs).toBe(0);
    expect(applyDarknessAction(state, fox).darknessRemainingMs).toBe(0);

    expect(DARKNESS_DURATION_MS).toBe(3_000);
    state = applyDarknessAction(state, humanRabbit);
    expect(state.darknessChargeId).toBeNull();
    expect(state.darknessRemainingMs).toBe(DARKNESS_DURATION_MS);
    expect(darknessChargeBannerLines(state)).toBeNull();
    // Single use
    const again = applyDarknessAction(state, humanRabbit);
    expect(again.darknessRemainingMs).toBe(DARKNESS_DURATION_MS);

    state = tickDarkness(state, DARKNESS_DURATION_MS);
    expect(state.darknessRemainingMs).toBe(0);
  });

  it('failed human rabbits restore fox catch (capped) and speed; UI announce for all', () => {
    let lobby = createLobby(
      'foxbuff',
      defaultConfig({ aiCount: 2, seekerPrepMs: 0, timeLimitMs: 180_000, catchBudget: 3 }),
    );
    let res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼A');
    res = joinHuman(res.ok ? res.state : lobby, 'r2', '토끼B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 11 }));
    state = grantMission(state, 2);
    // Spend 2 catch attempts so restore has room
    state = { ...state, catchBudgetRemaining: 1, foxSpeedBonus: 0 };
    const fox = state.seekerId!;
    const humans = state.humans.filter((h) => h !== fox);
    expect(humans.length).toBe(2);
    // Nobody completes → both humans fail
    state = failIncompleteRabbits({
      ...state,
      mission: { ...state.mission!, completedIds: [], skipIds: [] },
    });
    expect(state.foxMissionBuff).not.toBeNull();
    expect(state.foxMissionBuff!.failedHumanCount).toBe(2);
    // restore min(2, 3-1) = 2 → remaining 3 (cap)
    expect(state.foxMissionBuff!.catchRestored).toBe(2);
    expect(state.catchBudgetRemaining).toBe(3);
    expect(state.catchBudgetRemaining).toBeLessThanOrEqual(state.config.catchBudget);
    expect(state.foxSpeedBonus).toBe(2 * FOX_SPEED_BONUS_PER_FAILED_HUMAN);
    const banner = foxMissionBuffBannerLines(state);
    expect(banner).not.toBeNull();
    expect(banner![0]).toMatch(/여우 강화/);
    expect(banner!.join(' ')).toMatch(/잡기/);
    expect(banner!.join(' ')).toMatch(/속도/);
    // Everyone sees via missionBannerLines
    expect(missionBannerLines(state, humans[0])!.some((l) => l.includes('여우 강화'))).toBe(
      true,
    );

    // Already at cap → catch not restored further, speed still stacks
    state = grantMission(state, 3);
    state = {
      ...state,
      catchBudgetRemaining: state.config.catchBudget,
      mission: {
        ...state.mission!,
        completedIds: [],
        skipIds: [],
      },
    };
    // Revive humans for a second fail scenario
    const entities = { ...state.entities };
    for (const id of humans) {
      entities[id] = { ...entities[id]!, alive: true };
    }
    state = failIncompleteRabbits({ ...state, entities });
    expect(state.foxMissionBuff!.catchRestored).toBe(0);
    expect(state.catchBudgetRemaining).toBe(state.config.catchBudget);
    expect(state.foxSpeedBonus).toBe(4 * FOX_SPEED_BONUS_PER_FAILED_HUMAN);
  });

  it('visit points spread across map and avoid previous target', () => {
    const rng = createRng(42);
    const samples: Array<{ x: number; y: number }> = [];
    let avoid: { x: number; y: number } | null = null;
    for (let i = 0; i < 24; i++) {
      const p = pickVisitPoint(rng, MAP_WIDTH, MAP_HEIGHT, {
        avoid,
        minSeparation: VISIT_POINT_MIN_SEPARATION,
      });
      samples.push(p);
      // In bounds with margin
      expect(p.x).toBeGreaterThanOrEqual(100);
      expect(p.x).toBeLessThanOrEqual(MAP_WIDTH - 100);
      expect(p.y).toBeGreaterThanOrEqual(100);
      expect(p.y).toBeLessThanOrEqual(MAP_HEIGHT - 100);
      if (avoid) {
        expect(Math.hypot(p.x - avoid.x, p.y - avoid.y)).toBeGreaterThanOrEqual(
          VISIT_POINT_MIN_SEPARATION * 0.85,
        );
      }
      avoid = p;
    }
    // Not all points clustered in one corner — cover multiple map quadrants
    const left = samples.filter((p) => p.x < MAP_WIDTH / 2).length;
    const right = samples.length - left;
    const top = samples.filter((p) => p.y < MAP_HEIGHT / 2).length;
    const bot = samples.length - top;
    expect(left).toBeGreaterThan(3);
    expect(right).toBeGreaterThan(3);
    expect(top).toBeGreaterThan(3);
    expect(bot).toBeGreaterThan(3);

    // Consecutive grants with different ticks get different visit coords when forced visit
    let state = twoPlayerHunt(180_000, 0);
    const pts: Array<{ x: number; y: number }> = [];
    for (let g = 0; g < 8; g++) {
      state = grantMission(
        {
          ...state,
          tick: 100 + g * 50,
          mission: null,
          missionGrantCount: g,
        },
        7 + g,
      );
      if (state.mission!.kind === 'visit_point') {
        pts.push({ x: state.mission!.targetX, y: state.mission!.targetY });
        expect(state.lastVisitPoint).toEqual({
          x: state.mission!.targetX,
          y: state.mission!.targetY,
        });
      }
    }
    // At least two visit_point grants with distinct positions
    if (pts.length >= 2) {
      const unique = new Set(pts.map((p) => `${Math.round(p.x / 40)}:${Math.round(p.y / 40)}`));
      expect(unique.size).toBeGreaterThanOrEqual(2);
    }
  });

  it('practice fox mode has no user rabbits → only visit_point', () => {
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
    // No living user rabbits to touch → visit_point only
    expect([...kinds]).toEqual(['visit_point']);
  });
});
