import Phaser from 'phaser';
import {
  DEFAULT_AI_COUNT,
  DEFAULT_CATCH_BUDGET,
  DEFAULT_TIME_LIMIT_MS,
  normalizeRoomSettings,
  type FoxAssignmentMode,
  type MatchMode,
  type PracticeRole,
  type RoomRuleMode,
  type RoomSettings,
} from '@hide-and-seek/shared';
import { getRoomDirectory, type PublicRoom } from '../net/RoomDirectory';
import { isValidRoomCode, normalizeRoomCode } from '../net/roomCodes';
import { loadNickname, promptNickname, saveNickname } from '../net/nicknames';
import type { PeerRole } from './GameScene';

/** This mini-game's storage scope for nicknames (hub has none). */
const GAME_ID = 'hide-and-seek' as const;

type RowUi = {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  code: string;
};

type CreateDraft = {
  catchBudget: number;
  timeSec: number;
  aiCount: number;
  foxMode: FoxAssignmentMode;
  ruleMode: RoomRuleMode;
};

/**
 * AI 술래잡기 menu: per-game nickname, create room, join by code, room list.
 */
export class MenuScene extends Phaser.Scene {
  private listStatus!: Phaser.GameObjects.Text;
  private listEmpty!: Phaser.GameObjects.Text;
  private nickLabel!: Phaser.GameObjects.Text;
  private rows: RowUi[] = [];
  private listPanelY = 0;
  private listPanelH = 0;
  private destroyed = false;
  private nickname = loadNickname(GAME_ID);
  /** In-game create-room settings modal (no browser prompt). */
  private createModal: Phaser.GameObjects.Container | null = null;
  private createDraft: CreateDraft = {
    catchBudget: DEFAULT_CATCH_BUDGET,
    timeSec: Math.round(DEFAULT_TIME_LIMIT_MS / 1000),
    aiCount: DEFAULT_AI_COUNT,
    foxMode: 'roulette',
    ruleMode: 'standard',
  };
  private createValueLabels: {
    ruleMode: Phaser.GameObjects.Text | null;
    budget: Phaser.GameObjects.Text | null;
    time: Phaser.GameObjects.Text | null;
    ai: Phaser.GameObjects.Text | null;
    fox: Phaser.GameObjects.Text | null;
  } = { ruleMode: null, budget: null, time: null, ai: null, fox: null };

  constructor() {
    super('Menu');
  }

  create(): void {
    // Re-entry after Game→로비로 돌아가기: drop stale Phaser objects from prior Menu life
    this.clearTransientUi();
    this.destroyed = false;
    this.nickname = loadNickname(GAME_ID);
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#5d8a3e');
    if (this.textures.exists('grass_tile')) {
      for (let y = 0; y < height; y += 64) {
        for (let x = 0; x < width; x += 64) {
          this.add.image(x + 32, y + 32, 'grass_tile').setDisplaySize(64, 64).setAlpha(0.85);
        }
      }
    }

    this.add
      .text(width / 2, 40, 'AI 술래잡기', {
        fontSize: '40px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#2d4a1c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 88, '스낵게임 · 멀티 방 만들기 · 코드 참가 · 방 목록', {
        fontSize: '17px',
        color: '#f5f5dc',
      })
      .setOrigin(0.5);

    this.makeButton(width / 2, 148, 200, 36, 0x334155, '← 스낵게임 홈', () => {
      this.clearTransientUi();
      this.scene.start('Hub');
    });

    // Nickname bar (below hub back)
    this.nickLabel = this.add
      .text(width / 2 - 70, 198, this.nickLine(), {
        fontSize: '18px',
        color: '#fff8e7',
        fontStyle: 'bold',
        backgroundColor: '#0b1020cc',
        padding: { x: 14, y: 10 },
      })
      .setOrigin(0.5);
    this.makeButton(width / 2 + 160, 198, 180, 42, 0x8e44ad, '닉네임 변경', () => {
      this.nickname = promptNickname(this.nickname, GAME_ID);
      this.nickLabel.setText(this.nickLine());
    });

    // Top actions
    const btnY = 258;
    this.makeButton(width * 0.28, btnY, 300, 52, 0x27ae60, '방 만들기', () =>
      this.createHostRoom(),
    );
    this.makeButton(width * 0.72, btnY, 300, 52, 0x16a085, '코드로 참가', () =>
      this.joinWithCode(),
    );

    // Room list panel
    const panelX = width / 2;
    const panelW = Math.min(900, width - 80);
    this.listPanelY = 310;
    this.listPanelH = Math.min(340, height - 500);
    this.add
      .rectangle(panelX, this.listPanelY + this.listPanelH / 2, panelW, this.listPanelH, 0x0b1020, 0.72)
      .setStrokeStyle(2, 0xf1c40f, 0.5);

    this.add
      .text(panelX - panelW / 2 + 20, this.listPanelY + 14, '열린 방 목록', {
        fontSize: '22px',
        color: '#f1c40f',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    this.makeButton(panelX + panelW / 2 - 90, this.listPanelY + 28, 140, 40, 0x2980b9, '새로고침', () => {
      this.listStatus.setText('목록 새로고침 중…');
      getRoomDirectory().requestList();
    });

    this.listStatus = this.add
      .text(panelX, this.listPanelY + 56, '방 목록 연결 중…', {
        fontSize: '15px',
        color: '#bdc3c7',
      })
      .setOrigin(0.5, 0);

    this.listEmpty = this.add
      .text(
        panelX,
        this.listPanelY + this.listPanelH / 2,
        '열린 방이 없습니다.\n친구에게 방 만들기를 부탁하거나 코드로 참가하세요.',
        { fontSize: '18px', color: '#95a5a6', align: 'center', lineSpacing: 8 },
      )
      .setOrigin(0.5)
      .setVisible(false);

    // Practice
    const pracY = height - 110;
    this.makeButton(width * 0.2, pracY, 200, 48, 0x3498db, '연습 · 토끼', () =>
      this.go('practice', 'rabbit'),
    );
    this.makeButton(width * 0.48, pracY, 200, 48, 0xe67e22, '연습 · 여우', () =>
      this.go('practice', 'fox', undefined, undefined, {
        catchBudget: 999,
        timeLimitMs: 90_000,
        aiCount: 18,
        foxMode: 'roulette',
        ruleMode: 'stun_penalty',
      }),
    );
    this.makeButton(width * 0.78, pracY, 240, 48, 0x8e44ad, '연습 · 무제한 스턴', () =>
      this.go('practice', 'fox', undefined, undefined, {
        catchBudget: 999,
        timeLimitMs: 90_000,
        aiCount: 18,
        foxMode: 'roulette',
        ruleMode: 'stun_penalty',
      }),
    );

    this.add
      .text(
        width / 2,
        height - 42,
        '닉네임 설정 후 참가 · 목록 클릭 또는 코드 입력\n여우 준비 10초 후 토끼가 보입니다',
        { fontSize: '14px', color: '#ecf0f1', align: 'center', lineSpacing: 4 },
      )
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.go('normal', undefined, 'host'));

    const dir = getRoomDirectory();
    dir.onRooms = (rooms) => {
      if (this.destroyed) return;
      this.renderRoomList(rooms, panelX, panelW);
    };
    dir.onStatus = (s) => {
      if (this.destroyed) return;
      if (s === 'broker' || s === 'client') {
        this.listStatus.setText(
          s === 'broker' ? '목록 준비됨 (이 기기가 로비 중계)' : '목록 연결됨',
        );
        dir.requestList();
      } else if (s === 'connecting') {
        this.listStatus.setText('방 목록 연결 중…');
      } else if (s.includes('error') || s.includes('failed')) {
        this.listStatus.setText('목록 연결 실패 — 코드로 참가할 수 있어요');
      } else if (s === 'lobby_disconnected') {
        this.listStatus.setText('목록 재연결 중…');
      }
    };
    void dir.start().catch(() => {
      if (!this.destroyed) {
        this.listStatus.setText('목록 연결 실패 — 코드로 참가할 수 있어요');
        this.listEmpty.setVisible(true);
      }
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.destroyed = true;
      dir.onRooms = null;
      dir.onStatus = null;
      this.clearTransientUi();
    });
  }

  /**
   * Drop create-room modal + room list row refs so a later create() never
   * reuses destroyed GameObjects (방 만들기 broken after lobby return).
   */
  private clearTransientUi(): void {
    if (this.createModal) {
      try {
        this.createModal.destroy(true);
      } catch {
        /* ignore */
      }
      this.createModal = null;
    }
    this.createValueLabels = {
      ruleMode: null,
      budget: null,
      time: null,
      ai: null,
      fox: null,
    };
    for (const row of this.rows) {
      try {
        row.bg.destroy();
        row.text.destroy();
      } catch {
        /* ignore */
      }
    }
    this.rows = [];
  }

  private nickLine(): string {
    return `닉네임  ${this.nickname}`;
  }

  private renderRoomList(rooms: PublicRoom[], panelX: number, panelW: number): void {
    for (const row of this.rows) {
      row.bg.destroy();
      row.text.destroy();
    }
    this.rows = [];

    const joinable = rooms.filter(
      (r) =>
        r.phase === 'lobby' &&
        r.players < r.maxPlayers &&
        (!r.game || r.game === 'hide-and-seek'),
    );
    if (joinable.length === 0) {
      this.listEmpty.setVisible(true);
      this.listStatus.setText('열린 방 0개 · 코드로도 참가 가능');
      return;
    }
    this.listEmpty.setVisible(false);
    this.listStatus.setText(`열린 방 ${joinable.length}개 · 클릭해서 참가`);

    const startY = this.listPanelY + 90;
    const rowH = 56;
    const maxRows = Math.max(1, Math.floor((this.listPanelH - 100) / (rowH + 8)));
    const shown = joinable.slice(0, maxRows);

    for (const [i, room] of shown.entries()) {
      const y = startY + i * (rowH + 8);
      const bg = this.add
        .rectangle(panelX, y, panelW - 40, rowH, 0x1e8449, 0.95)
        .setStrokeStyle(2, 0x2ecc71, 0.8)
        .setInteractive({ useHandCursor: true });
      const modeBadge = room.ruleMode === 'stun_penalty' ? ' [무제한스턴]' : '';
      const label = `${room.code}  ·  ${room.hostName}${modeBadge}  ·  ${room.players}/${room.maxPlayers}명  ·  대기중`;
      const text = this.add
        .text(panelX, y, label, {
          fontSize: '20px',
          color: '#ffffff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5);
      bg.on('pointerover', () => bg.setFillStyle(0x239b56, 1));
      bg.on('pointerout', () => bg.setFillStyle(0x1e8449, 0.95));
      bg.on('pointerdown', () => {
        this.go('normal', undefined, 'guest', room.code);
      });
      this.rows.push({ bg, text, code: room.code });
    }
  }

  private joinWithCode(): void {
    const raw = window.prompt('친구에게 받은 방 코드를 입력하세요 (예: AB12CD)');
    if (!raw?.trim()) return;
    const code = normalizeRoomCode(raw);
    if (!isValidRoomCode(code)) {
      window.alert('방 코드 형식이 올바르지 않습니다. 4~12자 영문/숫자를 입력하세요.');
      return;
    }
    this.go('normal', undefined, 'guest', code);
  }

  /** Host: open in-scene settings modal (no browser prompt). */
  private createHostRoom(): void {
    this.openCreateRoomModal();
  }

  private openCreateRoomModal(): void {
    if (this.createModal) {
      this.createModal.setVisible(true);
      this.createModal.setDepth(5000);
      this.refreshCreateModalLabels();
      return;
    }

    const { width, height } = this.scale;
    const panelW = Math.min(560, width - 40);
    const panelH = Math.min(560, height - 60);
    const root = this.add.container(width / 2, height / 2).setDepth(5000);

    // Dim background (blocks clicks to menu)
    const dim = this.add
      .rectangle(0, 0, width + 40, height + 40, 0x000000, 0.62)
      .setInteractive();
    dim.on('pointerdown', () => {
      /* swallow */
    });

    const panel = this.add
      .rectangle(0, 0, panelW, panelH, 0x0f172a, 0.97)
      .setStrokeStyle(3, 0xf1c40f, 0.85);

    const title = this.add
      .text(0, -panelH / 2 + 36, '방 만들기', {
        fontSize: '28px',
        color: '#ffe08a',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const subtitle = this.add
      .text(0, -panelH / 2 + 68, '설정을 고른 뒤 생성하세요', {
        fontSize: '15px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    root.add([dim, panel, title, subtitle]);

    // Layout: [title+hint left] ........ [ − ][ value box ][ + ] right
    const rowStartY = -panelH / 2 + 105;
    const rowGap = 68;
    const leftX = -panelW / 2 + 28;
    const plusX = panelW / 2 - 36;
    const valueBoxW = 120;
    const valueCx = plusX - 52 - 8 - valueBoxW / 2;

    // Row 0: Game mode toggle (standard vs stun_penalty)
    const modeY = rowStartY;
    const modeTitle = this.add
      .text(leftX, modeY - 12, '게임 모드', {
        fontSize: '17px',
        color: '#e2e8f0',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const modeHint = this.add
      .text(leftX, modeY + 12, '일반(제한) / 무제한(AI스턴)', {
        fontSize: '12px',
        color: '#64748b',
      })
      .setOrigin(0, 0.5);
    const modeValueBg = this.add
      .rectangle(valueCx, modeY, valueBoxW, 40, 0x1e293b, 1)
      .setStrokeStyle(1, 0x475569, 0.8);
    this.createValueLabels.ruleMode = this.add
      .text(valueCx, modeY, '', {
        fontSize: '15px',
        color: '#fff8e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const modeToggle = this.add
      .rectangle(plusX, modeY, 48, 40, 0x2563eb, 0.95)
      .setStrokeStyle(2, 0x93c5fd, 0.7)
      .setInteractive({ useHandCursor: true });
    const modeToggleLabel = this.add
      .text(plusX, modeY, '⇄', {
        fontSize: '20px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    modeToggle.on('pointerdown', () => {
      this.createDraft.ruleMode =
        this.createDraft.ruleMode === 'standard' ? 'stun_penalty' : 'standard';
      this.refreshCreateModalLabels();
    });
    root.add([
      modeTitle,
      modeHint,
      modeValueBg,
      this.createValueLabels.ruleMode,
      modeToggle,
      modeToggleLabel,
    ]);

    // Row 1: Catch budget
    this.createValueLabels.budget = this.addStepperRow(
      root,
      rowStartY + rowGap,
      panelW,
      '잡기 횟수',
      'AI+유저 공통 (1~30)',
      () => String(this.createDraft.catchBudget),
      () => {
        if (this.createDraft.ruleMode === 'stun_penalty') return;
        this.createDraft.catchBudget = Math.max(1, this.createDraft.catchBudget - 1);
        this.refreshCreateModalLabels();
      },
      () => {
        if (this.createDraft.ruleMode === 'stun_penalty') return;
        this.createDraft.catchBudget = Math.min(30, this.createDraft.catchBudget + 1);
        this.refreshCreateModalLabels();
      },
    );

    // Row 2: Time limit
    this.createValueLabels.time = this.addStepperRow(
      root,
      rowStartY + rowGap * 2,
      panelW,
      '제한 시간',
      '초 단위 (30~600)',
      () => `${this.createDraft.timeSec}초`,
      () => {
        this.createDraft.timeSec = Math.max(30, this.createDraft.timeSec - 15);
        this.refreshCreateModalLabels();
      },
      () => {
        this.createDraft.timeSec = Math.min(600, this.createDraft.timeSec + 15);
        this.refreshCreateModalLabels();
      },
    );

    // Row 3: AI Count
    this.createValueLabels.ai = this.addStepperRow(
      root,
      rowStartY + rowGap * 3,
      panelW,
      'AI 토끼',
      '0~40마리',
      () => String(this.createDraft.aiCount),
      () => {
        this.createDraft.aiCount = Math.max(0, this.createDraft.aiCount - 1);
        this.refreshCreateModalLabels();
      },
      () => {
        this.createDraft.aiCount = Math.min(40, this.createDraft.aiCount + 1);
        this.refreshCreateModalLabels();
      },
    );

    // Row 4: Fox mode (label left, value box + toggle right)
    const foxY = rowStartY + rowGap * 4;
    const foxTitle = this.add
      .text(leftX, foxY - 12, '여우 선정', {
        fontSize: '17px',
        color: '#e2e8f0',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const foxHint = this.add
      .text(leftX, foxY + 12, '룰렛 또는 시작 시 지정', {
        fontSize: '12px',
        color: '#64748b',
      })
      .setOrigin(0, 0.5);
    const foxValueBg = this.add
      .rectangle(valueCx, foxY, valueBoxW, 40, 0x1e293b, 1)
      .setStrokeStyle(1, 0x475569, 0.8);
    this.createValueLabels.fox = this.add
      .text(valueCx, foxY, '', {
        fontSize: '15px',
        color: '#fff8e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const foxToggle = this.add
      .rectangle(plusX, foxY, 48, 40, 0x7c3aed, 0.95)
      .setStrokeStyle(2, 0xc4b5fd, 0.7)
      .setInteractive({ useHandCursor: true });
    const foxToggleLabel = this.add
      .text(plusX, foxY, '⇄', {
        fontSize: '20px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    foxToggle.on('pointerdown', () => {
      this.createDraft.foxMode =
        this.createDraft.foxMode === 'roulette' ? 'designate' : 'roulette';
      this.refreshCreateModalLabels();
    });
    root.add([
      foxTitle,
      foxHint,
      foxValueBg,
      this.createValueLabels.fox,
      foxToggle,
      foxToggleLabel,
    ]);

    // Actions
    const actionY = panelH / 2 - 48;
    const cancelBg = this.add
      .rectangle(-110, actionY, 160, 48, 0x475569, 0.98)
      .setStrokeStyle(2, 0xcbd5e1, 0.5)
      .setInteractive({ useHandCursor: true });
    const cancelTxt = this.add
      .text(-110, actionY, '취소', {
        fontSize: '18px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    cancelBg.on('pointerdown', () => this.closeCreateRoomModal());

    const createBg = this.add
      .rectangle(110, actionY, 180, 48, 0x16a34a, 0.98)
      .setStrokeStyle(2, 0x86efac, 0.7)
      .setInteractive({ useHandCursor: true });
    const createTxt = this.add
      .text(110, actionY, '방 생성', {
        fontSize: '18px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    createBg.on('pointerdown', () => this.confirmCreateRoom());

    root.add([cancelBg, cancelTxt, createBg, createTxt]);
    this.createModal = root;
    this.refreshCreateModalLabels();
  }

  /**
   * Row: title+hint on left, fixed [−][value][+] cluster on the right (no overlap).
   */
  private addStepperRow(
    root: Phaser.GameObjects.Container,
    y: number,
    panelW: number,
    title: string,
    hint: string,
    getValue: () => string,
    onMinus: () => void,
    onPlus: () => void,
  ): Phaser.GameObjects.Text {
    const leftX = -panelW / 2 + 28;
    const plusX = panelW / 2 - 36;
    const minusX = plusX - 56;
    const valueBoxW = 100;
    const valueCx = minusX - 12 - valueBoxW / 2;

    const label = this.add
      .text(leftX, y - 12, title, {
        fontSize: '17px',
        color: '#e2e8f0',
        fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const hintText = this.add
      .text(leftX, y + 12, hint, {
        fontSize: '12px',
        color: '#64748b',
      })
      .setOrigin(0, 0.5);

    // Fixed-width value plate so digits never sit under +/-
    const valueBg = this.add
      .rectangle(valueCx, y, valueBoxW, 40, 0x1e293b, 1)
      .setStrokeStyle(1, 0x475569, 0.9);
    const valueText = this.add
      .text(valueCx, y, getValue(), {
        fontSize: '20px',
        color: '#fff8e7',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const minus = this.add
      .rectangle(minusX, y, 44, 40, 0x334155, 1)
      .setStrokeStyle(2, 0x94a3b8, 0.55)
      .setInteractive({ useHandCursor: true });
    const minusL = this.add
      .text(minusX, y, '−', {
        fontSize: '24px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    minus.on('pointerdown', onMinus);

    const plus = this.add
      .rectangle(plusX, y, 44, 40, 0x334155, 1)
      .setStrokeStyle(2, 0x94a3b8, 0.55)
      .setInteractive({ useHandCursor: true });
    const plusL = this.add
      .text(plusX, y, '+', {
        fontSize: '24px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    plus.on('pointerdown', onPlus);

    root.add([label, hintText, valueBg, valueText, minus, minusL, plus, plusL]);
    return valueText;
  }

  private refreshCreateModalLabels(): void {
    const d = this.createDraft;
    this.createValueLabels.ruleMode?.setText(
      d.ruleMode === 'stun_penalty' ? '무제한 스턴' : '일반 모드',
    );
    this.createValueLabels.budget?.setText(
      d.ruleMode === 'stun_penalty' ? '무제한 (∞)' : String(d.catchBudget),
    );
    this.createValueLabels.time?.setText(`${d.timeSec}초`);
    this.createValueLabels.ai?.setText(String(d.aiCount));
    this.createValueLabels.fox?.setText(
      d.foxMode === 'designate' ? '직접 지정' : '룰렛 추첨',
    );
  }

  private closeCreateRoomModal(): void {
    this.createModal?.setVisible(false);
  }

  private confirmCreateRoom(): void {
    const isStun = this.createDraft.ruleMode === 'stun_penalty';
    const settings = normalizeRoomSettings({
      catchBudget: isStun ? 999 : this.createDraft.catchBudget,
      timeLimitMs: this.createDraft.timeSec * 1000,
      aiCount: this.createDraft.aiCount,
      foxMode: this.createDraft.foxMode,
      ruleMode: this.createDraft.ruleMode,
    });
    this.closeCreateRoomModal();
    this.go('normal', undefined, 'host', undefined, settings);
  }

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    label: string,
    onClick: () => void,
  ): Phaser.GameObjects.Rectangle {
    const btn = this.add.rectangle(x, y, w, h, color).setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, label, { fontSize: '18px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5);
    btn.on('pointerdown', onClick);
    return btn;
  }

  private go(
    mode: MatchMode,
    practiceRole?: PracticeRole,
    peerRole?: PeerRole,
    roomCode?: string,
    roomSettings?: RoomSettings,
  ): void {
    // Ensure current nickname is saved for this game before entering
    this.nickname = saveNickname(this.nickname, GAME_ID);
    this.scene.start('Game', {
      mode,
      practiceRole,
      peerRole,
      roomCode,
      playerName: this.nickname,
      roomSettings,
    });
  }
}
