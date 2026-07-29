import { describe, expect, it } from 'vitest';
import { isValidRoomCode, makeRoomCode, normalizeRoomCode } from './roomCodes';

describe('roomCodes', () => {
  it('makeRoomCode produces valid short codes', () => {
    for (let i = 0; i < 20; i++) {
      const c = makeRoomCode(6);
      expect(c).toHaveLength(6);
      expect(isValidRoomCode(c)).toBe(true);
    }
  });

  it('normalizeRoomCode strips noise and uppercases', () => {
    expect(normalizeRoomCode('  ab-cd_ef ')).toBe('ABCDEF');
    expect(normalizeRoomCode('xy12')).toBe('XY12');
  });

  it('rejects invalid codes', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('AB')).toBe(false);
    expect(isValidRoomCode('AB01')).toBe(false); // 0/1 not allowed
    expect(isValidRoomCode('hello!')).toBe(false);
  });
});
