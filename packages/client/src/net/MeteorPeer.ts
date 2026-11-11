/**
 * Lightweight PeerJS session for meteor survival race.
 * Host ticks independent per-player sims; guests send intent only.
 */
import { Peer, type DataConnection } from 'peerjs';
import {
  createMeteorRun,
  setShipIntent,
  stepMeteorRun,
  type MeteorRunState,
} from '@hide-and-seek/shared';
import { makeRoomCode, normalizeRoomCode } from './roomCodes';

export type MeteorPlayerPublic = {
  id: string;
  name: string;
  ship: {
    x: number;
    y: number;
    radius: number;
    alive: boolean;
    survivalMs: number;
  };
  meteors: Array<{ x: number; y: number; radius: number }>;
  config: { width: number; height: number };
};

export type MeteorSnap = {
  roomCode: string;
  localId: string;
  phase: 'lobby' | 'racing' | 'finished';
  players: MeteorPlayerPublic[];
};

type Wire =
  | { ch: 'hello'; name: string }
  | { ch: 'intent'; dx: number; dy: number }
  | { ch: 'start' }
  | { ch: 'snap'; snap: MeteorSnap }
  | { ch: 'lobby'; roomCode: string; players: Array<{ id: string; name: string }> };

type PlayerSlot = {
  id: string;
  name: string;
  run: MeteorRunState;
  intentDx: number;
  intentDy: number;
};

export type MeteorPeerHandlers = {
  onSnap?: (snap: MeteorSnap) => void;
  onLobby?: (roomCode: string, players: Array<{ id: string; name: string }>) => void;
  onStatus?: (status: string, detail?: string) => void;
};

export class MeteorPeer {
  private peer: Peer | null = null;
  private conns = new Map<string, DataConnection>();
  private isHost = false;
  private localPlayerId = '';
  private roomCode = '';
  private phase: 'lobby' | 'racing' | 'finished' = 'lobby';
  private slots = new Map<string, PlayerSlot>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs = 50;
  private handlers: MeteorPeerHandlers = {};
  private lastSnap: MeteorSnap | null = null;
  private softClosed = false;

  setHandlers(h: MeteorPeerHandlers): void {
    this.handlers = h;
  }

  get playerId(): string {
    return this.localPlayerId;
  }

  get hostMode(): boolean {
    return this.isHost;
  }

  get code(): string {
    return this.roomCode;
  }

  get currentSnap(): MeteorSnap | null {
    return this.lastSnap;
  }

  async createRoom(playerName: string): Promise<string> {
    this.isHost = true;
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
    this.roomCode = this.localPlayerId;
    this.addSlot(this.localPlayerId, playerName);
    this.phase = 'lobby';
    this.emitLobby();
    this.handlers.onStatus?.('host_ready', this.roomCode);
    return this.roomCode;
  }

  async joinRoom(hostCode: string, playerName: string): Promise<void> {
    this.isHost = false;
    const code = normalizeRoomCode(hostCode);
    this.roomCode = code;
    this.localPlayerId = await this.openPeer();
    this.handlers.onStatus?.('connecting', code);
    const conn = this.peer!.connect(code, { reliable: true });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('join_timeout')), 15_000);
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
    conn.send({ ch: 'hello', name: playerName } satisfies Wire);
    this.handlers.onStatus?.('joined', code);
  }

  /**
   * Host only: begin (or re-start after finished) independent survival races.
   * Allowed from lobby or finished — mid-race calls are ignored.
   */
  startRace(): void {
    if (!this.isHost || this.phase === 'racing') return;
    this.phase = 'racing';
    for (const slot of this.slots.values()) {
      slot.run = createMeteorRun({ seed: (Date.now() ^ slot.id.length * 997) >>> 0 });
      slot.intentDx = 0;
      slot.intentDy = 0;
    }
    this.startTicks();
    this.broadcastSnap();
  }

  sendIntent(dx: number, dy: number): void {
    if (this.isHost) {
      const me = this.slots.get(this.localPlayerId);
      if (me) {
        me.intentDx = dx;
        me.intentDy = dy;
      }
      return;
    }
    const hostConn = [...this.conns.values()][0];
    hostConn?.send({ ch: 'intent', dx, dy } satisfies Wire);
  }

  /** Soft close: stop ticks & close data channels without Peer.destroy hang. */
  softDisconnect(): void {
    if (this.softClosed) return;
    this.softClosed = true;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const c of this.conns.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.conns.clear();
    // Defer destroy so UI stays responsive
    const p = this.peer;
    this.peer = null;
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

  private addSlot(id: string, name: string): void {
    if (this.slots.has(id)) {
      this.slots.get(id)!.name = name;
      return;
    }
    this.slots.set(id, {
      id,
      name,
      run: createMeteorRun({ seed: 1 }),
      intentDx: 0,
      intentDy: 0,
    });
  }

  private emitLobby(): void {
    const players = [...this.slots.values()].map((s) => ({ id: s.id, name: s.name }));
    this.handlers.onLobby?.(this.roomCode, players);
    this.broadcast({ ch: 'lobby', roomCode: this.roomCode, players });
  }

  private startTicks(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = setInterval(() => this.hostTick(), this.tickMs);
  }

  private hostTick(): void {
    if (!this.isHost || this.phase !== 'racing') return;
    let anyAlive = false;
    for (const slot of this.slots.values()) {
      let run = setShipIntent(slot.run, slot.intentDx, slot.intentDy);
      run = stepMeteorRun(run, this.tickMs);
      slot.run = run;
      if (run.ship.alive) anyAlive = true;
    }
    this.broadcastSnap();
    if (!anyAlive && this.slots.size > 0) {
      this.phase = 'finished';
      if (this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
      this.broadcastSnap();
    }
  }

  private buildSnap(): MeteorSnap {
    const players: MeteorPlayerPublic[] = [...this.slots.values()].map((s) => ({
      id: s.id,
      name: s.name,
      ship: {
        x: s.run.ship.x,
        y: s.run.ship.y,
        radius: s.run.ship.radius,
        alive: s.run.ship.alive,
        survivalMs: s.run.ship.survivalMs,
      },
      meteors: s.run.meteors.map((m) => ({
        x: m.x,
        y: m.y,
        radius: m.radius,
      })),
      config: { width: s.run.config.width, height: s.run.config.height },
    }));
    return {
      roomCode: this.roomCode,
      localId: this.localPlayerId,
      phase: this.phase,
      players,
    };
  }

  private broadcastSnap(): void {
    const snap = this.buildSnap();
    // Host's localId in snap is for recipients; host fixes for self in handler
    this.lastSnap = { ...snap, localId: this.localPlayerId };
    this.handlers.onSnap?.(this.lastSnap);
    for (const [peerId, conn] of this.conns) {
      if (!conn.open) continue;
      const forGuest: MeteorSnap = { ...snap, localId: peerId };
      try {
        conn.send({ ch: 'snap', snap: forGuest } satisfies Wire);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcast(msg: Wire): void {
    for (const conn of this.conns.values()) {
      if (!conn.open) continue;
      try {
        conn.send(msg);
      } catch {
        /* ignore */
      }
    }
  }

  private openPeer(id?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const peer = id ? new Peer(id) : new Peer();
      this.peer = peer;
      const t = setTimeout(() => reject(new Error('peer_open_timeout')), 12_000);
      peer.on('open', (pid) => {
        clearTimeout(t);
        resolve(pid);
      });
      peer.on('error', (e) => {
        clearTimeout(t);
        reject(e);
      });
      peer.on('connection', (conn) => {
        if (!this.isHost) return;
        this.conns.set(conn.peer, conn);
        this.wireConn(conn);
      });
    });
  }

  private wireConn(conn: DataConnection): void {
    conn.on('data', (raw) => {
      const msg = raw as Wire;
      if (!msg || typeof msg !== 'object' || !('ch' in msg)) return;

      if (this.isHost) {
        if (msg.ch === 'hello') {
          this.addSlot(conn.peer, msg.name || '손님');
          if (this.phase === 'lobby') this.emitLobby();
          // Late join during race: still add with fresh run if racing
          if (this.phase === 'racing') {
            const slot = this.slots.get(conn.peer);
            if (slot) {
              slot.run = createMeteorRun({ seed: (Date.now() + 13) >>> 0 });
            }
            this.broadcastSnap();
          }
          return;
        }
        if (msg.ch === 'intent') {
          const slot = this.slots.get(conn.peer);
          if (slot) {
            slot.intentDx = msg.dx;
            slot.intentDy = msg.dy;
          }
          return;
        }
        return;
      }

      // Guest receives
      if (msg.ch === 'lobby') {
        this.handlers.onLobby?.(msg.roomCode, msg.players);
        return;
      }
      if (msg.ch === 'snap') {
        this.lastSnap = msg.snap;
        this.phase = msg.snap.phase;
        this.handlers.onSnap?.(msg.snap);
      }
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      if (this.isHost) {
        this.slots.delete(conn.peer);
        if (this.phase === 'lobby') this.emitLobby();
      }
    });
  }
}
