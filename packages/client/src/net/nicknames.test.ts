import { describe, expect, it } from 'vitest';
import { isValidNickname, normalizeNickname } from './nicknames';

describe('nicknames', () => {
  it('trims and clamps length', () => {
    expect(normalizeNickname('  토끼왕  ')).toBe('토끼왕');
    expect(normalizeNickname('abcdefghijklmnop')).toHaveLength(12);
  });

  it('strips dangerous punctuation', () => {
    expect(normalizeNickname('hi<script>')).toBe('hiscript');
  });

  it('validates length', () => {
    expect(isValidNickname('')).toBe(false);
    expect(isValidNickname('여우')).toBe(true);
    expect(isValidNickname('a'.repeat(13))).toBe(false);
  });
});
