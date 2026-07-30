import { describe, expect, it, beforeEach } from 'vitest';
import {
  AI_SPEED,
  ENTITY_COLLIDE_RADIUS,
  createLobby,
  defaultConfig,
  getSolidObstacles,
  integrateMotion,
  isEightDirVelocity,
  joinHuman,
  pickUnblockedEightDir,
  probeDirTravel,
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

  it('pickUnblockedEightDir avoids charging into a solid circle', () => {
    const solids = getSolidObstacles(7);
    const rock = solids[0]!;
    // Stand just outside rock, target is through the rock center
    const x = rock.x - (rock.radius + ENTITY_COLLIDE_RADIUS + 4);
    const y = rock.y;
    const dir = pickUnblockedEightDir(
      x,
      y,
      rock.x + 80,
      rock.y,
      AI_SPEED,
      solids,
    );
    expect(dir).not.toBeNull();
    if (dir) {
      const travel = probeDirTravel(x, y, dir.nx, dir.ny, AI_SPEED, 0.05, solids);
      expect(travel).toBeGreaterThan(AI_SPEED * 0.05 * 0.25);
    }
  });

  it('AI does not stay jammed forever against solids (repath / slide)', () => {
    let lobby = createLobby('unstuck', defaultConfig({ aiCount: 8, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A');
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 3 }));
    // Run many AI + motion ticks; all AI should change position over the window
    const startPos = new Map(
      Object.values(state.entities)
        .filter((e) => e.kind === 'ai')
        .map((e) => [e.id, { x: e.x, y: e.y }] as const),
    );
    for (let i = 0; i < 120; i++) {
      state = stepAiCrowd(state, 50, i + 1);
      state = integrateMotion(state, 0.05);
      state = { ...state, tick: state.tick + 1 };
    }
    let movedCount = 0;
    for (const e of Object.values(state.entities)) {
      if (e.kind !== 'ai' || !e.alive) continue;
      const s = startPos.get(e.id);
      if (!s) continue;
      if (Math.hypot(e.x - s.x, e.y - s.y) > 20) movedCount += 1;
    }
    // Most AI should have relocated rather than grind one wall forever
    expect(movedCount).toBeGreaterThanOrEqual(Math.floor(startPos.size * 0.5));
  });
});
