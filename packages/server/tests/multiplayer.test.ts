import { describe, expect, it } from 'vitest';
import {
  SEEKER_PREP_MS,
  START_SEQUENCE_MS,
  canSeekerSee,
  isSeekerBlind,
  isSeekerPrepActive,
  type ServerMessage,
} from '@hide-and-seek/shared';
import { RoomManager, type SocketLike, type Room } from '../src/room.js';

class FakeSocket implements SocketLike {
  readyState = 1;
  messages: ServerMessage[] = [];
  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  lastSnapshot(): Extract<ServerMessage, { type: 'snapshot' }> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.type === 'snapshot') return m;
    }
    return undefined;
  }
}

/**
 * Drain fox-roulette + 3s countdown until phase becomes `playing`.
 * Stops on the transition tick so prep is still full (SEEKER_PREP_MS).
 */
function advancePastStartSequence(room: Room, tickMs = 50): void {
  let guard = 0;
  const maxTicks = Math.ceil(START_SEQUENCE_MS / tickMs) + 5;
  while (room.state.phase === 'starting' && guard < maxTicks) {
    room.tick(tickMs);
    guard += 1;
  }
}

describe('multiplayer room host (in-process dual clients)', () => {
  it('two clients join, receive same seeker on start, and sync moves/catches', () => {
    const manager = new RoomManager();
    const a = new FakeSocket();
    const b = new FakeSocket();

    const joinA = manager.joinRoom('arena', 'player-a', a, 'Alice');
    expect(joinA.message.type).toBe('welcome');
    const joinB = manager.joinRoom('arena', 'player-b', b, 'Bob');
    expect(joinB.message.type).toBe('welcome');

    const room = manager.get('arena')!;
    expect(room.state.humans).toHaveLength(2);

    // Capacity: fill to 8 then reject
    for (let i = 0; i < 6; i++) {
      const s = new FakeSocket();
      const r = manager.joinRoom('arena', `p${i}`, s, `P${i}`);
      expect(r.message.type).toBe('welcome');
    }
    const overflow = new FakeSocket();
    const denied = manager.joinRoom('arena', 'overflow', overflow, 'Nope');
    expect(denied.message.type).toBe('error');
    if (denied.message.type === 'error') {
      expect(denied.message.message).toBe('room_full');
    }

    // Leave extras so we have 2 humans for cleaner match test
    for (let i = 0; i < 6; i++) {
      room.leave(`p${i}`);
    }
    expect(room.state.humans).toHaveLength(2);

    a.messages = [];
    b.messages = [];
    room.applyIntent('player-a', { type: 'start' });

    const snapStartA = a.lastSnapshot();
    const snapStartB = b.lastSnapshot();
    expect(snapStartA?.type).toBe('snapshot');
    expect(snapStartB?.type).toBe('snapshot');
    expect(snapStartA!.state.seekerId).toBe(snapStartB!.state.seekerId);
    // Normal start enters fox-roulette / countdown first
    expect(snapStartA!.state.phase).toBe('starting');
    expect(snapStartA!.state.humans).toEqual(
      expect.arrayContaining(['player-a', 'player-b']),
    );

    advancePastStartSequence(room);
    const snapA = a.lastSnapshot()!;
    const snapB = b.lastSnapshot()!;
    expect(snapA.state.phase).toBe('playing');
    expect(snapB.state.phase).toBe('playing');
    expect(snapA.state.seekerPrepRemainingMs).toBe(SEEKER_PREP_MS);

    const seekerId = snapA.state.seekerId!;
    const hiderId = seekerId === 'player-a' ? 'player-b' : 'player-a';

    // Move hider — both should see new velocity after intent (via next snapshot on catch or tick)
    room.applyIntent(hiderId, { type: 'move', dx: 1, dy: 0 });
    room.tick(50);
    const afterMoveA = a.lastSnapshot()!;
    const afterMoveB = b.lastSnapshot()!;
    expect(afterMoveA.state.entities[hiderId]!.vx).toBeGreaterThan(0);
    expect(afterMoveB.state.entities[hiderId]!.vx).toBe(
      afterMoveA.state.entities[hiderId]!.vx,
    );

    // Place seeker next to hider and catch (skip prep window)
    room.state = {
      ...room.state,
      seekerPrepRemainingMs: 0,
      entities: {
        ...room.state.entities,
        [seekerId]: { ...room.state.entities[seekerId]!, x: 200, y: 200 },
        [hiderId]: { ...room.state.entities[hiderId]!, x: 210, y: 200, alive: true },
      },
    };
    a.messages = [];
    b.messages = [];
    room.applyIntent(seekerId, { type: 'catch' });
    const catchSnap = a.lastSnapshot()!;
    expect(catchSnap.state.entities[hiderId]!.alive).toBe(false);
    expect(b.lastSnapshot()!.state.entities[hiderId]!.alive).toBe(false);
    expect(catchSnap.state.catchBudgetRemaining).toBeLessThan(room.state.config.catchBudget);
  });
});

describe('rematch after match ends', () => {
  it('start intent after ended begins a new match for both clients', () => {
    const manager = new RoomManager();
    const a = new FakeSocket();
    const b = new FakeSocket();
    manager.joinRoom('rematch-room', 'p1', a, 'A');
    manager.joinRoom('rematch-room', 'p2', b, 'B');
    const room = manager.get('rematch-room')!;
    room.applyIntent('p1', { type: 'start' });
    expect(room.state.phase).toBe('starting');
    advancePastStartSequence(room);
    expect(room.state.phase).toBe('playing');

    // Force end
    room.state = { ...room.state, timeRemainingMs: 0, seekerPrepRemainingMs: 0 };
    room.tick(50);
    expect(room.state.phase).toBe('ended');

    a.messages = [];
    b.messages = [];
    room.applyIntent('p2', { type: 'start' });
    expect(room.state.phase).toBe('starting');
    advancePastStartSequence(room);
    expect(room.state.phase).toBe('playing');
    const snapA = a.lastSnapshot();
    const snapB = b.lastSnapshot();
    expect(snapA?.state.phase).toBe('playing');
    expect(snapB?.state.phase).toBe('playing');
    expect(snapA?.state.seekerId).toBe(snapB?.state.seekerId);

    // New joiner after end (via another end cycle)
    room.state = { ...room.state, timeRemainingMs: 0, seekerPrepRemainingMs: 0 };
    room.tick(50);
    expect(room.state.phase).toBe('ended');
    const c = new FakeSocket();
    const joined = manager.joinRoom('rematch-room', 'p3', c, 'C');
    expect(joined.message.type).toBe('welcome');
    expect(room.state.phase).toBe('lobby');
    expect(room.state.humans).toContain('p3');
  });
});

describe('practice and seeker prep on room host', () => {
  it('practice start has no seeker; prep blocks seeker move until host ticks elapse full prep', () => {
    const manager = new RoomManager();
    const a = new FakeSocket();
    manager.joinRoom('practice-room', 'solo', a, 'Solo');
    const room = manager.get('practice-room')!;
    room.applyIntent('solo', { type: 'start', mode: 'practice', practiceRole: 'rabbit' });
    expect(room.state.mode).toBe('practice');
    expect(room.state.seekerId).toBeNull();
    expect(room.state.phase).toBe('playing');

    const manager2 = new RoomManager();
    const s = new FakeSocket();
    const h = new FakeSocket();
    manager2.joinRoom('prep-room', 'seek', s, 'S');
    manager2.joinRoom('prep-room', 'hide', h, 'H');
    const r2 = manager2.get('prep-room')!;
    r2.applyIntent('seek', { type: 'start', mode: 'normal' });
    expect(r2.state.phase).toBe('starting');
    advancePastStartSequence(r2);
    expect(r2.state.phase).toBe('playing');
    expect(r2.state.seekerPrepRemainingMs).toBe(SEEKER_PREP_MS);
    const sid = r2.state.seekerId!;
    const before = { ...r2.state.entities[sid]! };
    r2.applyIntent(sid, { type: 'move', dx: 1, dy: 0 });
    // prep freezes seeker velocity
    expect(r2.state.entities[sid]!.vx).toBe(0);
    expect(canSeekerSee(r2.state, sid)).toBe(false);
    expect(isSeekerPrepActive(r2.state)).toBe(true);

    // Drive shipped host ticks for the full prep window (no force-zero)
    const tickMs = 50;
    const ticks = Math.ceil(SEEKER_PREP_MS / tickMs);
    for (let i = 0; i < ticks; i++) {
      r2.tick(tickMs);
    }

    const seekerSnap = s.lastSnapshot();
    const hiderSnap = h.lastSnapshot();
    expect(seekerSnap?.state.seekerPrepRemainingMs).toBeLessThanOrEqual(0);
    expect(hiderSnap?.state.seekerPrepRemainingMs).toBeLessThanOrEqual(0);
    expect(canSeekerSee(seekerSnap!.state, sid)).toBe(true);
    expect(isSeekerBlind(seekerSnap!.state, sid)).toBe(false);
    expect(isSeekerPrepActive(seekerSnap!.state)).toBe(false);

    r2.applyIntent(sid, { type: 'move', dx: 1, dy: 0 });
    expect(r2.state.entities[sid]!.vx).toBeGreaterThan(0);
    expect(before.id).toBe(sid);
  });

  it('dual clients: host ticks ≥ SEEKER_PREP_MS then seeker snapshot is not blind', () => {
    const manager = new RoomManager();
    const foxSock = new FakeSocket();
    const rabbitSock = new FakeSocket();
    manager.joinRoom('dual-prep', 'fox', foxSock, 'Fox');
    manager.joinRoom('dual-prep', 'rabbit', rabbitSock, 'Rabbit');
    const room = manager.get('dual-prep')!;
    room.applyIntent('fox', { type: 'start', mode: 'normal' });

    expect(foxSock.lastSnapshot()!.state.phase).toBe('starting');
    advancePastStartSequence(room);

    const startSnap = foxSock.lastSnapshot()!;
    expect(startSnap.state.phase).toBe('playing');
    expect(startSnap.state.seekerPrepRemainingMs).toBe(SEEKER_PREP_MS);
    const seekerId = startSnap.state.seekerId!;
    expect(canSeekerSee(startSnap.state, seekerId)).toBe(false);

    // Simulate PeerMultiplayer/Room host 50ms cadence over full prep
    const tickMs = 50;
    for (let elapsed = 0; elapsed < SEEKER_PREP_MS; elapsed += tickMs) {
      room.tick(tickMs);
    }
    // one extra tick in case of flooring
    room.tick(tickMs);

    const foxEnd = foxSock.lastSnapshot()!;
    const rabbitEnd = rabbitSock.lastSnapshot()!;
    expect(foxEnd.state.seekerPrepRemainingMs).toBeLessThanOrEqual(0);
    expect(rabbitEnd.state.seekerPrepRemainingMs).toBeLessThanOrEqual(0);
    expect(foxEnd.state.seekerId).toBe(rabbitEnd.state.seekerId);
    expect(canSeekerSee(foxEnd.state, seekerId)).toBe(true);
    expect(isSeekerBlind(foxEnd.state, seekerId)).toBe(false);
    expect(isSeekerPrepActive(foxEnd.state)).toBe(false);
  });
});

describe('practice rejoin after disconnect', () => {
  it('allows a second player to join practice room after the first leaves', () => {
    const manager = new RoomManager();
    const a = new FakeSocket();
    manager.joinRoom('practice', 'solo1', a, 'S1');
    const room = manager.get('practice')!;
    room.applyIntent('solo1', { type: 'start', mode: 'practice', practiceRole: 'rabbit' });
    expect(room.state.phase).toBe('playing');
    room.leave('solo1');
    expect(room.state.phase).toBe('lobby');
    expect(room.state.humans).toHaveLength(0);

    const b = new FakeSocket();
    const joined = manager.joinRoom('practice', 'solo2', b, 'S2');
    expect(joined.message.type).toBe('welcome');
    expect(room.state.phase).toBe('lobby');
    expect(room.state.humans).toContain('solo2');
    room.applyIntent('solo2', { type: 'start', mode: 'practice', practiceRole: 'fox' });
    expect(room.state.phase).toBe('playing');
    expect(room.state.mode).toBe('practice');
    expect(room.state.practiceRole).toBe('fox');
    expect(room.state.seekerId).toBe('solo2');
    // must not end immediately with seeker win
    for (let i = 0; i < 10; i++) room.tick(50);
    expect(room.state.phase).toBe('playing');
    expect(room.state.winner).toBeNull();
  });
});
