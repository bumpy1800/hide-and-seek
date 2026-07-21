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
    let a = createLobby('room-a', defaultConfig({ aiCount: 1 }));
    let b = createLobby('room-b', defaultConfig({ aiCount: 1 }));
    let ra = joinHuman(a, 'ha', 'HA');
    let rb = joinHuman(b, 'hb', 'HB');
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
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
