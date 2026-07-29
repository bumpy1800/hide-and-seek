/** Persist player display name across sessions. */

const STORAGE_KEY = 'meadow-has-nickname';
const MAX_LEN = 12;

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

export function loadNickname(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const n = normalizeNickname(saved);
      if (isValidNickname(n)) return n;
    }
  } catch {
    /* private mode */
  }
  return defaultNickname();
}

export function saveNickname(name: string): string {
  const n = normalizeNickname(name);
  const finalName = isValidNickname(n) ? n : defaultNickname();
  try {
    localStorage.setItem(STORAGE_KEY, finalName);
  } catch {
    /* ignore */
  }
  return finalName;
}

/** Prompt user; cancel keeps current. */
export function promptNickname(current: string): string {
  const raw = window.prompt(
    `닉네임을 입력하세요 (1~${MAX_LEN}자)\n여우/토끼로 참가할 때 표시됩니다.`,
    current,
  );
  if (raw == null) return current;
  const n = normalizeNickname(raw);
  if (!isValidNickname(n)) {
    window.alert(`닉네임은 1~${MAX_LEN}자로 입력해 주세요.`);
    return current;
  }
  return saveNickname(n);
}
