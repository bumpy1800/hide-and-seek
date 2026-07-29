import type { EntityState, MatchPhase, MatchState } from '@hide-and-seek/shared';

/**
 * Overhead name plate text.
 * - During play: fox never sees rabbit nicknames (fairness).
 * - After match ends: everyone sees human nicknames (+ 생존/잡힘); AI labeled "AI".
 */
export function nameTagLabel(
  e: EntityState,
  you: string | null,
  seekerId: string | null,
  phase: MatchPhase = 'playing',
): string {
  if (phase === 'ended') {
    if (e.kind === 'ai') return 'AI';
    const nick = (e.name ?? '').trim() || '유저';
    if (e.id === seekerId || e.role === 'seeker') return `술래 · ${nick}`;
    const status = e.alive ? '생존' : '잡힘';
    return `${nick} · ${status}`;
  }

  if (e.kind === 'ai') return '';
  const nick = (e.name ?? '').trim();
  if (e.id === you) return nick || '나';
  // Fox must not read rabbit nicknames above heads during the hunt
  if (you != null && seekerId != null && seekerId === you) return '';
  if (seekerId != null && (e.id === seekerId || e.role === 'seeker')) return '술래';
  // User rabbits can see each other's nicknames
  return nick || '유저';
}

export type UserRabbitSummary = {
  id: string;
  name: string;
  alive: boolean;
  caught: boolean;
};

/** Human rabbits (hiders) for end-screen / reveal — excludes the fox. */
export function listUserRabbits(state: MatchState): UserRabbitSummary[] {
  const seekerId = state.seekerId;
  const caughtIds = new Set((state.caughtHumans ?? []).map((c) => c.id));
  const out: UserRabbitSummary[] = [];
  for (const id of state.humans) {
    if (id === seekerId) continue;
    const e = state.entities[id];
    if (!e || e.kind !== 'human') continue;
    // Prefer hider role; after catch role may still be hider with alive false
    if (e.role === 'seeker') continue;
    const name = (e.name ?? '').trim() || id;
    out.push({
      id,
      name,
      alive: e.alive,
      caught: caughtIds.has(id) || !e.alive,
    });
  }
  return out;
}

/** HUD lines listing every user rabbit and status (end screen). */
export function userRabbitRevealLines(state: MatchState): string[] {
  const list = listUserRabbits(state);
  if (list.length === 0) return ['유저 토끼  없음'];
  const lines = [`유저 토끼  ${list.length}명`];
  for (const r of list) {
    const mark = r.caught || !r.alive ? '잡힘' : '생존';
    lines.push(`  · ${r.name} (${mark})`);
  }
  return lines;
}
