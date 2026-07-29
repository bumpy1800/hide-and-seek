import { describe, expect, it, beforeEach } from 'vitest';
import {
  AI_SPEED,
  createLobby,
  defaultConfig,
  isEightDirVelocity,
  joinHuman,
  quantizeTo8Dir,
  resetAiBrains,
  skipToPlaying,
  startMatch,
  stepAiCrowd,
} from '../src/index.js';

describe('quantizeTo8Dir', () => {
  it('maps continuous angles onto 8 human-reachable directions', () => {
    const e = quantizeTo8Dir(1, 0);
    expect(e.nx).toBeCloseTo(1, 5);
    expect(e.ny).toBeCloseTo(0, 5);
    const ne = quantizeTo8Dir(1, 1);
    expect(ne.nx).toBeCloseTo(Math.SQRT1_2, 5);
    expect(ne.ny).toBeCloseTo(Math.SQRT1_2, 5);
    const odd = quantizeTo8Dir(0.3, 0.9);
    // Must be one of the 8 unit dirs
    const mag = Math.hypot(odd.nx, odd.ny);
    expect(mag).toBeCloseTo(1, 5);
    // not the raw continuous aim (0.3,0.9 normalized ≠ 8-dir if unquantized would differ)
    expect(isEightDirVelocity(odd.nx * AI_SPEED, odd.ny * AI_SPEED, AI_SPEED)).toBe(true);
  });

  it('returns zero for near-zero input', () => {
    expect(quantizeTo8Dir(0, 0)).toEqual({ nx: 0, ny: 0 });
  });
});

describe('stepAiCrowd 8-direction velocities', () => {
  beforeEach(() => {
    resetAiBrains();
  });

  it('moving AI only use 8-dir velocities at AI_SPEED', () => {
    let lobby = createLobby('ai8', defaultConfig({ aiCount: 12, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 42 }));
    const speed = AI_SPEED;
    // Many steps so brains pick distant targets
    for (let i = 0; i < 40; i++) {
      state = stepAiCrowd(state, 50, i + 1);
      state = { ...state, tick: state.tick + 1 };
      for (const e of Object.values(state.entities)) {
        if (e.kind !== 'ai' || !e.alive) continue;
        expect(isEightDirVelocity(e.vx, e.vy, speed, 1)).toBe(true);
        const mag = Math.hypot(e.vx, e.vy);
        if (mag > 1) {
          expect(mag).toBeCloseTo(speed, 0);
        }
      }
    }
  });
});
