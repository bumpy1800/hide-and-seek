import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image('grass_tile', '/assets/meadow/grass_tile.png');
    this.load.image('grass_tile_b', '/assets/meadow/grass_tile_b.png');
    this.load.image('hider_rabbit', '/assets/meadow/hider_rabbit.png');
    this.load.image('seeker_fox', '/assets/meadow/seeker_fox.png');
    this.load.image('prop_bush', '/assets/meadow/prop_bush.png');
    this.load.image('prop_tree', '/assets/meadow/prop_tree.png');
    this.load.image('prop_rock', '/assets/meadow/prop_rock.png');
  }

  create(): void {
    this.ensureFallback('grass_tile', 64, 0x6aa84f);
    this.ensureFallback('grass_tile_b', 64, 0x74b356);
    this.ensureFallback('hider_rabbit', 48, 0xd4b896);
    this.ensureFallback('seeker_fox', 52, 0xe67e22);
    this.ensureFallback('prop_bush', 72, 0x3d8b40);
    this.ensureFallback('prop_tree', 96, 0x2e7d32);
    this.ensureFallback('prop_rock', 64, 0x7f8c8d);
    this.ensureFallback('caught', 48, 0x95a5a6);
    this.scene.start('Menu');
  }

  private ensureFallback(key: string, size: number, color: number): void {
    if (this.textures.exists(key)) return;
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(color, 1);
    g.fillCircle(size / 2, size / 2, size / 2 - 2);
    g.generateTexture(key, size, size);
    g.destroy();
  }
}
