import Phaser from 'phaser';
import {
  allAnimalAnimKeys,
  allAnimalTextureKeys,
  animalAnimKey,
  animalTextureKey,
  type Facing,
  type AnimalKind,
} from '@hide-and-seek/shared';

const FACINGS: Facing[] = ['up', 'down', 'left', 'right'];

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
    for (const key of allAnimalTextureKeys()) {
      this.load.image(key, `/assets/meadow/${key}.png`);
    }
    this.load.image('hider_rabbit', '/assets/meadow/hider_rabbit.png');
    this.load.image('seeker_fox', '/assets/meadow/seeker_fox.png');
  }

  create(): void {
    for (const key of Object.keys(this.textures.list)) {
      if (key === '__DEFAULT' || key === '__MISSING') continue;
      try {
        this.textures.get(key).setFilter(Phaser.Textures.FilterMode.NEAREST);
      } catch {
        /* ignore */
      }
    }

    this.ensureFallback('grass_tile', 64, 0x6aa84f);
    this.ensureFallback('grass_tile_b', 64, 0x74b356);
    for (const key of allAnimalTextureKeys()) {
      const isFox = key.includes('fox');
      this.ensureFallback(key, 96, isFox ? 0xe67e22 : 0xd4b896);
    }
    this.ensureFallback('hider_rabbit', 96, 0xd4b896);
    this.ensureFallback('seeker_fox', 96, 0xe67e22);
    this.ensureFallback('prop_bush', 96, 0x3d8b40);
    this.ensureFallback('prop_tree', 128, 0x2e7d32);
    this.ensureFallback('prop_rock', 80, 0x7f8c8d);
    this.ensureFallback('caught', 64, 0x95a5a6);

    // --- Phaser Animation Manager (idle + run loops) ---
    this.registerAnimalAnims();

    this.scene.start('Menu');
  }

  private registerAnimalAnims(): void {
    for (const kind of ['fox', 'rabbit'] as AnimalKind[]) {
      for (const facing of FACINGS) {
        const idleKey = animalAnimKey(kind, facing, false);
        const runKey = animalAnimKey(kind, facing, true);
        if (!this.anims.exists(idleKey)) {
          this.anims.create({
            key: idleKey,
            frames: [{ key: animalTextureKey(kind, facing, 0) }],
            frameRate: 1,
            repeat: -1,
          });
        }
        if (!this.anims.exists(runKey)) {
          this.anims.create({
            key: runKey,
            frames: [
              { key: animalTextureKey(kind, facing, 0) },
              { key: animalTextureKey(kind, facing, 1) },
              { key: animalTextureKey(kind, facing, 2) },
              { key: animalTextureKey(kind, facing, 1) },
            ],
            frameRate: 10,
            repeat: -1,
          });
        }
      }
    }
    // Structural sanity for tests / debugging
    for (const k of allAnimalAnimKeys()) {
      if (!this.anims.exists(k)) {
        console.warn('[Boot] missing anim', k);
      }
    }
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
