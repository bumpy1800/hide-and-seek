import { describe, expect, it } from 'vitest';
import {
  attemptCatch,
  catchAnnounceText,
  createLobby,
  defaultConfig,
  joinHuman,
  listCaughtHumans,
  roleObjectiveLines,
  startMatch,
  skipToPlaying,
} from '../src/index.js';

describe('multiplayer AI + human catch feedback', () => {
  function twoPlayerNormal(seed = 11) {
    let lobby = createLobby('fb', defaultConfig({ aiCount: 2, seekerPrepMs: 0, catchRange: 500 }));
    let res = joinHuman(lobby, 'a', '여우유저');
    res = joinHuman(res.ok ? res.state : lobby, 'b', '토끼닉');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('join failed');
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed }));
    return state;
  }

  it('normal mode: AI catch succeeds, no grave, no caughtHumans, budget unchanged', () => {
    let state = twoPlayerNormal(3);
    const seekerId = state.seekerId!;
    const ai = Object.values(state.entities).find((e) => e.kind === 'ai' && e.alive)!;
    const budget = state.catchBudgetRemaining;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 100, y: 100 },
        [ai.id]: { ...ai, x: 110, y: 100, alive: true },
      },
    };
    const r = attemptCatch(state, seekerId, ai.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('ai');
    expect(r.placeGrave).toBe(false);
    expect(r.x).toBe(110);
    expect(r.y).toBe(100);
    expect(r.state.entities[ai.id]!.alive).toBe(false);
    expect(r.state.catchBudgetRemaining).toBe(budget - 1);
    expect(listCaughtHumans(r.state)).toHaveLength(0);
    expect(catchAnnounceText(r)).toContain('AI');
  });

  it('normal mode: human catch succeeds with nickname + grave flag', () => {
    let state = twoPlayerNormal(5);
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    const nick = state.entities[hiderId]!.name;
    state = {
      ...state,
      entities: {
        ...state.entities,
        [seekerId]: { ...state.entities[seekerId]!, x: 200, y: 200 },
        [hiderId]: { ...state.entities[hiderId]!, x: 210, y: 200, alive: true },
      },
    };
    const r = attemptCatch(state, seekerId, hiderId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('human');
    expect(r.placeGrave).toBe(true);
    expect(r.name).toBe(nick);
    expect(r.x).toBe(210);
    expect(r.y).toBe(200);
    expect(listCaughtHumans(r.state).some((c) => c.name === nick)).toBe(true);
    expect(catchAnnounceText(r)).toContain(nick);
    expect(catchAnnounceText(r)).toContain('유저');
  });

  it('roleObjectiveLines differs for fox vs rabbit', () => {
    const state = twoPlayerNormal(9);
    const seekerId = state.seekerId!;
    const hiderId = state.humans.find((h) => h !== seekerId)!;
    const foxLines = roleObjectiveLines(skipToPlaying(state), seekerId);
    const rabbitLines = roleObjectiveLines(skipToPlaying(state), hiderId);
    expect(foxLines.join('\n')).not.toBe(rabbitLines.join('\n'));
    expect(foxLines.some((l) => l.includes('잡') || l.includes('토끼'))).toBe(true);
    expect(rabbitLines.some((l) => l.includes('버티') || l.includes('숨'))).toBe(true);
  });
});
