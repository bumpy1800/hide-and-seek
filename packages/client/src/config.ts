import Phaser from 'phaser';
import { VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from '@hide-and-seek/shared';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';

export function createGameConfig(parent: string | HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    type: Phaser.AUTO,
    parent,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    backgroundColor: '#5d8a3e',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { debug: false },
    },
    scene: [BootScene, MenuScene, GameScene],
    input: {
      activePointers: 3,
    },
  };
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
