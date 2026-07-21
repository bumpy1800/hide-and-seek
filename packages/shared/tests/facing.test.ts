import { describe, expect, it } from 'vitest';
import { facingFromVelocity, facingTransform, type Facing } from '../src/index.js';

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
    const lasts: Facing[] = ['up', 'down', 'left', 'right'];
    for (const last of lasts) {
      expect(facingFromVelocity(0, 0, last)).toBe(last);
      expect(facingFromVelocity(0.5, -0.5, last)).toBe(last);
    }
  });
});

describe('facingTransform', () => {
  it('returns flip/angle for each facing', () => {
    expect(facingTransform('left').flipX).toBe(true);
    expect(facingTransform('right').flipX).toBe(false);
    expect(facingTransform('up').angle).toBe(180);
    expect(facingTransform('down').angle).toBe(0);
  });
});
