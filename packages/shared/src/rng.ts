/** Mulberry32 PRNG — deterministic when seeded. */
export function createRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickRandom<T>(items: readonly T[], rng: () => number): T {
  if (items.length === 0) {
    throw new Error('pickRandom: empty list');
  }
  const idx = Math.floor(rng() * items.length);
  return items[Math.min(idx, items.length - 1)]!;
}
