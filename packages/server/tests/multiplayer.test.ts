import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@hide-and-seek/shared';
import { RoomManager, type SocketLike } from '../src/room.js';

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

    const snapA = a.lastSnapshot();
    const snapB = b.lastSnapshot();
    expect(snapA?.type).toBe('snapshot');
    expect(snapB?.type).toBe('snapshot');
    expect(snapA!.state.seekerId).toBe(snapB!.state.seekerId);
    expect(snapA!.state.phase).toBe('playing');
    expect(snapA!.state.humans).toEqual(expect.arrayContaining(['player-a', 'player-b']));

    const seekerId = snapA!.state.seekerId!;
    const hiderId = seekerId === 'player-a' ? 'player-b' : 'player-a';

    // Move hider — both should see new velocity after intent (via next snapshot on catch or tick)
    room.applyIntent(hiderId, { type: 'move', dx: 1, dy: 0 });
    room.tick(50);
    const afterMoveA = a.lastSnapshot()!;
    const afterMoveB = b.lastSnapshot()!;
    expect(afterMoveA.state.entities[hiderId]!.vx).toBeGreaterThan(0);
    expect(afterMoveB.state.entities[hiderId]!.vx).toBe(afterMoveA.state.entities[hiderId]!.vx);

    // Place seeker next to hider and catch
    room.state = {
      ...room.state,
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
