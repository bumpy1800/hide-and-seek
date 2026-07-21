import Phaser from 'phaser';
import type { MatchMode } from '@hide-and-seek/shared';

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
      .text(width / 2, height * 0.16, 'MEADOW HIDE & SEEK', {
        fontSize: '40px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#2d4a1c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.32,
        '토끼들 사이에 섞이세요.\n여우 술래는 10초 준비 후 사냥을 시작합니다.\n연습 모드로 AI 움직임만 익힐 수 있습니다.',
        { fontSize: '17px', color: '#f5f5dc', align: 'center', lineSpacing: 8 },
      )
      .setOrigin(0.5);

    this.makeButton(width / 2, height * 0.58, 240, 54, 0x27ae60, 'PLAY', () =>
      this.go('normal'),
    );
    this.makeButton(width / 2, height * 0.72, 240, 54, 0x2980b9, '연습 모드', () =>
      this.go('practice'),
    );

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
      .text(x, y, label, { fontSize: '22px', color: '#fff', fontStyle: 'bold' })
      .setOrigin(0.5);
    btn.on('pointerdown', onClick);
  }

  private go(mode: MatchMode): void {
    this.scene.start('Game', { mode });
  }
}
