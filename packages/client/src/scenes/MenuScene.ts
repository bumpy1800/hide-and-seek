import Phaser from 'phaser';
import {
  DEFAULT_AI_COUNT,
  DEFAULT_CATCH_BUDGET,
  DEFAULT_TIME_LIMIT_MS,
  normalizeRoomSettings,
  type MatchMode,
  type PracticeRole,
  type RoomSettings,
} from '@hide-and-seek/shared';
import { getRoomDirectory, type PublicRoom } from '../net/RoomDirectory';
import { isValidRoomCode, normalizeRoomCode } from '../net/roomCodes';
import { loadNickname, promptNickname, saveNickname } from '../net/nicknames';
import type { PeerRole } from './GameScene';

type RowUi = {
  bg: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
  code: string;
};

/**
 * Main menu: nickname, create room, join by code, or click a live room.
 */
export class MenuScene extends Phaser.Scene {
  private listStatus!: Phaser.GameObjects.Text;
  private listEmpty!: Phaser.GameObjects.Text;
  private nickLabel!: Phaser.GameObjects.Text;
  private rows: RowUi[] = [];
  private listPanelY = 0;
  private listPanelH = 0;
  private destroyed = false;
  private nickname = loadNickname();

  constructor() {
    super('Menu');
  }

  create(): void {
    this.destroyed = false;
    this.nickname = loadNickname();
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
      .text(width / 2, 40, 'MEADOW HIDE & SEEK', {
        fontSize: '40px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#2d4a1c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 88, '멀티: 방 만들기 · 코드 참가 · 방 목록 클릭', {
        fontSize: '17px',
        color: '#f5f5dc',
      })
      .setOrigin(0.5);

    // Nickname bar
    this.nickLabel = this.add
      .text(width / 2 - 70, 128, this.nickLine(), {
        fontSize: '18px',
        color: '#fff8e7',
        fontStyle: 'bold',
        backgroundColor: '#0b1020cc',
        padding: { x: 14, y: 10 },
      })
      .setOrigin(0.5);
    this.makeButton(width / 2 + 160, 128, 180, 42, 0x8e44ad, '닉네임 변경', () => {
      this.nickname = promptNickname(this.nickname);
      this.nickLabel.setText(this.nickLine());
    });

    // Top actions
    const btnY = 190;
    this.makeButton(width * 0.28, btnY, 300, 52, 0x27ae60, '방 만들기', () =>
      this.createHostRoom(),
    );
    this.makeButton(width * 0.72, btnY, 300, 52, 0x16a085, '코드로 참가', () =>
      this.joinWithCode(),
    );

    // Room list panel
    const panelX = width / 2;
    const panelW = Math.min(900, width - 80);
    this.listPanelY = 250;
    this.listPanelH = Math.min(380, height - 450);
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
    this.makeButton(width * 0.32, pracY, 280, 48, 0x3498db, '연습 · 토끼', () =>
      this.go('practice', 'rabbit'),
    );
    this.makeButton(width * 0.68, pracY, 280, 48, 0xe67e22, '연습 · 여우', () =>
      this.go('practice', 'fox'),
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
    });
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

    const joinable = rooms.filter((r) => r.phase === 'lobby' && r.players < r.maxPlayers);
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
      const label = `${room.code}  ·  ${room.hostName}  ·  ${room.players}/${room.maxPlayers}명  ·  대기중`;
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

  /** Host: set catch budget, time limit, AI count, fox mode then open room. */
  private createHostRoom(): void {
    const budgetRaw = window.prompt(
      '잡기 횟수 (전체 AI+유저 공통, 1~30)',
      String(DEFAULT_CATCH_BUDGET),
    );
    if (budgetRaw == null) return;
    const timeRaw = window.prompt('제한 시간(초, 30~600)', String(DEFAULT_TIME_LIMIT_MS / 1000));
    if (timeRaw == null) return;
    const aiRaw = window.prompt('AI 토끼 수 (0~40)', String(DEFAULT_AI_COUNT));
    if (aiRaw == null) return;
    const foxRaw = window.prompt(
      '여우 선정 방식\n1 = 룰렛(랜덤 추첨)\n2 = 직접 지정(시작 시 고름)',
      '1',
    );
    if (foxRaw == null) return;
    const foxMode =
      foxRaw.trim() === '2' || /지정|designate/i.test(foxRaw) ? 'designate' : 'roulette';
    const settings = normalizeRoomSettings({
      catchBudget: Number(budgetRaw),
      timeLimitMs: Number(timeRaw) * 1000,
      aiCount: Number(aiRaw),
      foxMode,
    });
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
  ): void {
    const btn = this.add.rectangle(x, y, w, h, color).setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, label, { fontSize: '18px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5);
    btn.on('pointerdown', onClick);
  }

  private go(
    mode: MatchMode,
    practiceRole?: PracticeRole,
    peerRole?: PeerRole,
    roomCode?: string,
    roomSettings?: RoomSettings,
  ): void {
    // Ensure current nickname is saved before entering game
    this.nickname = saveNickname(this.nickname);
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
