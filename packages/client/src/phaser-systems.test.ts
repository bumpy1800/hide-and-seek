import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Structural checks: Phaser systems are wired in source (tilemap / anims / arcade).
 * Runtime Phaser needs a browser; these assert the shipped integration path exists.
 */
describe('Phaser system integration (structural)', () => {
  const root = resolve(__dirname);

  it('MeadowMap uses Tilemap + Arcade static solids + seed', () => {
    const src = readFileSync(resolve(root, 'world/MeadowMap.ts'), 'utf8');
    expect(src).toMatch(/make\.tilemap/);
    expect(src).toMatch(/createBlankLayer|createLayer/);
    expect(src).toMatch(/addTilesetImage/);
    expect(src).toMatch(/putTileAt/);
    expect(src).toMatch(/physics\.add\.staticGroup|physics\.add\.existing/);
    expect(src).toMatch(/setCircle/);
    expect(src).toMatch(/getSolidObstacles/);
    expect(src).toMatch(/listMeadowDecor/);
    expect(src).toMatch(/physics\.world\.setBounds/);
    expect(src).toMatch(/destroyMeadowWorld/);
  });

  it('GameScene rebuilds meadow from match meadowSeed', () => {
    const src = readFileSync(resolve(root, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/ensureMeadowForSeed|meadowSeed/);
    expect(src).toMatch(/buildMeadowWorld/);
  });

  it('BootScene registers Phaser Animation Manager clips', () => {
    const src = readFileSync(resolve(root, 'scenes/BootScene.ts'), 'utf8');
    expect(src).toMatch(/anims\.create/);
    expect(src).toMatch(/animalAnimKey/);
    expect(src).toMatch(/frameRate/);
    expect(src).toMatch(/repeat:\s*-1/);
  });

  it('GameScene uses Arcade physics sprites + play(anim)', () => {
    const src = readFileSync(resolve(root, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/physics\.add\.sprite/);
    expect(src).toMatch(/physics\.add\.group/);
    // Prop solids are visual cover only — no entity↔solid collider (sticky rollback)
    expect(src).toMatch(/setVelocity/);
    expect(src).toMatch(/\.play\(/);
    expect(src).toMatch(/animalAnimKey|animKeyFor/);
  });

  it('starting sequence: overlay above HUD and fox visuals deferred until reveal', () => {
    const src = readFileSync(resolve(root, 'scenes/GameScene.ts'), 'utf8');
    // Overlay must sit above HUD depths (~1999–2001)
    expect(src).toMatch(/startOverlay[\s\S]{0,200}setDepth\(3\d{3}\)/);
    expect(src).toMatch(/visualSeekerId|isFoxRevealed/);
    expect(src).toMatch(/startSequenceStage/);
    // Roulette stage must not paint role 여우 from seekerId
    expect(src).toMatch(/여우 추첨/);
  });

  it('config enables Arcade physics default', () => {
    const src = readFileSync(resolve(root, 'config.ts'), 'utf8');
    expect(src).toMatch(/physics:\s*\{/);
    expect(src).toMatch(/default:\s*['"]arcade['"]/);
  });
});
