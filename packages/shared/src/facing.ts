/** Cardinal facing for top-down animal sprites. */
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Velocity below this (world units/sec) keeps previous facing. */
export const FACING_IDLE_EPS = 1;

/**
 * Derive facing from velocity. Dominant axis wins when both nonzero.
 * Idle (near-zero velocity) returns `lastFacing`.
 */
export function facingFromVelocity(
  vx: number,
  vy: number,
  lastFacing: Facing = 'down',
  idleEps: number = FACING_IDLE_EPS,
): Facing {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax < idleEps && ay < idleEps) {
    return lastFacing;
  }
  if (ax >= ay) {
    return vx > 0 ? 'right' : 'left';
  }
  return vy > 0 ? 'down' : 'up';
}

/** Phaser-friendly transform for a single front-facing top-down texture. */
export type FacingTransform = {
  flipX: boolean;
  flipY: boolean;
  angle: number;
};

/**
 * Map facing to flip/angle so one front-facing art can show L/R/U/D.
 * Base art is assumed to face "down" (toward bottom of screen / camera).
 */
export function facingTransform(facing: Facing): FacingTransform {
  switch (facing) {
    case 'left':
      return { flipX: true, flipY: false, angle: 0 };
    case 'right':
      return { flipX: false, flipY: false, angle: 0 };
    case 'up':
      return { flipX: false, flipY: false, angle: 180 };
    case 'down':
    default:
      return { flipX: false, flipY: false, angle: 0 };
  }
}
