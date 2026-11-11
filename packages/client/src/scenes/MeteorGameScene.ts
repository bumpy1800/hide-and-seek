import Phaser from 'phaser';
import {
  createMeteorRun,
  formatSurvivalMs,
  multiViewGrid,
  rankBySurvival,
  setShipIntent,
  stepMeteorRun,
  type MeteorRunState,
} from '@hide-and-seek/shared';
import type { MeteorPeer, MeteorSnap } from '../net/MeteorPeer';
import { saveNickname } from '../net/nicknames';

export type MeteorGameData = {
  mode: 'solo' | 'multi';
  playerName?: string;
  peer?: MeteorPeer;
};

/**
 * Solo: full-field dodge. Multi: grid of each player's view, local pane emphasized,
 * survival-time race.
 */
export class MeteorGameScene extends Phaser.Scene {
  private mode: 'solo' | 'multi' = 'solo';
  private playerName = '손님';
  private peer: MeteorPeer | null = null;
  private solo: MeteorRunState | null = null;
  private snap: MeteorSnap | null = null;
  private keys!: {
    w: Phaser.Input.Keyboard.Key;
    a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key;
    d: Phaser.Input.Keyboard.Key;
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Text;
  private overlay!: Phaser.GameObjects.Text;
  private ended = false;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private enterKey!: Phaser.Input.Keyboard.Key;
  private restartBtn: Phaser.GameObjects.Rectangle | null = null;
  private restartBtnLabel: Phaser.GameObjects.Text | null = null;
  private lastScoreMs = 0;
  private multiGameOverShown = false;
  /** Sprite pools for Imagine ship/meteor textures (reused each frame). */
  private shipPool: Phaser.GameObjects.Image[] = [];
  private meteorPool: Phaser.GameObjects.Image[] = [];
  private shipPoolUsed = 0;
  private meteorPoolUsed = 0;
  private useSpriteAssets = false;

  constructor() {
    super('MeteorGame');
  }

  init(data: MeteorGameData): void {
    this.mode = data.mode === 'multi' ? 'multi' : 'solo';
    this.playerName = (data.playerName ?? '손님').trim() || '손님';
    this.peer = data.peer ?? null;
    this.solo = null;
    this.snap = null;
    this.ended = false;
    this.multiGameOverShown = false;
    this.lastScoreMs = 0;
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#050814');
    this.gfx = this.add.graphics();
    this.shipPool = [];
    this.meteorPool = [];
    this.shipPoolUsed = 0;
    this.meteorPoolUsed = 0;
    this.useSpriteAssets =
      this.textures.exists('dodge_ship') && this.textures.exists('dodge_meteor');
    const { width, height } = this.scale;

    this.hud = this.add
      .text(16, 12, '', {
        fontSize: '20px',
        color: '#e0e7ff',
        fontStyle: 'bold',
        stroke: '#000',
        strokeThickness: 3,
      })
      .setScrollFactor(0)
      .setDepth(100);

    this.overlay = this.add
      .text(width / 2, height / 2 - 40, '', {
        fontSize: '28px',
        color: '#fef3c7',
        fontStyle: 'bold',
        align: 'center',
        stroke: '#000',
        strokeThickness: 4,
        backgroundColor: '#0f172acc',
        padding: { x: 20, y: 16 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);

    const kb = this.input.keyboard;
    if (!kb) throw new Error('keyboard required');
    this.keys = {
      w: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
    };
    this.restartKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.spaceKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.enterKey = kb.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);

    this.makeButton(width - 90, 28, 150, 36, 0x475569, '메뉴', () => this.leave());

    if (this.mode === 'solo') {
      this.beginSoloRun();
      saveNickname(this.playerName, 'meteor-dodge');
    } else if (this.peer) {
      this.peer.setHandlers({
        onSnap: (s) => {
          this.snap = s;
          if (s.phase === 'finished') {
            this.ended = true;
          } else if (s.phase === 'racing') {
            // Host restarted race — clear game-over UI for everyone
            this.ended = false;
            this.multiGameOverShown = false;
            this.hideRestartUi();
            this.overlay.setVisible(false);
          }
        },
      });
      this.snap = this.peer.currentSnap;
      // If host hasn't raced yet, start now (defensive)
      if (this.peer.hostMode && (!this.snap || this.snap.phase === 'lobby')) {
        this.peer.startRace();
        this.snap = this.peer.currentSnap;
      }
    }

    this.events.once('shutdown', () => {
      this.peer?.softDisconnect();
      this.peer = null;
    });
  }

  update(_t: number, dt: number): void {
    // In-place restart on game over (no menu hop)
    if (this.ended && this.wantsRestart()) {
      this.restartInPlace();
      return;
    }

    const intent = this.readIntent();
    if (this.mode === 'solo' && this.solo) {
      if (this.solo.ship.alive) {
        this.solo = setShipIntent(this.solo, intent.dx, intent.dy);
        this.solo = stepMeteorRun(this.solo, Math.min(dt, 50));
      } else if (!this.ended) {
        this.ended = true;
        this.lastScoreMs = this.solo.ship.survivalMs;
        this.showSoloGameOver();
      }
      this.drawSolo();
      this.hud.setText(
        `닷지  ${formatSurvivalMs(this.solo.ship.survivalMs)}  ·  ${this.playerName}  ·  총알 ${this.solo.meteors.length}`,
      );
      return;
    }

    // Multi
    if (!this.ended) {
      this.peer?.sendIntent(intent.dx, intent.dy);
    }
    if (this.snap) this.drawMulti(this.snap);
    else {
      this.gfx.clear();
      this.hud.setText('멀티 동기화 중…');
    }
    if (this.ended && this.snap && !this.multiGameOverShown) {
      this.showMultiGameOver(this.snap);
      this.multiGameOverShown = true;
    }
  }

  private wantsRestart(): boolean {
    return (
      Phaser.Input.Keyboard.JustDown(this.restartKey) ||
      Phaser.Input.Keyboard.JustDown(this.spaceKey) ||
      Phaser.Input.Keyboard.JustDown(this.enterKey)
    );
  }

  /** Fresh solo run without leaving the scene. */
  private beginSoloRun(): void {
    this.solo = createMeteorRun({ seed: (Date.now() >>> 0) || 1 });
    this.ended = false;
    this.lastScoreMs = 0;
    this.overlay.setVisible(false);
    this.hideRestartUi();
  }

  private restartInPlace(): void {
    if (this.mode === 'solo') {
      this.beginSoloRun();
      return;
    }
    // Multi: only host can restart the shared race
    if (this.peer?.hostMode) {
      this.peer.startRace();
      this.ended = false;
      this.multiGameOverShown = false;
      this.overlay.setVisible(false);
      this.hideRestartUi();
      this.snap = this.peer.currentSnap;
    }
  }

  private readIntent(): { dx: number; dy: number } {
    let dx = 0;
    let dy = 0;
    if (this.keys.a.isDown || this.keys.left.isDown) dx -= 1;
    if (this.keys.d.isDown || this.keys.right.isDown) dx += 1;
    if (this.keys.w.isDown || this.keys.up.isDown) dy -= 1;
    if (this.keys.s.isDown || this.keys.down.isDown) dy += 1;
    return { dx, dy };
  }

  private drawSolo(): void {
    const s = this.solo!;
    const { width, height } = this.scale;
    const pad = 40;
    const scale = Math.min(
      (width - pad * 2) / s.config.width,
      (height - pad * 2) / s.config.height,
    );
    const ox = (width - s.config.width * scale) / 2;
    const oy = (height - s.config.height * scale) / 2 + 10;
    this.beginSpriteFrame();
    this.gfx.clear();
    this.drawStarField(ox, oy, s.config.width * scale, s.config.height * scale, 0);
    // Field border
    this.gfx.lineStyle(2, 0x6366f1, 0.8);
    this.gfx.strokeRect(ox, oy, s.config.width * scale, s.config.height * scale);
    this.drawWorld(
      this.gfx,
      ox,
      oy,
      scale,
      s.ship.x,
      s.ship.y,
      s.ship.radius,
      s.ship.alive,
      s.meteors,
      true,
    );
    this.endSpriteFrame();
  }

  private drawMulti(snap: MeteorSnap): void {
    const { width, height } = this.scale;
    const n = snap.players.length;
    const localIdx = Math.max(
      0,
      snap.players.findIndex((p) => p.id === snap.localId),
    );
    const cells = multiViewGrid(n, width, height - 48, localIdx, 10, 12);
    this.beginSpriteFrame();
    this.gfx.clear();

    const ranks = rankBySurvival(
      snap.players.map((p) => ({
        id: p.id,
        name: p.name,
        survivalMs: p.ship.survivalMs,
        alive: p.ship.alive,
      })),
    );
    const rankLine = ranks
      .map((r, i) => `${i + 1}. ${r.name} ${formatSurvivalMs(r.survivalMs)}`)
      .join('   ');
    this.hud.setText(`기록경쟁  ·  ${rankLine}`);

    for (let i = 0; i < snap.players.length; i++) {
      const p = snap.players[i]!;
      const cell = cells[i]!;
      const cfgW = p.config.width;
      const cfgH = p.config.height;
      const scale = Math.min(cell.w / cfgW, cell.h / cfgH) * (cell.isLocal ? 0.98 : 0.92);
      const ox = cell.x + (cell.w - cfgW * scale) / 2;
      const oy = cell.y + (cell.h - cfgH * scale) / 2;

      // Cell background + emphasis border
      this.gfx.fillStyle(0x0f172a, cell.isLocal ? 0.95 : 0.75);
      this.gfx.fillRect(cell.x, cell.y, cell.w, cell.h);
      if (cell.isLocal) {
        this.gfx.lineStyle(5, 0xfbbf24, 1);
      } else {
        this.gfx.lineStyle(2, 0x475569, 0.7);
      }
      this.gfx.strokeRect(cell.x + 1, cell.y + 1, cell.w - 2, cell.h - 2);

      this.drawStarField(ox, oy, cfgW * scale, cfgH * scale, i * 17);
      this.drawWorld(
        this.gfx,
        ox,
        oy,
        scale,
        p.ship.x,
        p.ship.y,
        p.ship.radius,
        p.ship.alive,
        p.meteors,
        cell.isLocal,
      );

      // Name + time label
      const label = cell.isLocal
        ? `★ ${p.name} (나)  ${formatSurvivalMs(p.ship.survivalMs)}`
        : `${p.name}  ${formatSurvivalMs(p.ship.survivalMs)}`;
      // Use ephemeral text via graphics only is hard — stack small texts each frame would leak.
      // We redraw labels with a reusable map:
      this.ensureLabel(i, cell.x + 8, cell.y + 6, label, cell.isLocal);
    }
    // Hide unused labels
    for (let i = snap.players.length; i < 8; i++) {
      this.labels[i]?.setVisible(false);
    }
    this.endSpriteFrame();
  }

  private labels: Phaser.GameObjects.Text[] = [];

  private ensureLabel(
    i: number,
    x: number,
    y: number,
    text: string,
    local: boolean,
  ): void {
    let t = this.labels[i];
    if (!t) {
      t = this.add
        .text(x, y, text, {
          fontSize: local ? '16px' : '14px',
          color: local ? '#fde68a' : '#cbd5e1',
          fontStyle: 'bold',
          stroke: '#000',
          strokeThickness: 3,
        })
        .setDepth(50);
      this.labels[i] = t;
    }
    t.setPosition(x, y)
      .setText(text)
      .setColor(local ? '#fde68a' : '#cbd5e1')
      .setFontSize(local ? '16px' : '14px')
      .setVisible(true);
  }

  private drawStarField(
    ox: number,
    oy: number,
    w: number,
    h: number,
    salt: number,
  ): void {
    this.gfx.fillStyle(0x050814, 1);
    this.gfx.fillRect(ox, oy, w, h);
    // Deterministic pseudo-stars from salt
    let s = (salt * 1103515245 + 12345) >>> 0;
    for (let i = 0; i < 28; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      const x = ox + ((s % 1000) / 1000) * w;
      s = (s * 1103515245 + 12345) >>> 0;
      const y = oy + ((s % 1000) / 1000) * h;
      this.gfx.fillStyle(0xffffff, 0.25 + (s % 50) / 100);
      this.gfx.fillCircle(x, y, 1 + (s % 2));
    }
  }

  private beginSpriteFrame(): void {
    this.shipPoolUsed = 0;
    this.meteorPoolUsed = 0;
  }

  private endSpriteFrame(): void {
    for (let i = this.shipPoolUsed; i < this.shipPool.length; i++) {
      this.shipPool[i]!.setVisible(false);
    }
    for (let i = this.meteorPoolUsed; i < this.meteorPool.length; i++) {
      this.meteorPool[i]!.setVisible(false);
    }
  }

  private blitShip(
    x: number,
    y: number,
    displayPx: number,
    alive: boolean,
    emphasize: boolean,
  ): void {
    let img = this.shipPool[this.shipPoolUsed];
    if (!img) {
      img = this.add.image(0, 0, 'dodge_ship').setDepth(30);
      this.shipPool.push(img);
    }
    this.shipPoolUsed += 1;
    img
      .setTexture('dodge_ship')
      .setPosition(x, y)
      .setDisplaySize(displayPx, displayPx)
      .setAlpha(alive ? 1 : 0.45)
      .setTint(alive ? (emphasize ? 0xffffff : 0xc7d2fe) : 0xef4444)
      .setVisible(true);
    if (emphasize && alive) {
      img.setDepth(35);
    } else {
      img.setDepth(30);
    }
  }

  private blitMeteor(x: number, y: number, displayPx: number): void {
    let img = this.meteorPool[this.meteorPoolUsed];
    if (!img) {
      img = this.add.image(0, 0, 'dodge_meteor').setDepth(25);
      this.meteorPool.push(img);
    }
    this.meteorPoolUsed += 1;
    img
      .setTexture('dodge_meteor')
      .setPosition(x, y)
      .setDisplaySize(displayPx, displayPx)
      .setAlpha(1)
      .clearTint()
      .setVisible(true);
  }

  private drawWorld(
    g: Phaser.GameObjects.Graphics,
    ox: number,
    oy: number,
    scale: number,
    shipX: number,
    shipY: number,
    shipR: number,
    alive: boolean,
    meteors: Array<{ x: number; y: number; radius: number }>,
    emphasizeShip: boolean,
  ): void {
    const sx = ox + shipX * scale;
    const sy = oy + shipY * scale;
    const r = Math.max(3.5, shipR * scale);

    if (this.useSpriteAssets) {
      // Meteor sprites — slightly larger than collision radius so rocks read clearly
      for (const m of meteors) {
        const bx = ox + m.x * scale;
        const by = oy + m.y * scale;
        const br = Math.max(6, m.radius * scale * 3.2);
        this.blitMeteor(bx, by, br * 2);
      }
      // Ship sprite
      const shipPx = Math.max(18, r * 4.2);
      this.blitShip(sx, sy, shipPx, alive, emphasizeShip);
      if (emphasizeShip && alive) {
        g.lineStyle(2, 0xfbbf24, 0.85);
        g.strokeCircle(sx, sy, shipPx * 0.42);
      }
      return;
    }

    // Fallback vector draw if textures missing
    for (const m of meteors) {
      const bx = ox + m.x * scale;
      const by = oy + m.y * scale;
      const br = Math.max(1.5, m.radius * scale);
      g.fillStyle(0xfbbf24, 0.35);
      g.fillCircle(bx, by, br * 1.8);
      g.fillStyle(0xfef08a, 1);
      g.fillCircle(bx, by, br);
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(bx - br * 0.2, by - br * 0.2, Math.max(0.8, br * 0.35));
    }
    if (alive) {
      g.fillStyle(emphasizeShip ? 0x38bdf8 : 0x22d3ee, 1);
      g.fillCircle(sx, sy, r);
      g.fillStyle(0xe0f2fe, 1);
      g.fillTriangle(sx, sy - r * 1.35, sx - r * 0.55, sy, sx + r * 0.55, sy);
      if (emphasizeShip) {
        g.lineStyle(2, 0xfbbf24, 1);
        g.strokeCircle(sx, sy, r + 1);
      }
    } else {
      g.fillStyle(0xef4444, 0.9);
      g.fillCircle(sx, sy, r * 1.2);
    }
  }

  private showSoloGameOver(): void {
    const s = this.solo!;
    this.overlay
      .setText(
        `피격!\n생존 기록 ${formatSurvivalMs(s.ship.survivalMs)}\n\nR / Space / Enter · 바로 다시 시작`,
      )
      .setVisible(true);
    this.showRestartButton('다시 시작', () => this.restartInPlace());
  }

  private showMultiGameOver(snap: MeteorSnap): void {
    const ranks = rankBySurvival(
      snap.players.map((p) => ({
        id: p.id,
        name: p.name,
        survivalMs: p.ship.survivalMs,
      })),
    );
    const lines = ranks.map(
      (r, i) => `${i + 1}위  ${r.name}  ${formatSurvivalMs(r.survivalMs)}`,
    );
    const canHostRestart = !!this.peer?.hostMode;
    const hint = canHostRestart
      ? '\n\nR / Space / Enter · 바로 다시 시작'
      : '\n\n호스트가 다시 시작하면 이어집니다';
    this.overlay.setText(`레이스 종료\n\n${lines.join('\n')}${hint}`).setVisible(true);
    if (canHostRestart) {
      this.showRestartButton('다시 시작', () => this.restartInPlace());
    }
  }

  private showRestartButton(label: string, onClick: () => void): void {
    this.hideRestartUi();
    const { width, height } = this.scale;
    const x = width / 2;
    const y = height / 2 + 120;
    const btn = this.add
      .rectangle(x, y, 260, 52, 0x2563eb)
      .setScrollFactor(0)
      .setDepth(210)
      .setInteractive({ useHandCursor: true });
    const text = this.add
      .text(x, y, label, { fontSize: '22px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(211);
    btn.on('pointerover', () => btn.setFillStyle(0x3b82f6));
    btn.on('pointerout', () => btn.setFillStyle(0x2563eb));
    btn.on('pointerdown', onClick);
    this.restartBtn = btn;
    this.restartBtnLabel = text;
  }

  private hideRestartUi(): void {
    this.restartBtn?.destroy();
    this.restartBtnLabel?.destroy();
    this.restartBtn = null;
    this.restartBtnLabel = null;
  }

  private leave(): void {
    this.peer?.softDisconnect();
    this.peer = null;
    this.scene.start('MeteorMenu');
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
    const btn = this.add
      .rectangle(x, y, w, h, color)
      .setScrollFactor(0)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, label, { fontSize: '16px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(101);
    btn.on('pointerdown', onClick);
  }
}
