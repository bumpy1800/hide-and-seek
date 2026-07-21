import Phaser from 'phaser';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '@hide-and-seek/shared';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

/** Cap DPR so canvas stays sharp on retina without extreme GPU cost. */
function gameResolution(): number {
  if (typeof window === 'undefined') return 1;
  const dpr = window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, 1), 2);
}

export function createGameConfig(parent: string | HTMLElement): Phaser.Types.Core.GameConfig {
  const resolution = gameResolution();
  // resolution is supported at runtime for HiDPI; some Phaser type packages omit it
  const config = {
    type: Phaser.AUTO,
    parent,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    backgroundColor: '#5d8a3e',
    resolution,
    render: {
      antialias: true,
      antialiasGL: true,
      roundPixels: true,
      pixelArt: false,
      powerPreference: 'high-performance' as const,
      transparent: false,
    },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      autoRound: true,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scene: [BootScene, MenuScene, GameScene],
    input: {
      activePointers: 3,
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
  };
  return config as Phaser.Types.Core.GameConfig;
}

export function getWsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.port === '5173' || location.port === '4173') {
    return 'ws://localhost:8787';
  }
  return `${proto}//${location.host}`;
}
