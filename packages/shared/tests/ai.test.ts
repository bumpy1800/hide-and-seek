import { describe, expect, it, beforeEach } from 'vitest';
import {
  createLobby,
  defaultConfig,
  joinHuman,
  startMatch,
  stepAiCrowd,
  hasAiBrain,
  resetAiBrains,
} from '../src/index.js';

describe('room-scoped AI brains', () => {
  beforeEach(() => {
    resetAiBrains();
  });

  it('does not share brains across rooms and resetAiBrains clears room keys', () => {
    let a = createLobby('room-a', defaultConfig());
    let b = createLobby('room-b', defaultConfig());
    let ra = joinHuman(a, 'ha', 'HA');
    ra = joinHuman(ra.ok ? ra.state : a, 'ha2', 'HA2');
    let rb = joinHuman(b, 'hb', 'HB');
    rb = joinHuman(rb.ok ? rb.state : b, 'hb2', 'HB2');
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    // 2 humans each → 5 AI (ai-0 exists)
    a = startMatch(ra.state, 1);
    b = startMatch(rb.state, 1);

    a = stepAiCrowd(a, 50, 1);
    b = stepAiCrowd(b, 50, 1);

    expect(hasAiBrain('room-a', 'ai-0')).toBe(true);
    expect(hasAiBrain('room-b', 'ai-0')).toBe(true);

    resetAiBrains('room-a');
    expect(hasAiBrain('room-a', 'ai-0')).toBe(false);
    expect(hasAiBrain('room-b', 'ai-0')).toBe(true);

    resetAiBrains('room-b');
    expect(hasAiBrain('room-b', 'ai-0')).toBe(false);
  });
});
