import http from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './RoomManager.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const publicDir = resolve(process.env.PUBLIC_DIR || join(root, 'dist'));
const port = Number(process.env.PORT || 80);
const host = process.env.HOST || '0.0.0.0';
const manager = new RoomManager();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

function serveStatic(request, response) {
  const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  let filePath = resolve(join(publicDir, relative === '/' ? 'index.html' : relative.slice(1)));
  if (!filePath.startsWith(publicDir)) return sendJson(response, 403, { error: 'forbidden' });
  if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(publicDir, 'index.html');
  if (!existsSync(filePath)) return sendJson(response, 404, { error: 'Build output not found.' });
  response.writeHead(200, {
    'content-type': MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
  });
  createReadStream(filePath).pipe(response);
}

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/healthz') return sendJson(response, 200, { ok: true, rooms: manager.rooms.size });
  if (pathname === '/authority/status') {
    const rooms = [...manager.rooms.values()].map((room) => ({ id: room.id, phase: room.phase, size: room.size, maxPlayers: 32 }));
    return sendJson(response, 200, { rooms });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' });
  return serveStatic(request, response);
});

const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname !== '/ws') {
    socket.destroy();
    return;
  }
  websocketServer.handleUpgrade(request, socket, head, (ws) => websocketServer.emit('connection', ws, request));
});

websocketServer.on('connection', (ws) => {
  ws.roomId = null;
  ws.playerId = null;
  ws.send(JSON.stringify({ type: 'connected', message: 'Authority connection ready.' }));
  ws.on('message', (raw) => {
    try {
      const packet = JSON.parse(raw.toString());
      manager.receive(ws, packet);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message.' }));
    }
  });
  ws.on('close', () => manager.disconnect(ws));
  ws.on('error', () => manager.disconnect(ws));
});

server.listen(port, host, () => {
  console.log(`Stumble Arena authority listening on ${host}:${port}`);
  console.log(`Static build directory: ${publicDir}`);
});

function shutdown() {
  manager.close();
  websocketServer.close();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
