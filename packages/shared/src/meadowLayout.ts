import { MAP_HEIGHT, MAP_WIDTH } from './types.js';

export type DecorKind = 'bush' | 'tree' | 'rock';
export type DecorSpec = { kind: DecorKind; x: number; y: number; scale: number };

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure meadow decor placement for the expanded animal/grassland arena. */
export function generateMeadowDecor(seed = 7, count = 48): DecorSpec[] {
  const rng = mulberry32(seed);
  const specs: DecorSpec[] = [];
  const margin = 80;
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const kind: DecorKind = roll < 0.45 ? 'bush' : roll < 0.75 ? 'rock' : 'tree';
    const x = margin + rng() * (MAP_WIDTH - margin * 2);
    const y = margin + rng() * (MAP_HEIGHT - margin * 2);
    const scale =
      kind === 'tree' ? 0.85 + rng() * 0.45 : kind === 'bush' ? 0.7 + rng() * 0.5 : 0.65 + rng() * 0.4;
    specs.push({ kind, x, y, scale });
  }
  return specs;
}

export function isInsideMeadow(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x <= MAP_WIDTH && y <= MAP_HEIGHT;
}
