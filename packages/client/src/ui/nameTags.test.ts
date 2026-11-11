import { describe, expect, it } from 'vitest';
import {
  createLobby,
  defaultConfig,
  joinHuman,
  skipToPlaying,
  startMatch,
  type MatchState,
} from '@hide-and-seek/shared';
import {
  DARKNESS_SKILL_ICON,
  catchCooldownProgress,
  listUserRabbits,
  nameTagLabel,
  userRabbitRevealLines,
} from './nameTags';

function playingTwo(): MatchState {
  let lobby = createLobby('t', defaultConfig({ aiCount: 1, seekerPrepMs: 0 }));
  let res = joinHuman(lobby, 'fox', '여우님');
  res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼갑');
  if (!res.ok) throw new Error('join');
  return skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 1 }));
}

describe('nameTagLabel', () => {
  it('catch cooldown progress is 0..1 for progress bar', () => {
    expect(catchCooldownProgress(3000, 3000)).toBe(1);
    expect(catchCooldownProgress(1500, 3000)).toBeCloseTo(0.5);
    expect(catchCooldownProgress(0, 3000)).toBe(0);
  });

  it('puts darkness skill icon left of rabbit nick; fox never sees it', () => {
    const state = playingTwo();
    const seeker = state.seekerId!;
    const rabbitId = state.humans.find((h) => h !== seeker)!;
    const rabbit = state.entities[rabbitId]!;
    const withSkill = nameTagLabel(rabbit, rabbitId, seeker, 'playing', {
      hasDarknessSkill: true,
    });
    expect(withSkill.startsWith(`${DARKNESS_SKILL_ICON} `)).toBe(true);
    expect(withSkill).toContain((rabbit.name ?? '').trim() || '나');
    // Fox viewing rabbit still gets empty plate (no skill leak)
    expect(
      nameTagLabel(rabbit, seeker, seeker, 'playing', { hasDarknessSkill: true }),
    ).toBe('');
  });

  it('hides rabbit nicknames from fox during play; rabbits see each other', () => {
    let lobby = createLobby('nicks', defaultConfig({ aiCount: 1, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'fox', '여우님');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', '토끼갑');
    res = joinHuman(res.ok ? res.state : lobby, 'r2', '토끼을');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 3 }));
    const seeker = state.seekerId!;
    const rabbits = state.humans.filter((h) => h !== seeker);
    expect(rabbits.length).toBeGreaterThanOrEqual(2);
    const r1 = rabbits[0]!;
    const r2 = rabbits[1]!;
    const rabbit1 = state.entities[r1]!;
    const rabbit2 = state.entities[r2]!;
    const ai = Object.values(state.entities).find((e) => e.kind === 'ai')!;

    // Fox must not read rabbit plates during hunt
    expect(nameTagLabel(rabbit1, seeker, seeker, 'playing')).toBe('');
    expect(nameTagLabel(rabbit2, seeker, seeker, 'playing')).toBe('');
    // AI never has a play-time plate
    expect(nameTagLabel(ai, r1, seeker, 'playing')).toBe('');
    // Rabbit sees own nick
    expect(nameTagLabel(rabbit1, r1, seeker, 'playing')).toBe(
      (rabbit1.name ?? '').trim() || '나',
    );
    // Rabbit sees other human rabbit nick
    expect(nameTagLabel(rabbit2, r1, seeker, 'playing')).toBe(
      (rabbit2.name ?? '').trim() || '유저',
    );
  });

  it('reveals human nicknames and AI label when ended', () => {
    const state = playingTwo();
    const seeker = state.seekerId!;
    const hider = state.humans.find((h) => h !== seeker)!;
    const rabbit = { ...state.entities[hider]!, alive: true, name: '토끼갑' };
    const ai = Object.values(state.entities).find((e) => e.kind === 'ai')!;
    expect(nameTagLabel(rabbit, seeker, seeker, 'ended')).toBe('토끼갑 · 생존');
    expect(nameTagLabel({ ...rabbit, alive: false }, seeker, seeker, 'ended')).toBe(
      '토끼갑 · 잡힘',
    );
    expect(nameTagLabel(ai, seeker, seeker, 'ended')).toBe('AI');
    const fox = state.entities[seeker]!;
    expect(nameTagLabel(fox, hider, seeker, 'ended')).toMatch(/^술래/);
  });

  it('displays stun duration above seeker when isStunned is true', () => {
    const state = playingTwo();
    const seeker = state.seekerId!;
    const fox = state.entities[seeker]!;
    const label = nameTagLabel(fox, null, seeker, 'playing', {
      isStunned: true,
      stunRemainingMs: 4200,
    });
    expect(label).toBe('술래 💫 스턴 (4.2초)');
  });
});

describe('listUserRabbits / reveal lines', () => {
  it('lists human rabbits with nicknames, not the fox', () => {
    const state = playingTwo();
    const seeker = state.seekerId!;
    const list = listUserRabbits(state);
    expect(list.every((r) => r.id !== seeker)).toBe(true);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]!.name.length).toBeGreaterThan(0);
    const lines = userRabbitRevealLines(state);
    expect(lines[0]).toMatch(/유저 토끼/);
    expect(lines.some((l) => l.includes('·'))).toBe(true);
  });
});
