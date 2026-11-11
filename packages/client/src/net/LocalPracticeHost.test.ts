import { describe, expect, it } from 'vitest';
import { LocalPracticeHost } from './LocalPracticeHost.js';
import type { ServerMessage } from '@hide-and-seek/shared';

describe('LocalPracticeHost practice stun penalty simulation', () => {
  it('practice fox mode defaults to stun_penalty and stuns on catching AI rabbit', () => {
    const host = new LocalPracticeHost('fox', '나');
    const messages: ServerMessage[] = [];
    host.onMessage = (msg) => messages.push(msg);

    host.start();
    const initialState = host.getState();
    expect(initialState.mode).toBe('practice');
    expect(initialState.practiceRole).toBe('fox');
    expect(initialState.ruleMode).toBe('stun_penalty');

    const seekerId = initialState.seekerId!;
    expect(seekerId).toBe('local-player');

    // Find an AI rabbit
    const aiId = Object.values(initialState.entities).find((e) => e.kind === 'ai')!.id;

    // Teleport seeker right on top of the AI rabbit
    const ai = initialState.entities[aiId]!;
    initialState.entities[seekerId] = {
      ...initialState.entities[seekerId]!,
      x: ai.x,
      y: ai.y,
    };

    // Attempt catch on AI rabbit
    host.sendIntent({ type: 'catch' });

    const postCatchState = host.getState();

    // 1) AI rabbit remains alive
    expect(postCatchState.entities[aiId]?.alive).toBe(true);

    // 2) Seeker has 2s blindness and 5s stun
    expect(postCatchState.seekerBlindRemainingMs).toBe(2000);
    expect(postCatchState.seekerStunRemainingMs).toBe(5000);

    // 3) Seeker velocity is 0
    expect(postCatchState.entities[seekerId]?.vx).toBe(0);
    expect(postCatchState.entities[seekerId]?.vy).toBe(0);

    // 4) Movement intent is blocked while stunned
    host.sendIntent({ type: 'move', dx: 1, dy: 0 });
    expect(host.getState().entities[seekerId]?.vx).toBe(0);

    // 5) catch_success event emitted
    const catchEv = messages.find(
      (m) => m.type === 'event' && m.event === 'catch_success',
    );
    expect(catchEv).toBeDefined();

    // 6) Secondary catch attempt while stunned is rejected
    host.sendIntent({ type: 'catch' });
    const postSecondCatch = host.getState();
    expect(postSecondCatch.seekerStunRemainingMs).toBe(5000);

    host.stop();
  });

  it('practice rabbit mode has no seeker and cannot catch', () => {
    const host = new LocalPracticeHost('rabbit', '토끼');
    host.start();
    const state = host.getState();
    expect(state.mode).toBe('practice');
    expect(state.practiceRole).toBe('rabbit');
    expect(state.seekerId).toBeNull();

    // Rabbit catch intent does nothing
    host.sendIntent({ type: 'catch' });
    const postCatchState = host.getState();
    expect(postCatchState.seekerStunRemainingMs).toBe(0);
    expect(postCatchState.phase).toBe('playing');

    host.stop();
  });
});
