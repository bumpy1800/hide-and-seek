import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEADOW_SEED,
  ENTITY_COLLIDE_RADIUS,
  createLobby,
  defaultConfig,
  getSolidObstacles,
  integrateMotion,
  joinHuman,
  listMeadowDecor,
  resolveSolidCollisions,
  setEntityVelocity,
  solidRadiusFor,
  startMatch,
  skipToPlaying,
} from '../src/index.js';

describe('meadow solid obstacles (tree/rock)', () => {
  it('builds solids only for tree and rock (not bush)', () => {
    const solids = getSolidObstacles(DEFAULT_MEADOW_SEED);
    expect(solids.length).toBeGreaterThan(5);
    expect(solids.every((s) => s.kind === 'tree' || s.kind === 'rock')).toBe(true);
    expect(solidRadiusFor('bush', 1)).toBeNull();
    expect(solidRadiusFor('tree', 1)).toBeGreaterThan(0);
    expect(solidRadiusFor('rock', 1)).toBeGreaterThan(0);
  });

  it('client decor list and solids share the same seed layout', () => {
    const decor = listMeadowDecor(DEFAULT_MEADOW_SEED);
    const solids = getSolidObstacles(DEFAULT_MEADOW_SEED);
    for (const o of solids) {
      const match = decor.find(
        (d) =>
          d.kind === o.kind &&
          Math.abs(d.x - o.x) < 0.01 &&
          Math.abs(d.y - o.y) < 0.01,
      );
      expect(match).toBeDefined();
    }
  });

  it('resolveSolidCollisions pushes a point outside a rock/tree circle', () => {
    const solids = getSolidObstacles(DEFAULT_MEADOW_SEED);
    const rock = solids.find((s) => s.kind === 'rock') ?? solids[0]!;
    // Place entity at obstacle center — must be pushed out
    const out = resolveSolidCollisions(
      rock.x,
      rock.y,
      ENTITY_COLLIDE_RADIUS,
      solids,
    );
    const d = Math.hypot(out.x - rock.x, out.y - rock.y);
    expect(d).toBeGreaterThanOrEqual(rock.radius + ENTITY_COLLIDE_RADIUS - 0.5);
  });

  it('integrateMotion cannot walk through a solid obstacle', () => {
    let lobby = createLobby('obs', defaultConfig({ aiCount: 0, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'a', 'A', { x: 100, y: 100 });
    res = joinHuman(res.ok ? res.state : lobby, 'b', 'B', { x: 200, y: 200 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = startMatch(res.state, { mode: 'normal', seed: 1 });
    const solids = getSolidObstacles(state.meadowSeed);
    const target = solids[0]!;
    const moverId = state.humans.find((h) => h !== state.seekerId) ?? state.humans[0]!;
    const approachX = target.x - (target.radius + ENTITY_COLLIDE_RADIUS + 8);
    state = {
      ...state,
      seekerPrepRemainingMs: 0,
      phase: 'playing' as const,
      startSequenceRemainingMs: 0,
      entities: {
        ...state.entities,
        [moverId]: {
          ...state.entities[moverId]!,
          x: approachX,
          y: target.y,
          vx: 400,
          vy: 0,
        },
      },
    };
    for (let i = 0; i < 40; i++) {
      state = integrateMotion(state, 0.05);
    }
    const e = state.entities[moverId]!;
    const d = Math.hypot(e.x - target.x, e.y - target.y);
    expect(d).toBeGreaterThanOrEqual(target.radius + ENTITY_COLLIDE_RADIUS - 1);
  });
});

