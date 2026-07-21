/** Cardinal facing for top-down / side animal sprites. */
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Which way the source texture "points" at angle 0 (no rotation). */
export type BaseHeading = Facing;

/** Velocity below this (world units/sec) keeps previous facing. */
export const FACING_IDLE_EPS = 1;

/** Clockwise order starting at up (Phaser angle increases clockwise). */
const CLOCKWISE: readonly Facing[] = ['up', 'right', 'down', 'left'];

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

/** Phaser-friendly transform for a single-orientation texture. */
export type FacingTransform = {
  flipX: boolean;
  flipY: boolean;
  /** Degrees, Phaser clockwise from the texture's natural orientation. */
  angle: number;
};

function transformKey(t: FacingTransform): string {
  return `${t.flipX ? 1 : 0},${t.flipY ? 1 : 0},${t.angle}`;
}

/**
 * Map world facing → flip/angle so one texture can show all four directions.
 *
 * Uses pure rotation in 90° steps from `baseHeading` (how the art faces at angle 0):
 * - meadow rabbit (`hider_rabbit`): top-down, head toward top of image → base `'up'`
 * - meadow fox (`seeker_fox`): side profile head toward left → base `'left'`
 *
 * All four facings produce distinct transforms (pairwise unique angle for a given base).
 */
export function facingTransform(
  facing: Facing,
  baseHeading: BaseHeading = 'up',
): FacingTransform {
  const targetIdx = CLOCKWISE.indexOf(facing);
  const baseIdx = CLOCKWISE.indexOf(baseHeading);
  // Steps clockwise from base art heading to desired world facing
  const steps = (targetIdx - baseIdx + 4) % 4;
  const angle = steps * 90;
  return { flipX: false, flipY: false, angle };
}

/** Base heading baked into our meadow character textures. */
export function baseHeadingForTexture(textureKey: string): BaseHeading {
  if (textureKey.includes('fox') || textureKey === 'seeker' || textureKey.includes('seeker')) {
    return 'left';
  }
  // rabbit / hider top-down art faces up (head at top of image)
  return 'up';
}

/** True if all four cardinal facings map to distinct visual transforms for this base. */
export function allFacingsDistinct(baseHeading: BaseHeading = 'up'): boolean {
  const keys = new Set(
    (['up', 'down', 'left', 'right'] as const).map((f) =>
      transformKey(facingTransform(f, baseHeading)),
    ),
  );
  return keys.size === 4;
}
