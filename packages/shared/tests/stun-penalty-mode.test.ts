import { describe, expect, it } from 'vitest';
import {
  attemptCatch,
  canSeekerAct,
  canSeekerSee,
  createLobby,
  defaultConfig,
  evaluateEndConditions,
  integrateMotion,
  isSeekerBlind,
  isSeekerStunned,
  joinHuman,
  normalizeRoomSettings,
  setEntityVelocity,
  skipToPlaying,
  startMatch,
  startPracticeMatch,
  tickTimer,
  STUN_PENALTY_BLIND_MS,
  STUN_PENALTY_STUN_MS,
  type MatchState,
} from '../src/index.js';

function setupPlayingMatch(ruleMode: 'standard' | 'stun_penalty'): {
  state: MatchState;
  seekerId: string;
  hiderId: string;
  aiId: string;
} {
  const config = defaultConfig({ ruleMode, seekerPrepMs: 0 });
  let state = createLobby('room-test', config);
  const j1 = joinHuman(state, 'p1', 'SeekerPlayer');
  const j2 = joinHuman(j1.state, 'p2', 'HiderPlayer');
  state = startMatch(j2.state, {
    mode: 'normal',
    ruleMode,
    designatedSeekerId: 'p1',
    foxMode: 'designate',
  });
  state = skipToPlaying(state);

  const seekerId = state.seekerId!;
  const hiderId = 'p2';
  const aiEntity = Object.values(state.entities).find((e) => e.kind === 'ai');
  if (!aiEntity) throw new Error('Expected at least one AI rabbit');
  const aiId = aiEntity.id;

  // Position entities within catch range
  const seeker = state.entities[seekerId]!;
  state = {
    ...state,
    entities: {
      ...state.entities,
      [hiderId]: { ...state.entities[hiderId]!, x: seeker.x + 10, y: seeker.y },
      [aiId]: { ...state.entities[aiId]!, x: seeker.x + 15, y: seeker.y },
    },
  };

  return { state, seekerId, hiderId, aiId };
}

describe('Stun Penalty Mode (무제한 스턴 모드)', () => {
  it('settings normalization preserves ruleMode', () => {
    const s1 = normalizeRoomSettings({ ruleMode: 'stun_penalty' });
    expect(s1.ruleMode).toBe('stun_penalty');

    const s2 = normalizeRoomSettings({ ruleMode: 'standard' });
    expect(s2.ruleMode).toBe('standard');

    const s3 = normalizeRoomSettings({});
    expect(s3.ruleMode).toBe('standard');
  });

  it('in stun_penalty mode: catching AI leaves rabbit alive, blinds for 2s, and stuns for 5s', () => {
    const { state, seekerId, aiId } = setupPlayingMatch('stun_penalty');

    expect(state.ruleMode).toBe('stun_penalty');
    expect(state.seekerBlindRemainingMs).toBe(0);
    expect(state.seekerStunRemainingMs).toBe(0);

    const res = attemptCatch(state, seekerId, aiId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // 1) AI rabbit does NOT disappear
    const caughtAi = res.state.entities[aiId];
    expect(caughtAi?.alive).toBe(true);

    // 2) Seeker screen turns dark for 2 seconds (2,000ms)
    expect(res.state.seekerBlindRemainingMs).toBe(STUN_PENALTY_BLIND_MS);
    expect(res.state.seekerBlindRemainingMs).toBe(2000);
    expect(isSeekerBlind(res.state, seekerId)).toBe(true);
    expect(canSeekerSee(res.state, seekerId)).toBe(false);

    // 3) Seeker is stunned for 5 seconds (5,000ms)
    expect(res.state.seekerStunRemainingMs).toBe(STUN_PENALTY_STUN_MS);
    expect(res.state.seekerStunRemainingMs).toBe(5000);
    expect(isSeekerStunned(res.state, seekerId)).toBe(true);
    expect(canSeekerAct(res.state, seekerId)).toBe(false);

    // 4) Seeker velocity reset to 0
    expect(res.state.entities[seekerId]?.vx).toBe(0);
    expect(res.state.entities[seekerId]?.vy).toBe(0);
  });

  it('seeker cannot move or catch while stunned', () => {
    const { state, seekerId, aiId } = setupPlayingMatch('stun_penalty');
    const res = attemptCatch(state, seekerId, aiId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    let s = res.state;

    // Movement velocity is blocked
    s = setEntityVelocity(s, seekerId, 100, 100);
    expect(s.entities[seekerId]?.vx).toBe(0);
    expect(s.entities[seekerId]?.vy).toBe(0);

    // Integrate motion does not move seeker
    const startX = s.entities[seekerId]!.x;
    const startY = s.entities[seekerId]!.y;
    s = integrateMotion(s, 0.5);
    expect(s.entities[seekerId]!.x).toBe(startX);
    expect(s.entities[seekerId]!.y).toBe(startY);

    // Catch attempts while stunned are rejected
    const catchAttempt = attemptCatch(s, seekerId, aiId);
    expect(catchAttempt.ok).toBe(false);
    expect(catchAttempt.reason).toBe('seeker_stunned');
  });

  it('timer ticks: 2s darkness lifts while stun continues until 5s', () => {
    const { state, seekerId, aiId } = setupPlayingMatch('stun_penalty');
    const res = attemptCatch(state, seekerId, aiId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    let s = res.state;

    // After 1 second (1000ms): both blind and stun active
    s = tickTimer(s, 1000);
    expect(s.seekerBlindRemainingMs).toBe(1000);
    expect(s.seekerStunRemainingMs).toBe(4000);
    expect(isSeekerBlind(s, seekerId)).toBe(true);
    expect(isSeekerStunned(s, seekerId)).toBe(true);

    // After 1 more second (total 2000ms): screen darkness clears, but stun still remains (3000ms)
    s = tickTimer(s, 1000);
    expect(s.seekerBlindRemainingMs).toBe(0);
    expect(s.seekerStunRemainingMs).toBe(3000);
    expect(isSeekerBlind(s, seekerId)).toBe(false);
    expect(canSeekerSee(s, seekerId)).toBe(true);
    expect(isSeekerStunned(s, seekerId)).toBe(true);
    expect(canSeekerAct(s, seekerId)).toBe(false);

    // After 3 more seconds (total 5000ms): stun completely clears!
    s = tickTimer(s, 3000);
    expect(s.seekerBlindRemainingMs).toBe(0);
    expect(s.seekerStunRemainingMs).toBe(0);
    expect(isSeekerStunned(s, seekerId)).toBe(false);
    expect(canSeekerAct(s, seekerId)).toBe(true);

    // Seeker can move again
    s = setEntityVelocity(s, seekerId, 120, 0);
    expect(s.entities[seekerId]?.vx).toBe(120);
  });

  it('unlimited catch budget: catches are never exhausted and do not cause endMatch', () => {
    const { state, seekerId, hiderId } = setupPlayingMatch('stun_penalty');
    let s = { ...state, catchBudgetRemaining: 0 };

    // In stun_penalty mode, budgetRemaining <= 0 does not end the match
    s = evaluateEndConditions(s);
    expect(s.phase).toBe('playing');
    expect(s.winner).toBeNull();

    // Catching human works even if catchBudgetRemaining was 0
    const humanCatch = attemptCatch(s, seekerId, hiderId);
    expect(humanCatch.ok).toBe(true);
    if (humanCatch.ok) {
      expect(humanCatch.state.entities[hiderId]?.alive).toBe(false);
      expect(humanCatch.state.phase).toBe('ended');
      expect(humanCatch.state.winner).toBe('seekers');
    }
  });

  it('practice mode supports stun_penalty ruleMode', () => {
    const config = defaultConfig({ ruleMode: 'stun_penalty' });
    let s = createLobby('room-practice', config);
    const j = joinHuman(s, 'solo', 'Tester');
    s = startPracticeMatch(j.state, Date.now(), 'fox', 'stun_penalty');

    expect(s.ruleMode).toBe('stun_penalty');
    const seekerId = s.seekerId!;
    const aiId = Object.values(s.entities).find((e) => e.kind === 'ai')!.id;

    // Move AI to seeker
    s = {
      ...s,
      entities: {
        ...s.entities,
        [aiId]: { ...s.entities[aiId]!, x: s.entities[seekerId]!.x, y: s.entities[seekerId]!.y },
      },
    };

    const res = attemptCatch(s, seekerId, aiId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.state.entities[aiId]?.alive).toBe(true);
    expect(res.state.seekerBlindRemainingMs).toBe(2000);
    expect(res.state.seekerStunRemainingMs).toBe(5000);
  });
});
