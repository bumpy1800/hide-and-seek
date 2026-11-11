import {
  applyPlayingIntent,
  createLobby,
  defaultConfig,
  joinHuman,
  startMatch,
  tickAuthority,
  type ClientIntent,
  type HostSimEvent,
  type MatchState,
  type PracticeRole,
  type RoomRuleMode,
  type ServerMessage,
} from '@hide-and-seek/shared';

export type LocalHostHandler = (msg: ServerMessage) => void;

/**
 * Client-side practice host — no WebSocket.
 * Authority logic lives in shared hostSim.
 */
export class LocalPracticeHost {
  private state: MatchState;
  private playerId = 'local-player';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs = 50;
  onMessage: LocalHostHandler | null = null;

  constructor(
    private practiceRole: PracticeRole,
    private playerName = '나',
    private ruleMode: RoomRuleMode = 'stun_penalty',
  ) {
    this.state = createLobby(`local-practice-${practiceRole}`, defaultConfig({ ruleMode }));
  }

  start(): void {
    const joined = joinHuman(this.state, this.playerId, this.playerName);
    if (!joined.ok) {
      this.emit({ type: 'error', message: joined.reason });
      return;
    }
    this.state = joined.state;
    this.emit({ type: 'welcome', playerId: this.playerId, roomId: this.state.roomId });
    this.emitSnapshot();

    this.state = startMatch(this.state, {
      mode: 'practice',
      practiceRole: this.practiceRole,
      seed: Date.now(),
      ruleMode: this.ruleMode,
    });
    this.emit({
      type: 'event',
      event: 'match_started',
      detail: {
        seekerId: this.state.seekerId,
        mode: this.state.mode,
        practiceRole: this.state.practiceRole,
        ruleMode: this.state.ruleMode,
      },
    });
    this.emitSnapshot();

    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  sendIntent(intent: ClientIntent): void {
    if (this.state.phase !== 'playing') return;
    const result = applyPlayingIntent(this.state, this.playerId, intent);
    this.state = result.state;
    this.dispatchEvents(result.events);
  }

  private dispatchEvents(events: HostSimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'snapshot') {
        this.emitSnapshot();
      } else {
        // Practice: only local player — unicast and broadcast are the same
        this.emit({ type: 'event', event: ev.event, detail: ev.detail });
      }
    }
  }

  private tick(): void {
    if (this.state.phase !== 'playing' && this.state.phase !== 'starting') return;
    this.state = tickAuthority(this.state, this.tickMs);
    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.emit({ type: 'snapshot', state: this.state, you: this.playerId });
  }

  private emit(msg: ServerMessage): void {
    this.onMessage?.(msg);
  }

  getState(): MatchState {
    return this.state;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
