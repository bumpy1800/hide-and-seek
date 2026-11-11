import { describe, expect, it } from 'vitest';
import {
  refreshTouchFoxSurroundGoal,
  touchFoxSurroundGoal,
  type AiBrain,
  type EntityState,
} from '../src/ai.js';
import { MAP_HEIGHT, MAP_WIDTH } from '../src/types.js';

function rabbit(id: string, x: number, y: number): EntityState {
  return {
    id,
    kind: 'ai',
    role: 'hider',
    name: id,
    x,
    y,
    vx: 0,
    vy: 0,
    alive: true,
  };
}

function fox(x: number, y: number, vx = 0, vy = 0): EntityState {
  return {
    id: 'fox',
    kind: 'human',
    role: 'seeker',
    name: '여우',
    x,
    y,
    vx,
    vy,
    alive: true,
  };
}

function brainAt(x: number, y: number): AiBrain {
  return {
    targetX: x,
    targetY: y,
    idleMs: 0,
    dirNx: 0,
    dirNy: 0,
    dirHoldMs: 0,
    missionKey: null,
    missionDepartDelayMs: 0,
    visitPattern: 'pass_through',
    afterX: x,
    afterY: y,
    visitedPoint: false,
    visitPhase: 'point',
    offsetX: x,
    offsetY: y,
    approachX: x,
    approachY: y,
    lastX: x,
    lastY: y,
    stuckMs: 0,
    sawMotion: false,
    escapeHoldMs: 0,
    surroundGoalX: x,
    surroundGoalY: y,
    surroundRefreshMs: 0,
  };
}

describe('touchFoxSurroundGoal', () => {
  it('assigns different flank goals to different AI (not all on fox body)', () => {
    const s = fox(900, 500, 160, 0); // running right, faster than rabbits
    const goals = ['ai-a', 'ai-b', 'ai-c', 'ai-d', 'ai-e', 'ai-f'].map((id) =>
      touchFoxSurroundGoal(rabbit(id, 400, 500), s, MAP_WIDTH, MAP_HEIGHT, 1),
    );
    // Spread: not all the same cell
    const keys = new Set(goals.map((g) => `${Math.round(g.x / 50)}:${Math.round(g.y / 50)}`));
    expect(keys.size).toBeGreaterThanOrEqual(3);
    // Goals should not all be exactly on the fox
    const onFox = goals.filter(
      (g) => Math.hypot(g.x - s.x, g.y - s.y) < 20,
    ).length;
    expect(onFox).toBeLessThan(goals.length);
  });

  it('places intercepts ahead of a moving fox (not pure rear chase)', () => {
    const s = fox(600, 500, 170, 0);
    const g = touchFoxSurroundGoal(
      rabbit('chaser', 200, 500),
      s,
      MAP_WIDTH,
      MAP_HEIGHT,
      2,
    );
    // For a far rabbit, goal should be toward/around fox, often ahead (x > fox when moving +x)
    // At least goal is nearer to fox than starting rabbit is, or offset beside fox
    const rabbitDist = Math.hypot(200 - s.x, 500 - s.y);
    const goalDist = Math.hypot(g.x - s.x, g.y - s.y);
    expect(goalDist).toBeLessThan(rabbitDist);
    // Prefer intercept: goal x not far behind fox when fox runs +x
    expect(g.x).toBeGreaterThan(s.x - 80);
  });

  it('closes in on fox when already nearby', () => {
    const s = fox(800, 400, 0, 0);
    const g = touchFoxSurroundGoal(
      rabbit('near', 820, 410),
      s,
      MAP_WIDTH,
      MAP_HEIGHT,
      1,
    );
    expect(Math.hypot(g.x - s.x, g.y - s.y)).toBeLessThan(30);
  });

  it('stays inside map bounds', () => {
    const s = fox(100, 100, -100, -100);
    for (const id of ['a', 'b', 'c', 'd']) {
      const g = touchFoxSurroundGoal(
        rabbit(id, 50, 50),
        s,
        MAP_WIDTH,
        MAP_HEIGHT,
        3,
      );
      expect(g.x).toBeGreaterThanOrEqual(40);
      expect(g.x).toBeLessThanOrEqual(MAP_WIDTH - 40);
      expect(g.y).toBeGreaterThanOrEqual(40);
      expect(g.y).toBeLessThanOrEqual(MAP_HEIGHT - 40);
    }
  });

  it('refreshTouchFoxSurroundGoal holds goal across short ticks (no thrash)', () => {
    const s = fox(700, 400, 120, 0);
    const r = rabbit('hold', 300, 400);
    const b = brainAt(r.x, r.y);
    const first = refreshTouchFoxSurroundGoal(b, r, s, MAP_WIDTH, MAP_HEIGHT, 1, 16, true);
    expect(first).toBe(true);
    const gx = b.surroundGoalX;
    const gy = b.surroundGoalY;
    expect(b.surroundRefreshMs).toBeGreaterThan(0);
    // Fox velocity flickers but goal stays until refresh elapses
    const s2 = fox(705, 402, 40, 30);
    const again = refreshTouchFoxSurroundGoal(b, r, s2, MAP_WIDTH, MAP_HEIGHT, 1, 16, false);
    expect(again).toBe(false);
    expect(b.surroundGoalX).toBe(gx);
    expect(b.surroundGoalY).toBe(gy);
  });
});
