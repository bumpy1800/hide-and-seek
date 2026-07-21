import Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#5d8a3e');
    // soft grass backdrop using tile if loaded
    if (this.textures.exists('grass_tile')) {
      for (let y = 0; y < height; y += 64) {
        for (let x = 0; x < width; x += 64) {
          this.add.image(x + 32, y + 32, 'grass_tile').setDisplaySize(64, 64).setAlpha(0.85);
        }
      }
    }

    this.add
      .text(width / 2, height * 0.2, 'MEADOW HIDE & SEEK', {
        fontSize: '42px',
        color: '#fff8e7',
        fontStyle: 'bold',
        stroke: '#2d4a1c',
        strokeThickness: 6,
      })
      .setOrigin(0.5);

    this.add
      .text(
        width / 2,
        height * 0.38,
        '토끼들 사이에 섞이세요.\n여우 술래가 어색한 움직임을 찾아냅니다!\n넓은 초원 맵 · 카메라가 당신을 따라갑니다.',
        { fontSize: '18px', color: '#f5f5dc', align: 'center', lineSpacing: 8 },
      )
      .setOrigin(0.5);

    const btn = this.add
      .rectangle(width / 2, height * 0.72, 220, 56, 0x27ae60)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(width / 2, height * 0.72, 'PLAY', {
        fontSize: '24px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const go = () => this.scene.start('Game');
    btn.on('pointerdown', go);
    this.input.keyboard?.once('keydown-ENTER', go);
    this.input.keyboard?.once('keydown-SPACE', go);
  }
}
