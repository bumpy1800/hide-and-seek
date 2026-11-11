import { describe, expect, it } from 'vitest';
import {
  CATCH_COOLDOWN_MS,
  attemptCatch,
  createLobby,
  defaultConfig,
  formatCatchCooldownSec,
  joinHuman,
  skipToPlaying,
  startMatch,
  tickTimer,
} from '../src/index.js';

function twoPlayerNormal(seed = 11) {
  let lobby = createLobby(
    'cd',
    defaultConfig({ aiCount: 2, seekerPrepMs: 0, catchRange: 500 }),
  );
  let res = joinHuman(lobby, 'a', '여우');
  res = joinHuman(res.ok ? res.state : lobby, 'b', '토끼');
  if (!res.ok) throw new Error('join');
  return skipToPlaying(startMatch(res.state, { mode: 'normal', seed }));
}

describe('fox catch cooldown', () => {
  it('exports 3s cooldown constant', () => {
    expect(CATCH_COOLDOWN_MS).toBe(3_000);
    expect(formatCatchCooldownSec(2500)).toBe('2.5');
  });

  it('successful catch arms 3s cooldown; second catch blocked until tick drains it', () => {
    let state = twoPlayerNormal(3);
    const seekerId = state.seekerId!;
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai' && e.alive);
    expect(ais.length).toBeGreaterThanOrEqual(2);
    const a1 = ais[0]!;
    const a2 = ais[1]!;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100 },
        [a1.id]: { ...a1, x: 110, y: 100 },
        [a2.id]: { ...a2, x: 120, y: 100 },
      },
    };

    const r1 = attemptCatch(state, seekerId, a1.id);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.state.catchCooldownRemainingMs).toBe(CATCH_COOLDOWN_MS);

    const r2 = attemptCatch(r1.state, seekerId, a2.id);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe('catch_cooldown');
    expect(r2.state.entities[a2.id]!.alive).toBe(true);

    // Drain cooldown via hunt ticks
    let s = r1.state;
    for (let t = 0; t < CATCH_COOLDOWN_MS; t += 50) {
      s = tickTimer(s, 50);
    }
    expect(s.catchCooldownRemainingMs).toBeLessThanOrEqual(0);

    const r3 = attemptCatch(
      {
        ...s,
        entities: {
          ...s.entities,
          [seekerId]: { ...s.entities[seekerId]!, x: 100, y: 100 },
          [a2.id]: { ...s.entities[a2.id]!, x: 110, y: 100, alive: true },
        },
      },
      seekerId,
      a2.id,
    );
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.state.catchCooldownRemainingMs).toBe(CATCH_COOLDOWN_MS);
  });
});
