/** Short shareable room codes (also used as PeerJS peer ids). */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makeRoomCode(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length]!;
  }
  return out;
}

/** Normalize user paste: trim, strip spaces/dashes, uppercase. */
export function normalizeRoomCode(raw: string): string {
  return raw.trim().replace(/[\s\-_.]/g, '').toUpperCase();
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z2-9]{4,12}$/.test(code);
}
