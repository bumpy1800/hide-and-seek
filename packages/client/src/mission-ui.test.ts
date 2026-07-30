import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MISSION_BANNER_TITLE,
  createLobby,
  defaultConfig,
  grantMission,
  joinHuman,
  missionBannerLines,
  skipToPlaying,
  startMatch,
} from '@hide-and-seek/shared';

describe('mission client wiring (structural)', () => {
  it('GameScene surfaces mission HUD and Space → mission_action for rabbits', () => {
    const src = readFileSync(resolve(__dirname, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/missionHudLines/);
    expect(src).toMatch(/mission_action/);
    expect(src).toMatch(/syncMissionMarker|missionMarker/);
    expect(src).toMatch(/touch_fox/);
    expect(src).toMatch(/missionBannerLines|missionBanner/);
    expect(src).toMatch(/돌발 미션 발생|MISSION_BANNER|missionBanner/);
  });

  it('PeerMultiplayer handles mission_action', () => {
    const src = readFileSync(resolve(__dirname, 'net/PeerMultiplayer.ts'), 'utf8');
    expect(src).toMatch(/applyMissionAction/);
    expect(src).toMatch(/mission_action/);
  });

  it('missionBannerLines for fox and rabbit viewers (pure helper)', () => {
    let lobby = createLobby('b', defaultConfig({ aiCount: 1, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 2 }));
    state = grantMission(state, 1);
    const lines = missionBannerLines(state);
    expect(lines).not.toBeNull();
    expect(lines![0]).toBe(MISSION_BANNER_TITLE);
    expect(lines![0]).toContain('돌발 미션 발생!! 토끼들은 미션을 수행해주세요');
    expect(lines![1]).toMatch(/^현재 미션:/);
  });
});
