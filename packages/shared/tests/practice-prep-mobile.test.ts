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
  it('starts without seeker and disables catch hunt rules', () => {
    let lobby = createLobby('p', defaultConfig({ aiCount: 3 }));
    const joined = joinHuman(lobby, 'h1', 'Hider');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    const state = startPracticeMatch(joined.state, 3);
    expect(state.mode).toBe('practice');
    expect(state.seekerId).toBeNull();
    expect(state.phase).toBe('playing');
    expect(state.seekerPrepRemainingMs).toBe(0);
    for (const id of state.humans) {
      expect(state.entities[id]!.role).toBe('hider');
    }
    expect(Object.values(state.entities).some((e) => e.kind === 'ai')).toBe(true);

    const viaStart = startMatch(joined.state, { mode: 'practice', seed: 3 });
    expect(viaStart.seekerId).toBeNull();
    expect(viaStart.mode).toBe('practice');

    const catchRes = attemptCatch(state, 'h1', Object.keys(state.entities)[0]!);
    expect(catchRes.ok).toBe(false);
    if (!catchRes.ok) expect(catchRes.reason).toBe('practice_no_catch');
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
