import type { EntityState, MatchState } from './types.js';
import { AI_SPEED } from './types.js';
import { createRng } from './rng.js';

type AiBrain = {
  targetX: number;
  targetY: number;
  idleMs: number;
};

/** Keyed by `${roomId}:${entityId}` so concurrent rooms never share brains. */
const brains = new Map<string, AiBrain>();

function brainKey(roomId: string, entityId: string): string {
  return `${roomId}:${entityId}`;
}

/** Clear all brains, or only those belonging to a room. */
export function resetAiBrains(roomId?: string): void {
  if (!roomId) {
    brains.clear();
    return;
  }
  const prefix = `${roomId}:`;
  for (const key of [...brains.keys()]) {
    if (key.startsWith(prefix)) brains.delete(key);
  }
}

/** Test helper: whether a brain exists for room+entity. */
export function hasAiBrain(roomId: string, entityId: string): boolean {
  return brains.has(brainKey(roomId, entityId));
}

/** Effective move speed for AI rabbits — must equal human rabbit speed. */
export function aiRabbitMoveSpeed(): number {
  return AI_SPEED;
}

/**
 * Update AI velocities with simple waypoint / idle patterns so they blend with hiders.
 * Uses the same base speed as human rabbits (no systematic slower variance).
 */
export function stepAiCrowd(state: MatchState, dtMs: number, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  const rng = createRng(seed + state.tick);
  const entities: Record<string, EntityState> = { ...state.entities };
  const roomId = state.roomId;
  const speed = aiRabbitMoveSpeed();

  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'ai' || !e.alive) continue;
    const key = brainKey(roomId, e.id);
    let brain = brains.get(key);
    if (!brain || brain.idleMs <= 0) {
      brain = {
        targetX: 40 + rng() * (state.config.mapWidth - 80),
        targetY: 40 + rng() * (state.config.mapHeight - 80),
        idleMs: 400 + rng() * 1800,
      };
      brains.set(key, brain);
    }

    const dx = brain.targetX - e.x;
    const dy = brain.targetY - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 12) {
      brain.idleMs -= dtMs;
      entities[e.id] = { ...e, vx: 0, vy: 0 };
    } else {
      const nx = dx / dist;
      const ny = dy / dist;
      // Same magnitude as human rabbit — no 0.75–1.5 multiplier lag
      entities[e.id] = { ...e, vx: nx * speed, vy: ny * speed };
    }
  }

  return { ...state, entities };
}
