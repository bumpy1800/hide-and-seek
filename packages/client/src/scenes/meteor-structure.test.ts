import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('운석 피하기 hub + multi structure', () => {
  it('hub enables meteor-dodge and starts MeteorMenu', () => {
    const hub = readFileSync(resolve(__dirname, 'HubScene.ts'), 'utf8');
    const cfg = readFileSync(resolve(__dirname, '../config.ts'), 'utf8');
    expect(hub).toMatch(/id:\s*['"]meteor-dodge['"]/);
    expect(hub).toMatch(/운석 피하기/);
    expect(hub).toMatch(/enabled:\s*true/);
    expect(hub).toMatch(/sceneKey:\s*['"]MeteorMenu['"]/);
    expect(cfg).toMatch(/MeteorMenuScene/);
    expect(cfg).toMatch(/MeteorGameScene/);
  });

  it('multi path: grid layout, local emphasis, survival ranking', () => {
    const game = readFileSync(resolve(__dirname, 'MeteorGameScene.ts'), 'utf8');
    const peer = readFileSync(resolve(__dirname, '../net/MeteorPeer.ts'), 'utf8');
    expect(game).toMatch(/multiViewGrid/);
    expect(game).toMatch(/isLocal/);
    expect(game).toMatch(/rankBySurvival/);
    expect(game).toMatch(/fbbf24|★|나/);
    expect(game).toMatch(/mode === 'solo'|mode: 'solo'/);
    expect(peer).toMatch(/startRace|survivalMs/);
    expect(peer).toMatch(/independent|createMeteorRun|stepMeteorRun/);
  });

  it('hazards render as small bullets (닷지 feel) not large rocks', () => {
    const game = readFileSync(resolve(__dirname, 'MeteorGameScene.ts'), 'utf8');
    const shared = readFileSync(
      resolve(__dirname, '../../../shared/src/meteorSurvival.ts'),
      'utf8',
    );
    // Client: bright bullet core + glow draw path
    expect(game).toMatch(/fef08a|fbbf24/);
    expect(game).toMatch(/닷지|피격/);
    // Sim: bullet-scale radii + time ramp on step path
    expect(shared).toMatch(/difficultyAt/);
    expect(shared).toMatch(/meteorMaxRadius:\s*4\.5|meteorMaxRadius:\s*[1-5]/);
    expect(shared).toMatch(/minSpawnIntervalMs/);
    expect(shared).toMatch(/difficultyAt\(next\.ship\.survivalMs/);
  });

  it('menu is per-game nickname + solo + multi entry', () => {
    const menu = readFileSync(resolve(__dirname, 'MeteorMenuScene.ts'), 'utf8');
    expect(menu).toMatch(/GAME_ID\s*=\s*['"]meteor-dodge['"]/);
    expect(menu).toMatch(/닉네임 변경/);
    expect(menu).toMatch(/싱글 플레이/);
    expect(menu).toMatch(/멀티 방 만들기/);
  });

  it('host race handoff enters MeteorGame once (no peer:null double start)', () => {
    const menu = readFileSync(resolve(__dirname, 'MeteorMenuScene.ts'), 'utf8');
    // Shipped path uses pure takePeerHandoff (once-only)
    expect(menu).toMatch(/takePeerHandoff/);
    // Start button must only startRace — not enterMultiGame after it
    const startBtnBody = menu.slice(
      menu.indexOf('레이스 시작'),
      menu.indexOf('private async joinMulti'),
    );
    expect(startBtnBody).toMatch(/startRace\s*\(/);
    expect(startBtnBody).not.toMatch(/enterMultiGame\s*\(/);
    // Handoff path is onSnap only
    expect(menu).toMatch(/onSnap:[\s\S]*enterMultiGame/);
  });

  it('loads Imagine dodge ship/meteor sprites in Boot and draws them in game', () => {
    const boot = readFileSync(resolve(__dirname, 'BootScene.ts'), 'utf8');
    const game = readFileSync(resolve(__dirname, 'MeteorGameScene.ts'), 'utf8');
    expect(boot).toMatch(/dodge_ship/);
    expect(boot).toMatch(/dodge_meteor/);
    expect(boot).toMatch(/assets\/dodge\/ship\.png/);
    expect(boot).toMatch(/assets\/dodge\/meteor\.png/);
    expect(game).toMatch(/dodge_ship|blitShip/);
    expect(game).toMatch(/dodge_meteor|blitMeteor/);
  });

  it('game over restarts in place without returning to menu', () => {
    const game = readFileSync(resolve(__dirname, 'MeteorGameScene.ts'), 'utf8');
    expect(game).toMatch(/restartInPlace|beginSoloRun/);
    expect(game).toMatch(/다시 시작/);
    expect(game).toMatch(/JustDown\(this\.restartKey\)|KeyCodes\.R/);
    // Solo restart must not scene.start MeteorMenu
    const restartBody = game.slice(
      game.indexOf('private restartInPlace'),
      game.indexOf('private showSoloGameOver'),
    );
    expect(restartBody).toMatch(/beginSoloRun|startRace/);
    expect(restartBody).not.toMatch(/scene\.start\(['"]MeteorMenu['"]\)/);
  });
});
