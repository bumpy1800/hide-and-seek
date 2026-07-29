import { describe, expect, it } from 'vitest';
import {
  START_SEQUENCE_MS,
  applyRoomSettings,
  attemptCatch,
  createLobby,
  defaultConfig,
  humanCatchScore,
  joinHuman,
  listCaughtHumans,
  skipToPlaying,
  startMatch,
  startSequenceStage,
  tickTimer,
} from '../src/index.js';

describe('total catch budget (AI + human)', () => {
  it('uses host config catchBudget/aiCount/timeLimit — not hider count', () => {
    let lobby = createLobby(
      'budget',
      defaultConfig({ catchBudget: 7, aiCount: 4, timeLimitMs: 60_000, seekerPrepMs: 0 }),
    );
    lobby = applyRoomSettings(lobby, { catchBudget: 7, aiCount: 4, timeLimitMs: 60_000 });
    let res = joinHuman(lobby, 'fox', '여우');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼1');
    res = joinHuman(res.ok ? res.state : lobby, 'r2', '토끼2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const state = startMatch(res.state, { mode: 'normal', seed: 11 });
    expect(state.phase).toBe('starting');
    expect(state.catchBudgetRemaining).toBe(7);
    expect(state.config.catchBudget).toBe(7);
    expect(state.config.aiCount).toBe(4);
    expect(state.config.timeLimitMs).toBe(60_000);
    expect(Object.values(state.entities).filter((e) => e.kind === 'ai')).toHaveLength(4);
    expect(listCaughtHumans(state)).toEqual([]);
  });

  it('AI and human catches both decrement total budget', () => {
    let lobby = createLobby(
      'mix',
      defaultConfig({ catchBudget: 3, aiCount: 2, seekerPrepMs: 0, catchRange: 5000 }),
    );
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 2 }));
    expect(state.catchBudgetRemaining).toBe(3);
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    const aiId = Object.values(state.entities).find((e) => e.kind === 'ai')!.id;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100 },
        [aiId]: { ...state.entities[aiId]!, x: 110, y: 100, alive: true },
        [hiderId]: { ...state.entities[hiderId]!, x: 120, y: 100, alive: true },
      },
    };
    let r = attemptCatch(state, seekerId, aiId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('ai');
    expect(r.state.catchBudgetRemaining).toBe(2);
    expect(humanCatchScore(r.state)).toBe(0);
    state = r.state;
    r = attemptCatch(state, seekerId, hiderId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('human');
    expect(r.state.catchBudgetRemaining).toBe(1);
    expect(humanCatchScore(r.state)).toBe(1);
  });

  it('exhausting N total catches ends match; user score preserved', () => {
    let lobby = createLobby(
      'exh',
      defaultConfig({ catchBudget: 2, aiCount: 3, seekerPrepMs: 0, catchRange: 5000 }),
    );
    let res = joinHuman(lobby, 's', 'S');
    res = joinHuman(res.ok ? res.state : lobby, 'h1', 'H1');
    res = joinHuman(res.ok ? res.state : lobby, 'h2', 'H2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 4 }));
    const seekerId = 's';
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai');
    state = {
      ...state,
      seekerId,
      catchBudgetRemaining: 2,
      entities: {
        ...state.entities,
        s: { ...state.entities.s!, role: 'seeker', x: 50, y: 50, alive: true },
        h1: { ...state.entities.h1!, role: 'hider', x: 900, y: 900, alive: true },
        h2: { ...state.entities.h2!, role: 'hider', x: 950, y: 950, alive: true },
        [ais[0]!.id]: { ...ais[0]!, x: 60, y: 50, alive: true },
        [ais[1]!.id]: { ...ais[1]!, x: 70, y: 50, alive: true },
      },
    };
    let r = attemptCatch(state, seekerId, ais[0]!.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    state = r.state;
    expect(state.catchBudgetRemaining).toBe(1);
    r = attemptCatch(state, seekerId, ais[1]!.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.catchBudgetRemaining).toBe(0);
    expect(r.state.phase).toBe('ended');
    expect(r.state.endReason).toBe('catch_budget_exhausted');
    expect(humanCatchScore(r.state)).toBe(0);
    expect(listCaughtHumans(r.state)).toHaveLength(0);
  });

  it('start sequence: roulette then countdown then playing+prep', () => {
    let lobby = createLobby('seq', defaultConfig({ catchBudget: 5, aiCount: 1 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, { mode: 'normal', seed: 1 });
    expect(state.phase).toBe('starting');
    expect(state.startSequenceRemainingMs).toBe(START_SEQUENCE_MS);
    expect(startSequenceStage(state.startSequenceRemainingMs)).toBe('roulette');
    // Advance past roulette into countdown
    state = tickTimer(state, 2600);
    expect(state.phase).toBe('starting');
    expect(startSequenceStage(state.startSequenceRemainingMs)).toBe('countdown');
    // Finish countdown → playing with prep
    state = tickTimer(state, 4000);
    expect(state.phase).toBe('playing');
    expect(state.startSequenceRemainingMs).toBe(0);
    expect(state.seekerPrepRemainingMs).toBe(state.config.seekerPrepMs);
  });
});
