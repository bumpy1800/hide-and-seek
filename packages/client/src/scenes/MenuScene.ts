import Phaser from 'phaser';
import type { MatchMode, PracticeRole } from '@hide-and-seek/shared';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
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
      .text(width / 2, height * 0.12, 'MEADOW HIDE & SEEK', {
        fontSize: '38px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#2d4a1c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.26,
        '멀티: PLAY · 혼자 연습: 토끼 / 여우 선택',
        { fontSize: '16px', color: '#f5f5dc', align: 'center' },
      )
      .setOrigin(0.5);

    this.makeButton(width / 2, height * 0.42, 260, 52, 0x27ae60, 'PLAY (멀티)', () =>
      this.go('normal'),
    );
    this.makeButton(width / 2, height * 0.56, 260, 52, 0x3498db, '연습 · 토끼', () =>
      this.go('practice', 'rabbit'),
    );
    this.makeButton(width / 2, height * 0.68, 260, 52, 0xe67e22, '연습 · 여우', () =>
      this.go('practice', 'fox'),
    );

    this.add
      .text(
        width / 2,
        height * 0.84,
        '토끼: 여우 없이 이동 연습\n여우: AI 토끼를 잡는 연습',
        { fontSize: '15px', color: '#ecf0f1', align: 'center', lineSpacing: 6 },
      )
      .setOrigin(0.5);

    this.input.keyboard?.once('keydown-ENTER', () => this.go('normal'));
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
      .text(x, y, label, { fontSize: '20px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5);
    btn.on('pointerdown', onClick);
  }

  private go(mode: MatchMode, practiceRole?: PracticeRole): void {
    this.scene.start('Game', { mode, practiceRole });
  }
}
