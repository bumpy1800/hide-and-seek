import { describe, expect, it } from 'vitest';
import {
  SEEKER_PREP_MS,
  attemptCatch,
  canSeekerAct,
  canSeekerSee,
  createLobby,
  defaultConfig,
  isSeekerPrepActive,
  joinHuman,
  leaveHuman,
  setEntityVelocity,
  shouldShowMobileKeypad,
  startMatch,
  startPracticeMatch,
  tickTimer,
} from '../src/index.js';

describe('shouldShowMobileKeypad', () => {
  it('shows for mobile UA and hides for desktop', () => {
    expect(
      shouldShowMobileKeypad({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        maxTouchPoints: 5,
        viewportWidth: 390,
      }),
    ).toBe(true);
    expect(
      shouldShowMobileKeypad({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
        maxTouchPoints: 0,
        pointerCoarse: false,
        viewportWidth: 1440,
      }),
    ).toBe(false);
    expect(
      shouldShowMobileKeypad({
        userAgent: 'Mozilla/5.0',
        maxTouchPoints: 2,
        viewportWidth: 800,
      }),
    ).toBe(true);
  });
});

describe('practice mode', () => {
  it('rabbit practice: no seeker, free move, no catch, no auto-end', () => {
    let lobby = createLobby('p', defaultConfig());
    const joined = joinHuman(lobby, 'h1', 'Hider');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    let state = startPracticeMatch(joined.state, 3, 'rabbit');
    expect(state.mode).toBe('practice');
    expect(state.practiceRole).toBe('rabbit');
    expect(state.seekerId).toBeNull();
    expect(state.phase).toBe('playing');
    expect(state.seekerPrepRemainingMs).toBe(0);
    for (const id of state.humans) {
      expect(state.entities[id]!.role).toBe('hider');
    }
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai');
    expect(ais).toHaveLength(5);

    const viaStart = startMatch(joined.state, { mode: 'practice', practiceRole: 'rabbit', seed: 3 });
    expect(viaStart.seekerId).toBeNull();
    expect(viaStart.mode).toBe('practice');

    const catchRes = attemptCatch(state, 'h1', ais[0]!.id);
    expect(catchRes.ok).toBe(false);
    if (!catchRes.ok) expect(catchRes.reason).toBe('practice_no_catch');

    for (let i = 0; i < 30; i++) state = tickTimer(state, 500);
    expect(state.phase).toBe('playing');
  });

  it('fox practice: solo seeker catches AI, never seeker-wins immediately', () => {
    let lobby = createLobby('fox-p', defaultConfig());
    const joined = joinHuman(lobby, 'fox1', 'Fox');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    let state = startPracticeMatch(joined.state, 7, 'fox');
    expect(state.mode).toBe('practice');
    expect(state.practiceRole).toBe('fox');
    expect(state.seekerId).toBe('fox1');
    expect(state.phase).toBe('playing');
    expect(state.entities['fox1']!.role).toBe('seeker');
    // Must NOT end as seekers (no human hiders)
    for (let i = 0; i < 20; i++) state = tickTimer(state, 500);
    expect(state.phase).toBe('playing');
    expect(state.winner).toBeNull();

    const ai = Object.values(state.entities).find((e) => e.kind === 'ai' && e.alive)!;
    state = {
      ...state,
      entities: {
        ...state.entities,
        fox1: { ...state.entities['fox1']!, x: 100, y: 100 },
        [ai.id]: { ...ai, x: 110, y: 100 },
      },
    };
    const catchRes = attemptCatch(state, 'fox1', ai.id);
    expect(catchRes.ok).toBe(true);
    if (catchRes.ok) {
      expect(catchRes.state.entities[ai.id]!.alive).toBe(false);
      expect(catchRes.state.phase).toBe('playing');
    }
  });
});

describe('seeker prep (~10s)', () => {
  it('blocks seeker act/see until prep elapses then allows both', () => {
    let lobby = createLobby('hunt', defaultConfig({ aiCount: 1, seekerPrepMs: SEEKER_PREP_MS }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, { mode: 'normal', seed: 2 });
    const seekerId = state.seekerId!;
    expect(state.seekerPrepRemainingMs).toBe(SEEKER_PREP_MS);
    expect(isSeekerPrepActive(state)).toBe(true);
    expect(canSeekerAct(state, seekerId)).toBe(false);
    expect(canSeekerSee(state, seekerId)).toBe(false);
    // hider still can "see"
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    expect(canSeekerSee(state, hiderId)).toBe(true);

    // velocity set ignored for seeker during prep
    state = setEntityVelocity(state, seekerId, 100, 0);
    expect(state.entities[seekerId]!.vx).toBe(0);

    // tick almost all prep — hunt timer should not expire yet
    state = tickTimer(state, SEEKER_PREP_MS - 100);
    expect(state.seekerPrepRemainingMs).toBe(100);
    expect(state.timeRemainingMs).toBe(state.config.timeLimitMs);
    expect(canSeekerAct(state, seekerId)).toBe(false);

    state = tickTimer(state, 100);
    expect(state.seekerPrepRemainingMs).toBe(0);
    expect(isSeekerPrepActive(state)).toBe(false);
    expect(canSeekerAct(state, seekerId)).toBe(true);
    expect(canSeekerSee(state, seekerId)).toBe(true);

    // after prep, catch budget path works (place close)
    const aiId = Object.values(state.entities).find((e) => e.kind === 'ai')!.id;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100 },
        [aiId]: { ...state.entities[aiId]!, x: 110, y: 100 },
      },
    };
    const miss = attemptCatch(state, seekerId, aiId);
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.reason).toBe('target_is_ai');
  });
});

describe('practice room rejoin after empty', () => {
  it('returns to lobby when last human leaves practice so a second join works', () => {
    let lobby = createLobby('practice', defaultConfig({ aiCount: 2 }));
    let res = joinHuman(lobby, 'p1', 'One');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startPracticeMatch(res.state, 1);
    expect(state.phase).toBe('playing');
    expect(state.mode).toBe('practice');

    state = leaveHuman(state, 'p1');
    expect(state.phase).toBe('lobby');
    expect(state.humans).toHaveLength(0);
    expect(state.mode).toBe('normal');

    const again = joinHuman(state, 'p2', 'Two');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.state.phase).toBe('lobby');
    expect(again.state.humans).toContain('p2');

    const practice2 = startPracticeMatch(again.state, 2, 'rabbit');
    expect(practice2.phase).toBe('playing');
    expect(practice2.seekerId).toBeNull();
  });

  it('join recovers abandoned playing room with zero humans', () => {
    let lobby = createLobby('practice', defaultConfig({ aiCount: 1 }));
    let res = joinHuman(lobby, 'ghost', 'G');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startPracticeMatch(res.state, 9, 'rabbit');
    // Simulate corrupt empty playing state without leaveHuman
    state = { ...state, humans: [], entities: {} };
    expect(state.phase).toBe('playing');
    const join = joinHuman(state, 'new', 'N');
    expect(join.ok).toBe(true);
    if (!join.ok) return;
    expect(join.state.phase).toBe('lobby');
    expect(join.state.humans).toEqual(['new']);
  });
});

describe('AI count = rabbit users × 5', () => {
  it('practice solo spawns 5 AI and stays playing after ticks', () => {
    let lobby = createLobby('solo-p', defaultConfig());
    const joined = joinHuman(lobby, 'only', 'Solo');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    let state = startPracticeMatch(joined.state, 1, 'rabbit');
    expect(state.mode).toBe('practice');
    expect(state.seekerId).toBeNull();
    expect(state.phase).toBe('playing');
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai');
    expect(ais).toHaveLength(5); // 1 rabbit user × 5
    expect(state.config.aiCount).toBe(5);
    // solo practice must not end after many ticks
    for (let i = 0; i < 40; i++) {
      state = tickTimer(state, 250);
    }
    expect(state.phase).toBe('playing');
    expect(state.mode).toBe('practice');
  });

  it('normal match AI count is (humans - seeker) × 5', () => {
    let lobby = createLobby('n', defaultConfig());
    for (const id of ['a', 'b', 'c']) {
      const r = joinHuman(lobby, id, id);
      expect(r.ok).toBe(true);
      if (r.ok) lobby = r.state;
    }
    const state = startMatch(lobby, { mode: 'normal', seed: 1 });
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai');
    // 3 humans → 1 seeker + 2 rabbits → 10 AI
    expect(ais).toHaveLength(10);
    expect(state.config.aiCount).toBe(10);
  });
});
