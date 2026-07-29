/** Cardinal facing for top-down animal sprites. */
export type Facing = 'up' | 'down' | 'left' | 'right';

/** Velocity below this (world units/sec) keeps previous facing. */
export const FACING_IDLE_EPS = 1;

/** Run-cycle frames while moving: 0 = idle/base, 1..RUN_FRAME_COUNT-1 = stride. */
export const RUN_FRAME_COUNT = 3;

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
 * Texture key for directional + run-frame assets.
 * Idle: hider_rabbit_down, seeker_fox_right
 * Run:  hider_rabbit_down_run1, seeker_fox_right_run2
 */
export function animalTextureKey(
  kind: AnimalKind,
  facing: Facing,
  runFrame = 0,
): string {
  const prefix = kind === 'fox' ? 'seeker_fox' : 'hider_rabbit';
  const base = `${prefix}_${facing}`;
  if (runFrame <= 0) return base;
  const f = Math.min(RUN_FRAME_COUNT - 1, Math.max(1, Math.floor(runFrame)));
  return `${base}_run${f}`;
}

/**
 * Pick run frame from speed + match/world tick.
 * Idle (near-zero velocity) → 0; moving → 1 or 2 alternating.
 */
export function runFrameFromMotion(
  vx: number,
  vy: number,
  tick: number,
  idleEps: number = FACING_IDLE_EPS,
): number {
  if (Math.hypot(vx, vy) < idleEps) return 0;
  // Two-step stride after idle frame
  return 1 + (Math.abs(Math.floor(tick / 3)) % 2);
}

/** All texture keys that must be loaded (idle + run frames × facings × animals). */
export function allAnimalTextureKeys(): string[] {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  const keys: string[] = [];
  for (const kind of ['rabbit', 'fox'] as const) {
    for (const d of dirs) {
      for (let f = 0; f < RUN_FRAME_COUNT; f++) {
        keys.push(animalTextureKey(kind, d, f));
      }
    }
  }
  return keys;
}

/** True if the four rabbit keys are all distinct strings. */
export function directionalKeysAreDistinct(kind: AnimalKind): boolean {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  const keys = dirs.map((d) => animalTextureKey(kind, d));
  return new Set(keys).size === 4;
}

/**
 * Phaser Animation Manager keys (created in BootScene).
 * idle = single base frame; run = looping stride frames.
 */
export function animalAnimKey(
  kind: AnimalKind,
  facing: Facing,
  moving: boolean,
): string {
  const prefix = kind === 'fox' ? 'seeker_fox' : 'hider_rabbit';
  return moving ? `${prefix}_${facing}_run` : `${prefix}_${facing}_idle`;
}

/** All Phaser anim keys that BootScene must register. */
export function allAnimalAnimKeys(): string[] {
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  const keys: string[] = [];
  for (const kind of ['rabbit', 'fox'] as const) {
    for (const d of dirs) {
      keys.push(animalAnimKey(kind, d, false));
      keys.push(animalAnimKey(kind, d, true));
    }
  }
  return keys;
}
