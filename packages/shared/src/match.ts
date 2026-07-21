import {
  CATCH_RANGE,
  DEFAULT_AI_COUNT,
  DEFAULT_CATCH_BUDGET,
  DEFAULT_TIME_LIMIT_MS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_HUMAN_PLAYERS,
  SEEKER_PREP_MS,
  type EntityState,
  type MatchConfig,
  type MatchMode,
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
    seekerPrepMs: SEEKER_PREP_MS,
    ...overrides,
  };
}

export function createLobby(roomId: string, config: MatchConfig = defaultConfig()): MatchState {
  return {
    roomId,
    phase: 'lobby',
    mode: 'normal',
    config,
    humans: [],
    seekerId: null,
    entities: {},
    catchBudgetRemaining: config.catchBudget,
    timeRemainingMs: config.timeLimitMs,
    seekerPrepRemainingMs: 0,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

export type JoinResult =
  | { ok: true; state: MatchState; playerId: string }
  | { ok: false; reason: string; state: MatchState };

export function canJoin(state: MatchState): boolean {
  if (state.phase === 'playing') return false;
  if (state.phase === 'ended') return state.humans.length < state.config.maxHumans;
  return state.humans.length < state.config.maxHumans;
}

export function returnToLobby(state: MatchState): MatchState {
  const entities: Record<string, EntityState> = {};
  for (const id of state.humans) {
    const prev = state.entities[id];
    if (!prev) continue;
    entities[id] = {
      ...prev,
      kind: 'human',
      role: 'hider',
      alive: true,
      vx: 0,
      vy: 0,
    };
  }
  return {
    ...state,
    phase: 'lobby',
    mode: 'normal',
    seekerId: null,
    entities,
    catchBudgetRemaining: state.config.catchBudget,
    timeRemainingMs: state.config.timeLimitMs,
    seekerPrepRemainingMs: 0,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

export function joinHuman(
  state: MatchState,
  playerId: string,
  name: string,
  spawn?: { x: number; y: number },
): JoinResult {
  let current = state;
  // Recover empty / abandoned sessions (e.g. practice never ended after disconnect).
  if (current.humans.length === 0 && current.phase !== 'lobby') {
    current = createLobby(current.roomId, current.config);
  }
  if (current.phase === 'ended') {
    current = returnToLobby(current);
  }
  if (current.phase !== 'lobby') {
    return { ok: false, reason: 'match_already_started', state: current };
  }
  if (current.humans.includes(playerId)) {
    return { ok: true, state: current, playerId };
  }
  if (current.humans.length >= current.config.maxHumans) {
    return { ok: false, reason: 'room_full', state: current };
  }

  const x = spawn?.x ?? 120 + (current.humans.length % 4) * 160;
  const y = spawn?.y ?? current.config.mapHeight * 0.35 + Math.floor(current.humans.length / 4) * 140;
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
      ...current,
      humans: [...current.humans, playerId],
      entities: { ...current.entities, [playerId]: entity },
    },
  };
}

export function leaveHuman(state: MatchState, playerId: string): MatchState {
  if (!state.humans.includes(playerId)) return state;
  const { [playerId]: _removed, ...rest } = state.entities;
  const entities =
    state.phase === 'lobby'
      ? Object.fromEntries(Object.entries(rest).filter(([, e]) => e.kind === 'human'))
      : rest;
  const next: MatchState = {
    ...state,
    humans: state.humans.filter((id) => id !== playerId),
    entities,
  };
  // Empty room must return to lobby so practice/normal can be rejoined after disconnect.
  if (next.humans.length === 0) {
    return createLobby(state.roomId, state.config);
  }
  if (next.phase === 'playing' && next.mode !== 'practice') {
    return evaluateEndConditions(next);
  }
  return next;
}

/** AI rabbits = human rabbit (hider) players × 5. Seeker is excluded. */
export function aiCountForRabbitUsers(rabbitUserCount: number): number {
  return Math.max(0, Math.floor(rabbitUserCount)) * 5;
}

function spawnAiCrowd(
  config: MatchConfig,
  rng: () => number,
  aiCount?: number,
): Record<string, EntityState> {
  const count = aiCount ?? config.aiCount;
  const entities: Record<string, EntityState> = {};
  for (let i = 0; i < count; i++) {
    const id = `ai-${i}`;
    entities[id] = {
      id,
      kind: 'ai',
      role: 'hider',
      name: `NPC-${i}`,
      x: 40 + rng() * (config.mapWidth - 80),
      y: 40 + rng() * (config.mapHeight - 80),
      vx: 0,
      vy: 0,
      alive: true,
    };
  }
  return entities;
}

export type StartOptions = {
  mode?: MatchMode;
  seed?: number;
};

/**
 * Start a normal hunt (random seeker + prep) or practice (no seeker).
 */
export function startMatch(state: MatchState, seedOrOpts: number | StartOptions = Date.now()): MatchState {
  const opts: StartOptions =
    typeof seedOrOpts === 'number' ? { seed: seedOrOpts, mode: 'normal' } : seedOrOpts;
  const mode: MatchMode = opts.mode ?? 'normal';
  const seed = opts.seed ?? Date.now();

  let current = state;
  if (current.phase === 'ended') {
    current = returnToLobby(current);
  }
  if (current.phase !== 'lobby') {
    throw new Error('startMatch: not in lobby');
  }
  if (current.humans.length < 1) {
    throw new Error('startMatch: need at least 1 human');
  }

  if (mode === 'practice') {
    return startPracticeMatch(current, seed);
  }

  const rng = createRng(seed);
  const seekerId = pickRandom(current.humans, rng);
  const rabbitUsers = Math.max(0, current.humans.length - 1);
  const aiN = aiCountForRabbitUsers(rabbitUsers);
  const entities: Record<string, EntityState> = { ...spawnAiCrowd(current.config, rng, aiN) };

  for (const id of current.humans) {
    const prev = current.entities[id]!;
    entities[id] = {
      ...prev,
      role: id === seekerId ? 'seeker' : 'hider',
      alive: true,
      vx: 0,
      vy: 0,
      x: clamp(prev.x, 24, current.config.mapWidth - 24),
      y: clamp(prev.y, 24, current.config.mapHeight - 24),
    };
  }

  const seeker = entities[seekerId]!;
  entities[seekerId] = {
    ...seeker,
    x: current.config.mapWidth * 0.15,
    y: current.config.mapHeight * 0.5,
  };

  return {
    ...current,
    phase: 'playing',
    mode: 'normal',
    seekerId,
    config: { ...current.config, aiCount: aiN },
    entities,
    catchBudgetRemaining: current.config.catchBudget,
    timeRemainingMs: current.config.timeLimitMs,
    seekerPrepRemainingMs: current.config.seekerPrepMs,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

/**
 * Practice: no seeker, all humans are hiders, AI crowd for blending rehearsal.
 * Hunt win/lose and catch budget do not apply.
 */
export function startPracticeMatch(state: MatchState, seed: number = Date.now()): MatchState {
  let current = state;
  if (current.phase === 'ended') {
    current = returnToLobby(current);
  }
  if (current.phase !== 'lobby') {
    throw new Error('startPracticeMatch: not in lobby');
  }
  if (current.humans.length < 1) {
    throw new Error('startPracticeMatch: need at least 1 human');
  }

  const rng = createRng(seed);
  // Solo practice allowed: all joined humans are rabbits (no seeker)
  const rabbitUsers = current.humans.length;
  const aiN = aiCountForRabbitUsers(rabbitUsers);
  const entities: Record<string, EntityState> = { ...spawnAiCrowd(current.config, rng, aiN) };

  for (const id of current.humans) {
    const prev = current.entities[id]!;
    entities[id] = {
      ...prev,
      role: 'hider',
      alive: true,
      vx: 0,
      vy: 0,
      x: clamp(prev.x, 24, current.config.mapWidth - 24),
      y: clamp(prev.y, 24, current.config.mapHeight - 24),
    };
  }

  return {
    ...current,
    phase: 'playing',
    mode: 'practice',
    seekerId: null,
    config: { ...current.config, aiCount: aiN },
    entities,
    catchBudgetRemaining: current.config.catchBudget,
    timeRemainingMs: current.config.timeLimitMs,
    seekerPrepRemainingMs: 0,
    winner: null,
    endReason: null,
    tick: 0,
  };
}

/** Seeker cannot move or catch until prep elapses (normal mode only). */
export function canSeekerAct(state: MatchState, playerId: string): boolean {
  if (state.mode === 'practice') return false;
  if (state.phase !== 'playing') return false;
  if (state.seekerId !== playerId) return false;
  return state.seekerPrepRemainingMs <= 0;
}

/** Seeker vision of rabbit motion is blocked during prep. */
export function canSeekerSee(state: MatchState, playerId: string): boolean {
  if (state.mode === 'practice') return true;
  if (state.phase !== 'playing') return true;
  if (state.seekerId !== playerId) return true;
  return state.seekerPrepRemainingMs <= 0;
}

export function isSeekerPrepActive(state: MatchState): boolean {
  return (
    state.mode === 'normal' &&
    state.phase === 'playing' &&
    state.seekerPrepRemainingMs > 0
  );
}

export type CatchResult =
  | { ok: true; state: MatchState; caughtId: string; kind: 'human' }
  | { ok: false; reason: string; state: MatchState };

export function attemptCatch(state: MatchState, seekerId: string, targetId: string): CatchResult {
  if (state.mode === 'practice') {
    return { ok: false, reason: 'practice_no_catch', state };
  }
  if (state.phase !== 'playing') {
    return { ok: false, reason: 'not_playing', state };
  }
  if (!canSeekerAct(state, seekerId)) {
    return { ok: false, reason: 'seeker_prep', state };
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

  const budget = state.catchBudgetRemaining - 1;

  if (target.kind === 'ai') {
    let next: MatchState = { ...state, catchBudgetRemaining: budget };
    next = evaluateEndConditions(next);
    return { ok: false, reason: 'target_is_ai', state: next };
  }

  const entities = {
    ...state.entities,
    [targetId]: { ...target, alive: false, vx: 0, vy: 0 },
  };
  let next: MatchState = { ...state, entities, catchBudgetRemaining: budget };
  next = evaluateEndConditions(next);
  return { ok: true, state: next, caughtId: targetId, kind: 'human' };
}

export function tickTimer(state: MatchState, dtMs: number): MatchState {
  if (state.phase !== 'playing') return state;

  // Prep countdown: AI may still move; main hunt timer waits until prep ends.
  if (state.mode === 'normal' && state.seekerPrepRemainingMs > 0) {
    const seekerPrepRemainingMs = Math.max(0, state.seekerPrepRemainingMs - dtMs);
    return {
      ...state,
      seekerPrepRemainingMs,
      tick: state.tick + 1,
    };
  }

  // Practice: no timed win/lose — just tick for AI stepping
  if (state.mode === 'practice') {
    if (state.humans.length === 0) {
      return createLobby(state.roomId, state.config);
    }
    return { ...state, tick: state.tick + 1 };
  }

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
  // Seeker locked during prep
  if (state.seekerId === entityId && isSeekerPrepActive(state)) {
    return state;
  }
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
    // Freeze seeker position during prep even if velocity was set
    if (state.seekerId === id && isSeekerPrepActive(state)) {
      entities[id] = { ...e, vx: 0, vy: 0 };
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
  if (state.mode === 'practice') return state;

  const hidersLeft = livingHumanHiders(state).length;

  if (hidersLeft === 0) {
    return endMatch(state, 'seekers', 'all_hiders_caught');
  }

  if (state.timeRemainingMs <= 0) {
    return endMatch(state, 'hiders', 'time_expired');
  }

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
    seekerPrepRemainingMs: 0,
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
