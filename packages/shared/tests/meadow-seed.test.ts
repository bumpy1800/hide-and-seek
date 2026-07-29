import { describe, expect, it } from 'vitest';
import {
  createLobby,
  defaultConfig,
  getSolidObstacles,
  joinHuman,
  listMeadowDecor,
  meadowSeedFromMatchSeed,
  returnToLobby,
  startMatch,
  startPracticeMatch,
} from '../src/index.js';

describe('room-scoped meadow seed', () => {
  it('meadowSeedFromMatchSeed is stable and changes with input', () => {
    expect(meadowSeedFromMatchSeed(1)).toBe(meadowSeedFromMatchSeed(1));
    expect(meadowSeedFromMatchSeed(1)).not.toBe(meadowSeedFromMatchSeed(2));
  });

  it('createLobby picks a meadowSeed; different rooms get different layouts', () => {
    const a = createLobby('room-a', defaultConfig({ aiCount: 0 }), 111);
    const b = createLobby('room-b', defaultConfig({ aiCount: 0 }), 999);
    expect(a.meadowSeed).toBe(111);
    expect(b.meadowSeed).toBe(999);

    const decorA = listMeadowDecor(a.meadowSeed);
    const decorB = listMeadowDecor(b.meadowSeed);
    expect(decorA.length).toBe(decorB.length);
    const same =
      decorA.length > 0 &&
      decorA.every(
        (d, i) =>
          d.kind === decorB[i]!.kind &&
          Math.abs(d.x - decorB[i]!.x) < 0.01 &&
          Math.abs(d.y - decorB[i]!.y) < 0.01,
      );
    expect(same).toBe(false);
    expect(getSolidObstacles(a.meadowSeed).length).toBeGreaterThan(0);
  });

  it('rematch keeps the same meadowSeed as room create', () => {
    let lobby = createLobby('keep', defaultConfig({ aiCount: 0, seekerPrepMs: 0 }), 4242);
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const first = startMatch(res.state, { mode: 'normal', seed: 11 });
    expect(first.meadowSeed).toBe(4242);
    const again = startMatch(returnToLobby(first), { mode: 'normal', seed: 99 });
    expect(again.meadowSeed).toBe(4242);
  });

  it('practice start keeps lobby meadowSeed (not match seed)', () => {
    const lobby = createLobby('p', defaultConfig(), 7777);
    const res = joinHuman(lobby, 'solo', 'S');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const state = startPracticeMatch(res.state, 12345, 'rabbit');
    expect(state.meadowSeed).toBe(7777);
    expect(state.meadowSeed).not.toBe(meadowSeedFromMatchSeed(12345));
  });
});
