import Phaser from 'phaser';
import {
  DEFAULT_MEADOW_SEED,
  ENTITY_COLLIDE_RADIUS,
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_SIZE,
  getSolidObstacles,
  listMeadowDecor,
  type DecorSpec,
  type SolidObstacle,
} from '@hide-and-seek/shared';

export type MeadowWorld = {
  seed: number;
  map: Phaser.Tilemaps.Tilemap;
  groundLayer: Phaser.Tilemaps.TilemapLayer;
  decor: Phaser.GameObjects.Image[];
  specs: DecorSpec[];
  /** Arcade static bodies for tree/rock (radii match shared `getSolidObstacles`). */
  solidGroup: Phaser.Physics.Arcade.StaticGroup;
  solids: SolidObstacle[];
  border: Phaser.GameObjects.Rectangle;
};

/**
 * Phaser Tilemap ground + decor props + Arcade static solids.
 * Seed must match `MatchState.meadowSeed` so multiplayer collision equals visuals.
 */
export function buildMeadowWorld(
  scene: Phaser.Scene,
  seed = DEFAULT_MEADOW_SEED,
): MeadowWorld {
  const cols = Math.ceil(MAP_WIDTH / TILE_SIZE);
  const rows = Math.ceil(MAP_HEIGHT / TILE_SIZE);
  const s = seed >>> 0;

  // --- Phaser Tilemap (not a manual image grid) ---
  const map = scene.make.tilemap({
    tileWidth: TILE_SIZE,
    tileHeight: TILE_SIZE,
    width: cols,
    height: rows,
  });

  // firstgid: 0 = grass_a, 1 = grass_b
  const tilesetA = map.addTilesetImage(
    'grass_a',
    'grass_tile',
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    0,
  );
  const tilesetB = map.addTilesetImage(
    'grass_b',
    'grass_tile_b',
    TILE_SIZE,
    TILE_SIZE,
    0,
    0,
    1,
  );
  if (!tilesetA || !tilesetB) {
    throw new Error('MeadowMap: grass tilesets failed to load');
  }

  const groundLayer = map.createBlankLayer('ground', [tilesetA, tilesetB], 0, 0, cols, rows);
  if (!groundLayer) {
    throw new Error('MeadowMap: ground layer failed');
  }
  groundLayer.setDepth(0);
  groundLayer.setScrollFactor(1);

  // Seeded grass pattern (varies each match)
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      const h = (Math.imul(tx + 1, 374761393) ^ Math.imul(ty + 1, 668265263) ^ s) >>> 0;
      const useB = h % 3 === 0;
      groundLayer.putTileAt(useB ? 1 : 0, tx, ty);
    }
  }

  // World bounds for Arcade physics
  scene.physics.world.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

  const border = scene.add
    .rectangle(MAP_WIDTH / 2, MAP_HEIGHT / 2, MAP_WIDTH - 4, MAP_HEIGHT - 4)
    .setStrokeStyle(6, 0x3d5c2e, 0.55)
    .setFillStyle(0x000000, 0)
    .setDepth(1);

  // --- Decor images (visual only; bushes are non-solid cover) ---
  const decor: Phaser.GameObjects.Image[] = [];
  const specs = listMeadowDecor(s);
  for (const spec of specs) {
    const tex =
      spec.kind === 'bush' ? 'prop_bush' : spec.kind === 'tree' ? 'prop_tree' : 'prop_rock';
    const base = spec.kind === 'tree' ? 0.85 : spec.kind === 'bush' ? 0.75 : 0.7;
    const img = scene.add
      .image(spec.x, spec.y, tex)
      .setOrigin(0.5, 0.7)
      .setDepth(10 + spec.y * 0.01)
      .setScale(base * spec.scale);
    decor.push(img);
  }

  // --- Arcade StaticGroup solids (tree/rock circles) ---
  const solidGroup = scene.physics.add.staticGroup();
  const solids = getSolidObstacles(s);
  for (const o of solids) {
    // Invisible zone — visual is the decor image above
    const hit = scene.add.zone(o.x, o.y, o.radius * 2, o.radius * 2);
    hit.setOrigin(0.5, 0.5);
    scene.physics.add.existing(hit, true);
    const body = hit.body as Phaser.Physics.Arcade.StaticBody;
    body.setCircle(o.radius);
    body.updateFromGameObject();
    solidGroup.add(hit);
  }

  void ENTITY_COLLIDE_RADIUS;

  return { seed: s, map, groundLayer, decor, specs, solidGroup, solids, border };
}

/** Tear down a previous meadow so a new seed can rebuild cleanly. */
export function destroyMeadowWorld(world: MeadowWorld | null | undefined): void {
  if (!world) return;
  for (const img of world.decor) {
    img.destroy();
  }
  world.solidGroup.clear(true, true);
  world.solidGroup.destroy(true);
  world.groundLayer.destroy();
  world.map.destroy();
  world.border.destroy();
}
