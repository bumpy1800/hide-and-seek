import { describe, expect, it } from 'vitest';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  createLobby,
  defaultConfig,
  integrateMotion,
  joinHuman,
  setEntityVelocity,
  startMatch,
} from '../src/index.js';

describe('expanded meadow map bounds', () => {
  it('exposes world larger than legacy 960×640', () => {
    expect(MAP_WIDTH).toBeGreaterThan(960);
    expect(MAP_HEIGHT).toBeGreaterThan(640);
    expect(MAP_WIDTH).toBe(2400);
    expect(MAP_HEIGHT).toBe(1600);
    const cfg = defaultConfig();
    expect(cfg.mapWidth).toBe(MAP_WIDTH);
    expect(cfg.mapHeight).toBe(MAP_HEIGHT);
  });

  it('clamps motion to the expanded map via integrateMotion', () => {
    let state = createLobby('bounds', defaultConfig());
    let joined = joinHuman(state, 'p1', 'P', { x: MAP_WIDTH - 10, y: MAP_HEIGHT - 10 });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    joined = joinHuman(joined.state, 'p2', 'Q', { x: 100, y: 100 });
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    state = startMatch(joined.state, 1);
    // fling toward outer corner at high speed
    state = setEntityVelocity(state, 'p1', 5000, 5000);
    state = integrateMotion(state, 1);
    const e = state.entities['p1']!;
    expect(e.x).toBeLessThanOrEqual(MAP_WIDTH - 16);
    expect(e.y).toBeLessThanOrEqual(MAP_HEIGHT - 16);
    expect(e.x).toBeGreaterThanOrEqual(16);
    expect(e.y).toBeGreaterThanOrEqual(16);
  });

  it('spawns AI inside expanded meadow', () => {
    let state = createLobby('ai-bounds', defaultConfig());
    let joined = joinHuman(state, 'p1', 'P');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    joined = joinHuman(joined.state, 'p2', 'Q');
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;
    // 2 humans → 1 seeker + 1 rabbit → 5 AI
    state = startMatch(joined.state, 42);
    const ais = Object.values(state.entities).filter((e) => e.kind === 'ai');
    expect(ais.length).toBe(5);
    for (const a of ais) {
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(MAP_WIDTH);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThanOrEqual(MAP_HEIGHT);
    }
  });
});
