import { Peer, type DataConnection } from 'peerjs';

/**
 * Public lobby listing so friends can click a room without typing a code.
 * Uses a fixed PeerJS broker id — first browser to claim it hosts the list;
 * others connect as clients. Works on static Vercel (no custom backend).
 */

export type PublicRoom = {
  code: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  phase: 'lobby' | 'playing' | 'ended';
  updatedAt: number;
};

type DirMsg =
  | { t: 'list_req' }
  | { t: 'list'; rooms: PublicRoom[] }
  | { t: 'announce'; room: PublicRoom }
  | { t: 'close'; code: string };

/** PeerJS id for the shared lobby directory (alphanumeric). */
export const LOBBY_PEER_ID = 'meadowhaslobby01';

/** Rooms without heartbeat for this long are dropped. */
const ROOM_STALE_MS = 25_000;

export type RoomsHandler = (rooms: PublicRoom[]) => void;
export type DirStatusHandler = (status: string) => void;

export class RoomDirectory {
  private peer: Peer | null = null;
  private isBroker = false;
  private rooms = new Map<string, PublicRoom>();
  private clients = new Map<string, DataConnection>();
  private brokerConn: DataConnection | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private cached: PublicRoom[] = [];

  onRooms: RoomsHandler | null = null;
  onStatus: DirStatusHandler | null = null;

  get roomsSnapshot(): PublicRoom[] {
    return this.cached;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.onStatus?.('connecting');
    try {
      await this.tryBecomeBroker();
    } catch {
      await this.connectAsClient();
    }
    this.pollTimer = setInterval(() => this.requestList(), 4000);
    this.pruneTimer = setInterval(() => this.pruneStale(), 5000);
  }

  stop(): void {
    this.started = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pollTimer = null;
    this.pruneTimer = null;
    for (const c of this.clients.values()) c.close();
    this.clients.clear();
    this.brokerConn?.close();
    this.brokerConn = null;
    this.peer?.destroy();
    this.peer = null;
    this.isBroker = false;
    this.rooms.clear();
    this.cached = [];
  }

  /** Host publishes / refreshes its room in the public list. */
  announce(room: PublicRoom): void {
    const entry: PublicRoom = { ...room, updatedAt: Date.now() };
    if (this.isBroker) {
      this.rooms.set(entry.code, entry);
      this.emitList();
      return;
    }
    this.sendToBroker({ t: 'announce', room: entry });
  }

  /** Remove room when host leaves or match is no longer joinable. */
  close(code: string): void {
    if (this.isBroker) {
      this.rooms.delete(code);
      this.emitList();
      return;
    }
    this.sendToBroker({ t: 'close', code });
  }

  requestList(): void {
    if (this.isBroker) {
      this.emitList();
      return;
    }
    this.sendToBroker({ t: 'list_req' });
  }

  private tryBecomeBroker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(LOBBY_PEER_ID, { debug: 0 });
      this.peer = peer;
      let settled = false;
      const fail = (err: unknown) => {
        if (settled) return;
        settled = true;
        peer.destroy();
        if (this.peer === peer) this.peer = null;
        reject(err);
      };
      peer.on('open', () => {
        if (settled) return;
        settled = true;
        this.isBroker = true;
        this.onStatus?.('broker');
        peer.on('connection', (conn) => this.wireClient(conn));
        this.emitList();
        resolve();
      });
      peer.on('error', (err) => {
        const type = (err as { type?: string }).type;
        if (type === 'unavailable-id' || type === 'peer-unavailable') {
          fail(err);
          return;
        }
        // Other errors after open: surface status but keep broker if possible
        this.onStatus?.(`broker_error:${type ?? String(err)}`);
        if (!settled) fail(err);
      });
    });
  }

  private connectAsClient(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => {
        const conn = peer.connect(LOBBY_PEER_ID, { reliable: true });
        this.brokerConn = conn;
        const t = setTimeout(() => reject(new Error('lobby_timeout')), 12000);
        conn.on('open', () => {
          clearTimeout(t);
          this.onStatus?.('client');
          this.wireBroker(conn);
          conn.send({ t: 'list_req' } satisfies DirMsg);
          resolve();
        });
        conn.on('error', (e) => {
          clearTimeout(t);
          reject(e);
        });
      });
      peer.on('error', (err) => {
        this.onStatus?.(`client_error:${String(err)}`);
        reject(err);
      });
    });
  }

  private wireClient(conn: DataConnection): void {
    conn.on('open', () => {
      this.clients.set(conn.peer, conn);
      conn.send({ t: 'list', rooms: this.sortedRooms() } satisfies DirMsg);
    });
    conn.on('data', (raw) => {
      this.handleMsg(raw as DirMsg, conn);
    });
    conn.on('close', () => {
      this.clients.delete(conn.peer);
    });
  }

  private wireBroker(conn: DataConnection): void {
    conn.on('data', (raw) => {
      this.handleMsg(raw as DirMsg, conn);
    });
    conn.on('close', () => {
      this.onStatus?.('lobby_disconnected');
      // Try reclaim broker after disconnect
      void this.reconnect();
    });
  }

  private async reconnect(): Promise<void> {
    if (!this.started) return;
    this.brokerConn = null;
    this.peer?.destroy();
    this.peer = null;
    this.isBroker = false;
    try {
      await this.tryBecomeBroker();
    } catch {
      try {
        await this.connectAsClient();
      } catch {
        this.onStatus?.('reconnect_failed');
      }
    }
  }

  private handleMsg(msg: DirMsg, from: DataConnection): void {
    if (!msg || typeof msg !== 'object' || !('t' in msg)) return;
    switch (msg.t) {
      case 'list_req':
        if (this.isBroker) {
          from.send({ t: 'list', rooms: this.sortedRooms() } satisfies DirMsg);
        }
        break;
      case 'list':
        this.applyList(msg.rooms);
        break;
      case 'announce':
        if (this.isBroker && msg.room?.code) {
          this.rooms.set(msg.room.code, { ...msg.room, updatedAt: Date.now() });
          this.emitList();
        }
        break;
      case 'close':
        if (this.isBroker && msg.code) {
          this.rooms.delete(msg.code);
          this.emitList();
        }
        break;
      default:
        break;
    }
  }

  private sendToBroker(msg: DirMsg): void {
    if (this.brokerConn?.open) {
      this.brokerConn.send(msg);
    }
  }

  private pruneStale(): void {
    if (!this.isBroker) return;
    const now = Date.now();
    let changed = false;
    for (const [code, room] of this.rooms) {
      if (now - room.updatedAt > ROOM_STALE_MS) {
        this.rooms.delete(code);
        changed = true;
      }
    }
    if (changed) this.emitList();
  }

  private sortedRooms(): PublicRoom[] {
    return [...this.rooms.values()]
      .filter((r) => r.phase === 'lobby')
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private emitList(): void {
    this.applyList(this.sortedRooms());
    if (!this.isBroker) return;
    const payload = { t: 'list' as const, rooms: this.cached };
    for (const conn of this.clients.values()) {
      if (conn.open) conn.send(payload);
    }
  }

  private applyList(rooms: PublicRoom[]): void {
    this.cached = Array.isArray(rooms) ? rooms.filter((r) => r.phase === 'lobby') : [];
    this.onRooms?.(this.cached);
  }
}

/** Shared directory for menu browsing + host announce (one peer per tab). */
let sharedDirectory: RoomDirectory | null = null;

export function getRoomDirectory(): RoomDirectory {
  sharedDirectory ??= new RoomDirectory();
  return sharedDirectory;
}

export function stopSharedRoomDirectory(): void {
  sharedDirectory?.stop();
  sharedDirectory = null;
}
