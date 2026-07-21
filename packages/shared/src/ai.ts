import type { EntityState, MatchState } from './types.js';
import { AI_SPEED } from './types.js';
import { createRng } from './rng.js';

type AiBrain = {
  targetX: number;
  targetY: number;
  idleMs: number;
};

const brains = new Map<string, AiBrain>();

export function resetAiBrains(): void {
  brains.clear();
}

/**
 * Update AI velocities with simple waypoint / idle patterns so they blend with hiders.
 */
export function stepAiCrowd(state: MatchState, dtMs: number, seed = 1): MatchState {
  if (state.phase !== 'playing') return state;
  const rng = createRng(seed + state.tick);
  const entities: Record<string, EntityState> = { ...state.entities };

  for (const e of Object.values(state.entities)) {
    if (e.kind !== 'ai' || !e.alive) continue;
    let brain = brains.get(e.id);
    if (!brain || brain.idleMs <= 0) {
      brain = {
        targetX: 40 + rng() * (state.config.mapWidth - 80),
        targetY: 40 + rng() * (state.config.mapHeight - 80),
        idleMs: 400 + rng() * 1800,
      };
      brains.set(e.id, brain);
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
      // slight speed variance so motion is not perfectly uniform
      const speed = AI_SPEED * (0.75 + rng() * 0.5);
      entities[e.id] = { ...e, vx: nx * speed, vy: ny * speed };
    }
  }

  return { ...state, entities };
}
