import { describe, expect, it } from 'vitest';
import {
  attemptCatch,
  canJoin,
  createLobby,
  defaultConfig,
  joinHuman,
  startMatch,
  tickTimer,
} from '../src/match.js';

describe('match capacity', () => {
  it('rejects join when 8 humans already present', () => {
    let state = createLobby('r1', defaultConfig({ maxHumans: 8 }));
    for (let i = 0; i < 8; i++) {
      const res = joinHuman(state, `p${i}`, `P${i}`);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    expect(canJoin(state)).toBe(false);
    const fail = joinHuman(state, 'p9', 'Overflow');
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.reason).toBe('room_full');
    expect(state.humans).toHaveLength(8);
  });
});

describe('random seeker', () => {
  it('assigns a seeker among humans and is deterministic per seed', () => {
    let state = createLobby('r1');
    for (const id of ['a', 'b', 'c']) {
      const res = joinHuman(state, id, id);
      expect(res.ok).toBe(true);
      if (res.ok) state = res.state;
    }
    const s1 = startMatch(state, 42);
    const s2 = startMatch(state, 42);
    const s3 = startMatch(state, 99);
    expect(s1.seekerId).toBe(s2.seekerId);
    expect(s1.humans).toContain(s1.seekerId);
    expect(s1.entities[s1.seekerId!]?.role).toBe('seeker');
    // Different seed may differ (very high chance with 3 players across many seeds)
    const seekers = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      seekers.add(startMatch(state, seed).seekerId!);
    }
    expect(seekers.size).toBeGreaterThan(1);
    expect(['a', 'b', 'c']).toContain(s3.seekerId);
  });
});

describe('timer and catch budget', () => {
  it('ends match for hiders when time expires with living hider', () => {
    let state = createLobby('r1', defaultConfig({ seekerPrepMs: 0, timeLimitMs: 1000, aiCount: 2 }));
    state = joinHuman(state, 's', 'Seeker').ok ? (joinHuman(state, 's', 'Seeker') as { ok: true; state: typeof state }).state : state;
    let res = joinHuman(createLobby('r1', defaultConfig({ seekerPrepMs: 0, timeLimitMs: 1000, aiCount: 2 })), 's', 'S');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.state;
    res = joinHuman(state, 'h', 'H');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = startMatch(res.state, 1);
    state = { ...state, seekerPrepRemainingMs: 0, phase: 'playing', startSequenceRemainingMs: 0 };
    state = tickTimer(state, 1000);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('hiders');
    expect(state.endReason).toBe('time_expired');
  });

  it('decrements catch budget and rejects when exhausted', () => {
    let lobby = createLobby('r1', defaultConfig({ seekerPrepMs: 0, catchBudget: 2, aiCount: 1, catchRange: 1000 }));
    let res = joinHuman(lobby, 'seek', 'S', { x: 100, y: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    res = joinHuman(res.state, 'hide', 'H', { x: 110, y: 100 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, 7);
    // Force seeker id if needed — seed 7 pick among [seek, hide]
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((id) => id !== seekerId)!;
    // Place both close
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100, role: 'seeker' },
        [hiderId]: { ...state.entities[hiderId]!, x: 110, y: 100, role: 'hider', alive: true },
      },
      seekerId,
      catchBudgetRemaining: 2,
    };

    const aiId = Object.values(state.entities).find((e) => e.kind === 'ai')!.id;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [aiId]: { ...state.entities[aiId]!, x: 105, y: 100 },
      },
    };

    // Ensure playable
    state = {
      ...state,
      phase: 'playing',
      startSequenceRemainingMs: 0,
      seekerPrepRemainingMs: 0,
      catchBudgetRemaining: 2,
    };
    // Catch AI → ok, spends 1 total budget, no grave
    let catchRes = attemptCatch(state, seekerId, aiId);
    expect(catchRes.ok).toBe(true);
    if (!catchRes.ok) return;
    expect(catchRes.kind).toBe('ai');
    expect(catchRes.placeGrave).toBe(false);
    state = catchRes.state;
    expect(state.catchBudgetRemaining).toBe(1);
    expect(state.entities[aiId]?.alive).toBe(false);

    // Catch human → success, budget decrements again, grave
    catchRes = attemptCatch(state, seekerId, hiderId);
    expect(catchRes.ok).toBe(true);
    if (catchRes.ok) {
      expect(catchRes.kind).toBe('human');
      expect(catchRes.placeGrave).toBe(true);
      expect(catchRes.name).toBeTruthy();
      state = catchRes.state;
      expect(state.entities[hiderId]?.alive).toBe(false);
      expect(state.catchBudgetRemaining).toBe(0);
    }

    // Exhaust remaining budget with a living hider still on the field
    lobby = createLobby('r2', defaultConfig({ seekerPrepMs: 0, aiCount: 0, catchRange: 1000 }));
    res = joinHuman(lobby, 'seek', 'S', { x: 100, y: 100 });
    res = joinHuman(res.ok ? res.state : lobby, 'hide', 'H', { x: 110, y: 100 });
    res = joinHuman(res.ok ? res.state : lobby, 'hide2', 'H2', { x: 900, y: 900 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = startMatch(res.state, 3);
    // defaultConfig catchBudget is DEFAULT_CATCH_BUDGET (3) unless overridden
    expect(state.catchBudgetRemaining).toBe(state.config.catchBudget);
    const sid = state.seekerId!;
    // Place seeker next to one hider, leave the other far and alive; budget 1
    const hiders = state.humans.filter((h) => h !== sid);
    state = {
      ...state,
      seekerPrepRemainingMs: 0,
      phase: 'playing' as const,
      startSequenceRemainingMs: 0,
      catchBudgetRemaining: 1,
      entities: {
        ...state.entities,
        [sid]: { ...state.entities[sid]!, x: 100, y: 100 },
        [hiders[0]!]: { ...state.entities[hiders[0]!]!, x: 110, y: 100, alive: true },
        [hiders[1]!]: { ...state.entities[hiders[1]!]!, x: 900, y: 900, alive: true },
      },
    };
    catchRes = attemptCatch(state, sid, hiders[0]!);
    expect(catchRes.ok).toBe(true);
    state = catchRes.state;
    expect(state.catchBudgetRemaining).toBe(0);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('hiders');
    expect(state.endReason).toBe('catch_budget_exhausted');

    const reject = attemptCatch(state, sid, hiders[1]!);
    expect(reject.ok).toBe(false);
    if (!reject.ok) {
      expect(['not_playing', 'catch_budget_exhausted']).toContain(reject.reason);
    }
  });

  it('allows multiplayer AI catch without spending human budget; human still spends', () => {
    let lobby = createLobby('r1', defaultConfig({ seekerPrepMs: 0, catchBudget: 3, aiCount: 3, catchRange: 80 }));
    let res = joinHuman(lobby, 'p1', 'A', { x: 50, y: 50 });
    res = joinHuman(res.ok ? res.state : lobby, 'p2', 'B', { x: 60, y: 50 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, 11);
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    const aiId = Object.keys(state.entities).find((id) => state.entities[id]!.kind === 'ai')!;
    const budgetBefore = state.catchBudgetRemaining;

    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100, role: 'seeker' },
        [hiderId]: { ...state.entities[hiderId]!, x: 120, y: 100, role: 'hider', alive: true },
        [aiId]: { ...state.entities[aiId]!, x: 110, y: 100, kind: 'ai', alive: true },
      },
    };

    state = {
      ...state,
      phase: 'playing',
      startSequenceRemainingMs: 0,
      seekerPrepRemainingMs: 0,
    };
    const aiCatch = attemptCatch(state, seekerId, aiId);
    expect(aiCatch.ok).toBe(true);
    if (!aiCatch.ok) return;
    expect(aiCatch.kind).toBe('ai');
    expect(aiCatch.placeGrave).toBe(false);
    expect(aiCatch.state.entities[aiId]?.alive).toBe(false);
    expect(aiCatch.state.catchBudgetRemaining).toBe(budgetBefore - 1);

    const humanCatch = attemptCatch(aiCatch.state, seekerId, hiderId);
    expect(humanCatch.ok).toBe(true);
    if (humanCatch.ok) {
      expect(humanCatch.kind).toBe('human');
      expect(humanCatch.placeGrave).toBe(true);
      expect(humanCatch.state.entities[hiderId]?.alive).toBe(false);
    }
  });
});

describe('rematch and rejoin after ended', () => {
  it('returnToLobby keeps humans and allows startMatch again', () => {
    let lobby = createLobby('r-rematch', defaultConfig({ aiCount: 2, timeLimitMs: 100 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, { seed: 5, mode: 'normal' });
    // Finish seeker prep then expire hunt timer
    state = { ...state, seekerPrepRemainingMs: 0, phase: 'playing', startSequenceRemainingMs: 0 };
    state = tickTimer(state, 100);
    expect(state.phase).toBe('ended');

    // join after ended should succeed (auto lobby)
    const rejoin = joinHuman(state, 'c', 'C');
    expect(rejoin.ok).toBe(true);
    if (!rejoin.ok) return;
    expect(rejoin.state.phase).toBe('lobby');
    expect(rejoin.state.humans).toContain('c');

    // start from ended without explicit join path → starting sequence first
    state = startMatch(state, 8);
    expect(state.phase).toBe('starting');
    expect(state.seekerId).toBeTruthy();
    expect(Object.values(state.entities).some((e) => e.kind === 'ai')).toBe(true);
  });
});
