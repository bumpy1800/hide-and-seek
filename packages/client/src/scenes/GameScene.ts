import Phaser from 'phaser';
import type { EntityState, MatchState } from '@hide-and-seek/shared';
import { IntentInput } from '../input/IntentInput';
import { GameClient } from '../net/GameClient';
import { getWsUrl } from '../config';

export class GameScene extends Phaser.Scene {
  private client!: GameClient;
  private inputCtl!: IntentInput;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private nameTags = new Map<string, Phaser.GameObjects.Text>();
  private hud!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Container;
  private you: string | null = null;
  private state: MatchState | null = null;
  private roomId = 'lobby';
  private playerName = `Guest${Math.floor(Math.random() * 900 + 100)}`;
  private lastMoveSent = { dx: 0, dy: 0 };

  constructor() {
    super('Game');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.rectangle(width / 2, height / 2, width - 8, height - 8, 0x243447).setStrokeStyle(4, 0x5d6d7e);

    const blocks = [
      [240, 200, 80, 120],
      [480, 360, 140, 60],
      [720, 180, 70, 160],
      [360, 480, 160, 50],
      [600, 500, 60, 100],
    ];
    for (const [x, y, w, h] of blocks) {
      this.add.rectangle(x, y, w, h, 0x34495e).setStrokeStyle(2, 0x1c2833);
    }

    this.hud = this.add
      .text(12, 10, '', {
        fontSize: '16px',
        color: '#ecf0f1',
        backgroundColor: '#00000088',
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(2000);

    this.statusText = this.add
      .text(width / 2, 28, 'Connecting…', {
        fontSize: '18px',
        color: '#f1c40f',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    // Touch + mouse START / AGAIN button (dual modality with ENTER)
    const btnBg = this.add.rectangle(0, 0, 200, 52, 0x27ae60, 0.95);
    const btnLabel = this.add
      .text(0, 0, 'START', {
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.startBtn = this.add
      .container(width / 2, height - 56, [btnBg, btnLabel])
      .setScrollFactor(0)
      .setDepth(2001)
      .setSize(200, 52)
      .setInteractive(
        new Phaser.Geom.Rectangle(-100, -26, 200, 52),
        Phaser.Geom.Rectangle.Contains,
      );
    this.startBtn.on('pointerdown', () => this.requestStart());
    this.startBtn.setData('label', btnLabel);

    this.inputCtl = new IntentInput(this);

    this.client = new GameClient(getWsUrl());
    this.client.onStatus = (s) => {
      this.statusText.setText(`Net: ${s}`);
      if (s === 'connected') {
        this.client.join(this.roomId, this.playerName);
      }
    };
    this.client.onSnapshot = (state, you) => {
      this.you = you;
      this.state = state;
      this.syncSprites(state);
      this.updateHud(state, you);
    };
    this.client.onEvent = (event, detail) => {
      if (event === 'error') {
        this.statusText.setText(`Error: ${String(detail)}`);
      } else if (event === 'match_ended') {
        const d = detail as { winner?: string; reason?: string };
        this.statusText.setText(`Ended — ${d.winner ?? '?'} (${d.reason ?? ''})`);
      } else if (event === 'match_started') {
        this.statusText.setText('Match started!');
      }
    };
    this.client.connect();

    const startKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    startKey?.on('down', () => this.requestStart());

    this.add
      .text(width - 12, 12, 'ENTER / START: begin or rematch', {
        fontSize: '13px',
        color: '#95a5a6',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputCtl.destroy();
      this.client.close();
    });
  }

  private requestStart(): void {
    this.client.sendIntent({ type: 'start' });
  }

  update(): void {
    if (!this.state || this.state.phase !== 'playing') return;
    const intents = this.inputCtl.poll();
    for (const intent of intents) {
      if (intent.type === 'move') {
        if (intent.dx !== this.lastMoveSent.dx || intent.dy !== this.lastMoveSent.dy) {
          this.lastMoveSent = { dx: intent.dx, dy: intent.dy };
          this.client.sendIntent(intent);
        }
      } else {
        this.client.sendIntent(intent);
      }
    }
  }

  private syncSprites(state: MatchState): void {
    const seen = new Set<string>();
    for (const e of Object.values(state.entities)) {
      seen.add(e.id);
      let spr = this.sprites.get(e.id);
      const tex = textureFor(e, state.seekerId);
      if (!spr) {
        spr = this.add.sprite(e.x, e.y, tex);
        this.sprites.set(e.id, spr);
        const tag = this.add
          .text(e.x, e.y - 22, labelFor(e, this.you), {
            fontSize: '11px',
            color: '#fff',
          })
          .setOrigin(0.5);
        this.nameTags.set(e.id, tag);
      } else if (spr.texture.key !== tex) {
        spr.setTexture(tex);
      }
      spr.setPosition(e.x, e.y);
      spr.setAlpha(e.alive ? 1 : 0.35);
      const tag = this.nameTags.get(e.id);
      tag?.setPosition(e.x, e.y - 22);
      tag?.setText(labelFor(e, this.you));
      tag?.setAlpha(e.alive ? 1 : 0.35);
    }
    for (const id of [...this.sprites.keys()]) {
      if (!seen.has(id)) {
        this.sprites.get(id)?.destroy();
        this.nameTags.get(id)?.destroy();
        this.sprites.delete(id);
        this.nameTags.delete(id);
      }
    }
  }

  private updateHud(state: MatchState, you: string): void {
    const me = state.entities[you];
    const role = me?.role ?? '—';
    const sec = Math.ceil(state.timeRemainingMs / 1000);
    const humans = state.humans.length;
    const lines = [
      `Room ${state.roomId} | ${state.phase} | Players ${humans}/${state.config.maxHumans}`,
      `You: ${role}${state.seekerId === you ? ' (술래)' : me?.kind === 'human' ? ' (숨기)' : ''}`,
      `Time ${sec}s | Catches left ${state.catchBudgetRemaining}`,
    ];
    if (state.phase === 'lobby') {
      lines.push('Tap START or press ENTER to begin');
    }
    if (state.phase === 'ended') {
      lines.push(`Winner: ${state.winner} — ${state.endReason}`);
      lines.push('Tap AGAIN or ENTER to rematch');
    }
    this.hud.setText(lines.join('\n'));
    this.inputCtl.setCatchVisible(state.phase === 'playing' && state.seekerId === you);

    const showStart = state.phase === 'lobby' || state.phase === 'ended';
    this.startBtn.setVisible(showStart);
    const label = this.startBtn.getData('label') as Phaser.GameObjects.Text | undefined;
    label?.setText(state.phase === 'ended' ? 'AGAIN' : 'START');
  }
}

function textureFor(e: EntityState, seekerId: string | null): string {
  if (!e.alive) return 'caught';
  if (e.id === seekerId || e.role === 'seeker') return 'seeker';
  return 'hider';
}

function labelFor(e: EntityState, you: string | null): string {
  if (e.id === you) return 'YOU';
  if (e.role === 'seeker') return 'SEEKER';
  return '';
}
