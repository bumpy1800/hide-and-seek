import Phaser from 'phaser';
import { loadNickname, promptNickname, saveNickname } from '../net/nicknames';
import { isValidRoomCode, normalizeRoomCode } from '../net/roomCodes';
import { takePeerHandoff } from '../net/meteorHandoff';
import { MeteorPeer } from '../net/MeteorPeer';

const GAME_ID = 'meteor-dodge' as const;

/**
 * 운석 피하기 menu — per-game nickname, solo, multi host/join.
 */
export class MeteorMenuScene extends Phaser.Scene {
  private nickname = loadNickname(GAME_ID);
  private nickLabel!: Phaser.GameObjects.Text;
  private statusLabel!: Phaser.GameObjects.Text;
  private peer: MeteorPeer | null = null;
  private lobbyPlayers: Array<{ id: string; name: string }> = [];
  private roomCode = '';
  private busy = false;
  /** Prevents double scene.start (startRace onSnap + button both fire). */
  private handedOff = false;

  constructor() {
    super('MeteorMenu');
  }

  create(): void {
    this.nickname = loadNickname(GAME_ID);
    this.busy = false;
    this.handedOff = false;
    this.peer?.softDisconnect();
    this.peer = null;
    this.lobbyPlayers = [];
    this.roomCode = '';

    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#0b1026');
    this.drawStars(80);

    this.add
      .text(width / 2, 48, '운석 피하기', {
        fontSize: '40px',
        color: '#e0e7ff',
        fontStyle: 'bold',
        stroke: '#1e1b4b',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(width / 2, 96, '닷지 스타일 · 8방향 · 총알 피하기 · 생존 기록경쟁', {
        fontSize: '16px',
        color: '#94a3b8',
      })
      .setOrigin(0.5);

    this.makeButton(width / 2, 148, 220, 36, 0x334155, '← 스낵게임 홈', () => {
      this.cleanupPeer();
      this.scene.start('Hub');
    });

    this.nickLabel = this.add
      .text(width / 2 - 70, 200, this.nickLine(), {
        fontSize: '18px',
        color: '#e0e7ff',
        fontStyle: 'bold',
        backgroundColor: '#1e1b4bcc',
        padding: { x: 14, y: 10 },
      })
      .setOrigin(0.5);
    this.makeButton(width / 2 + 160, 200, 180, 42, 0x7c3aed, '닉네임 변경', () => {
      this.nickname = promptNickname(this.nickname, GAME_ID);
      this.nickLabel.setText(this.nickLine());
    });

    this.makeButton(width / 2, 280, 340, 56, 0x2563eb, '싱글 플레이', () => this.startSolo());
    this.makeButton(width / 2, 360, 340, 56, 0x059669, '멀티 방 만들기', () => {
      void this.hostMulti();
    });
    this.makeButton(width / 2, 440, 340, 56, 0x0d9488, '코드로 참가', () => {
      void this.joinMulti();
    });

    this.statusLabel = this.add
      .text(width / 2, height - 80, 'WASD / 방향키 · 전방위 총알을 최대한 오래 피하세요', {
        fontSize: '15px',
        color: '#64748b',
        align: 'center',
      })
      .setOrigin(0.5);

    this.events.once('shutdown', () => this.cleanupPeer());
  }

  private nickLine(): string {
    return `닉네임  ${this.nickname}`;
  }

  private startSolo(): void {
    this.nickname = saveNickname(this.nickname, GAME_ID);
    this.cleanupPeer();
    this.scene.start('MeteorGame', {
      mode: 'solo',
      playerName: this.nickname,
    });
  }

  private async hostMulti(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.nickname = saveNickname(this.nickname, GAME_ID);
    this.setStatus('방 만드는 중…');
    try {
      this.cleanupPeer();
      const peer = new MeteorPeer();
      this.peer = peer;
      peer.setHandlers({
        onLobby: (code, players) => {
          this.roomCode = code;
          this.lobbyPlayers = players;
          this.setStatus(
            `방 코드 ${code}\n참가자 ${players.length}명 · 시작하려면 아래 버튼`,
          );
          this.ensureStartButton();
        },
        onStatus: (s, d) => {
          if (s === 'host_ready') this.setStatus(`방 코드 ${d} · 친구 접속 대기`);
        },
        // Handoff only here for host+guest; button only starts race (no second enter)
        onSnap: (snap) => {
          if (snap.phase === 'racing' || snap.phase === 'finished') {
            this.enterMultiGame(this.peer ?? peer);
          }
        },
      });
      const code = await peer.createRoom(this.nickname);
      this.roomCode = code;
      this.setStatus(`방 코드 ${code} · 친구 접속 대기 후 레이스 시작`);
      this.ensureStartButton();
    } catch (e) {
      this.setStatus(`방 만들기 실패: ${e instanceof Error ? e.message : String(e)}`);
      this.cleanupPeer();
    } finally {
      this.busy = false;
    }
  }

  private startBtn: Phaser.GameObjects.Rectangle | null = null;

  private ensureStartButton(): void {
    if (this.startBtn) return;
    const { width } = this.scale;
    this.startBtn = this.makeButton(width / 2, 520, 300, 48, 0xf59e0b, '레이스 시작!', () => {
      if (!this.peer?.hostMode || this.handedOff) return;
      // startRace broadcasts snap → onSnap → enterMultiGame once (do not enter here)
      this.peer.startRace();
    });
  }

  private async joinMulti(): Promise<void> {
    if (this.busy) return;
    const raw = window.prompt('방 코드를 입력하세요');
    if (raw == null) return;
    const code = normalizeRoomCode(raw);
    if (!isValidRoomCode(code)) {
      window.alert('올바른 방 코드가 아닙니다.');
      return;
    }
    this.busy = true;
    this.nickname = saveNickname(this.nickname, GAME_ID);
    this.setStatus(`참가 중… ${code}`);
    try {
      this.cleanupPeer();
      const peer = new MeteorPeer();
      this.peer = peer;
      peer.setHandlers({
        onLobby: (c, players) => {
          this.roomCode = c;
          this.lobbyPlayers = players;
          this.setStatus(
            `방 ${c} 대기 중\n${players.map((p) => p.name).join(', ') || '…'}`,
          );
        },
        onSnap: (snap) => {
          if (snap.phase === 'racing' || snap.phase === 'finished') {
            this.enterMultiGame(this.peer ?? peer);
          }
        },
        onStatus: (s, d) => this.setStatus(`${s}${d ? ` ${d}` : ''}`),
      });
      await peer.joinRoom(code, this.nickname);
      this.setStatus(`방 ${code} 접속 · 호스트 시작 대기`);
    } catch (e) {
      this.setStatus(`참가 실패: ${e instanceof Error ? e.message : String(e)}`);
      this.cleanupPeer();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Transfer peer to MeteorGame exactly once.
   * startRace → onSnap and any concurrent UI must not re-enter with peer:null.
   */
  private enterMultiGame(peer: MeteorPeer | null): void {
    const { state, taken } = takePeerHandoff(
      { handedOff: this.handedOff, peer: this.peer },
      peer,
    );
    this.handedOff = state.handedOff;
    this.peer = state.peer;
    if (!taken) return;
    this.scene.start('MeteorGame', {
      mode: 'multi',
      playerName: this.nickname,
      peer: taken,
    });
  }

  private setStatus(msg: string): void {
    this.statusLabel?.setText(msg);
  }

  private cleanupPeer(): void {
    // After handoff peer is null; only disconnect if we still own it
    if (!this.handedOff) {
      this.peer?.softDisconnect();
    }
    this.peer = null;
    this.startBtn = null;
  }

  private drawStars(n: number): void {
    const { width, height } = this.scale;
    const g = this.add.graphics();
    for (let i = 0; i < n; i++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      const r = Math.random() * 1.8 + 0.4;
      g.fillStyle(0xffffff, 0.3 + Math.random() * 0.6);
      g.fillCircle(x, y, r);
    }
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
    btn.on('pointerover', () => btn.setFillStyle(color, 0.85));
    btn.on('pointerout', () => btn.setFillStyle(color, 1));
    btn.on('pointerdown', onClick);
    return btn;
  }
}
