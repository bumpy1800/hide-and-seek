import { describe, expect, it } from 'vitest';
import { isEphemeralWsUrl, preferPeerMultiplayer } from './multiplayerMode';

describe('preferPeerMultiplayer (production multiplayer path)', () => {
  it('uses Peer when VITE_PEER_MULTIPLAYER=true even if WS is set', () => {
    expect(
      preferPeerMultiplayer({
        VITE_PEER_MULTIPLAYER: 'true',
        VITE_WS_URL: 'wss://gentle-fans-wonder.loca.lt',
      }),
    ).toBe(true);
  });

  it('rejects dead loca.lt / trycloudflare tunnels and prefers Peer', () => {
    expect(isEphemeralWsUrl('wss://gentle-fans-wonder.loca.lt')).toBe(true);
    expect(isEphemeralWsUrl('wss://proxy-examined-kept-humanity.trycloudflare.com')).toBe(true);
    expect(
      preferPeerMultiplayer({
        VITE_WS_URL: 'wss://gentle-fans-wonder.loca.lt',
      }),
    ).toBe(true);
    expect(
      preferPeerMultiplayer({
        VITE_WS_URL: 'wss://proxy-examined-kept-humanity.trycloudflare.com',
      }),
    ).toBe(true);
  });

  it('uses durable localhost WS only when peer forced off and URL is not ephemeral', () => {
    expect(isEphemeralWsUrl('ws://localhost:8787')).toBe(false);
    expect(
      preferPeerMultiplayer({
        VITE_WS_URL: 'ws://localhost:8787',
        VITE_PEER_MULTIPLAYER: 'false',
      }),
    ).toBe(false);
  });

  it('defaults to Peer when no WS URL (Vercel static)', () => {
    expect(preferPeerMultiplayer({})).toBe(true);
    expect(preferPeerMultiplayer({ VITE_WS_URL: '' })).toBe(true);
  });
});
