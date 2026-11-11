export const MAX_HUMAN_PLAYERS = 8;
export const DEFAULT_TIME_LIMIT_MS = 90_000;
export const DEFAULT_CATCH_BUDGET = 3;
export const CATCH_RANGE = 48;
/** Min time after a successful catch before the fox can catch again. */
export const CATCH_COOLDOWN_MS = 3_000;
/** Shared rabbit move speed: human hiders and AI rabbits use this same value. */
export const RABBIT_SPEED = 140;
/** @deprecated alias — human non-seeker and AI use RABBIT_SPEED */
export const PLAYER_SPEED = RABBIT_SPEED;
/** AI rabbit speed equals human rabbit (no slower base). */
export const AI_SPEED = RABBIT_SPEED;
/** Fox/seeker is a bit faster than rabbits (~20%+) for catch pressure. */
export const SEEKER_SPEED = 170;
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
/**
 * lobby → starting (fox roulette + countdown) → playing → ended
 */
export type MatchPhase = 'lobby' | 'starting' | 'playing' | 'ended';
export type MatchMode = 'normal' | 'practice';
/** Practice as rabbit (move only) or fox (catch AI rabbits). */
export type PracticeRole = 'rabbit' | 'fox';
export type Winner = 'seekers' | 'hiders' | null;

/** How the fox/seeker is chosen at match start. */
export type FoxAssignmentMode = 'roulette' | 'designate';

/**
 * Game rule variants:
 * - 'standard': Default hide & seek (limited catch budget, AI dies on catch).
 * - 'stun_penalty': Unlimited catch attempts; catching AI leaves rabbit alive, blinds seeker screen for 2s, stuns seeker for 5s.
 */
export type RoomRuleMode = 'standard' | 'stun_penalty';
export const STUN_PENALTY_BLIND_MS = 2_000;
export const STUN_PENALTY_STUN_MS = 5_000;

/** Host-configurable room options at create time. */
export type RoomSettings = {
  catchBudget: number;
  timeLimitMs: number;
  aiCount: number;
  /** roulette = spin UI + random; designate = host picks a human as fox. */
  foxMode: FoxAssignmentMode;
  /** standard = limited catches; stun_penalty = unlimited catches + AI miscatch penalty. */
  ruleMode?: RoomRuleMode;
};

/** Fox roulette duration then post-reveal countdown (ms). */
export const FOX_ROULETTE_MS = 2500;
export const POST_REVEAL_COUNTDOWN_MS = 3000;
export const START_SEQUENCE_MS = FOX_ROULETTE_MS + POST_REVEAL_COUNTDOWN_MS;

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
  /** How seeker is assigned for the next normal start. */
  foxMode: FoxAssignmentMode;
  ruleMode: RoomRuleMode;
};

/** Human player caught by the fox during a normal match (shown on end screen). */
export type CaughtHuman = {
  id: string;
  name: string;
};

/** Shared sudden mission for all rabbits (fox can observe). */
export type MissionKind = 'touch_rabbit' | 'visit_point';

export type ActiveMission = {
  kind: MissionKind;
  remainingMs: number;
  /** Map point for visit_point (ignored for touch_rabbit). */
  targetX: number;
  targetY: number;
  /**
   * Rabbit entity ids that completed this mission.
   * Host-side only for resolution; fox UI must not show live progress —
   * use missionResult after the mission ends.
   */
  completedIds: string[];
  /**
   * AI rabbits that sit out this mission (do not pursue goal).
   * They never auto-complete and count as fail on timeout (no death).
   */
  skipIds: string[];
};

/** Post-mission summary shown only to the fox for a short display window. */
export type MissionResult = {
  kind: MissionKind;
  /** User-rabbit (human hider) ids that completed — AI never included. */
  survivedIds: string[];
  /** User-rabbit ids that failed — AI never included. */
  failedIds: string[];
  /** Ms left to show this result on fox HUD/banner. */
  remainingMs: number;
};

/**
 * Everyone-visible announce when mission fails grant fox speed/catch restore
 * based on failed *human* rabbits.
 */
export type FoxMissionBuffAnnounce = {
  /** Human rabbits that failed this mission. */
  failedHumanCount: number;
  /** Catch attempts restored this event (capped so remaining ≤ config.catchBudget). */
  catchRestored: number;
  /** Speed points gained this event. */
  speedGained: number;
  /** Total fox speed bonus after this event. */
  speedBonusTotal: number;
  /** Catch remaining after restore. */
  catchRemaining: number;
  /** Config max catch budget (cap). */
  catchMax: number;
  remainingMs: number;
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
  /**
   * Ms until the seeker may catch again after a successful grab.
   * 0 = ready. Ticks down during playing (and practice fox).
   */
  catchCooldownRemainingMs: number;
  timeRemainingMs: number;
  seekerPrepRemainingMs: number;
  /**
   * While phase === 'starting': ms left in fox-reveal + countdown sequence.
   * 0 when not in starting phase.
   */
  startSequenceRemainingMs: number;
  winner: Winner;
  endReason: string | null;
  tick: number;
  /**
   * Humans the fox caught this match (ids + names). Broadcast in snapshots
   * so every client can render the same end roster.
   */
  caughtHumans: CaughtHuman[];
  /**
   * Deterministic seed for meadow decor (trees/bushes/rocks + grass pattern).
   * Set once when the room/lobby is created; rematches in the same room keep it.
   * All clients share this via snapshots.
   */
  meadowSeed: number;
  /** Active sudden mission, or null when none. */
  mission: ActiveMission | null;
  /**
   * Last mission outcome for fox-only UI. Cleared when display timer ends
   * or the next mission is granted. Rabbits must not use this for HUD.
   */
  missionResult: MissionResult | null;
  /**
   * Mission schedule:
   * - `-1` = not armed (waiting for hunt timer / post-prep)
   * - `null` = no further missions this match
   * - `>= 0` = ms until next grant
   */
  missionNextMs: number | null;
  /** How many sudden missions have been granted this match (0 = first still pending). */
  missionGrantCount: number;
  /**
   * Last visit_point target this match (used so the next visit mission
   * avoids spawning near the same spot).
   */
  lastVisitPoint: { x: number; y: number } | null;
  /**
   * Human rabbit who finished first among *user* rabbits this mission and
   * still has an unused darkness charge. AI never receives this. Cleared on
   * use or when a later mission's first human completer takes the charge.
   */
  darknessChargeId: string | null;
  /** Global screen blackout remaining ms (0 = inactive). Affects every client. */
  darknessRemainingMs: number;
  /**
   * Extra seeker speed from mission human-fails this match (added to SEEKER_SPEED).
   * Reset each match start.
   */
  foxSpeedBonus: number;
  /** Top-banner announce for last fox mission buff (everyone). */
  foxMissionBuff: FoxMissionBuffAnnounce | null;
  /** Active rule variant ('standard' | 'stun_penalty'). */
  ruleMode: RoomRuleMode;
  /** In stun_penalty mode: ms remaining of seeker screen blackout (2,000ms on AI miscatch). */
  seekerBlindRemainingMs: number;
  /** In stun_penalty mode: ms remaining of seeker stun (5,000ms on AI miscatch, unable to move/catch). */
  seekerStunRemainingMs: number;
};

export type ClientIntent =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'catch' }
  /** Rabbit T: complete touch_rabbit if near another user rabbit. */
  | { type: 'mission_action' }
  /** Mission 1st-place rabbit: spend darkness charge (K). */
  | { type: 'darkness' }
  /** Host: end match → room waiting lobby without rematch. */
  | { type: 'return_to_lobby' }
  | {
      type: 'start';
      mode?: MatchMode;
      practiceRole?: PracticeRole;
      /** When foxMode is designate, host may send the chosen seeker player id. */
      designatedSeekerId?: string;
      ruleMode?: RoomRuleMode;
    };

export type ServerMessage =
  | { type: 'welcome'; playerId: string; roomId: string }
  | { type: 'error'; message: string }
  | { type: 'snapshot'; state: MatchState; you: string }
  | { type: 'event'; event: string; detail?: unknown };

export type ClientMessage =
  | { type: 'join'; roomId?: string; name?: string }
  | { type: 'intent'; intent: ClientIntent }
  | { type: 'ping' };
