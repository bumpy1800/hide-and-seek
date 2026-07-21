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
    let state = createLobby('r1', defaultConfig({ timeLimitMs: 1000, aiCount: 2 }));
    state = joinHuman(state, 's', 'Seeker').ok ? (joinHuman(state, 's', 'Seeker') as { ok: true; state: typeof state }).state : state;
    let res = joinHuman(createLobby('r1', defaultConfig({ timeLimitMs: 1000, aiCount: 2 })), 's', 'S');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = res.state;
    res = joinHuman(state, 'h', 'H');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = startMatch(res.state, 1);
    state = tickTimer(state, 1000);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('hiders');
    expect(state.endReason).toBe('time_expired');
  });

  it('decrements catch budget and rejects when exhausted', () => {
    let lobby = createLobby('r1', defaultConfig({ catchBudget: 2, aiCount: 1, catchRange: 1000 }));
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

    // Catch AI → budget 1, not ok
    let catchRes = attemptCatch(state, seekerId, aiId);
    expect(catchRes.ok).toBe(false);
    if (catchRes.ok) return;
    expect(catchRes.reason).toBe('target_is_ai');
    state = catchRes.state;
    expect(state.catchBudgetRemaining).toBe(1);
    expect(state.entities[aiId]?.alive).toBe(true);

    // Catch human → success, budget 0 → may end if no hiders or budget exhausted
    catchRes = attemptCatch(state, seekerId, hiderId);
    // If only one hider and caught, seekers win
    if (catchRes.ok) {
      expect(catchRes.kind).toBe('human');
      state = catchRes.state;
      expect(state.entities[hiderId]?.alive).toBe(false);
    }

    // Exhaust budget with no targets left path: start fresh budget 1 waste on AI
    lobby = createLobby('r2', defaultConfig({ catchBudget: 1, aiCount: 1, catchRange: 1000 }));
    res = joinHuman(lobby, 'seek', 'S', { x: 100, y: 100 });
    res = joinHuman(res.ok ? res.state : lobby, 'hide', 'H', { x: 200, y: 200 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    state = startMatch(res.state, 3);
    const sid = state.seekerId!;
    const aid = Object.values(state.entities).find((e) => e.kind === 'ai')!.id;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [sid]: { ...state.entities[sid]!, x: 100, y: 100 },
        [aid]: { ...state.entities[aid]!, x: 100, y: 100 },
      },
    };
    catchRes = attemptCatch(state, sid, aid);
    expect(catchRes.ok).toBe(false);
    state = catchRes.state;
    expect(state.catchBudgetRemaining).toBe(0);
    expect(state.phase).toBe('ended');
    expect(state.winner).toBe('hiders');

    const reject = attemptCatch(state, sid, aid);
    expect(reject.ok).toBe(false);
    if (!reject.ok) {
      // after ended, not_playing; or if still playing budget exhausted
      expect(['not_playing', 'catch_budget_exhausted']).toContain(reject.reason);
    }
  });

  it('rejects catching AI as player elimination and accepts human hider', () => {
    let lobby = createLobby('r1', defaultConfig({ catchBudget: 3, aiCount: 3, catchRange: 80 }));
    let res = joinHuman(lobby, 'p1', 'A', { x: 50, y: 50 });
    res = joinHuman(res.ok ? res.state : lobby, 'p2', 'B', { x: 60, y: 50 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, 11);
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    const aiId = Object.keys(state.entities).find((id) => state.entities[id]!.kind === 'ai')!;

    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100, role: 'seeker' },
        [hiderId]: { ...state.entities[hiderId]!, x: 120, y: 100, role: 'hider', alive: true },
        [aiId]: { ...state.entities[aiId]!, x: 110, y: 100, kind: 'ai', alive: true },
      },
    };

    const aiCatch = attemptCatch(state, seekerId, aiId);
    expect(aiCatch.ok).toBe(false);
    if (!aiCatch.ok) expect(aiCatch.reason).toBe('target_is_ai');
    expect(aiCatch.state.entities[aiId]?.alive).toBe(true);

    const humanCatch = attemptCatch(aiCatch.state, seekerId, hiderId);
    expect(humanCatch.ok).toBe(true);
    if (humanCatch.ok) {
      expect(humanCatch.kind).toBe('human');
      expect(humanCatch.state.entities[hiderId]?.alive).toBe(false);
    }
  });
});
