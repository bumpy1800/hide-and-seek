import { describe, expect, it } from 'vitest';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  generateMeadowDecor,
  isInsideMeadow,
} from '../src/index.js';

describe('meadow decor layout', () => {
  it('places decor inside expanded meadow using real MAP bounds', () => {
    const specs = generateMeadowDecor(11, 40);
    expect(specs.length).toBe(40);
    for (const s of specs) {
      expect(isInsideMeadow(s.x, s.y)).toBe(true);
      expect(s.x).toBeLessThan(MAP_WIDTH);
      expect(s.y).toBeLessThan(MAP_HEIGHT);
      expect(['bush', 'tree', 'rock']).toContain(s.kind);
    }
  });
});
