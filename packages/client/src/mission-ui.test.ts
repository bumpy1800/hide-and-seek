import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('mission client wiring (structural)', () => {
  it('GameScene surfaces mission HUD and Space → mission_action for rabbits', () => {
    const src = readFileSync(resolve(__dirname, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/missionHudLines/);
    expect(src).toMatch(/mission_action/);
    expect(src).toMatch(/syncMissionMarker|missionMarker/);
    expect(src).toMatch(/touch_fox/);
  });

  it('PeerMultiplayer handles mission_action', () => {
    const src = readFileSync(resolve(__dirname, 'net/PeerMultiplayer.ts'), 'utf8');
    expect(src).toMatch(/applyMissionAction/);
    expect(src).toMatch(/mission_action/);
  });
});
