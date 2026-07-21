import Phaser from 'phaser';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  canSeekerSee,
  isSeekerPrepActive,
  type EntityState,
  type MatchMode,
  type MatchState,
} from '@hide-and-seek/shared';
import { IntentInput } from '../input/IntentInput';
import { GameClient } from '../net/GameClient';
import { getWsUrl } from '../config';
import { buildMeadowWorld } from '../world/MeadowMap';

type GameSceneData = { mode?: MatchMode };

export class GameScene extends Phaser.Scene {
  private client!: GameClient;
  private inputCtl!: IntentInput;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private nameTags = new Map<string, Phaser.GameObjects.Text>();
  private hud!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Container;
  private prepOverlay!: Phaser.GameObjects.Rectangle;
  private prepLabel!: Phaser.GameObjects.Text;
  private you: string | null = null;
  private state: MatchState | null = null;
  private roomId = 'lobby';
  private playMode: MatchMode = 'normal';
  private playerName = `Guest${Math.floor(Math.random() * 900 + 100)}`;
  private lastMoveSent = { dx: 0, dy: 0 };
  private cameraFollowId: string | null = null;
  private autoStarted = false;
  /** Last positions shown to seeker during prep (frozen view of others). */
  private frozenOthers = new Map<string, { x: number; y: number }>();

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.playMode = data.mode === 'practice' ? 'practice' : 'normal';
    this.roomId = this.playMode === 'practice' ? 'practice' : 'lobby';
    this.autoStarted = false;
    this.frozenOthers.clear();
  }

  create(): void {
    const { width, height } = this.scale;

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

    // Seeker prep blackout — obscures world so rabbit motion is not visible
    this.prepOverlay = this.add
      .rectangle(width / 2, height / 2, width + 4, height + 4, 0x0b1020, 0.92)
      .setScrollFactor(0)
      .setDepth(1500)
      .setVisible(false);
    this.prepLabel = this.add
      .text(width / 2, height / 2, '', {
        fontSize: '28px',
        color: '#f1c40f',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1501)
      .setVisible(false);

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
      // Auto-start practice once in lobby
      if (
        this.playMode === 'practice' &&
        !this.autoStarted &&
        state.phase === 'lobby' &&
        state.humans.includes(you)
      ) {
        this.autoStarted = true;
        this.client.sendIntent({ type: 'start', mode: 'practice' });
      }
      this.syncSprites(state, you);
      this.updateCameraFollow(you, state);
      this.updatePrepOverlay(state, you);
      this.updateHud(state, you);
    };
    this.client.onEvent = (event, detail) => {
      if (event === 'error') {
        this.statusText.setText(`Error: ${String(detail)}`);
      } else if (event === 'match_ended') {
        const d = detail as { winner?: string; reason?: string };
        this.statusText.setText(`Ended — ${d.winner ?? '?'} (${d.reason ?? ''})`);
      } else if (event === 'match_started') {
        const d = detail as { mode?: string };
        this.statusText.setText(
          d.mode === 'practice'
            ? '연습 모드 — AI 토끼 움직임에 맞춰 보세요'
            : 'Match started — 술래는 10초 준비 후 사냥!',
        );
        this.frozenOthers.clear();
      }
    };
    this.client.connect();

    const startKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    startKey?.on('down', () => this.requestStart());

    this.add
      .text(width - 12, 12, this.playMode === 'practice' ? '연습 모드' : 'ENTER / START', {
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
    this.client.sendIntent({
      type: 'start',
      mode: this.playMode === 'practice' ? 'practice' : 'normal',
    });
  }

  private updatePrepOverlay(state: MatchState, you: string): void {
    const blind = state.seekerId === you && isSeekerPrepActive(state);
    this.prepOverlay.setVisible(blind);
    this.prepLabel.setVisible(blind);
    if (blind) {
      const sec = Math.ceil(state.seekerPrepRemainingMs / 1000);
      this.prepLabel.setText(`준비 중…\n토끼 움직임은 ${sec}초 후부터 보입니다\n(이동 불가)`);
    }
  }

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
    const you = this.you;
    // Block local seeker input during prep (server also rejects)
    if (you && this.state.seekerId === you && isSeekerPrepActive(this.state)) {
      return;
    }
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

  private syncSprites(state: MatchState, you: string): void {
    const seekerBlind = state.seekerId === you && !canSeekerSee(state, you);
    // Capture freeze frame once when prep starts
    if (seekerBlind && this.frozenOthers.size === 0) {
      for (const e of Object.values(state.entities)) {
        if (e.id === you) continue;
        this.frozenOthers.set(e.id, { x: e.x, y: e.y });
      }
    }
    if (!seekerBlind) {
      this.frozenOthers.clear();
    }

    const seen = new Set<string>();
    for (const e of Object.values(state.entities)) {
      seen.add(e.id);
      let display = e;
      if (seekerBlind && e.id !== you) {
        const frozen = this.frozenOthers.get(e.id);
        if (frozen) {
          display = { ...e, x: frozen.x, y: frozen.y, vx: 0, vy: 0 };
        }
      }

      let spr = this.sprites.get(e.id);
      const tex = textureFor(e, state.seekerId);
      if (!spr) {
        spr = this.add.sprite(display.x, display.y, tex).setDepth(10);
        this.sprites.set(e.id, spr);
        const tag = this.add
          .text(display.x, display.y - 28, labelFor(e, this.you), {
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
      // While seeker is fully blacked out, hide other sprites under overlay anyway
      spr.setPosition(display.x, display.y);
      spr.setAlpha(e.alive ? 1 : 0.35);
      spr.setVisible(!(seekerBlind && e.id !== you));
      const tag = this.nameTags.get(e.id);
      tag?.setPosition(display.x, display.y - 28);
      tag?.setText(labelFor(e, this.you));
      tag?.setAlpha(e.alive ? 1 : 0.35);
      tag?.setVisible(!(seekerBlind && e.id !== you));
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
    const prepSec = Math.ceil(state.seekerPrepRemainingMs / 1000);
    const humans = state.humans.length;
    const lines = [
      `${state.mode === 'practice' ? '연습' : '사냥'} · ${state.roomId} | ${state.phase} | ${humans}/${state.config.maxHumans}`,
      `You: ${role}${state.seekerId === you ? ' (여우 술래)' : me?.kind === 'human' ? ' (토끼)' : ''}`,
    ];
    if (state.mode === 'practice') {
      lines.push('AI 토끼 움직임 연습 · 술래 없음 · 잡기 없음');
    } else {
      lines.push(`Time ${sec}s | Catches ${state.catchBudgetRemaining}`);
      if (isSeekerPrepActive(state) && state.seekerId === you) {
        lines.push(`준비 ${prepSec}s — 시야/이동 잠금`);
      } else if (isSeekerPrepActive(state)) {
        lines.push(`술래 준비 중 ${prepSec}s… 움직이며 섞이세요!`);
      }
    }
    if (state.phase === 'lobby') {
      lines.push(state.mode === 'practice' || this.playMode === 'practice' ? '연습 시작 중…' : 'Tap START or ENTER');
    }
    if (state.phase === 'ended') {
      lines.push(`Winner: ${state.winner} — ${state.endReason}`);
      lines.push('Tap AGAIN or ENTER to rematch');
    }
    this.hud.setText(lines.join('\n'));

    const showCatch =
      state.phase === 'playing' &&
      state.mode === 'normal' &&
      state.seekerId === you &&
      !isSeekerPrepActive(state);
    this.inputCtl.setCatchVisible(showCatch);

    const showStart =
      this.playMode !== 'practice' && (state.phase === 'lobby' || state.phase === 'ended');
    this.startBtn.setVisible(showStart);
    const label = this.startBtn.getData('label') as Phaser.GameObjects.Text | undefined;
    label?.setText(state.phase === 'ended' ? 'AGAIN' : 'START');
  }
}

function textureFor(e: EntityState, seekerId: string | null): string {
  if (!e.alive) return 'caught';
  if (e.id === seekerId || e.role === 'seeker') return 'seeker_fox';
  return 'hider_rabbit';
}

function labelFor(e: EntityState, you: string | null): string {
  if (e.id === you) return 'YOU';
  if (e.role === 'seeker') return 'SEEKER';
  return '';
}
