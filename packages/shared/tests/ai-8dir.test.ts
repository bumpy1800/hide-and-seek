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
    expect(Math.hypot(odd.nx, odd.ny)).toBeCloseTo(1, 5);
    expect(isEightDirVelocity(odd.nx * AI_SPEED, odd.ny * AI_SPEED, AI_SPEED)).toBe(
      true,
    );
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

  it('holds one 8-dir across consecutive ticks (keyboard-like, not re-snap every frame)', () => {
    let lobby = createLobby('hold', defaultConfig({ aiCount: 10, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 11 }));

    // Warm up so brains have distant waypoints + locked dir
    for (let w = 0; w < 5; w++) {
      state = stepAiCrowd(state, 50, w + 1);
      state = { ...state, tick: state.tick + 1 };
    }

    const prev = new Map<string, { vx: number; vy: number }>();
    for (const e of Object.values(state.entities)) {
      if (e.kind === 'ai' && Math.hypot(e.vx, e.vy) > 1) {
        prev.set(e.id, { vx: e.vx, vy: e.vy });
      }
    }
    expect(prev.size).toBeGreaterThan(0);

    // Next ~5 ticks (250ms) — hold min is 400ms so lock should stick
    let sameDirTicks = 0;
    let totalChecks = 0;
    for (let i = 0; i < 5; i++) {
      state = stepAiCrowd(state, 50, i + 20);
      state = { ...state, tick: state.tick + 1 };
      for (const e of Object.values(state.entities)) {
        if (e.kind !== 'ai' || !e.alive) continue;
        const p = prev.get(e.id);
        if (!p || Math.hypot(e.vx, e.vy) < 1) continue;
        totalChecks += 1;
        if (Math.abs(e.vx - p.vx) < 0.5 && Math.abs(e.vy - p.vy) < 0.5) {
          sameDirTicks += 1;
        }
      }
    }
    expect(totalChecks).toBeGreaterThan(0);
    expect(sameDirTicks / totalChecks).toBeGreaterThan(0.8);
  });
});
