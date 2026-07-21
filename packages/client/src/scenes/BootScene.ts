import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    // Generated textures: identical hider body, distinct seeker
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0x5dade2, 1);
    g.fillCircle(16, 16, 16);
    g.fillStyle(0x2e86c1, 1);
    g.fillCircle(16, 12, 6);
    g.generateTexture('hider', 32, 32);
    g.clear();

    g.fillStyle(0xe74c3c, 1);
    g.fillCircle(16, 16, 16);
    g.fillStyle(0xf9e79f, 1);
    g.fillCircle(16, 12, 6);
    g.generateTexture('seeker', 32, 32);
    g.clear();

    g.fillStyle(0x7f8c8d, 1);
    g.fillCircle(16, 16, 16);
    g.generateTexture('caught', 32, 32);
    g.destroy();

    this.scene.start('Menu');
  }
}
