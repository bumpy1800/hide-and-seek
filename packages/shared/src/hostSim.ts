/**
 * Shared host authority: move / playing intents / tick pipeline.
 * Transport layers (Peer, WS Room, LocalPractice) stay thin adapters.
 */
import { stepAiCrowd } from './ai.js';
import {
  attemptCatch,
  canSeekerAct,
  integrateMotion,
  isSeekerPrepActive,
  nearestCatchTarget,
  setEntityVelocity,
  tickTimer,
} from './match.js';
import { applyDarknessSkill, attemptMissionTouch, seekerMoveSpeed } from './mission.js';
import { RABBIT_SPEED, type ClientIntent, type MatchState } from './types.js';

export type HostEmitTarget = 'all' | string;

export type HostSimEvent =
  | { kind: 'snapshot' }
  | {
      kind: 'event';
      event: string;
      detail?: unknown;
      /** Default 'all'. Player id for unicast (e.g. catch_miss). */
      to?: HostEmitTarget;
    };

export type HostIntentResult = {
  state: MatchState;
  events: HostSimEvent[];
};

/** Normalize stick/keyboard move into entity velocity (prep-locked seeker = no-op). */
export function applyMoveIntent(
  state: MatchState,
  playerId: string,
  dx: number,
  dy: number,
): MatchState {
  if (state.phase !== 'playing') return state;
  const entity = state.entities[playerId];
  if (!entity || !entity.alive) return state;
  if (
    state.seekerId === playerId &&
    (isSeekerPrepActive(state) || (state.seekerStunRemainingMs ?? 0) > 0)
  ) {
    return state;
  }

  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  const isSeeker = state.seekerId === playerId;
  const speed = isSeeker ? seekerMoveSpeed(state) : RABBIT_SPEED;
  const vx = dx === 0 && dy === 0 ? 0 : nx * speed;
  const vy = dx === 0 && dy === 0 ? 0 : ny * speed;
  return setEntityVelocity(state, playerId, vx, vy);
}

/**
 * Apply an intent while phase === playing (move / mission / darkness / catch).
 * start / return_to_lobby stay transport-specific.
 */
export function applyPlayingIntent(
  state: MatchState,
  playerId: string,
  intent: ClientIntent,
): HostIntentResult {
  if (intent.type === 'start' || intent.type === 'return_to_lobby') {
    return { state, events: [] };
  }
  if (state.phase !== 'playing') return { state, events: [] };
  const entity = state.entities[playerId];
  if (!entity || !entity.alive) return { state, events: [] };

  if (intent.type === 'move') {
    return {
      state: applyMoveIntent(state, playerId, intent.dx, intent.dy),
      events: [],
    };
  }

  if (intent.type === 'mission_action') {
    return {
      state: attemptMissionTouch(state, playerId),
      events: [{ kind: 'snapshot' }],
    };
  }

  if (intent.type === 'darkness') {
    return {
      state: applyDarknessSkill(state, playerId),
      events: [{ kind: 'snapshot' }],
    };
  }

  if (intent.type === 'catch') {
    // Practice rabbit never catches (mission touch is mission_action / T)
    if (state.mode === 'practice' && state.practiceRole !== 'fox') {
      return { state, events: [] };
    }
    if (!canSeekerAct(state, playerId)) return { state, events: [] };

    const targetId = nearestCatchTarget(state, playerId);
    if (!targetId) {
      return {
        state,
        events: [
          {
            kind: 'event',
            event: 'catch_miss',
            detail: { reason: 'no_target' },
            to: playerId,
          },
        ],
      };
    }

    const result = attemptCatch(state, playerId, targetId);
    return {
      state: result.state,
      events: [
        {
          kind: 'event',
          event: result.ok ? 'catch_success' : 'catch_fail',
          detail: result.ok
            ? {
                ok: true,
                kind: result.kind,
                name: result.name,
                x: result.x,
                y: result.y,
                caughtId: result.caughtId,
                placeGrave: result.placeGrave,
              }
            : result,
        },
        { kind: 'snapshot' },
      ],
    };
  }

  return { state, events: [] };
}

/**
 * Authority tick: AI + motion while playing, always advance timer on
 * playing/starting. Practice never stays in phase 'ended'.
 */
export function tickAuthority(state: MatchState, dtMs: number): MatchState {
  if (state.phase !== 'playing' && state.phase !== 'starting') return state;

  let next = state;
  if (next.phase === 'playing') {
    if (next.mode === 'practice' && next.practiceRole) {
      // Belt against accidental mode flips from shared evaluateEndConditions
      next = { ...next, mode: 'practice', practiceRole: next.practiceRole };
    }
    next = stepAiCrowd(next, dtMs, next.tick + 1);
    next = integrateMotion(next, dtMs / 1000);
  }
  next = tickTimer(next, dtMs);
  if (next.mode === 'practice' && next.phase === 'ended') {
    next = {
      ...next,
      phase: 'playing',
      winner: null,
      endReason: null,
    };
  }
  return next;
}

/** Unified match_ended event detail (Peer + WS). */
export function matchEndedDetail(state: MatchState): {
  winner: MatchState['winner'];
  reason: string | null;
  humanCatches: number;
  catchBudget: number;
} {
  return {
    winner: state.winner,
    reason: state.endReason,
    humanCatches: state.caughtHumans?.length ?? 0,
    catchBudget: state.config.catchBudget,
  };
}
