import {
  CATCH_RANGE,
  DEFAULT_AI_COUNT,
  DEFAULT_CATCH_BUDGET,
  DEFAULT_TIME_LIMIT_MS,
  FOX_ROULETTE_MS,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_HUMAN_PLAYERS,
  POST_REVEAL_COUNTDOWN_MS,
  SEEKER_PREP_MS,
  START_SEQUENCE_MS,
  type EntityState,
  type MatchConfig,
  type MatchMode,
  type MatchState,
  type PracticeRole,
  type RoomSettings,
  type Winner,
} from './types.js';
import { createRng, pickRandom } from './rng.js';
import { DEFAULT_MEADOW_SEED, newRoomMeadowSeed } from './meadowLayout.js';
import {
  attemptMissionTouch,
  checkMissionProximityCompletions,
  emptyMissionState,
  tickMission,
} from './mission.js';

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
    foxMode: 'roulette',
    ...overrides,
  };
}

/**
 * Create a new room lobby. Meadow layout seed is fixed for this room lifetime
 * (rematches keep the same trees/rocks). Pass `meadowSeed` only for tests.
 */
export function createLobby(
  roomId: string,
  config: MatchConfig = defaultConfig(),
  meadowSeed?: number,
): MatchState {
  const seed =
    meadowSeed != null && Number.isFinite(meadowSeed)
      ? meadowSeed >>> 0
      : newRoomMeadowSeed(roomId);
  return {
    roomId,
    phase: 'lobby',
    mode: 'normal',
    practiceRole: null,
    config,
    humans: [],
    seekerId: null,
    entities: {},
    catchBudgetRemaining: config.catchBudget,
    timeRemainingMs: config.timeLimitMs,
    seekerPrepRemainingMs: 0,
    startSequenceRemainingMs: 0,
    winner: null,
    endReason: null,
    tick: 0,
    caughtHumans: [],
    meadowSeed: seed,
    ...emptyMissionState(),
  };
}

/** Number of human rabbits (hiders) for a lobby about to start with a given seeker. */
export function humanHiderCount(humans: readonly string[], seekerId: string): number {
  return humans.filter((id) => id !== seekerId).length;
}

/**
 * @deprecated Prefer host-configured config.catchBudget (total catches including AI).
 * Kept for tests that still reference the name — now returns host total N, not hider count.
 */
export function catchBudgetForHumanHiders(hiderCount: number): number {
  return Math.max(0, hiderCount);
}

/** Clamp host room options to safe ranges. */
export function normalizeRoomSettings(raw: Partial<RoomSettings>): RoomSettings {
  const catchBudget = Math.min(30, Math.max(1, Math.floor(raw.catchBudget ?? DEFAULT_CATCH_BUDGET)));
  const timeLimitMs = Math.min(600_000, Math.max(30_000, Math.floor(raw.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS)));
  const aiCount = Math.min(40, Math.max(0, Math.floor(raw.aiCount ?? DEFAULT_AI_COUNT)));
  const foxMode = raw.foxMode === 'designate' ? 'designate' : 'roulette';
  return { catchBudget, timeLimitMs, aiCount, foxMode };
}

/** Apply host room settings onto lobby config. */
export function applyRoomSettings(state: MatchState, raw: Partial<RoomSettings>): MatchState {
  const s = normalizeRoomSettings(raw);
  return {
    ...state,
    config: {
      ...state.config,
      catchBudget: s.catchBudget,
      timeLimitMs: s.timeLimitMs,
      aiCount: s.aiCount,
      foxMode: s.foxMode,
    },
    catchBudgetRemaining: s.catchBudget,
    timeRemainingMs: s.timeLimitMs,
  };
}

/**
 * Which part of the start sequence (roulette vs countdown) given remaining ms.
 * Pure helper for UI + tests (no Phaser).
 */
export function startSequenceStage(
  remainingMs: number,
): 'roulette' | 'countdown' | 'done' {
  if (remainingMs <= 0) return 'done';
  const elapsed = START_SEQUENCE_MS - remainingMs;
  if (elapsed < FOX_ROULETTE_MS) return 'roulette';
  return 'countdown';
}

/** Seconds to show on the post-reveal countdown (1..3). */
export function startCountdownSeconds(remainingMs: number): number {
  if (remainingMs <= 0) return 0;
  const stage = startSequenceStage(remainingMs);
  if (stage !== 'countdown') return Math.ceil(POST_REVEAL_COUNTDOWN_MS / 1000);
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/** Human users caught count (score among total N catch attempts). */
export function humanCatchScore(state: MatchState): number {
  return listCaughtHumans(state).length;
}

/** Safe accessor for caught human list (older snapshots may omit the field). */
export function listCaughtHumans(
  state: MatchState,
): Array<{ id: string; name: string }> {
  const list = state.caughtHumans;
  if (!Array.isArray(list)) return [];
  return list.map((c) => ({ id: c.id, name: c.name }));
}

export type JoinResult =
  | { ok: true; state: MatchState; playerId: string }
  | { ok: false; reason: string; state: MatchState };

export function canJoin(state: MatchState): boolean {
  if (state.phase === 'playing' || state.phase === 'starting') return false;
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
    practiceRole: null,
    seekerId: null,
    entities,
    catchBudgetRemaining: state.config.catchBudget,
    timeRemainingMs: state.config.timeLimitMs,
    seekerPrepRemainingMs: 0,
    startSequenceRemainingMs: 0,
    winner: null,
    endReason: null,
    tick: 0,
    caughtHumans: [],
    meadowSeed: state.meadowSeed ?? DEFAULT_MEADOW_SEED,
    ...emptyMissionState(),
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
  practiceRole?: PracticeRole;
  seed?: number;
  /** Host-picked fox when foxMode is designate (must be in state.humans). */
  designatedSeekerId?: string;
  /** Override config.foxMode for this start. */
  foxMode?: import('./types.js').FoxAssignmentMode;
};

/**
 * Start a normal hunt (random or designated seeker + prep) or practice (no seeker).
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
    return startPracticeMatch(current, seed, opts.practiceRole ?? 'rabbit');
  }

  // Normal hunt needs at least 2 humans (1 seeker + 1 hider); solo should use practice.
  if (current.humans.length < 2) {
    throw new Error('startMatch: normal mode needs at least 2 human players');
  }

  const foxMode =
    opts.foxMode === 'designate' || opts.foxMode === 'roulette'
      ? opts.foxMode
      : current.config.foxMode === 'designate'
        ? 'designate'
        : 'roulette';

  const rng = createRng(seed);
  let seekerId: string;
  if (foxMode === 'designate') {
    const pick = opts.designatedSeekerId;
    if (!pick || !current.humans.includes(pick)) {
      throw new Error('startMatch: designated seeker must be a human in the room');
    }
    seekerId = pick;
  } else {
    seekerId = pickRandom(current.humans, rng);
  }

  // Host-configured totals (not derived from human hider count)
  const aiN = Math.max(0, current.config.aiCount);
  const catchBudget = Math.max(1, current.config.catchBudget);
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

  // Roulette: full spin + 3s; designate: fox already known → countdown only
  const startSequenceRemainingMs =
    foxMode === 'roulette' ? START_SEQUENCE_MS : POST_REVEAL_COUNTDOWN_MS;

  // Layout is room-scoped: keep createLobby meadowSeed across rematches
  const meadowSeed = current.meadowSeed ?? DEFAULT_MEADOW_SEED;

  return {
    ...current,
    phase: 'starting',
    mode: 'normal',
    practiceRole: null,
    seekerId,
    config: {
      ...current.config,
      aiCount: aiN,
      catchBudget,
      timeLimitMs: current.config.timeLimitMs,
      foxMode,
    },
    entities,
    catchBudgetRemaining: catchBudget,
    timeRemainingMs: current.config.timeLimitMs,
    seekerPrepRemainingMs: 0, // prep starts when playing begins
    startSequenceRemainingMs,
    winner: null,
    endReason: null,
    tick: 0,
    caughtHumans: [],
    meadowSeed,
    // Arm missions after prep ends (hunt timer starts)
    mission: null,
    missionNextMs: -1,
    missionGrantCount: 0,
  };
}

/**
 * Practice modes (solo OK, never auto-ends via hunt win rules):
 * - rabbit: no fox, move among AI rabbits
 * - fox: local human is seeker, catch AI rabbits only (no human-hider win condition)
 */
export function startPracticeMatch(
  state: MatchState,
  seed: number = Date.now(),
  practiceRole: PracticeRole = 'rabbit',
): MatchState {
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
  const role: PracticeRole = practiceRole === 'fox' ? 'fox' : 'rabbit';

  // AI = rabbit users × 5. Fox practice has 0 human rabbits → still spawn 5 (1 pack).
  const rabbitUsers = role === 'fox' ? Math.max(1, current.humans.length) : current.humans.length;
  const aiN = aiCountForRabbitUsers(rabbitUsers);
  const entities: Record<string, EntityState> = { ...spawnAiCrowd(current.config, rng, aiN) };

  let seekerId: string | null = null;
  if (role === 'fox') {
    // First human is the practicing fox (solo OK)
    seekerId = current.humans[0]!;
  }

  for (const id of current.humans) {
    const prev = current.entities[id]!;
    const isSeeker = role === 'fox' && id === seekerId;
    entities[id] = {
      ...prev,
      role: isSeeker ? 'seeker' : 'hider',
      alive: true,
      vx: 0,
      vy: 0,
      x: clamp(prev.x, 24, current.config.mapWidth - 24),
      y: clamp(prev.y, 24, current.config.mapHeight - 24),
    };
  }

  if (seekerId && entities[seekerId]) {
    entities[seekerId] = {
      ...entities[seekerId]!,
      x: current.config.mapWidth * 0.15,
      y: current.config.mapHeight * 0.5,
    };
  }

  // Practice also keeps the room lobby layout (not re-rolled each start)
  const meadowSeed = current.meadowSeed ?? DEFAULT_MEADOW_SEED;

  return {
    ...current,
    phase: 'playing',
    mode: 'practice',
    practiceRole: role,
    seekerId,
    config: { ...current.config, aiCount: aiN },
    entities,
    // Unlimited practice catch attempts for fox mode
    catchBudgetRemaining: role === 'fox' ? 999 : current.config.catchBudget,
    timeRemainingMs: current.config.timeLimitMs,
    seekerPrepRemainingMs: 0, // no prep in practice
    startSequenceRemainingMs: 0,
    winner: null,
    meadowSeed,
    endReason: null,
    tick: 0,
    caughtHumans: [],
    // Practice: arm sudden missions (same 10s → 30s → cooldown loop for testing)
    mission: null,
    missionNextMs: -1,
    missionGrantCount: 0,
  };
}

/**
 * Normalized prep remaining. Non-finite / missing → 0 (never permanent blind).
 */
export function seekerPrepRemainingMs(state: MatchState): number {
  const v = state.seekerPrepRemainingMs as unknown;
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return Math.max(0, v);
}

/** Seeker cannot move or catch until prep elapses (normal mode only). */
export function canSeekerAct(state: MatchState, playerId: string): boolean {
  if (state.phase !== 'playing') return false;
  if (state.seekerId !== playerId) return false;
  // Practice fox: can hunt AI immediately (no prep)
  if (state.mode === 'practice') {
    return state.practiceRole === 'fox';
  }
  return seekerPrepRemainingMs(state) <= 0;
}

/** Seeker vision of rabbit motion is blocked during prep. */
export function canSeekerSee(state: MatchState, playerId: string): boolean {
  if (state.mode === 'practice') return true;
  if (state.phase !== 'playing') return true;
  if (state.seekerId !== playerId) return true;
  return seekerPrepRemainingMs(state) <= 0;
}

export function isSeekerPrepActive(state: MatchState): boolean {
  return (
    state.mode === 'normal' &&
    state.phase === 'playing' &&
    seekerPrepRemainingMs(state) > 0
  );
}

/**
 * Wall-clock remaining for client failsafe.
 * @param prepEndsAtMs absolute timestamp when prep should end, or null to use state only
 */
export function effectivePrepRemainingMs(
  state: MatchState,
  nowMs: number,
  prepEndsAtMs: number | null,
): number {
  if (state.mode !== 'normal' || state.phase !== 'playing') return 0;
  if (prepEndsAtMs != null && Number.isFinite(prepEndsAtMs)) {
    return Math.max(0, prepEndsAtMs - nowMs);
  }
  return seekerPrepRemainingMs(state);
}

export function isSeekerBlind(
  state: MatchState,
  playerId: string,
  nowMs: number = Date.now(),
  prepEndsAtMs: number | null = null,
): boolean {
  if (state.seekerId !== playerId) return false;
  if (state.mode === 'practice') return false;
  if (state.phase !== 'playing') return false;
  return effectivePrepRemainingMs(state, nowMs, prepEndsAtMs) > 0;
}

export type CatchVictimKind = 'human' | 'ai';

export type CatchResult =
  | {
      ok: true;
      state: MatchState;
      caughtId: string;
      kind: CatchVictimKind;
      name: string;
      x: number;
      y: number;
      /** True when a lasting grave marker should be shown (human only). */
      placeGrave: boolean;
    }
  | { ok: false; reason: string; state: MatchState };

/**
 * Role-specific objective lines for HUD (normal play + practice).
 * Pure helper so fox/rabbit clients always get different copy.
 */
export function roleObjectiveLines(state: MatchState, you: string): string[] {
  if (state.mode === 'practice') {
    if (state.practiceRole === 'fox') {
      return [
        '목표  AI 토끼를 가까이서 잡기',
        '안내  시간 제한 없음 · 연습용',
      ];
    }
    return [
      '목표  맵을 돌아다니며 이동 연습',
      '안내  여우 없음 · 자유롭게 이동',
    ];
  }
  if (state.phase === 'lobby') {
    return ['목표  인원을 모은 뒤 시작'];
  }
  if (state.phase === 'starting') {
    const stage = startSequenceStage(state.startSequenceRemainingMs ?? 0);
    if (stage === 'roulette') {
      return ['안내  여우 추첨 중…'];
    }
    return [
      `안내  ${startCountdownSeconds(state.startSequenceRemainingMs ?? 0)}초 후 시작`,
    ];
  }
  if (state.phase === 'ended') {
    const users = humanCatchScore(state);
    const total = state.config.catchBudget;
    return [
      '목표  결과 확인 후 다시하기',
      `유저 포획  ${users}명 / 전체 시도 ${total - state.catchBudgetRemaining}회`,
    ];
  }
  const isFox = state.seekerId === you;
  if (isFox) {
    if (isSeekerPrepActive(state)) {
      return [
        '목표  준비 시간 — 시야·이동 잠금',
        `준비  ${Math.ceil(seekerPrepRemainingMs(state) / 1000)}초 후 사냥 시작`,
      ];
    }
    return [
      '목표  제한 시간 안에 토끼를 잡으세요',
      `잡기 횟수  ${state.catchBudgetRemaining}/${state.config.catchBudget} (AI·유저 공통)`,
      `유저 포획  ${humanCatchScore(state)}명`,
    ];
  }
  // Rabbit (human hider)
  if (isSeekerPrepActive(state)) {
    return [
      '목표  술래 준비 중 — 자리를 섞어 숨으세요',
      `준비  ${Math.ceil(seekerPrepRemainingMs(state) / 1000)}초`,
    ];
  }
  return [
    '목표  여우에게 잡히지 말고 끝까지 버티기',
    '안내  나무·바위 뒤로 숨고 거리를 유지하세요',
  ];
}

/** Test/helper: jump past roulette+countdown+prep into actionable hunt. */
export function skipToPlaying(state: MatchState): MatchState {
  return {
    ...state,
    phase: 'playing',
    startSequenceRemainingMs: 0,
    seekerPrepRemainingMs: 0,
    // Ready for mission arming on next hunt tick (or keep existing)
    missionNextMs:
      state.mode === 'normal'
        ? state.missionNextMs === null
          ? null
          : state.missionNextMs === undefined || state.missionNextMs === -1
            ? -1
            : state.missionNextMs
        : null,
    mission: state.mission ?? null,
    missionGrantCount: state.missionGrantCount ?? 0,
  };
}

/** Rabbit Space / mission_action while playing. */
export function applyMissionAction(state: MatchState, playerId: string): MatchState {
  return attemptMissionTouch(state, playerId);
}

/** Short global toast line for a successful catch (all clients). */
export function catchAnnounceText(detail: {
  kind: CatchVictimKind;
  name?: string;
}): string {
  if (detail.kind === 'ai') {
    return '잡았다! AI 토끼';
  }
  const nick = (detail.name ?? '').trim() || '유저';
  return `잡았다! 유저 토끼 「${nick}」`;
}

export function attemptCatch(state: MatchState, seekerId: string, targetId: string): CatchResult {
  if (state.phase !== 'playing') {
    return { ok: false, reason: 'not_playing', state };
  }
  // Rabbit practice: no catching
  if (state.mode === 'practice' && state.practiceRole !== 'fox') {
    return { ok: false, reason: 'practice_no_catch', state };
  }
  if (!canSeekerAct(state, seekerId)) {
    return { ok: false, reason: 'seeker_prep', state };
  }
  if (state.seekerId !== seekerId) {
    return { ok: false, reason: 'not_seeker', state };
  }
  // Total catch budget (AI + human) — no catches when exhausted in normal mode
  if (state.mode === 'normal' && state.catchBudgetRemaining <= 0) {
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

  const catchX = target.x;
  const catchY = target.y;

  // AI rabbit: spends 1 of total N catch attempts; no grave; not scored as user catch
  if (target.kind === 'ai') {
    const entities = {
      ...state.entities,
      [targetId]: { ...target, alive: false, vx: 0, vy: 0 },
    };
    const budget = Math.max(0, state.catchBudgetRemaining - 1);
    let next: MatchState = {
      ...state,
      entities,
      catchBudgetRemaining: budget,
    };
    if (state.mode === 'normal') {
      next = evaluateEndConditions(next);
    }
    return {
      ok: true,
      state: next,
      caughtId: targetId,
      kind: 'ai',
      name: target.name || 'AI',
      x: catchX,
      y: catchY,
      placeGrave: false,
    };
  }

  // Practice has no human targets to eliminate for win
  if (state.mode === 'practice') {
    return { ok: false, reason: 'practice_ai_only', state };
  }

  // Successful human catch spends 1 budget and records the victim (user score)
  const budget = state.catchBudgetRemaining - 1;
  const victimName = target.name || targetId;
  const entities = {
    ...state.entities,
    [targetId]: { ...target, alive: false, vx: 0, vy: 0 },
  };
  const caughtHumans = [
    ...listCaughtHumans(state),
    { id: targetId, name: victimName },
  ];
  let next: MatchState = {
    ...state,
    entities,
    catchBudgetRemaining: budget,
    caughtHumans,
  };
  next = evaluateEndConditions(next);
  return {
    ok: true,
    state: next,
    caughtId: targetId,
    kind: 'human',
    name: victimName,
    x: catchX,
    y: catchY,
    placeGrave: true,
  };
}

export function tickTimer(state: MatchState, dtMs: number): MatchState {
  // Fox roulette + countdown gate before hunt
  if (state.phase === 'starting' && state.mode === 'normal') {
    const left = Math.max(0, (state.startSequenceRemainingMs ?? 0) - dtMs);
    if (left <= 0) {
      return {
        ...state,
        phase: 'playing',
        startSequenceRemainingMs: 0,
        seekerPrepRemainingMs: state.config.seekerPrepMs,
        tick: state.tick + 1,
      };
    }
    return {
      ...state,
      startSequenceRemainingMs: left,
      tick: state.tick + 1,
    };
  }

  if (state.phase !== 'playing') return state;

  // Prep countdown: AI may still move; main hunt timer waits until prep ends.
  // Missions do NOT run during seeker prep (10s delay starts after prep).
  const prepLeft = seekerPrepRemainingMs(state);
  if (state.mode === 'normal' && prepLeft > 0) {
    return {
      ...state,
      seekerPrepRemainingMs: Math.max(0, prepLeft - dtMs),
      tick: state.tick + 1,
      missionNextMs: state.missionNextMs ?? -1,
    };
  }

  // Practice: no timed win/lose — AI + mission loop for testing
  if (state.mode === 'practice') {
    if (state.humans.length === 0) {
      return createLobby(state.roomId, state.config);
    }
    let next = { ...state, tick: state.tick + 1 };
    // Same mission schedule as multi (10s first, 30s duration, 30s cooldown loop)
    next = tickMission(next, dtMs);
    next = checkMissionProximityCompletions(next);
    // Fox practice: if all AI rabbits are down, spawn a fresh pack
    if (next.practiceRole === 'fox') {
      const aliveAi = Object.values(next.entities).filter((e) => e.kind === 'ai' && e.alive);
      if (aliveAi.length === 0) {
        const rng = createRng(next.tick + 99);
        const fresh = spawnAiCrowd(next.config, rng, next.config.aiCount);
        const entities = { ...next.entities };
        for (const [id, e] of Object.entries(next.entities)) {
          if (e.kind === 'ai') delete entities[id];
        }
        Object.assign(entities, fresh);
        next = { ...next, entities };
      }
    }
    return next;
  }

  const timeRemainingMs = Math.max(0, state.timeRemainingMs - dtMs);
  let next: MatchState = {
    ...state,
    timeRemainingMs,
    tick: state.tick + 1,
  };
  // Hunt clock running → sudden missions (10s first delay, 30s each, loop rules)
  next = tickMission(next, dtMs);
  next = checkMissionProximityCompletions(next);
  return evaluateEndConditions(next);
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
  // starting (roulette/countdown): freeze everyone; only playing moves
  if (state.phase !== 'playing') return state;
  const entities: Record<string, EntityState> = {};
  const mapW = state.config.mapWidth;
  const mapH = state.config.mapHeight;
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
    // Map bounds only (props are visual cover, not blockers)
    const x = clamp(e.x + e.vx * dtSec, 16, mapW - 16);
    const y = clamp(e.y + e.vy * dtSec, 16, mapH - 16);
    entities[id] = { ...e, x, y };
  }
  let next: MatchState = { ...state, entities };
  // Visit-point missions complete on movement
  if (next.mission?.kind === 'visit_point') {
    next = checkMissionProximityCompletions(next);
  }
  return next;
}

export function livingHumanHiders(state: MatchState): EntityState[] {
  return Object.values(state.entities).filter(
    (e) => e.kind === 'human' && e.role === 'hider' && e.alive,
  );
}

export function evaluateEndConditions(state: MatchState): MatchState {
  if (state.phase !== 'playing') return state;
  if (state.mode === 'practice') {
    return { ...state, phase: 'playing', winner: null, endReason: null };
  }

  const hidersLeft = livingHumanHiders(state).length;

  if (hidersLeft === 0) {
    // Solo seeker / no human hiders ever in the match → do not end (avoids instant seeker win)
    const humanHiderCount = state.humans.filter((id) => {
      const e = state.entities[id];
      return e && e.role === 'hider';
    }).length;
    if (humanHiderCount === 0) {
      return state;
    }
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
