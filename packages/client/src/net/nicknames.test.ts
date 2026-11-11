import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  isValidNickname,
  loadNickname,
  normalizeNickname,
  saveNickname,
  storageKeyForGame,
} from './nicknames';

describe('nicknames', () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    mem.clear();
    // Minimal localStorage stub for node tests
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => {
          mem.set(k, String(v));
        },
        removeItem: (k: string) => {
          mem.delete(k);
        },
      },
    });
  });

  afterEach(() => {
    mem.clear();
  });

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

  it('scopes storage keys per game', () => {
    expect(storageKeyForGame('hide-and-seek')).toBe('snack-nick:hide-and-seek');
    expect(storageKeyForGame('asteroid-dodge')).toBe('snack-nick:asteroid-dodge');
  });

  it('saves and loads independently per game', () => {
    saveNickname('토끼왕', 'hide-and-seek');
    saveNickname('파일럿', 'asteroid-dodge');
    expect(loadNickname('hide-and-seek')).toBe('토끼왕');
    expect(loadNickname('asteroid-dodge')).toBe('파일럿');
  });

  it('migrates legacy meadow-has-nickname into hide-and-seek only', () => {
    mem.set('meadow-has-nickname', '옛닉');
    expect(loadNickname('hide-and-seek')).toBe('옛닉');
    expect(mem.get('snack-nick:hide-and-seek')).toBe('옛닉');
    // Other games do not inherit legacy
    const other = loadNickname('asteroid-dodge');
    expect(other).not.toBe('옛닉');
    expect(other.startsWith('손님')).toBe(true);
  });
});
