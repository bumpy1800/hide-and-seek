import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Snack Games hub', () => {
  it('Boot starts Hub; Hub lists AI 술래잡기 and opens Menu', () => {
    const boot = readFileSync(resolve(__dirname, 'BootScene.ts'), 'utf8');
    const hub = readFileSync(resolve(__dirname, 'HubScene.ts'), 'utf8');
    const cfg = readFileSync(resolve(__dirname, '../config.ts'), 'utf8');
    expect(boot).toMatch(/scene\.start\(['"]Hub['"]\)/);
    expect(hub).toMatch(/스낵게임/);
    expect(hub).toMatch(/AI 술래잡기/);
    expect(hub).toMatch(/scene\.start\(['"]Menu['"]\)|sceneKey:\s*['"]Menu['"]/);
    expect(hub).toMatch(/운석 피하기/);
    expect(hub).toMatch(/sceneKey:\s*['"]MeteorMenu['"]/);
    expect(hub).not.toMatch(/변신 술래잡기/);
    expect(hub).not.toMatch(/disguise-seek/);
    expect(hub).not.toMatch(/구스 구스 덕/);
    expect(hub).not.toMatch(/goose-duck/);
    // Nickname is per-game, not on hub
    expect(hub).not.toMatch(/닉네임 변경/);
    expect(hub).not.toMatch(/promptNickname/);
    expect(cfg).toMatch(/HubScene/);
    expect(cfg).toMatch(/MeteorMenuScene|MeteorGameScene/);
    expect(cfg).toMatch(/BootScene,\s*HubScene|HubScene,\s*MenuScene/);
  });

  it('Menu can return to Hub and sets nickname inside the game', () => {
    const menu = readFileSync(resolve(__dirname, 'MenuScene.ts'), 'utf8');
    expect(menu).toMatch(/스낵게임 홈/);
    expect(menu).toMatch(/scene\.start\(['"]Hub['"]\)/);
    expect(menu).toMatch(/닉네임 변경/);
    expect(menu).toMatch(/promptNickname|saveNickname/);
    // Nickname is scoped to this mini-game, not global hub
    expect(menu).toMatch(/GAME_ID\s*=\s*['"]hide-and-seek['"]/);
    expect(menu).toMatch(/loadNickname\(GAME_ID\)/);
  });
});

