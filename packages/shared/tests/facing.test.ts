import { describe, expect, it } from 'vitest';
import {
  animalTextureKey,
  allAnimalTextureKeys,
  directionalKeysAreDistinct,
  facingFromVelocity,
  runFrameFromMotion,
  animalAnimKey,
  allAnimalAnimKeys,
  type Facing,
  AI_SPEED,
  RABBIT_SPEED,
  PLAYER_SPEED,
  SEEKER_SPEED,
  aiRabbitMoveSpeed,
} from '../src/index.js';

const ALL: Facing[] = ['up', 'down', 'left', 'right'];

describe('facingFromVelocity', () => {
  it('maps cardinal velocities to 4 directions', () => {
    expect(facingFromVelocity(100, 0, 'down')).toBe('right');
    expect(facingFromVelocity(-100, 0, 'down')).toBe('left');
    expect(facingFromVelocity(0, 100, 'down')).toBe('down');
    expect(facingFromVelocity(0, -100, 'down')).toBe('up');
  });

  it('keeps last facing when idle', () => {
    for (const last of ALL) {
      expect(facingFromVelocity(0, 0, last)).toBe(last);
    }
  });
});

describe('directional texture keys (not rotate)', () => {
  it('rabbit and fox each have 4 distinct idle keys plus run frames', () => {
    expect(directionalKeysAreDistinct('rabbit')).toBe(true);
    expect(directionalKeysAreDistinct('fox')).toBe(true);
    for (const f of ALL) {
      expect(animalTextureKey('rabbit', f)).toBe(`hider_rabbit_${f}`);
      expect(animalTextureKey('fox', f)).toBe(`seeker_fox_${f}`);
      expect(animalTextureKey('fox', f, 1)).toBe(`seeker_fox_${f}_run1`);
      expect(animalTextureKey('rabbit', f, 2)).toBe(`hider_rabbit_${f}_run2`);
    }
    const keys = allAnimalTextureKeys();
    // 2 animals × 4 facings × 3 frames
    expect(keys).toHaveLength(24);
    expect(new Set(keys).size).toBe(24);
  });
});

describe('rabbit speed parity', () => {
  it('human rabbit and AI rabbit share the same speed constant', () => {
    expect(RABBIT_SPEED).toBe(AI_SPEED);
    expect(PLAYER_SPEED).toBe(RABBIT_SPEED);
    expect(aiRabbitMoveSpeed()).toBe(RABBIT_SPEED);
    expect(aiRabbitMoveSpeed()).toBe(PLAYER_SPEED);
  });

  it('fox/seeker is a bit faster than rabbits', () => {
    expect(SEEKER_SPEED).toBeGreaterThan(RABBIT_SPEED);
    // roughly 15–25% advantage, not a huge gap
    expect(SEEKER_SPEED / RABBIT_SPEED).toBeGreaterThan(1.15);
    expect(SEEKER_SPEED / RABBIT_SPEED).toBeLessThan(1.35);
  });
});

describe('runFrameFromMotion', () => {
  it('idle stays on frame 0; moving cycles 1–2', () => {
    expect(runFrameFromMotion(0, 0, 99)).toBe(0);
    expect(runFrameFromMotion(100, 0, 0)).toBe(1);
    expect(runFrameFromMotion(100, 0, 3)).toBe(2);
    expect(runFrameFromMotion(0, -80, 6)).toBe(1);
  });
});

describe('Phaser anim keys', () => {
  it('exposes distinct idle/run anim keys for all facings', () => {
    expect(animalAnimKey('fox', 'right', false)).toBe('seeker_fox_right_idle');
    expect(animalAnimKey('fox', 'right', true)).toBe('seeker_fox_right_run');
    expect(animalAnimKey('rabbit', 'down', true)).toBe('hider_rabbit_down_run');
    const keys = allAnimalAnimKeys();
    // 2 animals × 4 facings × (idle+run)
    expect(keys).toHaveLength(16);
    expect(new Set(keys).size).toBe(16);
  });
});
