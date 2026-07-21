export const MAX_HUMAN_PLAYERS = 8;
export const DEFAULT_TIME_LIMIT_MS = 90_000;
export const DEFAULT_CATCH_BUDGET = 3;
export const CATCH_RANGE = 48;
export const PLAYER_SPEED = 160;
export const AI_SPEED = 90;
export const DEFAULT_AI_COUNT = 14;
export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 640;

export type EntityKind = 'human' | 'ai';
export type Role = 'seeker' | 'hider';
export type MatchPhase = 'lobby' | 'playing' | 'ended';
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
};

export type MatchState = {
  roomId: string;
  phase: MatchPhase;
  config: MatchConfig;
  humans: string[];
  seekerId: string | null;
  entities: Record<string, EntityState>;
  catchBudgetRemaining: number;
  timeRemainingMs: number;
  winner: Winner;
  endReason: string | null;
  tick: number;
};

export type ClientIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'catch' }
  | { type: 'ready' }
  | { type: 'start' };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'snapshot'; state: MatchState; you: string }
  | { type: 'event'; event: string; detail?: unknown };

export type ClientMessage =
  | { type: 'join'; roomId?: string; name?: string }
  | { type: 'intent'; intent: ClientIntent }
  | { type: 'ping' };
