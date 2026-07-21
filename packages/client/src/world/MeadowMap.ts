import Phaser from 'phaser';
import { MAP_HEIGHT, MAP_WIDTH, TILE_SIZE, generateMeadowDecor } from '@hide-and-seek/shared';

/**
 * Build grassland tile ground + animal/meadow decorative props across the expanded arena.
 */
export function buildMeadowWorld(scene: Phaser.Scene, seed = 7): {
  groundLayer: Phaser.GameObjects.Group;
  decor: Phaser.GameObjects.Image[];
} {
  const groundLayer = scene.add.group();
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
  const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);

  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const key = (tx + ty) % 3 === 0 ? 'grass_tile_b' : 'grass_tile';
      const tile = scene.add
        .image(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, key)
        .setDepth(0)
        .setDisplaySize(TILE_SIZE, TILE_SIZE);
      groundLayer.add(tile);
    }
  }

  const border = scene.add
    .rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH - 4, MAP_HEIGHT - 4)
    .setStrokeStyle(6, 0x3d5c2e, 0.55)
    .setFillStyle(0x000000, 0)
    .setDepth(1);
  groundLayer.add(border);

  const decor: Phaser.GameObjects.Image[] = [];
  const specs = generateMeadowDecor(seed, 48);
  // cover thickets (extra bushes/trees)
  const thickets = generateMeadowDecor(seed + 99, 24).map((s) => ({
    ...s,
    kind: s.kind === 'rock' ? ('bush' as const) : s.kind,
  }));

  for (const s of [...specs, ...thickets]) {
    const tex =
      s.kind === 'bush' ? 'prop_bush' : s.kind === 'tree' ? 'prop_tree' : 'prop_rock';
    const img = scene.add
      .image(s.x, s.y, tex)
      .setDepth(s.kind === 'tree' ? 5 : 4)
      .setScale(s.scale);
    decor.push(img);
  }

  return { groundLayer, decor };
}
