import Phaser from 'phaser';
import { allAnimalTextureKeys } from '@hide-and-seek/shared';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  preload(): void {
    this.load.image('grass_tile', '/assets/meadow/grass_tile.png');
    this.load.image('grass_tile_b', '/assets/meadow/grass_tile_b.png');
    this.load.image('prop_bush', '/assets/meadow/prop_bush.png');
    this.load.image('prop_tree', '/assets/meadow/prop_tree.png');
    this.load.image('prop_rock', '/assets/meadow/prop_rock.png');
    // True 4-direction animal art (separate PNGs, not rotate)
    for (const key of allAnimalTextureKeys()) {
      this.load.image(key, `/assets/meadow/${key}.png`);
    }
    // legacy aliases
    this.load.image('hider_rabbit', '/assets/meadow/hider_rabbit.png');
    this.load.image('seeker_fox', '/assets/meadow/seeker_fox.png');
  }

  create(): void {
    // Linear filter + higher-res assets → smoother scale on high-DPI
    for (const key of Object.keys(this.textures.list)) {
      if (key === '__DEFAULT' || key === '__MISSING') continue;
      try {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.LINEAR);
      } catch {
        /* ignore */
      }
    }

    this.ensureFallback('grass_tile', 128, 0x6aa84f);
    this.ensureFallback('grass_tile_b', 128, 0x74b356);
    for (const key of allAnimalTextureKeys()) {
      const isFox = key.includes('fox');
      this.ensureFallback(key, 128, isFox ? 0xe67e22 : 0xd4b896);
    }
    this.ensureFallback('hider_rabbit', 128, 0xd4b896);
    this.ensureFallback('seeker_fox', 128, 0xe67e22);
    this.ensureFallback('prop_bush', 128, 0x3d8b40);
    this.ensureFallback('prop_tree', 160, 0x2e7d32);
    this.ensureFallback('prop_rock', 112, 0x7f8c8d);
    this.ensureFallback('caught', 96, 0x95a5a6);
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
