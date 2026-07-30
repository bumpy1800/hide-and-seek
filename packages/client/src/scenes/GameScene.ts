import Phaser from 'phaser';
import {
  DEFAULT_MEADOW_SEED,
  MAP_HEIGHT,
  MAP_WIDTH,
  SEEKER_PREP_MS,
  effectivePrepRemainingMs,
  isSeekerBlind,
  type EntityState,
  type MatchMode,
  type PracticeRole,
  type MatchState,
  ENTITY_COLLIDE_RADIUS,
  SEEKER_SPEED,
  RABBIT_SPEED,
  FACING_IDLE_EPS,
  facingFromVelocity,
  animalAnimKey,
  animalTextureKey,
  listCaughtHumans,
  roleObjectiveLines,
  catchAnnounceText,
  humanCatchScore,
  startSequenceStage,
  startCountdownSeconds,
  FOX_ROULETTE_MS,
  START_SEQUENCE_MS,
  type Facing,
  type CatchVictimKind,
  type RoomSettings,
} from '@hide-and-seek/shared';
import { IntentInput } from '../input/IntentInput';
import { GameClient } from '../net/GameClient';
import { LocalPracticeHost } from '../net/LocalPracticeHost';
import { PeerMultiplayer } from '../net/PeerMultiplayer';
import { normalizeRoomCode } from '../net/roomCodes';
import { loadNickname, saveNickname } from '../net/nicknames';
import { getWsUrl, preferPeerMultiplayer } from '../config';
import {
  buildMeadowWorld,
  destroyMeadowWorld,
  type MeadowWorld,
} from '../world/MeadowMap';
import { nameTagLabel, userRabbitRevealLines } from '../ui/nameTags';

export type PeerRole = 'host' | 'guest';

type GameSceneData = {
  mode?: MatchMode;
  practiceRole?: PracticeRole;
  peerRole?: PeerRole;
  roomCode?: string;
  playerName?: string;
  roomSettings?: RoomSettings;
};

export class GameScene extends Phaser.Scene {
  private client: GameClient | null = null;
  private localPractice: LocalPracticeHost | null = null;
  private peer: PeerMultiplayer | null = null;
  private inputCtl!: IntentInput;
  private meadow!: MeadowWorld;
  private meadowSeed = DEFAULT_MEADOW_SEED;
  private solidCollider: Phaser.Physics.Arcade.Collider | null = null;
  private entityGroup!: Phaser.Physics.Arcade.Group;
  private sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private nameTags = new Map<string, Phaser.GameObjects.Text>();
  private hudPanel!: Phaser.GameObjects.Graphics;
  private hudTitle!: Phaser.GameObjects.Text;
  private hudBody!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private modeBadge!: Phaser.GameObjects.Text;
  private startBtn!: Phaser.GameObjects.Container;
  private prepOverlay!: Phaser.GameObjects.Rectangle;
  private prepLabel!: Phaser.GameObjects.Text;
  private you: string | null = null;
  private state: MatchState | null = null;
  private roomId = 'lobby';
  private playMode: MatchMode = 'normal';
  private practiceRole: PracticeRole = 'rabbit';
  private peerRole: PeerRole = 'host';
  private joinRoomCode = '';
  private playerName = loadNickname();
  private lastMoveSent = { dx: 0, dy: 0 };
  private cameraFollowId: string | null = null;
  private autoStarted = false;
  /** Last positions shown to seeker during prep (frozen view of others). */
  private frozenOthers = new Map<string, { x: number; y: number }>();
  private lastFacing = new Map<string, Facing>();
  /**
   * Wall-clock when seeker prep must end. Client failsafe when host/server
   * stops ticking seekerPrepRemainingMs (common on dead WS tunnels).
   */
  private prepEndsAtMs: number | null = null;
  private lastLocalPrepMs = -1;
  /** Graves for human rabbits only (world markers). */
  private graves: Phaser.GameObjects.Container[] = [];
  private graveIds = new Set<string>();
  private roomSettings: RoomSettings | null = null;
  private startOverlay!: Phaser.GameObjects.Rectangle;
  private startOverlayLabel!: Phaser.GameObjects.Text;
  private rouletteNames: Array<{ id: string; name: string }> = [];
  private rouletteCursor = 0;
  private lastRouletteSwap = 0;

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.playMode = data.mode === 'practice' ? 'practice' : 'normal';
    this.practiceRole = data.practiceRole === 'fox' ? 'fox' : 'rabbit';
    this.peerRole = data.peerRole === 'guest' ? 'guest' : 'host';
    this.joinRoomCode = (data.roomCode ?? '').trim();
    this.roomSettings = data.roomSettings ?? null;
    this.playerName = saveNickname(
      (data.playerName ?? loadNickname()).trim() || loadNickname(),
    );
    // Unique practice room so solo practice never collides with others / leftover state
    this.roomId =
      this.playMode === 'practice'
        ? `practice-${this.practiceRole}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        : 'lobby';
    this.autoStarted = false;
    this.frozenOthers.clear();
    this.prepEndsAtMs = null;
    this.lastLocalPrepMs = -1;
    this.state = null;
    this.you = null;
    this.client = null;
    this.localPractice = null;
    this.peer = null;
    this.clearGraves();
    this.graveIds.clear();
  }

  create(): void {
    const { width, height } = this.scale;

    this.entityGroup = this.physics.add.group({
      collideWorldBounds: true,
      allowGravity: false,
    });
    // Tilemap + decor (visual only — no solid blocking; free movement)
    this.meadowSeed = DEFAULT_MEADOW_SEED;
    this.meadow = buildMeadowWorld(this, this.meadowSeed);
    this.solidCollider = null;

    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setBackgroundColor('#5d8a3e');

    // Left HUD — glass panel with Korean labels
    this.hudPanel = this.add.graphics().setScrollFactor(0).setDepth(1999);
    const hudFont =
      'system-ui, -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    this.hudTitle = this.add
      .text(28, 22, '초원 숨바꼭질', {
        fontFamily: hudFont,
        fontSize: '20px',
        color: '#fff8e7',
        fontStyle: 'bold',
      })
      .setScrollFactor(0)
      .setDepth(2000)
      .setShadow(0, 2, '#000000aa', 4, false, true);
    this.hudBody = this.add
      .text(28, 52, '연결 중…', {
        fontFamily: hudFont,
        fontSize: '15px',
        color: '#e8eef5',
        lineSpacing: 7,
      })
      .setScrollFactor(0)
      .setDepth(2000)
      .setShadow(0, 1, '#00000088', 3, false, true);
    this.drawHudPanel(320, 120);

    this.statusText = this.add
      .text(width / 2, 22, '연결 중…', {
        fontFamily: hudFont,
        fontSize: '17px',
        color: '#ffe08a',
        fontStyle: 'bold',
        align: 'center',
        backgroundColor: '#0b1020cc',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setShadow(0, 1, '#00000066', 2, false, true);

    // Seeker prep blackout — obscures world so rabbit motion is not visible
    this.prepOverlay = this.add
      .rectangle(width / 2, height / 2, width + 4, height + 4, 0x0b1020, 0.92)
      .setScrollFactor(0)
      .setDepth(1500)
      .setVisible(false);
    this.prepLabel = this.add
      .text(width / 2, height / 2, '', {
        fontFamily: hudFont,
        fontSize: '30px',
        color: '#ffe08a',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(1501)
      .setVisible(false)
      .setShadow(0, 2, '#000000', 6, false, true);

    // Fox roulette + countdown — above HUD (1999–2001) so roles are not leaked
    this.startOverlay = this.add
      .rectangle(width / 2, height / 2, width + 4, height + 4, 0x0b1020, 0.94)
      .setScrollFactor(0)
      .setDepth(3000)
      .setVisible(false);
    this.startOverlayLabel = this.add
      .text(width / 2, height / 2, '', {
        fontFamily: hudFont,
        fontSize: '36px',
        color: '#ffe08a',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(3001)
      .setVisible(false)
      .setShadow(0, 3, '#000000', 8, false, true);

    const btnBg = this.add.rectangle(0, 0, 220, 54, 0x27ae60, 0.96);
    btnBg.setStrokeStyle(2, 0xa8e6cf, 0.7);
    const btnLabel = this.add
      .text(0, 0, '시작', {
        fontFamily: hudFont,
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    this.startBtn = this.add
      .container(width / 2, height - 56, [btnBg, btnLabel])
      .setScrollFactor(0)
      .setDepth(2001)
      .setSize(220, 54)
      .setInteractive(
        new Phaser.Geom.Rectangle(-110, -27, 220, 54),
        Phaser.Geom.Rectangle.Contains,
      );
    this.startBtn.on('pointerdown', () => this.requestStart());
    this.startBtn.setData('label', btnLabel);

    this.inputCtl = new IntentInput(this);

    // Practice runs 100% local (no WebSocket) so solo never depends on multiplayer host.
    if (this.playMode === 'practice') {
      this.bootLocalPractice();
    } else if (preferPeerMultiplayer()) {
      void this.bootPeerMultiplayer();
    } else {
      this.bootMultiplayer();
    }

    const startKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    startKey?.on('down', () => this.requestStart());

    const modeLabel =
      this.playMode === 'practice'
        ? this.practiceRole === 'fox'
          ? '연습 · 여우'
          : '연습 · 토끼'
        : this.peerRole === 'host'
          ? '방장 · Enter로 시작'
          : '손님 · 대기 중';
    this.modeBadge = this.add
      .text(width - 16, 16, modeLabel, {
        fontFamily: hudFont,
        fontSize: '14px',
        color: '#f8fafc',
        fontStyle: 'bold',
        backgroundColor: '#0b1020bb',
        padding: { x: 12, y: 8 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(2000)
      .setShadow(0, 1, '#00000055', 2, false, true);

    // After Arcade step: snap remotes (and everyone when match ended) back to
    // authority coords so solid separation cannot leave fox seeing wrong spots.
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.resyncAuthorityPositions, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.resyncAuthorityPositions, this);
      this.solidCollider?.destroy();
      this.solidCollider = null;
      destroyMeadowWorld(this.meadow);
      this.inputCtl.destroy();
      this.client?.close();
      this.localPractice?.stop();
      this.peer?.destroy();
      this.clearGraves();
    });
  }

  /**
   * Rebuild meadow when room meadowSeed changes (new room), not on rematch.
   */
  private ensureMeadowForSeed(seed: number): void {
    const s = (seed ?? DEFAULT_MEADOW_SEED) >>> 0;
    if (this.meadow && this.meadowSeed === s) return;
    this.solidCollider?.destroy();
    this.solidCollider = null;
    destroyMeadowWorld(this.meadow);
    this.meadowSeed = s;
    this.meadow = buildMeadowWorld(this, s);
    // No entity↔solid collider — props are cover only (avoids sticky blocking)
    this.solidCollider = null;
  }

  /** Keep non-predicted sprites on host/snapshot x,y after physics. */
  private resyncAuthorityPositions = (): void => {
    const state = this.state;
    const you = this.you;
    if (!state || !you) return;
    const matchOver = state.phase === 'ended';
    const seekerBlind = !matchOver && this.seekerIsBlind(state, you);
    for (const e of Object.values(state.entities)) {
      const spr = this.sprites.get(e.id);
      if (!spr) continue;
      const isLocal = e.id === you;
      // Local player may use short prediction during play; others always authority
      if (!matchOver && isLocal && e.alive && !seekerBlind) continue;
      let x = e.x;
      let y = e.y;
      if (!matchOver && seekerBlind && !isLocal) {
        const frozen = this.frozenOthers.get(e.id);
        if (frozen) {
          x = frozen.x;
          y = frozen.y;
        }
      }
      spr.setPosition(x, y);
      const body = spr.body as Phaser.Physics.Arcade.Body | null;
      if (body) {
        body.reset(x, y);
        body.setVelocity(0, 0);
      }
      const tag = this.nameTags.get(e.id);
      tag?.setPosition(x, y - 28);
    }
  };

  private clearGraves(): void {
    for (const g of this.graves) g.destroy();
    this.graves = [];
    this.graveIds.clear();
  }

  /**
   * Human rabbit grave at catch location (all clients). AI leaves no marker.
   */
  private spawnHumanGrave(caughtId: string, name: string, x: number, y: number): void {
    if (this.graveIds.has(caughtId)) return;
    this.graveIds.add(caughtId);
    const stone = this.add
      .rectangle(0, 4, 28, 34, 0x6b7280, 0.95)
      .setStrokeStyle(2, 0x374151, 1);
    const crossV = this.add.rectangle(0, -2, 4, 22, 0xd1d5db, 1);
    const crossH = this.add.rectangle(0, -6, 14, 4, 0xd1d5db, 1);
    const label = this.add
      .text(0, -28, name, {
        fontSize: '12px',
        color: '#fff8e7',
        fontStyle: 'bold',
        backgroundColor: '#000000aa',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5);
    const c = this.add.container(x, y, [stone, crossV, crossH, label]).setDepth(8);
    this.graves.push(c);
  }

  private onCatchSuccess(detail: unknown): void {
    const d = detail as {
      ok?: boolean;
      kind?: CatchVictimKind;
      name?: string;
      x?: number;
      y?: number;
      caughtId?: string;
      placeGrave?: boolean;
    };
    if (!d || d.ok === false) return;
    const kind: CatchVictimKind = d.kind === 'human' ? 'human' : 'ai';
    const name = typeof d.name === 'string' ? d.name : kind === 'ai' ? 'AI' : '유저';
    this.statusText.setText(catchAnnounceText({ kind, name }));
    if (
      kind === 'human' &&
      d.placeGrave !== false &&
      typeof d.x === 'number' &&
      typeof d.y === 'number' &&
      d.caughtId
    ) {
      this.spawnHumanGrave(d.caughtId, name, d.x, d.y);
    }
  }

  private requestStart(): void {
    if (this.localPractice) {
      // Already auto-started; ignore (or could restart)
      return;
    }
    // New match: drop prior-round graves before host starts
    this.clearGraves();
    let designatedSeekerId: string | undefined;
    const foxMode = this.state?.config.foxMode ?? this.roomSettings?.foxMode ?? 'roulette';
    if (foxMode === 'designate' && this.state && this.state.phase !== 'playing') {
      const humans = this.state.humans
        .map((id) => ({
          id,
          name: (this.state!.entities[id]?.name ?? id).trim() || id,
        }))
        .filter((h) => h.id);
      if (humans.length >= 2) {
        const lines = humans.map((h, i) => `${i + 1}. ${h.name}`).join('\n');
        const pick = window.prompt(
          `여우(술래)로 지정할 플레이어 번호를 입력하세요:\n${lines}`,
          '1',
        );
        if (pick == null) return;
        const idx = Math.max(0, Math.min(humans.length - 1, (Number(pick) || 1) - 1));
        designatedSeekerId = humans[idx]!.id;
      } else if (humans[0]) {
        designatedSeekerId = humans[0].id;
      }
    }
    const intent = {
      type: 'start' as const,
      mode: 'normal' as const,
      ...(designatedSeekerId ? { designatedSeekerId } : {}),
    };
    if (this.peer) {
      this.peer.sendIntent(intent);
      return;
    }
    this.client?.sendIntent(intent);
  }

  private bootLocalPractice(): void {
    this.statusText.setText(
      this.practiceRole === 'fox'
        ? `여우 연습 · ${this.playerName}`
        : `토끼 연습 · ${this.playerName}`,
    );
    this.localPractice = new LocalPracticeHost(this.practiceRole, this.playerName);
    this.localPractice.onMessage = (msg) => {
      if (msg.type === 'welcome') {
        this.you = msg.playerId;
      } else if (msg.type === 'snapshot') {
        this.applySnapshot(msg.state, msg.you);
      } else if (msg.type === 'event') {
        this.handleEvent(msg.event, msg.detail);
      } else if (msg.type === 'error') {
        this.statusText.setText(`오류: ${msg.message}`);
      }
    };
    this.localPractice.start();
  }

  private async bootPeerMultiplayer(): Promise<void> {
    this.peer = new PeerMultiplayer();
    this.peer.onStatus = (s, detail) => {
      if (s === 'host_ready' && detail) {
        this.roomId = detail;
        this.statusText.setText(`방 코드 ${detail} · 친구 초대 후 시작`);
      } else if (s === 'joined' && detail) {
        this.roomId = detail;
        this.statusText.setText(`참가 완료 · 방장이 시작할 때까지 기다려 주세요`);
      } else if (s === 'guest_connected') {
        this.statusText.setText(`친구가 들어왔습니다 · 시작을 눌러 주세요`);
      } else if (s === 'error') {
        this.statusText.setText(`연결 오류: ${detail ?? s}`);
      } else if (s === 'disconnected') {
        this.statusText.setText('연결이 끊겼습니다 · 메뉴에서 다시 참가해 주세요');
      } else if (s === 'directory_unavailable') {
        this.statusText.setText('방 목록 연동 실패 · 코드 공유로 초대할 수 있어요');
      } else {
        this.statusText.setText(koreanPeerStatus(s, detail));
      }
    };
    this.peer.onMessage = (msg) => {
      if (msg.type === 'welcome') {
        this.you = msg.playerId;
        this.roomId = msg.roomId;
      } else if (msg.type === 'snapshot') {
        this.applySnapshot(msg.state, msg.you);
      } else if (msg.type === 'event') {
        this.handleEvent(msg.event, msg.detail);
      } else if (msg.type === 'error') {
        this.statusText.setText(`오류: ${koreanError(msg.message)}`);
      }
    };

    try {
      if (this.peerRole === 'guest') {
        const code = normalizeRoomCode(
          this.joinRoomCode || window.prompt('친구 방 코드를 입력하세요') || '',
        );
        if (!code) {
          this.statusText.setText('방 코드가 없습니다 · 메뉴에서 다시 참가해 주세요');
          return;
        }
        this.statusText.setText(`${code} 방에 연결하는 중…`);
        await this.peer.joinRoom(code, this.playerName);
        this.roomId = code;
      } else {
        this.statusText.setText('방을 만드는 중…');
        const code = await this.peer.createRoom(
          this.playerName,
          this.roomSettings ?? undefined,
        );
        this.roomId = code;
        const s = this.roomSettings;
        const settingsLine = s
          ? `\n설정  잡기 ${s.catchBudget}회 · ${Math.round(s.timeLimitMs / 1000)}초 · AI ${s.aiCount} · 여우 ${s.foxMode === 'designate' ? '지정' : '룰렛'}`
          : '';
        this.statusText.setText(
          `방 코드 ${code} · 목록 또는 코드로 친구 초대${settingsLine}`,
        );
      }
    } catch (e) {
      this.statusText.setText(
        `연결 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  private bootMultiplayer(): void {
    this.client = new GameClient(getWsUrl());
    this.client.onStatus = (s) => {
      this.statusText.setText(koreanNetStatus(s));
      if (s === 'connected') {
        this.client?.join(this.roomId, this.playerName);
      }
    };
    this.client.onSnapshot = (state, you) => {
      this.applySnapshot(state, you);
    };
    this.client.onEvent = (event, detail) => {
      this.handleEvent(event, detail);
    };
    this.client.connect();
  }

  private handleEvent(event: string, detail?: unknown): void {
    if (event === 'error') {
      this.statusText.setText(`오류: ${koreanError(String(detail))}`);
    } else if (event === 'match_ended') {
      const d = detail as { winner?: string; reason?: string };
      const caught = this.state ? listCaughtHumans(this.state) : [];
      const caughtLine =
        caught.length > 0
          ? ` · 잡힌 토끼: ${caught.map((c) => c.name).join(', ')}`
          : '';
      this.statusText.setText(
        `경기 종료 · ${koreanWinner(d.winner)} (${koreanEndReason(d.reason)})${caughtLine}`,
      );
      this.prepEndsAtMs = null;
    } else if (event === 'match_started') {
      // All clients: wipe previous match graves / freeze state on every start
      this.clearGraves();
      this.frozenOthers.clear();
      this.prepEndsAtMs = null;
      const d = detail as {
        prepMs?: number;
        practiceRole?: string;
        seekerId?: string;
        humans?: Array<{ id: string; name: string }>;
        startSequenceMs?: number;
        foxMode?: string;
      } | undefined;
      if (this.playMode === 'practice' || d?.practiceRole) {
        const pr = d?.practiceRole;
        this.statusText.setText(
          pr === 'fox'
            ? '여우 연습 · AI 토끼를 잡아 보세요!'
            : '토끼 연습 · 마음껏 움직여 보세요',
        );
      } else if (d?.foxMode === 'designate') {
        this.rouletteNames = d?.humans ?? [];
        const foxName =
          d.humans?.find((h) => h.id === d.seekerId)?.name ??
          this.state?.entities[d.seekerId ?? '']?.name ??
          '여우';
        this.statusText.setText(`여우 지정 · ${foxName} · 곧 시작`);
      } else {
        this.rouletteNames = d?.humans ?? [];
        this.rouletteCursor = 0;
        this.lastRouletteSwap = 0;
        this.statusText.setText('여우 추첨 중…');
      }
    } else if (event === 'catch_success') {
      this.onCatchSuccess(detail);
    } else if (event === 'catch_fail' || event === 'catch_miss') {
      const d = detail as { reason?: string } | undefined;
      if (d?.reason === 'no_target' || d?.reason === 'out_of_range') {
        this.statusText.setText('놓침 · 범위 안에 토끼가 없어요');
      }
    }
  }

  private drawHudPanel(w: number, h: number): void {
    const g = this.hudPanel;
    g.clear();
    const x = 14;
    const y = 12;
    // Soft outer shadow
    g.fillStyle(0x000000, 0.22);
    g.fillRoundedRect(x + 3, y + 4, w, h, 14);
    // Glass body
    g.fillStyle(0x0b1220, 0.78);
    g.fillRoundedRect(x, y, w, h, 14);
    // Gold edge accent
    g.lineStyle(1.5, 0xe8c96a, 0.55);
    g.strokeRoundedRect(x, y, w, h, 14);
    // Top highlight line
    g.lineStyle(2, 0xffffff, 0.08);
    g.beginPath();
    g.moveTo(x + 16, y + 1);
    g.lineTo(x + w - 16, y + 1);
    g.strokePath();
  }

  /**
   * Apply host snapshot, then clamp prep with wall-clock so fox never stays
   * permanently blind if ticks stop arriving.
   */
  private applySnapshot(raw: MatchState, you: string): void {
    this.you = you;
    let state = raw;
    // Hard guard: never treat practice as ended on client
    if (state.mode === 'practice' && state.phase === 'ended') {
      state = {
        ...state,
        phase: 'playing',
        winner: null,
        endReason: null,
      };
    }

    // Room layout: trees/bushes/rocks/grass follow host meadowSeed (set at room create)
    if (typeof state.meadowSeed === 'number' && Number.isFinite(state.meadowSeed)) {
      this.ensureMeadowForSeed(state.meadowSeed);
    }

    // Phase transition into a new round: drop prior-world markers
    if (
      this.state &&
      this.state.phase === 'ended' &&
      (state.phase === 'lobby' || state.phase === 'starting' || state.phase === 'playing')
    ) {
      this.clearGraves();
    }
    if (state.phase === 'starting' && this.state?.phase !== 'starting') {
      this.clearGraves();
    }
    if (state.phase === 'lobby' || state.phase === 'ended') {
      this.prepEndsAtMs = null;
      this.frozenOthers.clear();
    } else if (
      state.mode === 'normal' &&
      state.phase === 'playing' &&
      state.seekerPrepRemainingMs > 0
    ) {
      // First time we see active prep (or rematch), arm wall clock from remaining
      if (this.prepEndsAtMs == null) {
        this.prepEndsAtMs = Date.now() + state.seekerPrepRemainingMs;
      }
    }

    state = this.clampPrepWithWallClock(state);
    this.state = state;
    this.syncSprites(state, you);
    this.updateCameraFollow(you, state);
    this.updatePrepOverlay(state, you);
    this.updateHud(state, you);
  }

  private clampPrepWithWallClock(state: MatchState): MatchState {
    if (state.mode !== 'normal' || state.phase !== 'playing') return state;
    const rem = effectivePrepRemainingMs(state, Date.now(), this.prepEndsAtMs);
    // Use the smaller of server/host value and wall-clock (never extend prep)
    if (rem < state.seekerPrepRemainingMs) {
      return { ...state, seekerPrepRemainingMs: rem };
    }
    return state;
  }

  private prepRemainingForUi(state: MatchState): number {
    return effectivePrepRemainingMs(state, Date.now(), this.prepEndsAtMs);
  }

  private seekerIsBlind(state: MatchState, you: string): boolean {
    return isSeekerBlind(state, you, Date.now(), this.prepEndsAtMs);
  }

  private updatePrepOverlay(state: MatchState, you: string): void {
    // Starting sequence: roulette + countdown (all clients)
    if (state.phase === 'starting' && state.mode === 'normal') {
      this.startOverlay.setVisible(true);
      this.startOverlayLabel.setVisible(true);
      this.prepOverlay.setVisible(false);
      this.prepLabel.setVisible(false);
      const rem = state.startSequenceRemainingMs ?? 0;
      const stage = startSequenceStage(rem);
      // Designate mode never spins — fox is already public
      const spin = state.config.foxMode !== 'designate' && stage === 'roulette';
      if (spin) {
        // Spin names every ~120ms
        const now = this.time.now;
        if (now - this.lastRouletteSwap > 120 && this.rouletteNames.length > 0) {
          this.lastRouletteSwap = now;
          this.rouletteCursor = (this.rouletteCursor + 1) % this.rouletteNames.length;
        }
        const spinName =
          this.rouletteNames[this.rouletteCursor]?.name ??
          state.entities[state.seekerId ?? '']?.name ??
          '???';
        this.startOverlayLabel.setText(`🦊 여우 추첨\n\n${spinName}\n\n두구두구…`);
      } else {
        const sec = startCountdownSeconds(rem);
        const foxName =
          state.entities[state.seekerId ?? '']?.name ??
          this.rouletteNames.find((h) => h.id === state.seekerId)?.name ??
          '여우';
        const youFox = state.seekerId === you;
        const head =
          state.config.foxMode === 'designate' ? '여우 지정' : `여우는 「${foxName}」!`;
        this.startOverlayLabel.setText(
          `${head}\n${state.config.foxMode === 'designate' ? `「${foxName}」` : ''}\n${youFox ? '당신이 여우입니다' : '당신은 토끼입니다'}\n\n${sec}`,
        );
      }
      return;
    }

    this.startOverlay.setVisible(false);
    this.startOverlayLabel.setVisible(false);

    // Arm prep wall-clock once when hunt actually starts
    if (
      state.phase === 'playing' &&
      state.mode === 'normal' &&
      this.prepEndsAtMs == null &&
      state.seekerPrepRemainingMs > 0
    ) {
      this.prepEndsAtMs = Date.now() + state.seekerPrepRemainingMs;
    }

    const blind = this.seekerIsBlind(state, you);
    this.prepOverlay.setVisible(blind);
    this.prepLabel.setVisible(blind);
    if (blind) {
      const sec = Math.ceil(this.prepRemainingForUi(state) / 1000);
      this.prepLabel.setText(
        `준비 시간\n${sec}초 후 토끼가 보입니다\n지금은 움직일 수 없어요`,
      );
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
    if (!this.state || !this.you) return;

    // Wall-clock tick even when host snapshots freeze (dead tunnel / stalled host)
    if (this.state.phase === 'playing' && this.playMode === 'normal') {
      const clamped = this.clampPrepWithWallClock(this.state);
      const rem = clamped.seekerPrepRemainingMs;
      if (rem !== this.lastLocalPrepMs || clamped !== this.state) {
        this.state = clamped;
        this.lastLocalPrepMs = rem;
        this.syncSprites(this.state, this.you);
        this.updatePrepOverlay(this.state, this.you);
        this.updateHud(this.state, this.you);
      }
    }

    if (this.state.phase !== 'playing') return;
    const you = this.you;
    // Block local seeker input during prep (host also rejects)
    if (you && this.seekerIsBlind(this.state, you)) {
      return;
    }
    const intents = this.inputCtl.poll();
    for (const intent of intents) {
      if (intent.type === 'move') {
        if (intent.dx !== this.lastMoveSent.dx || intent.dy !== this.lastMoveSent.dy) {
          this.lastMoveSent = { dx: intent.dx, dy: intent.dy };
          this.sendIntent(intent);
        }
      } else {
        this.sendIntent(intent);
      }
    }
  }

  private sendIntent(intent: import('@hide-and-seek/shared').ClientIntent): void {
    if (this.localPractice) {
      this.localPractice.sendIntent(intent);
      return;
    }
    if (this.peer) {
      this.peer.sendIntent(intent);
      return;
    }
    this.client?.sendIntent(intent);
  }

  private syncSprites(state: MatchState, you: string): void {
    const matchOver = state.phase === 'ended';
    // Never freeze or blind after the match ends — show true snapshot positions
    if (matchOver || state.phase === 'lobby') {
      this.frozenOthers.clear();
      this.prepEndsAtMs = null;
    }

    const seekerBlind = !matchOver && this.seekerIsBlind(state, you);
    // Capture freeze frame once when prep starts (fox only, during prep)
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
      // Always use authoritative coordinates when match is over (no prep freeze)
      let display = e;
      if (!matchOver && seekerBlind && e.id !== you) {
        const frozen = this.frozenOthers.get(e.id);
        if (frozen) {
          display = { ...e, x: frozen.x, y: frozen.y, vx: 0, vy: 0 };
        }
      }

      // During roulette, hide true seeker so fox sprite does not leak before reveal
      const visualSeeker = visualSeekerId(state);

      // Facing + Phaser Animation Manager (run/idle)
      const prevFace = this.lastFacing.get(e.id) ?? 'down';
      const face = facingFromVelocity(display.vx, display.vy, prevFace);
      this.lastFacing.set(e.id, face);
      const moving =
        !matchOver && Math.hypot(display.vx, display.vy) >= FACING_IDLE_EPS;
      const animKey = animKeyFor(e, visualSeeker, face, moving && e.alive);

      let spr = this.sprites.get(e.id) as Phaser.Physics.Arcade.Sprite | undefined;
      if (!spr) {
        const created = this.physics.add.sprite(
          display.x,
          display.y,
          animalTextureKeyFor(e, visualSeeker, face),
        );
        created.setOrigin(0.5, 0.5);
        created.setDisplaySize(64, 64);
        created.setCollideWorldBounds(true);
        created.setDepth(20 + display.y * 0.01);
        const body = created.body as Phaser.Physics.Arcade.Body;
        body.setAllowGravity(false);
        // Circle body centered on sprite (display is 64×64)
        const r = ENTITY_COLLIDE_RADIUS;
        body.setCircle(r, 32 - r, 32 - r);
        body.setBounce(0, 0);
        body.setDrag(0, 0);
        body.setMaxVelocity(SEEKER_SPEED, SEEKER_SPEED);
        this.entityGroup.add(created);
        this.sprites.set(e.id, created);
        spr = created;
      }

      // Authoritative snapshot position (shared integrateMotion is multiplayer source of truth)
      // Force world coords every frame so Arcade solid separation cannot drift remotes
      spr.setPosition(display.x, display.y);
      spr.setDepth(20 + display.y * 0.01);
      const body = spr.body as Phaser.Physics.Arcade.Body | null;
      const isLocal = e.id === you;
      if (body) {
        body.reset(display.x, display.y);
        // No solid prop collision — prediction only for feel between snapshots
        body.checkCollision.none = true;
        const allowLocalPredict =
          isLocal &&
          e.alive &&
          !matchOver &&
          state.phase === 'playing' &&
          !(seekerBlind && state.seekerId === you);
        if (allowLocalPredict) {
          body.enable = true;
          body.moves = true;
          const isSeeker = state.seekerId === you;
          const speed = isSeeker ? SEEKER_SPEED : RABBIT_SPEED;
          body.setVelocity(this.lastMoveSent.dx * speed, this.lastMoveSent.dy * speed);
        } else {
          body.setVelocity(0, 0);
          body.moves = false;
        }
      }

      // Phaser Animation Manager: idle / run loops registered in BootScene
      if (e.alive && this.anims.exists(animKey)) {
        if (spr.anims.currentAnim?.key !== animKey) {
          spr.play(animKey, true);
        }
      } else {
        spr.anims.stop();
      }

      spr.setFlipX(false);
      spr.setFlipY(false);
      spr.setAngle(0);
      spr.setAlpha(e.alive ? 1 : 0.45);
      // Everyone visible when match ends (prep blackout no longer applies)
      spr.setVisible(matchOver || !(seekerBlind && e.id !== you));

      // Name tags: during play fox cannot read rabbit nicks; on ended, reveal all humans + AI
      const tagLabel = nameTagLabel(e, you, visualSeeker, state.phase);
      const showTag =
        tagLabel.length > 0 && (matchOver || !(seekerBlind && e.id !== you));
      let tag = this.nameTags.get(e.id);
      if (showTag) {
        if (!tag) {
          tag = this.add
            .text(display.x, display.y - 28, tagLabel, {
              fontSize: matchOver ? '13px' : '11px',
              color: e.kind === 'ai' ? '#c5d0dc' : '#fff8e7',
              backgroundColor: e.kind === 'human' ? '#1a3a2acc' : '#00000066',
              padding: { x: 4, y: 2 },
              fontStyle: e.kind === 'human' ? 'bold' : 'normal',
            })
            .setOrigin(0.5)
            .setDepth(matchOver ? 40 : 11);
          this.nameTags.set(e.id, tag);
        }
        tag.setPosition(display.x, display.y - 28);
        tag.setText(tagLabel);
        tag.setAlpha(e.alive ? 1 : 0.75);
        tag.setVisible(true);
        tag.setDepth(matchOver ? 40 : 11);
        if (matchOver) {
          tag.setStyle({
            fontSize: '13px',
            color: e.kind === 'ai' ? '#c5d0dc' : '#fff8e7',
            backgroundColor: e.kind === 'human' ? '#1a3a2acc' : '#00000066',
            fontStyle: e.kind === 'human' ? 'bold' : 'normal',
          });
        }
      } else if (tag) {
        // Remove empty / forbidden tags so background boxes never linger
        tag.destroy();
        this.nameTags.delete(e.id);
      }
    }
    for (const id of [...this.sprites.keys()]) {
      if (!seen.has(id)) {
        this.sprites.get(id)?.destroy();
        this.nameTags.get(id)?.destroy();
        this.sprites.delete(id);
        this.nameTags.delete(id);
        this.lastFacing.delete(id);
        if (this.cameraFollowId === id) {
          this.cameras.main.stopFollow();
          this.cameraFollowId = null;
        }
      }
    }
  }

  private updateHud(state: MatchState, you: string): void {
    const me = state.entities[you];
    const prepActive =
      this.prepRemainingForUi(state) > 0 &&
      state.mode === 'normal' &&
      state.phase === 'playing';
    const humans = state.humans.length;
    const room = shortRoom(state.roomId || this.roomId);
    const foxKnown = isFoxRevealed(state);
    const isFox =
      (foxKnown && state.seekerId === you) || state.practiceRole === 'fox';
    const isRabbit =
      !isFox && (me?.kind === 'human' || state.practiceRole === 'rabbit');

    // During starting, HUD stays under the fullscreen overlay; keep text neutral
    // so a brief peek never spoils the roulette.
    const starting = state.phase === 'starting' && state.mode === 'normal';

    // Title
    let title = '초원 숨바꼭질';
    if (state.mode === 'practice') {
      title = state.practiceRole === 'fox' ? '연습 · 여우' : '연습 · 토끼';
    } else if (state.phase === 'lobby') {
      title = '대기실';
    } else if (starting) {
      title =
        startSequenceStage(state.startSequenceRemainingMs ?? 0) === 'roulette'
          ? '여우 추첨'
          : '곧 시작';
    } else if (state.phase === 'playing') {
      title = prepActive ? '준비 중' : '사냥 중';
    } else if (state.phase === 'ended') {
      title = '경기 종료';
    }
    this.hudTitle.setText(title);
    this.hudTitle.setColor(
      starting ? '#fff8e7' : isFox ? '#ffb36b' : isRabbit ? '#c8f0d8' : '#fff8e7',
    );

    const rows: string[] = [];
    rows.push(`상태  ${koreanPhase(state)}`);
    if (state.mode !== 'practice' || this.peer) {
      rows.push(`방    ${room}`);
    }
    rows.push(`인원  ${humans} / ${state.config.maxHumans}명`);

    if (starting) {
      rows.push(`닉네임  ${this.playerName}`);
      if (startSequenceStage(state.startSequenceRemainingMs ?? 0) === 'roulette') {
        rows.push('안내  여우 추첨 중…');
      } else {
        rows.push('안내  여우 공개 · 곧 시작');
      }
    } else if (state.mode === 'practice') {
      const aiN = Object.values(state.entities).filter(
        (e) => e.kind === 'ai' && e.alive,
      ).length;
      if (state.practiceRole === 'fox') {
        rows.push(`역할  여우 (술래)`);
        rows.push(`닉네임  ${this.playerName}`);
        rows.push(`AI 토끼  ${aiN}마리`);
      } else {
        rows.push(`역할  토끼`);
        rows.push(`닉네임  ${this.playerName}`);
        rows.push(`AI 친구  ${aiN}마리`);
      }
      for (const line of roleObjectiveLines(state, you)) {
        rows.push(line);
      }
    } else {
      const myRole =
        foxKnown && state.seekerId === you
          ? '여우 (술래)'
          : me?.kind === 'human'
            ? '토끼 (숨는 쪽)'
            : '관전';
      rows.push(`역할  ${myRole}`);
      rows.push(`닉네임  ${this.playerName}`);

      if (state.phase === 'playing') {
        rows.push(`시간  ${formatClock(state.timeRemainingMs)}`);
        if (state.seekerId === you) {
          rows.push(
            `잡기 횟수  ${state.catchBudgetRemaining}/${state.config.catchBudget}`,
          );
        }
        // Role-specific objectives (fox vs rabbit)
        for (const line of roleObjectiveLines(state, you)) {
          rows.push(line);
        }
        if (!prepActive && state.seekerId === you) {
          rows.push(`조작  범위 ${state.config.catchRange}px 에서 잡기`);
        }
      }
    }

    if (state.phase === 'lobby') {
      if (this.peer && this.peerRole === 'host') {
        rows.push(`코드  ${this.roomId}`);
        rows.push(
          humans < 2
            ? '안내  친구 2명 이상 모이면 시작'
            : '안내  시작 버튼 또는 Enter',
        );
      } else if (this.peer) {
        rows.push('안내  방장이 시작할 때까지 대기');
      } else if (this.playMode === 'practice') {
        rows.push('안내  연습 준비 중…');
      } else {
        rows.push('안내  시작 버튼 또는 Enter');
      }
    }

    if (state.phase === 'ended' && state.mode !== 'practice') {
      rows.push(`결과  ${koreanWinner(state.winner)} 승`);
      rows.push(`사유  ${koreanEndReason(state.endReason)}`);
      const caught = listCaughtHumans(state);
      const used = state.config.catchBudget - state.catchBudgetRemaining;
      rows.push(
        `유저 포획  ${humanCatchScore(state)}명 · 전체 시도 ${used}/${state.config.catchBudget}`,
      );
      // Full reveal: which rabbits were real players + nicknames (alive / caught)
      for (const line of userRabbitRevealLines(state)) {
        rows.push(line);
      }
      if (caught.length > 0) {
        rows.push(`잡힌 유저  ${caught.map((c) => c.name).join(', ')}`);
      }
      rows.push('안내  머리 위 이름 = 유저 · AI는 "AI" 표시');
      rows.push('안내  다시하기 또는 Enter');
    }

    this.hudBody.setText(rows.join('\n'));

    // Fit glass panel to content
    const padX = 28;
    const padY = 18;
    const gap = 8;
    const titleH = this.hudTitle.height;
    const bodyH = this.hudBody.height;
    const panelW = Math.max(
      300,
      Math.ceil(Math.max(this.hudTitle.width, this.hudBody.width) + padX * 2),
    );
    const panelH = Math.ceil(padY + titleH + gap + bodyH + padY);
    this.drawHudPanel(panelW, panelH);
    this.hudTitle.setPosition(14 + padX - 6, 12 + padY - 4);
    this.hudBody.setPosition(14 + padX - 6, 12 + padY + titleH + gap - 2);

    const showCatch =
      state.phase === 'playing' &&
      state.seekerId === you &&
      !this.seekerIsBlind(state, you) &&
      (state.mode === 'normal' || state.practiceRole === 'fox');
    this.inputCtl.setCatchVisible(showCatch);

    const showStart =
      this.playMode !== 'practice' &&
      (state.phase === 'lobby' || state.phase === 'ended') &&
      (!this.peer || this.peerRole === 'host');
    this.startBtn.setVisible(showStart);
    const label = this.startBtn.getData('label') as Phaser.GameObjects.Text | undefined;
    label?.setText(state.phase === 'ended' ? '다시하기' : '시작');
  }
}

function shortRoom(id: string): string {
  if (!id) return '—';
  if (id.startsWith('practice-')) return '연습방';
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function koreanPhase(state: MatchState): string {
  if (state.mode === 'practice') return '연습';
  switch (state.phase) {
    case 'lobby':
      return '대기';
    case 'playing':
      return '진행';
    case 'ended':
      return '종료';
    default:
      return state.phase;
  }
}

function koreanWinner(winner?: string | null): string {
  if (winner === 'seeker' || winner === 'seekers') return '여우';
  if (winner === 'hiders' || winner === 'hider') return '토끼';
  if (winner === 'draw') return '무승부';
  return winner ?? '없음';
}

function koreanEndReason(reason?: string | null): string {
  switch (reason) {
    case 'all_hiders_caught':
      return '토끼를 모두 잡음';
    case 'catch_budget_exhausted':
      return '잡기 기회 소진';
    case 'time_expired':
    case 'time_up':
      return '시간 종료';
    case 'seeker_left':
      return '술래 이탈';
    default:
      return reason ?? '—';
  }
}

function koreanError(msg: string): string {
  switch (msg) {
    case 'need_2_players_for_multiplayer':
      return '멀티는 2명 이상 필요해요';
    case 'room_full':
      return '방이 가득 찼어요';
    case 'join_timeout':
      return '참가 시간이 초과됐어요';
    default:
      return msg;
  }
}

function koreanNetStatus(s: string): string {
  switch (s) {
    case 'connecting':
      return '서버에 연결 중…';
    case 'connected':
      return '서버 연결됨';
    case 'disconnected':
      return '서버 연결 끊김';
    case 'error':
      return '서버 연결 오류';
    default:
      return s;
  }
}

function koreanPeerStatus(s: string, detail?: string): string {
  const d = detail ? ` · ${detail}` : '';
  switch (s) {
    case 'connecting_host':
      return `방에 연결 중${d}`;
    case 'joined':
      return `참가 완료${d}`;
    default:
      return `${s}${d}`;
  }
}

/**
 * Fox identity is secret during roulette; only show after countdown stage
 * (or once playing / practice).
 */
function isFoxRevealed(state: MatchState): boolean {
  if (state.mode === 'practice') return true;
  if (state.phase !== 'starting') return true;
  // Host-designated fox is public immediately (countdown only, no spin secrecy)
  if (state.config.foxMode === 'designate') return true;
  return startSequenceStage(state.startSequenceRemainingMs ?? 0) === 'countdown';
}

/** Seeker id for sprites / name tags — null while roulette is spinning. */
function visualSeekerId(state: MatchState): string | null {
  if (!isFoxRevealed(state)) return null;
  return state.seekerId;
}

function animKeyFor(
  e: EntityState,
  seekerId: string | null,
  facing: Facing,
  moving: boolean,
): string {
  if (!e.alive) return 'caught';
  // When seekerId is null (roulette), force rabbit so fox art does not leak
  const kind =
    seekerId != null && (e.id === seekerId || e.role === 'seeker') ? 'fox' : 'rabbit';
  return animalAnimKey(kind, facing, moving);
}

function animalTextureKeyFor(
  e: EntityState,
  seekerId: string | null,
  facing: Facing,
): string {
  if (!e.alive) return 'caught';
  const kind =
    seekerId != null && (e.id === seekerId || e.role === 'seeker') ? 'fox' : 'rabbit';
  // Idle frame as initial texture; Animation Manager swaps frames
  return animalTextureKey(kind, facing, 0);
}

// nameTagLabel lives in ../ui/nameTags (play fairness + end-game reveal)
