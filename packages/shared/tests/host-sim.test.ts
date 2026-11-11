import { describe, expect, it } from 'vitest';
import {
  RABBIT_SPEED,
  SEEKER_SPEED,
  applyMoveIntent,
  applyPlayingIntent,
  createLobby,
  defaultConfig,
  joinHuman,
  markMissionComplete,
  matchEndedDetail,
  skipToPlaying,
  startMatch,
  tickAuthority,
} from '../src/index.js';

function twoPlayer() {
  let lobby = createLobby(
    'hs',
    defaultConfig({ aiCount: 2, seekerPrepMs: 0, timeLimitMs: 90_000 }),
  );
  let res = joinHuman(lobby, 'fox', 'F');
  res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R');
  if (!res.ok) throw new Error('join');
  return skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 3 }));
}

describe('hostSim shared authority', () => {
  it('applyMoveIntent sets seeker/rabbit speeds', () => {
    let state = twoPlayer();
    const fox = state.seekerId!;
    const rabbit = state.humans.find((h) => h !== fox)!;
    state = applyMoveIntent(state, fox, 1, 0);
    expect(state.entities[fox]!.vx).toBeCloseTo(SEEKER_SPEED, 5);
    state = applyMoveIntent(state, rabbit, 0, 1);
    expect(state.entities[rabbit]!.vy).toBeCloseTo(RABBIT_SPEED, 5);
    state = applyMoveIntent(state, rabbit, 0, 0);
    expect(state.entities[rabbit]!.vx).toBe(0);
    expect(state.entities[rabbit]!.vy).toBe(0);
  });

  it('applyPlayingIntent darkness only for charge holder', () => {
    let state = twoPlayer();
    const fox = state.seekerId!;
    const rabbit = state.humans.find((h) => h !== fox)!;
    state = {
      ...state,
      mission: {
        kind: 'visit_point',
        remainingMs: 30_000,
        targetX: 100,
        targetY: 100,
        completedIds: [],
        skipIds: [],
      },
    };
    state = markMissionComplete(state, rabbit);
    expect(state.darknessChargeId).toBe(rabbit);

    const denied = applyPlayingIntent(state, fox, { type: 'darkness' });
    expect(denied.state.darknessRemainingMs).toBe(0);

    const ok = applyPlayingIntent(state, rabbit, { type: 'darkness' });
    expect(ok.state.darknessRemainingMs).toBeGreaterThan(0);
    expect(ok.events.some((e) => e.kind === 'snapshot')).toBe(true);
  });

  it('catch_miss unicast when no target', () => {
    let state = twoPlayer();
    const fox = state.seekerId!;
    // Move fox far from everyone
    state = {
      ...state,
      entities: {
        ...state.entities,
        [fox]: { ...state.entities[fox]!, x: 10, y: 10 },
      },
      config: { ...state.config, catchRange: 5 },
    };
    const r = applyPlayingIntent(state, fox, { type: 'catch' });
    const miss = r.events.find((e) => e.kind === 'event' && e.event === 'catch_miss');
    expect(miss).toBeDefined();
    if (miss && miss.kind === 'event') {
      expect(miss.to).toBe(fox);
    }
  });

  it('tickAuthority advances timer while playing', () => {
    let state = twoPlayer();
    const before = state.timeRemainingMs;
    state = tickAuthority(state, 100);
    expect(state.timeRemainingMs).toBe(before - 100);
    expect(state.tick).toBeGreaterThan(0);
  });

  it('matchEndedDetail is unified shape', () => {
    const state = twoPlayer();
    const d = matchEndedDetail({
      ...state,
      winner: 'seekers',
      endReason: 'budget',
      caughtHumans: [{ id: 'r1', name: 'R' }],
    });
    expect(d).toEqual({
      winner: 'seekers',
      reason: 'budget',
      humanCatches: 1,
      catchBudget: state.config.catchBudget,
    });
  });
});
