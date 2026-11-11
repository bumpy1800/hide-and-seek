import { Peer, type DataConnection } from 'peerjs';
import {
  applyPlayingIntent,
  applyRoomSettings,
  createLobby,
  defaultConfig,
  joinHuman,
  leaveHuman,
  matchEndedDetail,
  normalizeRoomSettings,
  resetAiBrains,
  returnToLobby,
  startMatch,
  tickAuthority,
  type ClientIntent,
  type ClientMessage,
  type HostSimEvent,
  type MatchState,
  type RoomSettings,
  type ServerMessage,
} from '@hide-and-seek/shared';
import { getRoomDirectory, type PublicRoom } from './RoomDirectory';
import { makeRoomCode, normalizeRoomCode } from './roomCodes';

export type PeerSessionHandler = (msg: ServerMessage) => void;
export type PeerStatusHandler = (status: string, detail?: string) => void;

type WireMsg =
  | { ch: 'client'; msg: ClientMessage }
  | { ch: 'server'; msg: ServerMessage }
  | { ch: 'hello'; name: string };

/**
 * Browser multiplayer: one peer is host (ticks match state), others are guests.
 * Works on static Vercel deploy without a dedicated WebSocket server.
 * Hosts register in RoomDirectory so friends can click-to-join from a list.
 */
export class PeerMultiplayer {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private state: MatchState = createLobby('peer-lobby', defaultConfig());
  private names = new Map<string, string>();
  private localPlayerId = '';
  private hostName = 'Host';
  private isHost = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private listHeartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs = 50;
  private endedBroadcast = false;

  onMessage: PeerSessionHandler | null = null;
  onStatus: PeerStatusHandler | null = null;

  /** Host creates a room with a short code; returns shareable room code. */
  async createRoom(
    playerName: string,
    settings?: Partial<RoomSettings>,
  ): Promise<string> {
    this.isHost = true;
    this.hostName = playerName;
    let code = '';
    let lastErr: unknown;
    for (let attempt = 0; attempt < 10; attempt++) {
      code = makeRoomCode(6);
      try {
        this.localPlayerId = await this.openPeer(code);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        this.peer?.destroy();
        this.peer = null;
      }
    }
    if (!this.localPlayerId) {
      throw lastErr instanceof Error ? lastErr : new Error('create_room_failed');
    }
    this.names.set(this.localPlayerId, playerName);
    const opts = normalizeRoomSettings(settings ?? {});
    this.state = createLobby(
      this.localPlayerId,
      defaultConfig({
        catchBudget: opts.catchBudget,
        timeLimitMs: opts.timeLimitMs,
        aiCount: opts.aiCount,
        foxMode: opts.foxMode,
        ruleMode: opts.ruleMode,
      }),
    );
    this.state = applyRoomSettings(this.state, opts);
    const joined = joinHuman(this.state, this.localPlayerId, playerName);
    if (!joined.ok) throw new Error(joined.reason);
    this.state = joined.state;
    this.onStatus?.('host_ready', this.localPlayerId);
    this.emitLocal({ type: 'welcome', playerId: this.localPlayerId, roomId: this.localPlayerId });
    this.broadcastSnapshot();
    this.startTicks();
    await this.ensureDirectory();
    this.publishListing();
    this.listHeartbeat = setInterval(() => this.publishListing(), 8000);
    return this.localPlayerId;
  }

  /** Guest joins host room code (short code or peer id). */
  async joinRoom(hostId: string, playerName: string): Promise<void> {
    this.isHost = false;
    const code = normalizeRoomCode(hostId);
    this.localPlayerId = await this.openPeer();
    this.onStatus?.('connecting_host', code);
    const conn = this.peer!.connect(code, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('join_timeout')), 15000);
      conn.on('open', () => {
        clearTimeout(t);
        resolve();
      });
      conn.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });
    this.conns.set(code, conn);
    this.wireConn(conn);
    conn.send({ ch: 'hello', name: playerName } satisfies WireMsg);
    this.onStatus?.('joined', code);
  }

  sendIntent(intent: ClientIntent): void {
    if (this.isHost) {
      this.applyIntent(this.localPlayerId, intent);
      return;
    }
    const hostConn = [...this.conns.values()][0];
    hostConn?.send({ ch: 'client', msg: { type: 'intent', intent } } satisfies WireMsg);
  }

  get playerId(): string {
    return this.localPlayerId;
  }

  get hostMode(): boolean {
    return this.isHost;
  }

  get roomCode(): string {
    return this.localPlayerId;
  }

  /**
   * Stop ticks + close data channels without PeerJS destroy (destroy can hang UI).
   * Safe to call multiple times.
   */
  softDisconnect(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.listHeartbeat) {
      clearInterval(this.listHeartbeat);
      this.listHeartbeat = null;
    }
    if (this.isHost && this.localPlayerId) {
      try {
        getRoomDirectory().close(this.localPlayerId);
      } catch {
        /* ignore */
      }
    }
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    this.onMessage = null;
    this.onStatus = null;
  }

  destroy(): void {
    this.softDisconnect();
    const p = this.peer;
    this.peer = null;
    // Defer PeerJS destroy — sync destroy has frozen the game loop in practice
    if (p) {
      setTimeout(() => {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }, 0);
    }
  }

  private async ensureDirectory(): Promise<void> {
    const dir = getRoomDirectory();
    try {
      await dir.start();
    } catch {
      // Listing optional — code join still works
      this.onStatus?.('directory_unavailable');
    }
  }

  private publishListing(): void {
    if (!this.isHost || !this.localPlayerId) return;
    const room: PublicRoom = {
      code: this.localPlayerId,
      hostName: this.hostName,
      players: this.state.humans.length,
      maxPlayers: this.state.config.maxHumans,
      phase: this.state.phase === 'lobby' ? 'lobby' : this.state.phase === 'playing' ? 'playing' : 'ended',
      updatedAt: Date.now(),
      game: 'hide-and-seek',
      ruleMode: this.state.ruleMode ?? this.state.config?.ruleMode,
    };
    // Only lobby rooms appear in clickable list
    if (room.phase === 'lobby') {
      getRoomDirectory().announce(room);
    } else {
      getRoomDirectory().close(room.code);
    }
  }

  private openPeer(preferredId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const peer = preferredId ? new Peer(preferredId, { debug: 0 }) : new Peer({ debug: 0 });
      this.peer = peer;
      let settled = false;
      peer.on('open', (id) => {
        if (settled) return;
        settled = true;
        resolve(id);
      });
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        this.onStatus?.('error', `${type ?? ''}:${String(err)}`);
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
      peer.on('connection', (conn) => {
        if (!this.isHost) return;
        conn.on('open', () => {
          this.conns.set(conn.peer, conn);
          this.wireConn(conn);
          this.onStatus?.('guest_connected', conn.peer);
        });
      });
    });
  }

  private wireConn(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const data = raw as WireMsg;
      if (!data || typeof data !== 'object') return;
      if (data.ch === 'hello' && this.isHost) {
        const name = data.name || `Guest`;
        const pid = conn.peer;
        const joined = joinHuman(this.state, pid, name);
        if (!joined.ok) {
          conn.send({ ch: 'server', msg: { type: 'error', message: joined.reason } } satisfies WireMsg);
          return;
        }
        this.state = joined.state;
        this.names.set(pid, name);
        conn.send({
          ch: 'server',
          msg: { type: 'welcome', playerId: pid, roomId: this.localPlayerId },
        } satisfies WireMsg);
        this.broadcastSnapshot();
        this.publishListing();
        return;
      }
      if (data.ch === 'client' && this.isHost) {
        const msg = data.msg;
        if (msg.type === 'intent') {
          this.applyIntent(conn.peer, msg.intent);
        }
        return;
      }
      if (data.ch === 'server' && !this.isHost) {
        this.emitLocal(data.msg);
      }
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      if (this.isHost) {
        this.state = leaveHuman(this.state, conn.peer);
        this.names.delete(conn.peer);
        this.broadcastSnapshot();
        this.publishListing();
      } else {
        this.onStatus?.('disconnected');
      }
    });
  }

  private applyIntent(playerId: string, intent: ClientIntent): void {
    // Host-only: put room back in waiting lobby (no auto rematch)
    if (intent.type === 'return_to_lobby') {
      if (!this.isHost || playerId !== this.localPlayerId) return;
      if (this.state.phase !== 'ended' && this.state.phase !== 'playing') return;
      this.state = returnToLobby(this.state);
      resetAiBrains(this.state.roomId);
      this.endedBroadcast = false;
      this.broadcastSnapshot();
      this.publishListing();
      this.broadcast({
        type: 'event',
        event: 'returned_to_lobby',
        detail: {},
      });
      return;
    }

    if (intent.type === 'start') {
      if (this.state.phase === 'playing' || this.state.phase === 'starting') return;
      if (this.state.phase === 'ended') {
        this.state = returnToLobby(this.state);
        resetAiBrains(this.state.roomId);
        this.endedBroadcast = false;
        this.publishListing();
      }
      if (this.state.phase !== 'lobby') return;
      if (this.state.humans.length < 2) {
        this.emitTo(playerId, { type: 'error', message: 'need_2_players_for_multiplayer' });
        return;
      }
      try {
        resetAiBrains(this.state.roomId);
        const foxMode = this.state.config.foxMode === 'designate' ? 'designate' : 'roulette';
        let designatedSeekerId =
          typeof intent.designatedSeekerId === 'string' ? intent.designatedSeekerId : undefined;
        if (foxMode === 'designate' && !designatedSeekerId) {
          // Fallback: first human if host forgot to pick (still designate, no roulette)
          designatedSeekerId = this.state.humans[0];
        }
        this.state = startMatch(this.state, {
          mode: 'normal',
          seed: Date.now() ^ this.state.humans.length,
          foxMode,
          designatedSeekerId,
          ruleMode: intent.ruleMode ?? this.state.ruleMode ?? this.state.config?.ruleMode,
        });
        this.endedBroadcast = false;
        this.broadcastSnapshot();
        const names = this.state.humans.map((id) => ({
          id,
          name: this.names.get(id) || this.state.entities[id]?.name || id,
        }));
        this.broadcast({
          type: 'event',
          event: 'match_started',
          detail: {
            seekerId: this.state.seekerId,
            mode: this.state.mode,
            prepMs: this.state.config.seekerPrepMs,
            startSequenceMs: this.state.startSequenceRemainingMs,
            humans: names,
            catchBudget: this.state.config.catchBudget,
            timeLimitMs: this.state.config.timeLimitMs,
            aiCount: this.state.config.aiCount,
            foxMode: this.state.config.foxMode,
          },
        });
        // Hide from public list once match starts
        this.publishListing();
      } catch (e) {
        this.emitTo(playerId, {
          type: 'error',
          message: e instanceof Error ? e.message : 'start_failed',
        });
      }
      return;
    }

    // Playing intents (move / mission / darkness / catch) via shared hostSim
    const result = applyPlayingIntent(this.state, playerId, intent);
    this.state = result.state;
    this.dispatchHostEvents(result.events);
  }

  private dispatchHostEvents(events: HostSimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'snapshot') {
        this.broadcastSnapshot();
        continue;
      }
      const msg: ServerMessage = {
        type: 'event',
        event: ev.event,
        detail: ev.detail,
      };
      if (ev.to && ev.to !== 'all') {
        this.emitTo(ev.to, msg);
      } else {
        this.broadcast(msg);
      }
    }
  }

  private startTicks(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => {
      if (this.state.phase !== 'playing' && this.state.phase !== 'starting') return;
      this.state = tickAuthority(this.state, this.tickMs);
      this.broadcastSnapshot();
      if (this.state.phase === 'ended' && !this.endedBroadcast) {
        this.endedBroadcast = true;
        resetAiBrains(this.state.roomId);
        this.broadcast({
          type: 'event',
          event: 'match_ended',
          detail: matchEndedDetail(this.state),
        });
      }
    }, this.tickMs);
  }

  private broadcastSnapshot(): void {
    this.emitLocal({ type: 'snapshot', state: this.state, you: this.localPlayerId });
    for (const [peerId, conn] of this.conns) {
      if (conn.open) {
        conn.send({
          ch: 'server',
          msg: { type: 'snapshot', state: this.state, you: peerId },
        } satisfies WireMsg);
      }
    }
  }

  private broadcast(msg: ServerMessage): void {
    this.emitLocal(msg);
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send({ ch: 'server', msg } satisfies WireMsg);
    }
  }

  private emitTo(playerId: string, msg: ServerMessage): void {
    if (playerId === this.localPlayerId) {
      this.emitLocal(msg);
      return;
    }
    const conn = this.conns.get(playerId);
    conn?.send({ ch: 'server', msg } satisfies WireMsg);
  }

  private emitLocal(msg: ServerMessage): void {
    this.onMessage?.(msg);
  }
}
