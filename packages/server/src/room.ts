import {
  PLAYER_SPEED,
  attemptCatch,
  createLobby,
  defaultConfig,
  integrateMotion,
  joinHuman,
  leaveHuman,
  nearestCatchTarget,
  resetAiBrains,
  returnToLobby,
  setEntityVelocity,
  startMatch,
  stepAiCrowd,
  tickTimer,
  type ClientIntent,
  type ClientMessage,
  type MatchState,
  type ServerMessage,
} from '@hide-and-seek/shared';

export type SocketLike = {
  send: (data: string) => void;
  readyState: number;
};

const OPEN = 1;

export class Room {
  readonly id: string;
  state: MatchState;
  private clients = new Map<string, SocketLike>();
  private names = new Map<string, string>();
  private endedBroadcast = false;

  constructor(id: string) {
    this.id = id;
    this.state = createLobby(id, defaultConfig());
  }

  get size(): number {
    return this.clients.size;
  }

  join(playerId: string, socket: SocketLike, name?: string): ServerMessage {
    const result = joinHuman(this.state, playerId, name ?? `Player-${playerId.slice(0, 4)}`);
    if (!result.ok) {
      return { type: 'error', message: result.reason };
    }
    this.state = result.state;
    this.clients.set(playerId, socket);
    this.names.set(playerId, name ?? `Player-${playerId.slice(0, 4)}`);
    this.broadcastSnapshot();
    return { type: 'welcome', playerId, roomId: this.id };
  }

  leave(playerId: string): void {
    if (!this.clients.has(playerId)) return;
    this.clients.delete(playerId);
    this.names.delete(playerId);
    this.state = leaveHuman(this.state, playerId);
    this.broadcastSnapshot();
  }

  handleMessage(playerId: string, msg: ClientMessage): void {
    if (msg.type === 'ping') {
      this.send(playerId, { type: 'event', event: 'pong' });
      return;
    }
    if (msg.type === 'intent') {
      this.applyIntent(playerId, msg.intent);
    }
  }

  applyIntent(playerId: string, intent: ClientIntent): void {
    if (intent.type === 'start') {
      // Lobby start or rematch after ended
      if (this.state.phase === 'playing') return;
      if (this.state.phase === 'ended') {
        this.state = returnToLobby(this.state);
        resetAiBrains(this.id);
        this.endedBroadcast = false;
      }
      if (this.state.phase !== 'lobby') return;
      if (this.state.humans.length < 1) return;
      resetAiBrains(this.id);
      this.state = startMatch(this.state, Date.now() ^ this.state.humans.length);
      this.endedBroadcast = false;
      this.broadcastSnapshot();
      this.broadcast({ type: 'event', event: 'match_started', detail: { seekerId: this.state.seekerId } });
      return;
    }

    if (this.state.phase !== 'playing') return;
    const entity = this.state.entities[playerId];
    if (!entity || !entity.alive) return;

    if (intent.type === 'move') {
      const len = Math.hypot(intent.dx, intent.dy) || 1;
      const nx = intent.dx / len;
      const ny = intent.dy / len;
      const speed = PLAYER_SPEED;
      const vx = intent.dx === 0 && intent.dy === 0 ? 0 : nx * speed;
      const vy = intent.dx === 0 && intent.dy === 0 ? 0 : ny * speed;
      this.state = setEntityVelocity(this.state, playerId, vx, vy);
      return;
    }

    if (intent.type === 'catch') {
      if (this.state.seekerId !== playerId) return;
      const targetId = nearestCatchTarget(this.state, playerId);
      if (!targetId) {
        this.send(playerId, { type: 'event', event: 'catch_miss', detail: { reason: 'no_target' } });
        return;
      }
      const result = attemptCatch(this.state, playerId, targetId);
      this.state = result.state;
      this.broadcast({
        type: 'event',
        event: result.ok ? 'catch_success' : 'catch_fail',
        detail: result,
      });
      this.broadcastSnapshot();
      if (this.state.phase === 'ended') {
        resetAiBrains(this.id);
      }
    }
  }

  tick(dtMs: number): void {
    if (this.state.phase !== 'playing') return;
    this.state = stepAiCrowd(this.state, dtMs, this.state.tick + 1);
    this.state = integrateMotion(this.state, dtMs / 1000);
    this.state = tickTimer(this.state, dtMs);
    this.broadcastSnapshot();
    if (this.state.phase === 'ended' && !this.endedBroadcast) {
      this.endedBroadcast = true;
      resetAiBrains(this.id);
      this.broadcast({
        type: 'event',
        event: 'match_ended',
        detail: { winner: this.state.winner, reason: this.state.endReason },
      });
    }
  }

  broadcastSnapshot(): void {
    for (const [playerId, socket] of this.clients) {
      if (socket.readyState !== OPEN) continue;
      const msg: ServerMessage = { type: 'snapshot', state: this.state, you: playerId };
      socket.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: ServerMessage): void {
    const raw = JSON.stringify(msg);
    for (const socket of this.clients.values()) {
      if (socket.readyState === OPEN) socket.send(raw);
    }
  }

  send(playerId: string, msg: ServerMessage): void {
    const socket = this.clients.get(playerId);
    if (socket && socket.readyState === OPEN) socket.send(JSON.stringify(msg));
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  getOrCreate(roomId: string): Room {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }
    return room;
  }

  get(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  joinRoom(roomId: string | undefined, playerId: string, socket: SocketLike, name?: string) {
    const id = roomId && roomId.trim() ? roomId.trim() : 'lobby';
    const room = this.getOrCreate(id);
    return { room, message: room.join(playerId, socket, name) };
  }

  leaveAll(playerId: string): void {
    for (const room of this.rooms.values()) {
      room.leave(playerId);
    }
  }

  tickAll(dtMs: number): void {
    for (const room of this.rooms.values()) {
      room.tick(dtMs);
    }
  }
}
