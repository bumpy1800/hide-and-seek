import Phaser from 'phaser';
import { MAP_HEIGHT, MAP_WIDTH, type EntityState, type MatchState } from '@hide-and-seek/shared';
import { IntentInput } from '../input/IntentInput';
import { GameClient } from '../net/GameClient';
import { getWsUrl } from '../config';
import { buildMeadowWorld } from '../world/MeadowMap';

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
  private cameraFollowId: string | null = null;

  constructor() {
    super('Game');
  }

  create(): void {
    const { width, height } = this.scale;

    // Expanded meadow world (tiles + animal/flora decor)
    buildMeadowWorld(this, 7);

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBackgroundColor('#5d8a3e');

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
      this.updateCameraFollow(you, state);
      this.updateHud(state, you);
    };
    this.client.onEvent = (event, detail) => {
      if (event === 'error') {
        this.statusText.setText(`Error: ${String(detail)}`);
      } else if (event === 'match_ended') {
        const d = detail as { winner?: string; reason?: string };
        this.statusText.setText(`Ended — ${d.winner ?? '?'} (${d.reason ?? ''})`);
      } else if (event === 'match_started') {
        this.statusText.setText('Match started — blend with the meadow animals!');
      }
    };
    this.client.connect();

    const startKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    startKey?.on('down', () => this.requestStart());

    this.add
      .text(width - 12, 12, 'ENTER / START · camera follows you', {
        fontSize: '13px',
        color: '#ecf0f1',
        backgroundColor: '#00000066',
        padding: { x: 6, y: 4 },
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

  /**
   * Keep the local player centered: camera follows their entity from snapshots.
   */
  private updateCameraFollow(you: string, state: MatchState): void {
    const me = state.entities[you];
    if (!me) return;
    const spr = this.sprites.get(you);
    if (!spr) {
      this.cameras.main.centerOn(me.x, me.y);
      return;
    }
    if (this.cameraFollowId !== you) {
      this.cameras.main.startFollow(spr, true, 0.14, 0.14);
      this.cameras.main.setFollowOffset(0, 0);
      this.cameraFollowId = you;
    }
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
        spr = this.add.sprite(e.x, e.y, tex).setDepth(10);
        this.sprites.set(e.id, spr);
        const tag = this.add
          .text(e.x, e.y - 28, labelFor(e, this.you), {
            fontSize: '11px',
            color: '#fff',
            backgroundColor: '#00000055',
            padding: { x: 3, y: 1 },
          })
          .setOrigin(0.5)
          .setDepth(11);
        this.nameTags.set(e.id, tag);
      } else if (spr.texture.key !== tex) {
        spr.setTexture(tex);
      }
      spr.setPosition(e.x, e.y);
      spr.setAlpha(e.alive ? 1 : 0.35);
      const tag = this.nameTags.get(e.id);
      tag?.setPosition(e.x, e.y - 28);
      tag?.setText(labelFor(e, this.you));
      tag?.setAlpha(e.alive ? 1 : 0.35);
    }
    for (const id of [...this.sprites.keys()]) {
      if (!seen.has(id)) {
        this.sprites.get(id)?.destroy();
        this.nameTags.get(id)?.destroy();
        this.sprites.delete(id);
        this.nameTags.delete(id);
        if (this.cameraFollowId === id) {
          this.cameras.main.stopFollow();
          this.cameraFollowId = null;
        }
      }
    }
  }

  private updateHud(state: MatchState, you: string): void {
    const me = state.entities[you];
    const role = me?.role ?? '—';
    const sec = Math.ceil(state.timeRemainingMs / 1000);
    const humans = state.humans.length;
    const lines = [
      `Meadow ${state.roomId} | ${state.phase} | ${humans}/${state.config.maxHumans} · map ${state.config.mapWidth}×${state.config.mapHeight}`,
      `You: ${role}${state.seekerId === you ? ' (여우 술래)' : me?.kind === 'human' ? ' (토끼 히더)' : ''}`,
      `Time ${sec}s | Catches left ${state.catchBudgetRemaining}`,
    ];
    if (state.phase === 'lobby') {
      lines.push('Tap START or ENTER · camera centers on you');
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
  if (e.id === seekerId || e.role === 'seeker') return 'seeker_fox';
  // Human hiders + AI share identical rabbit look
  return 'hider_rabbit';
}

function labelFor(e: EntityState, you: string | null): string {
  if (e.id === you) return 'YOU';
  if (e.role === 'seeker') return 'SEEKER';
  return '';
}
