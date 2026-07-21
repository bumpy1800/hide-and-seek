import {
  integrateMotion,
  joinHuman,
  createLobby,
  defaultConfig,
  startMatch,
  stepAiCrowd,
  tickTimer,
  attemptCatch,
  nearestCatchTarget,
  setEntityVelocity,
  PLAYER_SPEED,
  type ClientIntent,
  type MatchState,
  type PracticeRole,
  type ServerMessage,
} from '@hide-and-seek/shared';

export type LocalHostHandler = (msg: ServerMessage) => void;

/**
 * Client-side practice host — no WebSocket.
 * Solo practice always works even when multiplayer server is down.
 */
export class LocalPracticeHost {
  private state: MatchState;
  private playerId = 'local-player';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly tickMs = 50;
  onMessage: LocalHostHandler | null = null;

  constructor(private practiceRole: PracticeRole) {
    this.state = createLobby(`local-practice-${practiceRole}`, defaultConfig());
  }

  start(): void {
    // Join as single human
    const joined = joinHuman(this.state, this.playerId, 'You');
    if (!joined.ok) {
      this.emit({ type: 'error', message: joined.reason });
      return;
    }
    this.state = joined.state;
    this.emit({ type: 'welcome', playerId: this.playerId, roomId: this.state.roomId });
    this.emitSnapshot();

    // Immediately start practice (solo)
    this.state = startMatch(this.state, {
      mode: 'practice',
      practiceRole: this.practiceRole,
      seed: Date.now(),
    });
    this.emit({
      type: 'event',
      event: 'match_started',
      detail: {
        seekerId: this.state.seekerId,
        mode: this.state.mode,
        practiceRole: this.state.practiceRole,
      },
    });
    this.emitSnapshot();

    this.timer = setInterval(() => this.tick(), this.tickMs);
  }

  sendIntent(intent: ClientIntent): void {
    if (this.state.phase !== 'playing') return;

    if (intent.type === 'move') {
      const len = Math.hypot(intent.dx, intent.dy) || 1;
      const nx = intent.dx / len;
      const ny = intent.dy / len;
      const vx = intent.dx === 0 && intent.dy === 0 ? 0 : nx * PLAYER_SPEED;
      const vy = intent.dx === 0 && intent.dy === 0 ? 0 : ny * PLAYER_SPEED;
      this.state = setEntityVelocity(this.state, this.playerId, vx, vy);
      return;
    }

    if (intent.type === 'catch') {
      if (this.state.practiceRole !== 'fox' || this.state.seekerId !== this.playerId) return;
      const targetId = nearestCatchTarget(this.state, this.playerId);
      if (!targetId) return;
      const result = attemptCatch(this.state, this.playerId, targetId);
      this.state = result.state;
      this.emit({
        type: 'event',
        event: result.ok ? 'catch_success' : 'catch_fail',
        detail: result,
      });
      this.emitSnapshot();
    }
  }

  private tick(): void {
    if (this.state.phase !== 'playing') return;
    // Safety: practice must never end via hunt rules
    if (this.state.mode !== 'practice') {
      this.state = { ...this.state, mode: 'practice', practiceRole: this.practiceRole };
    }
    this.state = stepAiCrowd(this.state, this.tickMs, this.state.tick + 1);
    this.state = integrateMotion(this.state, this.tickMs / 1000);
    this.state = tickTimer(this.state, this.tickMs);
    // Force-keep playing for practice
    if (this.state.phase === 'ended' && this.state.mode === 'practice') {
      this.state = {
        ...this.state,
        phase: 'playing',
        winner: null,
        endReason: null,
      };
    }
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
