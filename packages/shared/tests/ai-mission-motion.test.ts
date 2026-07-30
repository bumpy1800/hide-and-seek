import { describe, expect, it, beforeEach } from 'vitest';
import {
  AI_MISSION_STAGGER_MS_MAX,
  AI_SPEED,
  checkMissionProximityCompletions,
  createLobby,
  defaultConfig,
  getAiMissionPlan,
  grantMission,
  integrateMotion,
  isEightDirVelocity,
  joinHuman,
  MISSION_VISIT_RADIUS,
  resetAiBrains,
  skipToPlaying,
  startMatch,
  stepAiCrowd,
} from '../src/index.js';

function huntWithVisit(seed = 21, aiCount = 12) {
  let lobby = createLobby('vis', defaultConfig({ aiCount, seekerPrepMs: 0 }));
  let res = joinHuman(lobby, 'fox', 'F');
  res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R');
  if (!res.ok) throw new Error('join');
  let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed }));
  state = grantMission(state, 4);
  state = {
    ...state,
    mission: {
      kind: 'visit_point',
      remainingMs: 30_000,
      targetX: 900,
      targetY: 500,
      completedIds: [],
    },
  };
  return state;
}

/** Place AI outside radius and simulate real travel into completion. */
function simulateVisitMission(ticks: number, seed = 21, stepMs = 200) {
  let state = huntWithVisit(seed);
  const m = state.mission!;
  const entities = { ...state.entities };
  let i = 0;
  for (const [id, e] of Object.entries(entities)) {
    if (e.kind !== 'ai') continue;
    const ang = (i / 12) * Math.PI * 2;
    entities[id] = {
      ...e,
      x: m.targetX + Math.cos(ang) * 400,
      y: m.targetY + Math.sin(ang) * 400,
      vx: 0,
      vy: 0,
    };
    i += 1;
  }
  state = { ...state, entities, mission: { ...m, completedIds: [] } };
  resetAiBrains(state.roomId);
  for (let t = 0; t < ticks; t++) {
    state = stepAiCrowd(state, stepMs, t + 2);
    state = integrateMotion(state, stepMs / 1000);
    state = checkMissionProximityCompletions(state);
    state = { ...state, tick: state.tick + 1 };
  }
  return state;
}

describe('AI visit_point mission motion', () => {
  beforeEach(() => {
    resetAiBrains();
  });

  it('staggers departures: not all AI mission-bound on first tick after grant', () => {
    let state = huntWithVisit();
    state = stepAiCrowd(state, 50, 1);
    const delays: number[] = [];
    let waiting = 0;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'ai' || !e.alive) continue;
      const plan = getAiMissionPlan(state.roomId, e.id);
      expect(plan).not.toBeNull();
      delays.push(plan!.departDelayMs);
      if (plan!.departDelayMs > 50) waiting += 1;
    }
    const unique = new Set(delays.map((d) => Math.round(d / 50)));
    expect(unique.size).toBeGreaterThan(1);
    expect(Math.max(...delays)).toBeGreaterThan(100);
    expect(Math.max(...delays)).toBeLessThanOrEqual(AI_MISSION_STAGGER_MS_MAX + 1);
    expect(waiting).toBeGreaterThan(0);
  });

  it('assigns multiple visit patterns across AI', () => {
    let state = huntWithVisit();
    state = stepAiCrowd(state, 50, 2);
    const patterns = new Set<string>();
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'ai') continue;
      const plan = getAiMissionPlan(state.roomId, e.id);
      if (plan) patterns.add(plan.visitPattern);
    }
    expect(patterns.size).toBeGreaterThanOrEqual(2);
  });

  it('real path: majority of AI complete visit (enter radius) then leave', () => {
    let state = simulateVisitMission(120, 33);
    const m = state.mission!;
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai' && e.alive);
    const doneIds = new Set(state.mission?.completedIds ?? []);
    let completed = 0;
    let leftAfter = 0;
    let frozenOnPoint = 0;
    let visitedIncomplete = 0;

    for (const e of ais) {
      const plan = getAiMissionPlan(state.roomId, e.id);
      const d = Math.hypot(e.x - m.targetX, e.y - m.targetY);
      const done = doneIds.has(e.id);
      if (done) completed += 1;
      // visitedPoint must imply completed (same radius)
      if (plan?.visitedPoint && !done) visitedIncomplete += 1;
      if (done && d > MISSION_VISIT_RADIUS + 30) leftAfter += 1;
      if (done && d <= 12 && Math.hypot(e.vx, e.vy) < 1) frozenOnPoint += 1;
      expect(isEightDirVelocity(e.vx, e.vy, AI_SPEED, 1)).toBe(true);
    }

    // High bar: thrash/early-leave would leave most incomplete
    expect(completed).toBeGreaterThanOrEqual(Math.ceil(ais.length * 0.7));
    expect(visitedIncomplete).toBe(0);
    expect(leftAfter).toBeGreaterThan(0);
    expect(frozenOnPoint).toBe(0);
  });

  it('sweep_by advances offset→point one-way and completes (no thrash)', () => {
    let state = huntWithVisit(77, 16);
    const m = state.mission!;
    // Place AI far away
    const entities = { ...state.entities };
    let i = 0;
    for (const [id, e] of Object.entries(entities)) {
      if (e.kind !== 'ai') continue;
      entities[id] = {
        ...e,
        x: m.targetX + 500,
        y: m.targetY + (i % 2 === 0 ? 200 : -200),
        vx: 0,
        vy: 0,
      };
      i += 1;
    }
    state = { ...state, entities, mission: { ...m, completedIds: [] } };
    resetAiBrains(state.roomId);

    // Arm plans
    state = stepAiCrowd(state, 50, 1);
    const sweepIds = Object.values(state.entities)
      .filter((e) => e.kind === 'ai')
      .map((e) => e.id)
      .filter((id) => getAiMissionPlan(state.roomId, id)?.visitPattern === 'sweep_by');
    expect(sweepIds.length).toBeGreaterThan(0);

    // Track phase transitions: offset may go to point, never point→offset
    const phaseHist = new Map<string, string[]>();
    for (const id of sweepIds) phaseHist.set(id, []);

    for (let t = 0; t < 150; t++) {
      state = stepAiCrowd(state, 200, t + 2);
      state = integrateMotion(state, 0.2);
      state = checkMissionProximityCompletions(state);
      state = { ...state, tick: state.tick + 1 };
      for (const id of sweepIds) {
        const plan = getAiMissionPlan(state.roomId, id);
        if (!plan) continue;
        const hist = phaseHist.get(id)!;
        if (hist[hist.length - 1] !== plan.visitPhase) {
          hist.push(plan.visitPhase);
        }
      }
    }

    // No regression to offset after leaving it
    for (const id of sweepIds) {
      const hist = phaseHist.get(id)!;
      const offsetIdx = hist.indexOf('offset');
      const pointIdx = hist.indexOf('point');
      const afterIdx = hist.indexOf('after');
      if (offsetIdx >= 0 && pointIdx >= 0) {
        expect(pointIdx).toBeGreaterThan(offsetIdx);
      }
      // Never see offset after point
      if (pointIdx >= 0) {
        expect(hist.slice(pointIdx).includes('offset')).toBe(false);
      }
      if (afterIdx >= 0) {
        expect(hist.slice(afterIdx).includes('offset')).toBe(false);
        expect(hist.slice(afterIdx).includes('point')).toBe(false);
      }
    }

    // Most sweep_by AI must complete
    let sweepDone = 0;
    for (const id of sweepIds) {
      if (state.mission?.completedIds.includes(id)) sweepDone += 1;
    }
    expect(sweepDone).toBeGreaterThanOrEqual(Math.ceil(sweepIds.length * 0.6));
  });

  it('keeps moving after real completion (post-visit non-zero motion)', () => {
    let state = simulateVisitMission(100, 44);
    for (let t = 0; t < 20; t++) {
      state = stepAiCrowd(state, 50, t + 100);
      state = integrateMotion(state, 0.05);
      state = checkMissionProximityCompletions(state);
      state = { ...state, tick: state.tick + 1 };
    }
    const doneIds = state.mission?.completedIds ?? [];
    expect(doneIds.length).toBeGreaterThan(0);
    let moving = 0;
    for (const id of doneIds) {
      const e = state.entities[id];
      if (e && Math.hypot(e.vx, e.vy) > 1) moving += 1;
    }
    expect(moving).toBeGreaterThan(0);
  });

  it('post-visit displacement directions differ across patterns', () => {
    let state = simulateVisitMission(110, 55);
    const m = state.mission!;
    const angles: number[] = [];
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'ai') continue;
      if (!state.mission?.completedIds.includes(e.id)) continue;
      const dx = e.x - m.targetX;
      const dy = e.y - m.targetY;
      if (Math.hypot(dx, dy) < 40) continue;
      angles.push(Math.round((Math.atan2(dy, dx) * 4) / Math.PI));
    }
    expect(new Set(angles).size).toBeGreaterThanOrEqual(2);
  });
});
