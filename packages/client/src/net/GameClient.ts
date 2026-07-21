import type { ClientIntent, ClientMessage, MatchState, ServerMessage } from '@hide-and-seek/shared';

export type SnapshotHandler = (state: MatchState, you: string) => void;
export type EventHandler = (event: string, detail?: unknown) => void;

export class GameClient {
  private ws: WebSocket | null = null;
  private you: string | null = null;
  onSnapshot: SnapshotHandler | null = null;
  onEvent: EventHandler | null = null;
  onStatus: ((status: string) => void) | null = null;

  constructor(private url: string) {}

  connect(): void {
    this.onStatus?.('connecting');
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => this.onStatus?.('connected'));
    this.ws.addEventListener('close', () => this.onStatus?.('disconnected'));
    this.ws.addEventListener('error', () => this.onStatus?.('error'));
    this.ws.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.you = msg.playerId;
        this.onEvent?.('welcome', msg);
      } else if (msg.type === 'snapshot') {
        this.you = msg.you;
        this.onSnapshot?.(msg.state, msg.you);
      } else if (msg.type === 'event') {
        this.onEvent?.(msg.event, msg.detail);
      } else if (msg.type === 'error') {
        this.onEvent?.('error', msg.message);
      }
    });
  }

  join(roomId: string, name: string): void {
    this.send({ type: 'join', roomId, name });
  }

  sendIntent(intent: ClientIntent): void {
    this.send({ type: 'intent', intent });
  }

  private send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  get playerId(): string | null {
    return this.you;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
