import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Stun penalty mode UI wiring in client', () => {
  it('GameScene: prep overlay is strictly guarded by isSeekerPrepActive (no leak into stun darkness)', () => {
    const src = readFileSync(resolve(__dirname, 'GameScene.ts'), 'utf8');
    // updatePrepOverlay must check isSeekerPrepActive, not just seekerIsBlind
    expect(src).toMatch(/isSeekerPrepActive\(state\)/);
    const prepOverlaySection = src.slice(
      src.indexOf('private updatePrepOverlay'),
      src.indexOf('private updateCameraFollow'),
    );
    expect(prepOverlaySection).toMatch(/isSeekerPrepActive\(state\)/);
    expect(prepOverlaySection).toMatch(/prepOverlay\.setVisible\(isPrep\)/);
  });

  it('GameScene: darkness overlay provides prominent penalty warning style for seeker', () => {
    const src = readFileSync(resolve(__dirname, 'GameScene.ts'), 'utf8');
    const darkSection = src.slice(
      src.indexOf('private syncDarknessOverlay'),
      src.indexOf('private spawnHumanGrave'),
    );
    expect(darkSection).toMatch(/AI 토끼 오인 페널티!/);
    expect(darkSection).toMatch(/화면 암흑/);
    expect(darkSection).toMatch(/이동 불가\(스턴\)/);
    expect(darkSection).toMatch(/darknessLabel\.setStyle/);
  });

  it('GameScene: top banner shows live countdown while seeker is stunned', () => {
    const src = readFileSync(resolve(__dirname, 'GameScene.ts'), 'utf8');
    const bannerSection = src.slice(
      src.indexOf('private syncMissionBanner'),
      src.indexOf('private syncDarknessOverlay'),
    );
    expect(bannerSection).toMatch(/stunMs > 0/);
    expect(bannerSection).toMatch(/스턴 상태! 못 움직입니다/);
    expect(bannerSection).toMatch(/술래가 AI 토끼를 잡아 스턴 상태입니다!/);
  });

  it('GameScene: input poll resets velocity and lastMoveSent on stun to prevent stuck input', () => {
    const src = readFileSync(resolve(__dirname, 'GameScene.ts'), 'utf8');
    const updateSection = src.slice(
      src.indexOf('update(): void'),
      src.indexOf('private sendIntent'),
    );
    expect(updateSection).toMatch(/isStunned/);
    expect(updateSection).toMatch(/lastMoveSent = \{ dx: 0, dy: 0 \}/);
    expect(updateSection).toMatch(/setVelocity\(0, 0\)/);
  });

  it('GameScene: room settings summary displays unlimited stun mode instead of 999 catches', () => {
    const src = readFileSync(resolve(__dirname, 'GameScene.ts'), 'utf8');
    expect(src).toMatch(/무제한 \(스턴 모드\)|무제한 \(스턴 페널티\)/);
  });

  it('MenuScene: supports stun penalty mode toggle and practice button', () => {
    const src = readFileSync(resolve(__dirname, 'MenuScene.ts'), 'utf8');
    expect(src).toMatch(/stun_penalty/);
    expect(src).toMatch(/연습 · 무제한 스턴/);
    expect(src).toMatch(/무제한 스턴/);
    expect(src).toMatch(/무제한 \(∞\)/);
  });
});
