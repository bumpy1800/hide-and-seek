import { describe, expect, it, vi } from 'vitest';
import { teardownSessionHosts } from './sessionTeardown';

describe('teardownSessionHosts (lobby return)', () => {
  it('stops practice, soft-disconnects then destroys peer, closes client', () => {
    const stop = vi.fn();
    const softDisconnect = vi.fn();
    const destroy = vi.fn();
    const close = vi.fn();

    const result = teardownSessionHosts({
      practice: { stop },
      peer: { softDisconnect, destroy },
      client: { close },
    });

    expect(stop).toHaveBeenCalledOnce();
    expect(softDisconnect).toHaveBeenCalledOnce();
    // softDisconnect alone is not enough — destroy frees PeerServer slot
    // (PeerMultiplayer.destroy defers PeerJS destroy via setTimeout)
    expect(destroy).toHaveBeenCalledOnce();
    expect(softDisconnect.mock.invocationCallOrder[0]!).toBeLessThan(
      destroy.mock.invocationCallOrder[0]!,
    );
    expect(close).toHaveBeenCalledOnce();
    expect(result.readyForMenu).toBe(true);
    expect(result.practiceStopped).toBe(true);
    expect(result.peerDisconnected).toBe(true);
    expect(result.clientClosed).toBe(true);
  });

  it('still calls destroy when softDisconnect missing', () => {
    const destroy = vi.fn();
    teardownSessionHosts({
      practice: null,
      peer: { destroy },
      client: null,
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('calls softDisconnect then destroy even if softDisconnect throws', () => {
    const softDisconnect = vi.fn(() => {
      throw new Error('soft boom');
    });
    const destroy = vi.fn();
    // Current impl: whole peer try block fails if soft throws first
    // Soft must not prevent destroy — fix if this fails
    expect(() =>
      teardownSessionHosts({
        practice: null,
        peer: { softDisconnect, destroy },
        client: null,
      }),
    ).not.toThrow();
    expect(softDisconnect).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it('never throws when host methods throw', () => {
    expect(() =>
      teardownSessionHosts({
        practice: {
          stop: () => {
            throw new Error('practice boom');
          },
        },
        peer: {
          softDisconnect: () => {
            throw new Error('peer boom');
          },
          destroy: () => {
            throw new Error('destroy boom');
          },
        },
        client: {
          close: () => {
            throw new Error('ws boom');
          },
        },
      }),
    ).not.toThrow();
  });
});
