import { describe, expect, it } from 'vitest';
import {
  POST_REVEAL_COUNTDOWN_MS,
  START_SEQUENCE_MS,
  applyRoomSettings,
  createLobby,
  defaultConfig,
  joinHuman,
  startMatch,
  startSequenceStage,
  tickTimer,
} from '../src/index.js';

describe('fox assignment mode', () => {
  it('roulette uses full start sequence and random seeker', () => {
    let lobby = createLobby(
      'r',
      defaultConfig({ foxMode: 'roulette', aiCount: 0, seekerPrepMs: 0 }),
    );
    lobby = applyRoomSettings(lobby, {
      catchBudget: 3,
      timeLimitMs: 60_000,
      aiCount: 0,
      foxMode: 'roulette',
    });
    let res = joinHuman(lobby, 'p1', 'P1');
    res = joinHuman(res.ok ? res.state : lobby, 'p2', 'P2');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const state = startMatch(res.state, { mode: 'normal', seed: 7, foxMode: 'roulette' });
    expect(state.phase).toBe('starting');
    expect(state.startSequenceRemainingMs).toBe(START_SEQUENCE_MS);
    expect(startSequenceStage(state.startSequenceRemainingMs)).toBe('roulette');
    expect(state.seekerId === 'p1' || state.seekerId === 'p2').toBe(true);
    expect(state.config.foxMode).toBe('roulette');
  });

  it('designate sets chosen seeker and skips roulette secrecy', () => {
    let lobby = createLobby(
      'd',
      defaultConfig({ foxMode: 'designate', aiCount: 0, seekerPrepMs: 0 }),
    );
    lobby = applyRoomSettings(lobby, {
      catchBudget: 5,
      timeLimitMs: 90_000,
      aiCount: 0,
      foxMode: 'designate',
    });
    let res = joinHuman(lobby, 'alice', '앨리스');
    res = joinHuman(res.ok ? res.state : lobby, 'bob', '밥');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const state = startMatch(res.state, {
      mode: 'normal',
      seed: 1,
      foxMode: 'designate',
      designatedSeekerId: 'bob',
    });
    expect(state.seekerId).toBe('bob');
    expect(state.entities.bob!.role).toBe('seeker');
    expect(state.entities.alice!.role).toBe('hider');
    // Countdown only — no roulette window
    expect(state.startSequenceRemainingMs).toBe(POST_REVEAL_COUNTDOWN_MS);
    expect(startSequenceStage(state.startSequenceRemainingMs)).toBe('countdown');
    expect(state.config.foxMode).toBe('designate');
    // After countdown, playing
    const playing = tickTimer(state, POST_REVEAL_COUNTDOWN_MS);
    expect(playing.phase).toBe('playing');
  });

  it('designate without valid id throws', () => {
    let lobby = createLobby('x', defaultConfig({ foxMode: 'designate', aiCount: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(() =>
      startMatch(res.state, {
        mode: 'normal',
        foxMode: 'designate',
        designatedSeekerId: 'not-here',
      }),
    ).toThrow(/designated seeker/);
  });
});
