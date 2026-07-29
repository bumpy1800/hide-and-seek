/**
 * Pure multiplayer transport selection (no Phaser / DOM).
 * Unit-tested so production cannot bake a dead tunnel and skip Peer host.
 */

export function isEphemeralWsUrl(url: string | undefined | null): boolean {
  if (!url || url.trim().length === 0) return true;
  return /loca\.lt|localtunnel|trycloudflare\.com|ngrok|cloudflared/i.test(url);
}

/**
 * Prefer browser PeerJS multiplayer when no durable WS server is configured.
 * Vercel static deploy has no durable WS — peer host ticks prep/catch locally.
 */
export function preferPeerMultiplayer(env: {
  VITE_PEER_MULTIPLAYER?: string;
  VITE_WS_URL?: string;
}): boolean {
  const force = env.VITE_PEER_MULTIPLAYER;
  if (force === '1' || force === 'true') return true;
  if (force === '0' || force === 'false') return false;
  const ws = env.VITE_WS_URL;
  // No URL or ephemeral tunnel → PeerJS (production-safe)
  if (isEphemeralWsUrl(ws)) return true;
  // Durable explicit WS (e.g. local server / real host)
  return false;
}
