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
  it('GameScene surfaces mission HUD and T → mission_action for rabbits', () => {
    const src = readFileSync(resolve(__dirname, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/missionHudLines/);
    expect(src).toMatch(/mission_action|touch_rabbit/);
    expect(src).toMatch(/syncMissionMarker|missionMarker/);
    expect(src).toMatch(/touch_rabbit/);
    expect(src).toMatch(/missionBannerLines|missionBanner/);
    expect(src).toMatch(/돌발 미션 발생|MISSION_BANNER|missionBanner/);
    expect(src).toMatch(/syncDarknessOverlay|darknessOverlay/);
    // Fox must not see visit_point marker
    expect(src).toMatch(/isFoxViewer|practiceRole === 'fox'/);
    expect(src).toMatch(/!isFoxViewer/);
  });

  it('IntentInput queues darkness on K and mission_action on T', () => {
    const src = readFileSync(resolve(__dirname, 'input/IntentInput.ts'), 'utf8');
    expect(src).toMatch(/KeyCodes\.K|darknessQueued/);
    expect(src).toMatch(/type: 'darkness'/);
    expect(src).toMatch(/KeyCodes\.T|missionQueued/);
    expect(src).toMatch(/type: 'mission_action'/);
  });

  it('PeerMultiplayer uses shared hostSim for playing intents', () => {
    const src = readFileSync(resolve(__dirname, 'net/PeerMultiplayer.ts'), 'utf8');
    expect(src).toMatch(/applyPlayingIntent/);
    expect(src).toMatch(/tickAuthority/);
  });

  it('missionBannerLines for fox and rabbit viewers (pure helper)', () => {
    let lobby = createLobby('b', defaultConfig({ aiCount: 1, seekerPrepMs: 0 }));
    let res = joinHuman(lobby, 'fox', 'F');
    res = joinHuman(res.ok ? res.state : lobby, 'r1', 'R');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    let state = skipToPlaying(startMatch(res.state, { mode: 'normal', seed: 2 }));
    state = grantMission(state, 1);
    const foxId = state.seekerId!;
    const rabbitId = state.humans.find((h) => h !== foxId)!;
    const foxLines = missionBannerLines(state, foxId);
    expect(foxLines).not.toBeNull();
    expect(foxLines![0]).toContain(MISSION_BANNER_TITLE);
    expect(foxLines!.join('\n')).toMatch(/돌발 미션/);
    // Fox: start only — no skill-holder / skill-reward copy mid-mission
    expect(foxLines!.join('\n')).not.toMatch(/암흑|스킬 획득/);
    const rabbitLines = missionBannerLines(state, rabbitId);
    expect(rabbitLines!.join('\n')).toMatch(/스킬 획득/);
    expect(rabbitLines!.join('\n')).toMatch(/여우 강화/);
  });

  it('GameScene places mission banner top-center (visible)', () => {
    const src = readFileSync(resolve(__dirname, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/syncMissionBanner/);
    // Top center placement (not top-right chip)
    expect(src).toMatch(/scale\.width\s*\/\s*2/);
    expect(src).toMatch(/setOrigin\(0\.5,\s*0\)|setOrigin\(0\.5, 0\)/);
  });

  it('key hints for catch / touch rabbit / darkness are exported for HUD', async () => {
    const {
      KEY_HINT_CATCH,
      KEY_HINT_TOUCH_RABBIT,
      KEY_HINT_DARKNESS,
    } = await import('@hide-and-seek/shared');
    expect(KEY_HINT_CATCH).toMatch(/\[Space\].*잡기/);
    expect(KEY_HINT_TOUCH_RABBIT).toMatch(/\[T\].*터치/);
    expect(KEY_HINT_DARKNESS).toMatch(/\[K\].*암흑/);
  });

  it('GameScene home return tears down hosts then starts Hub', () => {
    const src = readFileSync(resolve(__dirname, 'scenes/GameScene.ts'), 'utf8');
    expect(src).toMatch(/스낵게임 홈|requestReturnToMenu/);
    expect(src).toMatch(/requestReturnToMenu/);
    expect(src).toMatch(/teardownSessionHosts/);
    expect(src).toMatch(/scene\.start\(['"]Hub['"]\)/);
    expect(src).toMatch(/softDisconnect|teardownSessionHosts/);
    expect(src).toMatch(/return_to_lobby|requestReturnToRoomLobby/);
  });
});
