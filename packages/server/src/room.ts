import {
  applyPlayingIntent,
  createLobby,
  defaultConfig,
  joinHuman,
  leaveHuman,
  matchEndedDetail,
  resetAiBrains,
  returnToLobby,
  startMatch,
  tickAuthority,
  type ClientIntent,
  type ClientMessage,
  type HostSimEvent,
  type MatchMode,
  type PracticeRole,
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
    if (intent.type === 'return_to_lobby') {
      if (this.state.phase !== 'ended' && this.state.phase !== 'playing') return;
      this.state = returnToLobby(this.state);
      resetAiBrains(this.id);
      this.endedBroadcast = false;
      this.broadcastSnapshot();
      this.broadcast({ type: 'event', event: 'returned_to_lobby', detail: {} });
      return;
    }

    if (intent.type === 'start') {
      if (this.state.phase === 'playing') return;
      if (this.state.phase === 'ended') {
        this.state = returnToLobby(this.state);
        resetAiBrains(this.id);
        this.endedBroadcast = false;
      }
      if (this.state.phase !== 'lobby') return;
      if (this.state.humans.length < 1) return;
      resetAiBrains(this.id);
      const mode: MatchMode = intent.mode === 'practice' ? 'practice' : 'normal';
      const practiceRole: PracticeRole | undefined =
        intent.practiceRole === 'fox'
          ? 'fox'
          : intent.practiceRole === 'rabbit'
            ? 'rabbit'
            : undefined;
      if (mode === 'normal' && this.state.humans.length < 2) {
        this.send(playerId, {
          type: 'error',
          message: 'need_2_players_for_multiplayer',
        });
        return;
      }
      try {
        const foxMode = this.state.config.foxMode === 'designate' ? 'designate' : 'roulette';
        let designatedSeekerId =
          typeof intent.designatedSeekerId === 'string' ? intent.designatedSeekerId : undefined;
        if (mode === 'normal' && foxMode === 'designate' && !designatedSeekerId) {
          designatedSeekerId = this.state.humans[0];
        }
        this.state = startMatch(this.state, {
          mode,
          practiceRole,
          seed: Date.now() ^ this.state.humans.length,
          foxMode: mode === 'normal' ? foxMode : undefined,
          designatedSeekerId: mode === 'normal' ? designatedSeekerId : undefined,
          ruleMode: intent.ruleMode ?? this.state.ruleMode ?? this.state.config?.ruleMode,
        });
      } catch (e) {
        this.send(playerId, {
          type: 'error',
          message: e instanceof Error ? e.message : 'start_failed',
        });
        return;
      }
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
          practiceRole: this.state.practiceRole,
          prepMs: this.state.config.seekerPrepMs,
          startSequenceMs: this.state.startSequenceRemainingMs,
          humans: names,
          catchBudget: this.state.config.catchBudget,
          timeLimitMs: this.state.config.timeLimitMs,
          aiCount: this.state.config.aiCount,
          foxMode: this.state.config.foxMode,
        },
      });
      return;
    }

    const result = applyPlayingIntent(this.state, playerId, intent);
    this.state = result.state;
    this.dispatchHostEvents(result.events);
    if (this.state.phase === 'ended') {
      resetAiBrains(this.id);
    }
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
        this.send(ev.to, msg);
      } else {
        this.broadcast(msg);
      }
    }
  }

  tick(dtMs: number): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'starting') return;
    this.state = tickAuthority(this.state, dtMs);
    this.broadcastSnapshot();
    if (this.state.phase === 'ended' && !this.endedBroadcast) {
      this.endedBroadcast = true;
      resetAiBrains(this.id);
      this.broadcast({
        type: 'event',
        event: 'match_ended',
        detail: matchEndedDetail(this.state),
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
