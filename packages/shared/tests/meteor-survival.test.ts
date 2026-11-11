import { describe, expect, it } from 'vitest';
import {
  circlesOverlap,
  createMeteorRun,
  defaultMeteorConfig,
  difficultyAt,
  formatSurvivalMs,
  multiViewGrid,
  normalizeIntent8,
  rankBySurvival,
  setShipIntent,
  spawnMeteor,
  stepMeteorRun,
  velocityFromIntent8,
} from '../src/meteorSurvival.js';

describe('dodge survival — 8-dir ship', () => {
  it('normalizes intent to 8 discrete directions', () => {
    expect(normalizeIntent8(0.9, -0.2)).toEqual({ dx: 1, dy: -1 });
    expect(normalizeIntent8(-3, 0)).toEqual({ dx: -1, dy: 0 });
    expect(normalizeIntent8(0, 0)).toEqual({ dx: 0, dy: 0 });
  });

  it('cardinal move has full speed; diagonal matches magnitude', () => {
    const speed = 100;
    const right = velocityFromIntent8(1, 0, speed);
    expect(right.vx).toBeCloseTo(100);
    expect(right.vy).toBeCloseTo(0);

    const up = velocityFromIntent8(0, -1, speed);
    expect(up.vx).toBeCloseTo(0);
    expect(up.vy).toBeCloseTo(-100);

    const diag = velocityFromIntent8(1, 1, speed);
    const mag = Math.hypot(diag.vx, diag.vy);
    expect(mag).toBeCloseTo(100, 5);
    expect(diag.vx).toBeCloseTo(100 * Math.SQRT1_2, 5);
    expect(diag.vy).toBeCloseTo(100 * Math.SQRT1_2, 5);
  });

  it('step moves ship on all 8 directions from center', () => {
    const dirs: Array<[number, number]> = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];
    for (const [dx, dy] of dirs) {
      let s = createMeteorRun({
        seed: 42,
        config: { spawnIntervalMs: 999_999, minSpawnIntervalMs: 999_999, width: 400, height: 400 },
      });
      const ox = s.ship.x;
      const oy = s.ship.y;
      s = setShipIntent(s, dx, dy);
      s = stepMeteorRun(s, 100);
      if (dx !== 0) expect(Math.sign(s.ship.x - ox)).toBe(dx);
      if (dy !== 0) expect(Math.sign(s.ship.y - oy)).toBe(dy);
    }
  });
});

describe('dodge survival — omni bullets + collision + timer', () => {
  it('default hazards are bullet-scale (not large rocks)', () => {
    const c = defaultMeteorConfig();
    expect(c.meteorMaxRadius).toBeLessThanOrEqual(6);
    expect(c.meteorMinRadius).toBeLessThan(c.meteorMaxRadius);
    expect(c.shipRadius).toBeLessThanOrEqual(12);
    expect(c.spawnIntervalMs).toBeLessThan(500);
  });

  it('spawned bullets have non-zero velocity (any direction) and small radius', () => {
    let s = createMeteorRun({ seed: 7, config: { maxMeteors: 20, hardMaxMeteors: 20 } });
    for (let i = 0; i < 8; i++) s = spawnMeteor(s);
    expect(s.meteors.length).toBe(8);
    for (const m of s.meteors) {
      expect(Math.hypot(m.vx, m.vy)).toBeGreaterThan(0);
      expect(m.radius).toBeLessThanOrEqual(6);
    }
    const hasHorizontal = s.meteors.some((m) => Math.abs(m.vx) > 1);
    const hasVertical = s.meteors.some((m) => Math.abs(m.vy) > 1);
    expect(hasHorizontal).toBe(true);
    expect(hasVertical).toBe(true);
  });

  it('step advances bullets and despawns far off-screen bodies', () => {
    let s = createMeteorRun({
      seed: 3,
      config: {
        width: 200,
        height: 200,
        spawnIntervalMs: 999_999,
        minSpawnIntervalMs: 999_999,
        meteorMinSpeed: 500,
        meteorMaxSpeed: 500,
      },
    });
    s = {
      ...s,
      meteors: [
        {
          id: 'fast',
          x: 100,
          y: 100,
          vx: 1000,
          vy: 0,
          radius: 3,
        },
      ],
    };
    s = stepMeteorRun(s, 500);
    expect(s.meteors.find((m) => m.id === 'fast')).toBeUndefined();
  });

  it('ship–bullet overlap ends run and freezes survival score', () => {
    let s = createMeteorRun({
      seed: 1,
      config: {
        width: 300,
        height: 300,
        shipRadius: 10,
        spawnIntervalMs: 999_999,
        minSpawnIntervalMs: 999_999,
      },
    });
    s = stepMeteorRun(s, 250);
    expect(s.ship.alive).toBe(true);
    expect(s.ship.survivalMs).toBe(250);

    s = {
      ...s,
      meteors: [
        {
          id: 'hit',
          x: s.ship.x,
          y: s.ship.y,
          vx: 0,
          vy: 0,
          radius: 4,
        },
      ],
    };
    s = stepMeteorRun(s, 16);
    expect(s.ship.alive).toBe(false);
    const scoreAtDeath = s.ship.survivalMs;
    expect(scoreAtDeath).toBe(266);

    s = stepMeteorRun(s, 500);
    expect(s.ship.alive).toBe(false);
    expect(s.ship.survivalMs).toBe(scoreAtDeath);
    expect(s.elapsedMs).toBe(250 + 16 + 500);
  });

  it('circlesOverlap is used by hit test (distance)', () => {
    expect(circlesOverlap(0, 0, 5, 8, 0, 4)).toBe(true);
    expect(circlesOverlap(0, 0, 5, 10, 0, 4)).toBe(false);
  });
});

describe('dodge survival — time-based difficulty ramp', () => {
  it('difficultyAt tightens spawn interval and raises speed/density with time', () => {
    const c = defaultMeteorConfig();
    const d0 = difficultyAt(0, c);
    const d30 = difficultyAt(30_000, c);
    const d50 = difficultyAt(50_000, c);
    expect(d30.spawnIntervalMs).toBeLessThan(d0.spawnIntervalMs);
    expect(d30.speedMul).toBeGreaterThan(d0.speedMul);
    expect(d30.maxMeteors).toBeGreaterThan(d0.maxMeteors);
    expect(d50.bulletsPerSpawn).toBeGreaterThanOrEqual(d0.bulletsPerSpawn);
    expect(d0.spawnIntervalMs).toBe(c.spawnIntervalMs);
    expect(d50.spawnIntervalMs).toBeGreaterThanOrEqual(c.minSpawnIntervalMs);
  });

  it('step path spawns more bullets in the same window at high survival time', () => {
    const windowMs = 900;
    const cfg = {
      width: 900,
      height: 500,
      maxMeteors: 40,
      hardMaxMeteors: 200,
      spawnIntervalMs: 300,
      minSpawnIntervalMs: 60,
    };

    function bulletsAfter(startSurvivalMs: number): number {
      let s = createMeteorRun({ seed: 77, config: cfg });
      s = {
        ...s,
        ship: { ...s.ship, survivalMs: startSurvivalMs },
        elapsedMs: startSurvivalMs,
        spawnCooldownMs: 0,
        meteors: [],
      };
      s = stepMeteorRun(s, windowMs);
      return s.meteors.length;
    }

    const early = bulletsAfter(0);
    const late = bulletsAfter(40_000);
    expect(late).toBeGreaterThan(early);
    expect(early).toBeGreaterThan(0);
  });

  it('spawned bullets at high ramp are faster than base (speedMul on spawn path)', () => {
    const c = defaultMeteorConfig({
      meteorMinSpeed: 100,
      meteorMaxSpeed: 100,
      maxMeteors: 50,
      hardMaxMeteors: 50,
    });
    let s = createMeteorRun({ seed: 5, config: c });
    const d0 = difficultyAt(0, c);
    const dLate = difficultyAt(40_000, c);
    s = spawnMeteor(s, d0.speedMul, 50);
    const slow = Math.hypot(s.meteors[0]!.vx, s.meteors[0]!.vy);
    s = spawnMeteor(s, dLate.speedMul, 50);
    const fast = Math.hypot(s.meteors[1]!.vx, s.meteors[1]!.vy);
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('dodge survival — multi ranking + grid layout', () => {
  it('rankBySurvival sorts highest survival first', () => {
    const ranks = rankBySurvival([
      { id: 'a', name: 'A', survivalMs: 1200 },
      { id: 'b', name: 'B', survivalMs: 3400 },
      { id: 'c', name: 'C', survivalMs: 3400 },
    ]);
    expect(ranks[0]!.id).toBe('b');
    expect(ranks.map((r) => r.survivalMs)).toEqual([3400, 3400, 1200]);
  });

  it('multiViewGrid places N cells and marks local emphasis', () => {
    const cells = multiViewGrid(4, 800, 600, 2, 8, 8);
    expect(cells).toHaveLength(4);
    expect(cells.filter((c) => c.isLocal)).toHaveLength(1);
    expect(cells[2]!.isLocal).toBe(true);
    const keys = new Set(cells.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(4);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.y).toBeGreaterThanOrEqual(0);
      expect(c.x + c.w).toBeLessThanOrEqual(800 + 0.001);
      expect(c.y + c.h).toBeLessThanOrEqual(600 + 0.001);
    }
  });

  it('formatSurvivalMs for HUD', () => {
    expect(formatSurvivalMs(1234)).toMatch(/1\.23/);
    expect(formatSurvivalMs(65_000)).toMatch(/1:/);
  });
});
