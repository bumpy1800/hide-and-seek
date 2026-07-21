import {
  CATCH_RANGE,
  DEFAULT_AI_COUNT,
  DEFAULT_CATCH_BUDGET,
  DEFAULT_TIME_LIMIT_MS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_HUMAN_PLAYERS,
  type EntityState,
  type MatchConfig,
  type MatchState,
  type Winner,
} from './types.js';
import { createRng, pickRandom } from './rng.js';

export function defaultConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    maxHumans: MAX_HUMAN_PLAYERS,
    timeLimitMs: DEFAULT_TIME_LIMIT_MS,
    catchBudget: DEFAULT_CATCH_BUDGET,
    aiCount: DEFAULT_AI_COUNT,
    mapWidth: MAP_WIDTH,
    mapHeight: MAP_HEIGHT,
    catchRange: CATCH_RANGE,
    ...overrides,
  };
}

export function createLobby(roomId: string, config: MatchConfig = defaultConfig()): MatchState {
  return {
    roomId,
    phase: 'lobby',
    config,
    humans: [],
    seekerId: null,
    entities: {},
    catchBudgetRemaining: config.catchBudget,
    timeRemainingMs: config.timeLimitMs,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

export type JoinResult =
  | { ok: true; state: MatchState; playerId: string }
  | { ok: false; reason: string; state: MatchState };

export function canJoin(state: MatchState): boolean {
  return state.phase === 'lobby' && state.humans.length < state.config.maxHumans;
}

export function joinHuman(
  state: MatchState,
  playerId: string,
  name: string,
  spawn?: { x: number; y: number },
): JoinResult {
  if (state.phase !== 'lobby') {
    return { ok: false, reason: 'match_already_started', state };
  }
  if (state.humans.includes(playerId)) {
    return { ok: true, state, playerId };
  }
  if (state.humans.length >= state.config.maxHumans) {
    return { ok: false, reason: 'room_full', state };
  }

  const x = spawn?.x ?? 80 + state.humans.length * 40;
  const y = spawn?.y ?? state.config.mapHeight / 2;
  const entity: EntityState = {
    id: playerId,
    kind: 'human',
    role: 'hider',
    name: name || `Player-${playerId.slice(0, 4)}`,
    x,
    y,
    vx: 0,
    vy: 0,
    alive: true,
  };

  return {
    ok: true,
    playerId,
    state: {
      ...state,
      humans: [...state.humans, playerId],
      entities: { ...state.entities, [playerId]: entity },
    },
  };
}

export function leaveHuman(state: MatchState, playerId: string): MatchState {
  if (!state.humans.includes(playerId)) return state;
  const { [playerId]: _removed, ...rest } = state.entities;
  const next: MatchState = {
    ...state,
    humans: state.humans.filter((id) => id !== playerId),
    entities: rest,
  };
  if (next.phase === 'playing') {
    return evaluateEndConditions(next);
  }
  return next;
}

/**
 * Assign a random seeker among joined humans and spawn AI crowd.
 * Seedable for tests.
 */
export function startMatch(state: MatchState, seed: number = Date.now()): MatchState {
  if (state.phase !== 'lobby') {
    throw new Error('startMatch: not in lobby');
  }
  if (state.humans.length < 1) {
    throw new Error('startMatch: need at least 1 human');
  }

  const rng = createRng(seed);
  const seekerId = pickRandom(state.humans, rng);
  const entities: Record<string, EntityState> = {};

  for (const id of state.humans) {
    const prev = state.entities[id]!;
    entities[id] = {
      ...prev,
      role: id === seekerId ? 'seeker' : 'hider',
      alive: true,
      vx: 0,
      vy: 0,
      x: clamp(prev.x, 24, state.config.mapWidth - 24),
      y: clamp(prev.y, 24, state.config.mapHeight - 24),
    };
  }

  for (let i = 0; i < state.config.aiCount; i++) {
    const id = `ai-${i}`;
    entities[id] = {
      id,
      kind: 'ai',
      role: 'hider',
      name: `NPC-${i}`,
      x: 40 + rng() * (state.config.mapWidth - 80),
      y: 40 + rng() * (state.config.mapHeight - 80),
      vx: 0,
      vy: 0,
      alive: true,
    };
  }

  // Nudge seeker to opposite side for fairness
  const seeker = entities[seekerId]!;
  entities[seekerId] = {
    ...seeker,
    x: state.config.mapWidth * 0.15,
    y: state.config.mapHeight * 0.5,
  };

  return {
    ...state,
    phase: 'playing',
    seekerId,
    entities,
    catchBudgetRemaining: state.config.catchBudget,
    timeRemainingMs: state.config.timeLimitMs,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

export type CatchResult =
  | { ok: true; state: MatchState; caughtId: string; kind: 'human' }
  | { ok: false; reason: string; state: MatchState };

export function attemptCatch(state: MatchState, seekerId: string, targetId: string): CatchResult {
  if (state.phase !== 'playing') {
    return { ok: false, reason: 'not_playing', state };
  }
  if (state.seekerId !== seekerId) {
    return { ok: false, reason: 'not_seeker', state };
  }
  if (state.catchBudgetRemaining <= 0) {
    return { ok: false, reason: 'catch_budget_exhausted', state };
  }

  const seeker = state.entities[seekerId];
  const target = state.entities[targetId];
  if (!seeker || !target) {
    return { ok: false, reason: 'missing_entity', state };
  }
  if (!target.alive) {
    return { ok: false, reason: 'target_dead', state };
  }
  if (target.id === seekerId) {
    return { ok: false, reason: 'self', state };
  }

  const dist = Math.hypot(seeker.x - target.x, seeker.y - target.y);
  if (dist > state.config.catchRange) {
    return { ok: false, reason: 'out_of_range', state };
  }

  // Spending a catch attempt always consumes budget (wrong guess costs).
  const budget = state.catchBudgetRemaining - 1;

  if (target.kind === 'ai') {
    // AI is not eliminable as a player — budget wasted.
    let next: MatchState = {
      ...state,
      catchBudgetRemaining: budget,
    };
    next = evaluateEndConditions(next);
    return { ok: false, reason: 'target_is_ai', state: next };
  }

  // Human hider caught
  const entities = {
    ...state.entities,
    [targetId]: { ...target, alive: false, vx: 0, vy: 0 },
  };
  let next: MatchState = {
    ...state,
    entities,
    catchBudgetRemaining: budget,
  };
  next = evaluateEndConditions(next);
  return { ok: true, state: next, caughtId: targetId, kind: 'human' };
}

export function tickTimer(state: MatchState, dtMs: number): MatchState {
  if (state.phase !== 'playing') return state;
  const timeRemainingMs = Math.max(0, state.timeRemainingMs - dtMs);
  return evaluateEndConditions({ ...state, timeRemainingMs, tick: state.tick + 1 });
}

export function setEntityVelocity(
  state: MatchState,
  entityId: string,
  vx: number,
  vy: number,
): MatchState {
  const e = state.entities[entityId];
  if (!e || !e.alive) return state;
  return {
    ...state,
    entities: {
      ...state.entities,
      [entityId]: { ...e, vx, vy },
    },
  };
}

export function integrateMotion(state: MatchState, dtSec: number): MatchState {
  if (state.phase !== 'playing') return state;
  const entities: Record<string, EntityState> = {};
  for (const [id, e] of Object.entries(state.entities)) {
    if (!e.alive) {
      entities[id] = e;
      continue;
    }
    const x = clamp(e.x + e.vx * dtSec, 16, state.config.mapWidth - 16);
    const y = clamp(e.y + e.vy * dtSec, 16, state.config.mapHeight - 16);
    entities[id] = { ...e, x, y };
  }
  return { ...state, entities };
}

export function livingHumanHiders(state: MatchState): EntityState[] {
  return Object.values(state.entities).filter(
    (e) => e.kind === 'human' && e.role === 'hider' && e.alive,
  );
}

export function evaluateEndConditions(state: MatchState): MatchState {
  if (state.phase !== 'playing') return state;

  const hidersLeft = livingHumanHiders(state).length;

  if (hidersLeft === 0) {
    return endMatch(state, 'seekers', 'all_hiders_caught');
  }

  if (state.timeRemainingMs <= 0) {
    return endMatch(state, 'hiders', 'time_expired');
  }

  // If seeker spent all catches and cannot catch remaining hiders, hiders win
  // only when budget is 0 and at least one hider still alive.
  if (state.catchBudgetRemaining <= 0) {
    return endMatch(state, 'hiders', 'catch_budget_exhausted');
  }

  return state;
}

export function endMatch(state: MatchState, winner: Winner, reason: string): MatchState {
  return {
    ...state,
    phase: 'ended',
    winner,
    endReason: reason,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function nearestCatchTarget(
  state: MatchState,
  seekerId: string,
): string | null {
  const seeker = state.entities[seekerId];
  if (!seeker) return null;
  let best: { id: string; d: number } | null = null;
  for (const e of Object.values(state.entities)) {
    if (!e.alive || e.id === seekerId) continue;
    const d = Math.hypot(seeker.x - e.x, seeker.y - e.y);
    if (d <= state.config.catchRange && (!best || d < best.d)) {
      best = { id: e.id, d };
    }
  }
  return best?.id ?? null;
}
