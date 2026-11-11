/**
 * Pure dodge survival sim — classic 닷지-style: small omni bullets, 8-dir move,
 * time-ramped density. No Phaser; Vitest drives these functions directly.
 */

import { createRng } from './rng.js';

export type MeteorWorldConfig = {
  width: number;
  height: number;
  shipSpeed: number;
  shipRadius: number;
  /** Base projectile speed range (px/s) at t=0. */
  meteorMinSpeed: number;
  meteorMaxSpeed: number;
  /** Bullet radii — kept small like classic 닷지. */
  meteorMinRadius: number;
  meteorMaxRadius: number;
  /** Spawn interval at t=0 (ms). Shrinks via difficultyAt. */
  spawnIntervalMs: number;
  /** Floor for ramped spawn interval. */
  minSpawnIntervalMs: number;
  /** Soft cap at t=0; ramp can raise effective max toward hardMaxMeteors. */
  maxMeteors: number;
  hardMaxMeteors: number;
  /** Margin outside playfield where bullets enter from. */
  spawnMargin: number;
};

export type MeteorBody = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
};

export type MeteorShip = {
  x: number;
  y: number;
  radius: number;
  /** Intent axes in {-1,0,1}; step normalizes diagonals. */
  intentDx: number;
  intentDy: number;
  alive: boolean;
  /** Accumulated survival time while alive (score). */
  survivalMs: number;
};

export type MeteorRunState = {
  config: MeteorWorldConfig;
  ship: MeteorShip;
  meteors: MeteorBody[];
  /** Wall time of the run (keeps ticking after death for display only). */
  elapsedMs: number;
  spawnCooldownMs: number;
  nextMeteorId: number;
  seed: number;
  /** Deterministic PRNG closed over seed progression. */
  rng: () => number;
};

export type SurvivalRank = {
  id: string;
  name: string;
  survivalMs: number;
  alive: boolean;
};

export type GridCell = {
  index: number;
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when this cell is the local player's pane. */
  isLocal: boolean;
};

/** Live difficulty derived from survival time (닷지 “시간이 갈수록 총알이 늘어난다”). */
export type DifficultyScale = {
  spawnIntervalMs: number;
  speedMul: number;
  maxMeteors: number;
  bulletsPerSpawn: number;
};

export function defaultMeteorConfig(
  overrides: Partial<MeteorWorldConfig> = {},
): MeteorWorldConfig {
  return {
    width: 960,
    height: 540,
    shipSpeed: 260,
    shipRadius: 8,
    // Fast small bullets (not sparse rocks)
    meteorMinSpeed: 140,
    meteorMaxSpeed: 260,
    meteorMinRadius: 2.5,
    meteorMaxRadius: 4.5,
    spawnIntervalMs: 320,
    minSpawnIntervalMs: 70,
    maxMeteors: 48,
    hardMaxMeteors: 140,
    spawnMargin: 28,
    ...overrides,
  };
}

/**
 * Classic 닷지 pressure curve from survival time.
 * Called from the real step path so tests observe denser fire after long runs.
 */
export function difficultyAt(
  survivalMs: number,
  config: MeteorWorldConfig,
): DifficultyScale {
  const t = Math.max(0, survivalMs) / 1000;
  // Interval shrinks toward floor (~ halves every ~12s, then floors)
  const spawnIntervalMs = Math.max(
    config.minSpawnIntervalMs,
    config.spawnIntervalMs * Math.pow(0.88, t / 3),
  );
  // Speed creeps up; soft cap so late game stays readable
  const speedMul = Math.min(2.4, 1 + t * 0.035);
  // More concurrent bullets over time
  const maxMeteors = Math.min(
    config.hardMaxMeteors,
    config.maxMeteors + Math.floor(t / 2.5) * 4,
  );
  // Multi-spawn bursts in late game
  let bulletsPerSpawn = 1;
  if (t >= 45) bulletsPerSpawn = 3;
  else if (t >= 22) bulletsPerSpawn = 2;
  return { spawnIntervalMs, speedMul, maxMeteors, bulletsPerSpawn };
}

/** Clamp intent components to -1 | 0 | 1 for discrete 8-dir input. */
export function normalizeIntent8(dx: number, dy: number): { dx: number; dy: number } {
  const sx = dx === 0 ? 0 : dx > 0 ? 1 : -1;
  const sy = dy === 0 ? 0 : dy > 0 ? 1 : -1;
  return { dx: sx, dy: sy };
}

/**
 * Unit velocity for 8-dir movement. Diagonals are normalized so speed matches
 * cardinals (√2/2 each axis).
 */
export function velocityFromIntent8(
  intentDx: number,
  intentDy: number,
  speed: number,
): { vx: number; vy: number } {
  const { dx, dy } = normalizeIntent8(intentDx, intentDy);
  if (dx === 0 && dy === 0) return { vx: 0, vy: 0 };
  if (dx !== 0 && dy !== 0) {
    const inv = Math.SQRT1_2; // 1/√2
    return { vx: dx * speed * inv, vy: dy * speed * inv };
  }
  return { vx: dx * speed, vy: dy * speed };
}

export function circlesOverlap(
  ax: number,
  ay: number,
  ar: number,
  bx: number,
  by: number,
  br: number,
): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

export function createMeteorRun(opts: {
  seed?: number;
  config?: Partial<MeteorWorldConfig>;
} = {}): MeteorRunState {
  const config = defaultMeteorConfig(opts.config);
  const seed = opts.seed ?? 1;
  const rng = createRng(seed);
  return {
    config,
    ship: {
      x: config.width / 2,
      y: config.height / 2,
      radius: config.shipRadius,
      intentDx: 0,
      intentDy: 0,
      alive: true,
      survivalMs: 0,
    },
    meteors: [],
    elapsedMs: 0,
    spawnCooldownMs: 0,
    nextMeteorId: 1,
    seed,
    rng,
  };
}

export function setShipIntent(
  state: MeteorRunState,
  dx: number,
  dy: number,
): MeteorRunState {
  const n = normalizeIntent8(dx, dy);
  return {
    ...state,
    ship: {
      ...state.ship,
      intentDx: n.dx,
      intentDy: n.dy,
    },
  };
}

/**
 * Spawn one bullet just outside a random edge, velocity aimed through the
 * playfield (omnidirectional traffic — not only top-down).
 */
export function spawnMeteor(
  state: MeteorRunState,
  speedMul = 1,
  maxCap?: number,
): MeteorRunState {
  const { config, rng } = state;
  const cap = maxCap ?? config.maxMeteors;
  if (state.meteors.length >= cap) return state;

  const edge = Math.floor(rng() * 4); // 0 top, 1 right, 2 bottom, 3 left
  const m = config.spawnMargin;
  let x = 0;
  let y = 0;
  switch (edge) {
    case 0:
      x = rng() * config.width;
      y = -m;
      break;
    case 1:
      x = config.width + m;
      y = rng() * config.height;
      break;
    case 2:
      x = rng() * config.width;
      y = config.height + m;
      break;
    default:
      x = -m;
      y = rng() * config.height;
      break;
  }

  // Aim toward a random interior point so paths cross the field in any direction
  const targetX = config.width * (0.12 + rng() * 0.76);
  const targetY = config.height * (0.12 + rng() * 0.76);
  const dirX = targetX - x;
  const dirY = targetY - y;
  const len = Math.hypot(dirX, dirY) || 1;
  const base =
    config.meteorMinSpeed + rng() * (config.meteorMaxSpeed - config.meteorMinSpeed);
  const speed = base * Math.max(0.5, speedMul);
  const radius =
    config.meteorMinRadius + rng() * (config.meteorMaxRadius - config.meteorMinRadius);

  const id = `m${state.nextMeteorId}`;
  const body: MeteorBody = {
    id,
    x,
    y,
    vx: (dirX / len) * speed,
    vy: (dirY / len) * speed,
    radius,
  };

  return {
    ...state,
    nextMeteorId: state.nextMeteorId + 1,
    meteors: [...state.meteors, body],
  };
}

function clampShip(x: number, y: number, r: number, w: number, h: number) {
  return {
    x: Math.min(w - r, Math.max(r, x)),
    y: Math.min(h - r, Math.max(r, y)),
  };
}

function meteorStillRelevant(
  m: MeteorBody,
  w: number,
  h: number,
  margin: number,
): boolean {
  const pad = margin + m.radius + 8;
  return m.x > -pad && m.x < w + pad && m.y > -pad && m.y < h + pad;
}

/**
 * Advance simulation by dtMs. While ship is alive: move, spawn (ramped), collide.
 * Survival timer only accumulates while alive; hit ends the run (alive=false).
 */
export function stepMeteorRun(state: MeteorRunState, dtMs: number): MeteorRunState {
  if (dtMs <= 0) return state;

  const dt = dtMs / 1000;
  const { config } = state;
  let next: MeteorRunState = {
    ...state,
    elapsedMs: state.elapsedMs + dtMs,
    ship: { ...state.ship },
    meteors: state.meteors.map((m) => ({ ...m })),
  };

  // Move bullets always (visuals after death still useful)
  next.meteors = next.meteors
    .map((m) => ({
      ...m,
      x: m.x + m.vx * dt,
      y: m.y + m.vy * dt,
    }))
    .filter((m) => meteorStillRelevant(m, config.width, config.height, config.spawnMargin));

  if (!next.ship.alive) {
    return next;
  }

  // Ship move (8-dir)
  const { vx, vy } = velocityFromIntent8(
    next.ship.intentDx,
    next.ship.intentDy,
    config.shipSpeed,
  );
  const pos = clampShip(
    next.ship.x + vx * dt,
    next.ship.y + vy * dt,
    next.ship.radius,
    config.width,
    config.height,
  );
  next.ship.x = pos.x;
  next.ship.y = pos.y;
  next.ship.survivalMs += dtMs;

  // 닷지 ramp from survival time (after this frame's accumulate)
  const diff = difficultyAt(next.ship.survivalMs, config);

  // Spawn cadence (interval + burst count from difficultyAt)
  next.spawnCooldownMs -= dtMs;
  while (next.spawnCooldownMs <= 0 && next.meteors.length < diff.maxMeteors) {
    for (let b = 0; b < diff.bulletsPerSpawn; b++) {
      if (next.meteors.length >= diff.maxMeteors) break;
      next = spawnMeteor(next, diff.speedMul, diff.maxMeteors);
    }
    next.spawnCooldownMs += diff.spawnIntervalMs;
  }
  if (next.spawnCooldownMs < 0) next.spawnCooldownMs = 0;

  // Collisions
  for (const m of next.meteors) {
    if (
      circlesOverlap(
        next.ship.x,
        next.ship.y,
        next.ship.radius,
        m.x,
        m.y,
        m.radius,
      )
    ) {
      next.ship.alive = false;
      break;
    }
  }

  return next;
}

/** Sort highest survival first (record race). */
export function rankBySurvival(
  entries: ReadonlyArray<{ id: string; name: string; survivalMs: number; alive?: boolean }>,
): SurvivalRank[] {
  return [...entries]
    .map((e) => ({
      id: e.id,
      name: e.name,
      survivalMs: e.survivalMs,
      alive: e.alive ?? false,
    }))
    .sort((a, b) => {
      if (b.survivalMs !== a.survivalMs) return b.survivalMs - a.survivalMs;
      return a.id.localeCompare(b.id);
    });
}

/**
 * Lay out N player views in a near-square grid inside totalW×totalH.
 * localPlayerIndex gets isLocal=true for UI emphasis.
 */
export function multiViewGrid(
  playerCount: number,
  totalW: number,
  totalH: number,
  localPlayerIndex = 0,
  gap = 8,
  padding = 8,
): GridCell[] {
  const n = Math.max(1, Math.floor(playerCount));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const innerW = totalW - padding * 2 - gap * (cols - 1);
  const innerH = totalH - padding * 2 - gap * (rows - 1);
  const cellW = innerW / cols;
  const cellH = innerH / rows;
  const cells: GridCell[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    cells.push({
      index: i,
      col,
      row,
      x: padding + col * (cellW + gap),
      y: padding + row * (cellH + gap),
      w: cellW,
      h: cellH,
      isLocal: i === localPlayerIndex,
    });
  }
  return cells;
}

/** Format survival milliseconds as m:ss.cc or s.ss for HUD. */
export function formatSurvivalMs(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  if (m > 0) {
    return `${m}:${s.toFixed(2).padStart(5, '0')}`;
  }
  return `${s.toFixed(2)}s`;
}
