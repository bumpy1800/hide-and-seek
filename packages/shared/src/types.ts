export const MAX_HUMAN_PLAYERS = 8;
export const DEFAULT_TIME_LIMIT_MS = 90_000;
export const DEFAULT_CATCH_BUDGET = 3;
export const CATCH_RANGE = 48;
/** Shared rabbit move speed: human hiders and AI rabbits use this same value. */
export const RABBIT_SPEED = 140;
/** @deprecated alias — human non-seeker and AI use RABBIT_SPEED */
export const PLAYER_SPEED = RABBIT_SPEED;
/** AI rabbit speed equals human rabbit (no slower base). */
export const AI_SPEED = RABBIT_SPEED;
/** Fox/seeker may be slightly faster for catch gameplay */
export const SEEKER_SPEED = 160;
export const DEFAULT_AI_COUNT = 18;
export const SEEKER_PREP_MS = 10_000;
/** World size (~1080p meadow arena) */
export const MAP_WIDTH = 1920;
export const MAP_HEIGHT = 1080;
/** Client camera viewport — match map / 1080p for sharp 1:1 on FHD */
export const VIEWPORT_WIDTH = 1920;
export const VIEWPORT_HEIGHT = 1080;
export const TILE_SIZE = 64;

export type EntityKind = 'human' | 'ai';
export type Role = 'seeker' | 'hider';
export type MatchPhase = 'lobby' | 'playing' | 'ended';
export type MatchMode = 'normal' | 'practice';
/** Practice as rabbit (move only) or fox (catch AI rabbits). */
export type PracticeRole = 'rabbit' | 'fox';
export type Winner = 'seekers' | 'hiders' | null;

export type Vec2 = { x: number; y: number };

export type EntityState = {
  id: string;
  kind: EntityKind;
  role: Role;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
};

export type MatchConfig = {
  maxHumans: number;
  timeLimitMs: number;
  catchBudget: number;
  aiCount: number;
  mapWidth: number;
  mapHeight: number;
  catchRange: number;
  seekerPrepMs: number;
};

export type MatchState = {
  roomId: string;
  phase: MatchPhase;
  mode: MatchMode;
  /** Only set when mode === 'practice' */
  practiceRole: PracticeRole | null;
  config: MatchConfig;
  humans: string[];
  seekerId: string | null;
  entities: Record<string, EntityState>;
  catchBudgetRemaining: number;
  timeRemainingMs: number;
  seekerPrepRemainingMs: number;
  winner: Winner;
  endReason: string | null;
  tick: number;
};

export type ClientIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'catch' }
  | { type: 'ready' }
  | { type: 'start'; mode?: MatchMode; practiceRole?: PracticeRole };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'snapshot'; state: MatchState; you: string }
  | { type: 'event'; event: string; detail?: unknown };

export type ClientMessage =
  | { type: 'join'; roomId?: string; name?: string }
  | { type: 'intent'; intent: ClientIntent }
  | { type: 'ping' };
