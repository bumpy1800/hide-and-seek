/** Cardinal facing for top-down animal sprites. */
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Velocity below this (world units/sec) keeps previous facing. */
export const FACING_IDLE_EPS = 1;

export type AnimalKind = 'rabbit' | 'fox';

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

/**
 * Texture key for a drawn directional asset (not rotate of a single image).
 * Keys: hider_rabbit_{up|down|left|right}, seeker_fox_{up|down|left|right}
 */
export function animalTextureKey(kind: AnimalKind, facing: Facing): string {
  const prefix = kind === 'fox' ? 'seeker_fox' : 'hider_rabbit';
  return `${prefix}_${facing}`;
}

/** All directional texture keys that must be loaded. */
export function allAnimalTextureKeys(): string[] {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  return [
    ...dirs.map((d) => animalTextureKey('rabbit', d)),
    ...dirs.map((d) => animalTextureKey('fox', d)),
  ];
}

/** True if the four rabbit keys are all distinct strings. */
export function directionalKeysAreDistinct(kind: AnimalKind): boolean {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  const keys = dirs.map((d) => animalTextureKey(kind, d));
  return new Set(keys).size === 4;
}
