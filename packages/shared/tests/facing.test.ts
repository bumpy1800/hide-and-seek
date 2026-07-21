import { describe, expect, it } from 'vitest';
import {
  animalTextureKey,
  allAnimalTextureKeys,
  directionalKeysAreDistinct,
  facingFromVelocity,
  type Facing,
  AI_SPEED,
  RABBIT_SPEED,
  PLAYER_SPEED,
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
  it('rabbit and fox each have 4 distinct keys', () => {
    expect(directionalKeysAreDistinct('rabbit')).toBe(true);
    expect(directionalKeysAreDistinct('fox')).toBe(true);
    for (const f of ALL) {
      expect(animalTextureKey('rabbit', f)).toBe(`hider_rabbit_${f}`);
      expect(animalTextureKey('fox', f)).toBe(`seeker_fox_${f}`);
    }
    const keys = allAnimalTextureKeys();
    expect(keys).toHaveLength(8);
    expect(new Set(keys).size).toBe(8);
  });
});

describe('rabbit speed parity', () => {
  it('human rabbit and AI rabbit share the same speed constant', () => {
    expect(RABBIT_SPEED).toBe(AI_SPEED);
    expect(PLAYER_SPEED).toBe(RABBIT_SPEED);
    expect(aiRabbitMoveSpeed()).toBe(RABBIT_SPEED);
    expect(aiRabbitMoveSpeed()).toBe(PLAYER_SPEED);
  });
});
