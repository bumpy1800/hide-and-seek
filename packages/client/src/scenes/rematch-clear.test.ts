import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Structural: rematch / match_started must clear graves on the shipped client path.
 */
describe('rematch clears prior-match graves', () => {
  const scenePath = resolve(__dirname, 'GameScene.ts');
  const src = readFileSync(scenePath, 'utf8');

  it('clears graves on match_started event (all clients)', () => {
    expect(src).toMatch(/event === ['"]match_started['"]/);
    // clearGraves appears in the match_started branch
    const idx = src.indexOf("event === 'match_started'");
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 800);
    expect(window).toMatch(/clearGraves\s*\(/);
  });

  it('clears graves when starting a new match from requestStart', () => {
    expect(src).toMatch(/requestStart\s*\(/);
    const idx = src.indexOf('private requestStart');
    expect(idx).toBeGreaterThan(-1);
    const window = src.slice(idx, idx + 600);
    expect(window).toMatch(/clearGraves\s*\(/);
  });

  it('clears graves on phase transition out of ended', () => {
    expect(src).toMatch(/phase === ['"]ended['"]/);
    expect(src).toMatch(/clearGraves\s*\(/);
  });
});
