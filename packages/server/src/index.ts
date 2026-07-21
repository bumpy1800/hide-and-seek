import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { ClientMessage } from '@hide-and-seek/shared';
import { RoomManager } from './room.js';

const PORT = Number(process.env.PORT ?? 8787);
const TICK_MS = 50;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prefer monorepo client dist when present
const STATIC_CANDIDATES = [
  process.env.STATIC_DIR,
  path.resolve(__dirname, '../../client/dist'),
  path.resolve(__dirname, '../public'),
].filter(Boolean) as string[];

function resolveStaticRoot(): string | null {
  for (const dir of STATIC_CANDIDATES) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

const staticRoot = resolveStaticRoot();
const manager = new RoomManager();

function contentType(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.map')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, static: Boolean(staticRoot) }));
    return;
  }

  if (staticRoot) {
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    rel = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(staticRoot, rel);
    if (!filePath.startsWith(staticRoot)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(staticRoot, 'index.html');
    }
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'content-type': contentType(filePath) });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
  }

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('Hide-and-Seek multiplayer host\n');
});

const wss = new WebSocketServer({ server });

type ClientMeta = { playerId: string; roomId: string | null };

wss.on('connection', (socket) => {
  const meta: ClientMeta = { playerId: randomUUID(), roomId: null };

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      socket.send(JSON.stringify({ type: 'error', message: 'invalid_json' }));
      return;
    }

    if (msg.type === 'join') {
      if (meta.roomId) {
        manager.get(meta.roomId)?.leave(meta.playerId);
      }
      const { room, message } = manager.joinRoom(msg.roomId, meta.playerId, socket, msg.name);
      if (message.type === 'error') {
        socket.send(JSON.stringify(message));
        return;
      }
      meta.roomId = room.id;
      socket.send(JSON.stringify(message));
      room.broadcastSnapshot();
      return;
    }

    if (!meta.roomId) {
      socket.send(JSON.stringify({ type: 'error', message: 'not_joined' }));
      return;
    }
    manager.get(meta.roomId)?.handleMessage(meta.playerId, msg);
  });

  socket.on('close', () => {
    if (meta.roomId) {
      manager.get(meta.roomId)?.leave(meta.playerId);
    }
  });
});

setInterval(() => {
  manager.tickAll(TICK_MS);
}, TICK_MS);

server.listen(PORT, () => {
  console.log(`Hide-and-Seek server listening on :${PORT} static=${staticRoot ?? 'none'}`);
});

export { manager, server, wss };
