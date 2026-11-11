/** Per-game player display names (set inside each game, not on the hub). */

const MAX_LEN = 12;
/** Legacy single-key storage (migrated into hide-and-seek on first load). */
const LEGACY_KEY = 'meadow-has-nickname';
const KEY_PREFIX = 'snack-nick:';

/** Known snack-game ids used for storage scoping. */
export type SnackGameId = 'hide-and-seek' | (string & {});

export function storageKeyForGame(gameId: SnackGameId): string {
  const id = gameId.trim() || 'hide-and-seek';
  return `${KEY_PREFIX}${id}`;
}

export function normalizeNickname(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[<>"'`\\]/g, '')
    .slice(0, MAX_LEN);
  return cleaned;
}

export function isValidNickname(name: string): boolean {
  return name.length >= 1 && name.length <= MAX_LEN;
}

export function defaultNickname(): string {
  return `손님${Math.floor(Math.random() * 900 + 100)}`;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/**
 * Load nickname for a specific game.
 * Falls back to legacy global key once for hide-and-seek (pre-hub installs).
 */
export function loadNickname(gameId: SnackGameId = 'hide-and-seek'): string {
  const key = storageKeyForGame(gameId);
  const saved = readStored(key);
  if (saved) {
    const n = normalizeNickname(saved);
    if (isValidNickname(n)) return n;
  }

  // One-time migration: old hub-wide nickname → hide-and-seek only
  if (gameId === 'hide-and-seek') {
    const legacy = readStored(LEGACY_KEY);
    if (legacy) {
      const n = normalizeNickname(legacy);
      if (isValidNickname(n)) {
        writeStored(key, n);
        return n;
      }
    }
  }

  return defaultNickname();
}

export function saveNickname(
  name: string,
  gameId: SnackGameId = 'hide-and-seek',
): string {
  const n = normalizeNickname(name);
  const finalName = isValidNickname(n) ? n : defaultNickname();
  writeStored(storageKeyForGame(gameId), finalName);
  return finalName;
}

/** Prompt user; cancel keeps current. Saves under the given game id. */
export function promptNickname(
  current: string,
  gameId: SnackGameId = 'hide-and-seek',
): string {
  const raw = window.prompt(
    `닉네임을 입력하세요 (1~${MAX_LEN}자)\n이 게임에서만 사용됩니다.`,
    current,
  );
  if (raw == null) return current;
  const n = normalizeNickname(raw);
  if (!isValidNickname(n)) {
    window.alert(`닉네임은 1~${MAX_LEN}자로 입력해 주세요.`);
    return current;
  }
  return saveNickname(n, gameId);
}
