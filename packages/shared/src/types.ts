export const MAX_HUMAN_PLAYERS = 8;
export const DEFAULT_TIME_LIMIT_MS = 90_000;
export const DEFAULT_CATCH_BUDGET = 3;
export const CATCH_RANGE = 48;
export const PLAYER_SPEED = 180;
export const AI_SPEED = 100;
export const DEFAULT_AI_COUNT = 18;
/** Seeker cannot see rabbit motion or move during this prep window. */
export const SEEKER_PREP_MS = 10_000;
export const MAP_WIDTH = 2400;
export const MAP_HEIGHT = 1600;
export const VIEWPORT_WIDTH = 960;
export const VIEWPORT_HEIGHT = 640;
export const TILE_SIZE = 64;

export type EntityKind = 'human' | 'ai';
export type Role = 'seeker' | 'hider';
export type MatchPhase = 'lobby' | 'playing' | 'ended';
export type MatchMode = 'normal' | 'practice';
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
  config: MatchConfig;
  humans: string[];
  seekerId: string | null;
  entities: Record<string, EntityState>;
  catchBudgetRemaining: number;
  timeRemainingMs: number;
  /** Counts down during seeker prep; 0 means hunt is live for seeker vision/move. */
  seekerPrepRemainingMs: number;
  winner: Winner;
  endReason: string | null;
  tick: number;
};

export type ClientIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'catch' }
  | { type: 'ready' }
  | { type: 'start'; mode?: MatchMode };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'snapshot'; state: MatchState; you: string }
  | { type: 'event'; event: string; detail?: unknown };

export type ClientMessage =
  | { type: 'join'; roomId?: string; name?: string }
  | { type: 'intent'; intent: ClientIntent }
  | { type: 'ping' };
