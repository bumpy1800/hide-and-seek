import { describe, expect, it } from 'vitest';
import {
  allFacingsDistinct,
  baseHeadingForTexture,
  facingFromVelocity,
  facingTransform,
  type Facing,
} from '../src/index.js';

const ALL: Facing[] = ['up', 'down', 'left', 'right'];

function key(t: { flipX: boolean; flipY: boolean; angle: number }): string {
  return `${t.flipX},${t.flipY},${((t.angle % 360) + 360) % 360}`;
}

describe('facingFromVelocity', () => {
  it('maps cardinal velocities to 4 directions', () => {
    expect(facingFromVelocity(100, 0, 'down')).toBe('right');
    expect(facingFromVelocity(-100, 0, 'down')).toBe('left');
    expect(facingFromVelocity(0, 100, 'down')).toBe('down');
    expect(facingFromVelocity(0, -100, 'down')).toBe('up');
  });

  it('uses dominant axis on diagonals', () => {
    expect(facingFromVelocity(100, 10, 'down')).toBe('right');
    expect(facingFromVelocity(10, 100, 'down')).toBe('down');
    expect(facingFromVelocity(-80, -20, 'right')).toBe('left');
    expect(facingFromVelocity(20, -90, 'left')).toBe('up');
  });

  it('keeps last facing when idle', () => {
    for (const last of ALL) {
      expect(facingFromVelocity(0, 0, last)).toBe(last);
      expect(facingFromVelocity(0.5, -0.5, last)).toBe(last);
    }
  });
});

describe('facingTransform', () => {
  it('produces four pairwise-distinct transforms for rabbit base (up)', () => {
    expect(allFacingsDistinct('up')).toBe(true);
    const keys = ALL.map((f) => key(facingTransform(f, 'up')));
    expect(new Set(keys).size).toBe(4);
    // right !== down (the previous bug)
    expect(key(facingTransform('right', 'up'))).not.toBe(key(facingTransform('down', 'up')));
  });

  it('produces four pairwise-distinct transforms for fox base (left)', () => {
    expect(allFacingsDistinct('left')).toBe(true);
    const keys = ALL.map((f) => key(facingTransform(f, 'left')));
    expect(new Set(keys).size).toBe(4);
  });

  it('maps correctly for rabbit base art facing up', () => {
    // art faces up at 0°
    expect(facingTransform('up', 'up')).toEqual({ flipX: false, flipY: false, angle: 0 });
    expect(facingTransform('right', 'up')).toEqual({ flipX: false, flipY: false, angle: 90 });
    expect(facingTransform('down', 'up')).toEqual({ flipX: false, flipY: false, angle: 180 });
    expect(facingTransform('left', 'up')).toEqual({ flipX: false, flipY: false, angle: 270 });
  });

  it('maps correctly for fox base art facing left', () => {
    // art faces left at 0° — walk left keeps 0, walk right needs 180
    expect(facingTransform('left', 'left')).toEqual({ flipX: false, flipY: false, angle: 0 });
    expect(facingTransform('up', 'left')).toEqual({ flipX: false, flipY: false, angle: 90 });
    expect(facingTransform('right', 'left')).toEqual({ flipX: false, flipY: false, angle: 180 });
    expect(facingTransform('down', 'left')).toEqual({ flipX: false, flipY: false, angle: 270 });
  });

  it('baseHeadingForTexture matches meadow assets', () => {
    expect(baseHeadingForTexture('hider_rabbit')).toBe('up');
    expect(baseHeadingForTexture('seeker_fox')).toBe('left');
  });
});
