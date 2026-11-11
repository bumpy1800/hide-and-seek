/**
 * Ordered teardown for leaving a match back to the main Menu.
 * Pure orchestration so tests can prove cleanup order without Phaser.
 */

export type SessionHosts = {
  /** Local practice host (has stop()). */
  practice: { stop: () => void } | null;
  /** Peer multiplayer (has softDisconnect or destroy). */
  peer: { softDisconnect?: () => void; destroy?: () => void } | null;
  /** WebSocket client. */
  client: { close: () => void } | null;
};

export type TeardownResult = {
  practiceStopped: boolean;
  peerDisconnected: boolean;
  clientClosed: boolean;
  /** Hosts are cleared; scene may start Menu next. */
  readyForMenu: boolean;
};

/**
 * Stop all network/practice hosts safely.
 * - Practice timer stopped first
 * - Peer: softDisconnect (timers/conns) then destroy (deferred PeerJS cleanup)
 * - Never throws
 */
export function teardownSessionHosts(hosts: SessionHosts): TeardownResult {
  let practiceStopped = false;
  let peerDisconnected = false;
  let clientClosed = false;

  if (hosts.practice) {
    try {
      hosts.practice.stop();
      practiceStopped = true;
    } catch {
      practiceStopped = false;
    }
  }

  if (hosts.peer) {
    // Soft first (sync), then destroy (PeerMultiplayer defers PeerJS destroy).
    // Separate try blocks so soft failure still schedules destroy.
    try {
      if (typeof hosts.peer.softDisconnect === 'function') {
        hosts.peer.softDisconnect();
      }
    } catch {
      /* continue to destroy */
    }
    try {
      if (typeof hosts.peer.destroy === 'function') {
        hosts.peer.destroy();
      }
      peerDisconnected = true;
    } catch {
      peerDisconnected = false;
    }
  }

  if (hosts.client) {
    try {
      hosts.client.close();
      clientClosed = true;
    } catch {
      clientClosed = false;
    }
  }

  return {
    practiceStopped: hosts.practice ? practiceStopped : true,
    peerDisconnected: hosts.peer ? peerDisconnected : true,
    clientClosed: hosts.client ? clientClosed : true,
    readyForMenu: true,
  };
}
