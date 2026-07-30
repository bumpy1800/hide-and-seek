import { describe, expect, it, beforeEach } from 'vitest';
import {
  AI_SPEED,
  createLobby,
  defaultConfig,
  integrateMotion,
  joinHuman,
  resetAiBrains,
  skipToPlaying,
  startMatch,
  stepAiCrowd,
} from '../src/index.js';

/**
 * Original rabbit AI movement: continuous aim toward waypoints (not 8-dir),
 * map-bounds integration only.
 */
describe('original continuous AI rabbit movement', () => {
  beforeEach(() => {
    resetAiBrains();
  });

  it('AI velocity is continuous toward waypoint at AI_SPEED', () => {
    let lobby = createLobby('ai-cont', defaultConfig({ aiCount: 6, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 42 }));
    let anyMoving = false;
    for (let i = 0; i < 30; i++) {
      state = stepAiCrowd(state, 50, i + 1);
      state = { ...state, tick: state.tick + 1 };
      for (const e of Object.values(state.entities)) {
        if (e.kind !== 'ai' || !e.alive) continue;
        const mag = Math.hypot(e.vx, e.vy);
        if (mag > 1) {
          anyMoving = true;
          expect(mag).toBeCloseTo(AI_SPEED, 0);
        }
      }
    }
    expect(anyMoving).toBe(true);
  });

  it('AI positions change freely over time (no solid blocking in integrateMotion)', () => {
    let lobby = createLobby('ai-free', defaultConfig({ aiCount: 8, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 7 }));
    const start = new Map(
      Object.values(state.entities)
        .filter((e) => e.kind === 'ai')
        .map((e) => [e.id, { x: e.x, y: e.y }] as const),
    );
    for (let i = 0; i < 80; i++) {
      state = stepAiCrowd(state, 50, i + 1);
      state = integrateMotion(state, 0.05);
      state = { ...state, tick: state.tick + 1 };
    }
    let moved = 0;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'ai') continue;
      const s = start.get(e.id);
      if (s && Math.hypot(e.x - s.x, e.y - s.y) > 15) moved += 1;
    }
    expect(moved).toBeGreaterThanOrEqual(Math.floor(start.size * 0.5));
  });
});
