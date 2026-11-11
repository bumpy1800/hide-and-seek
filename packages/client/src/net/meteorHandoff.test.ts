import { describe, expect, it } from 'vitest';
import { takePeerHandoff } from './meteorHandoff';

describe('meteor multi handoff', () => {
  it('takes peer once then rejects null and second take', () => {
    const peer = { id: 'host-room' };
    let state = { handedOff: false, peer: peer as { id: string } | null };

    const first = takePeerHandoff(state, peer);
    expect(first.taken).toBe(peer);
    expect(first.state.handedOff).toBe(true);
    expect(first.state.peer).toBeNull();
    state = first.state;

    // Simulates button calling enter after onSnap already nulled this.peer
    const second = takePeerHandoff(state, null);
    expect(second.taken).toBeNull();
    expect(second.state.handedOff).toBe(true);

    const third = takePeerHandoff(state, peer);
    expect(third.taken).toBeNull();
  });
});
