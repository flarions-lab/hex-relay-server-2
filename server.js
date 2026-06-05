/**
 * Hex Prototype — WebSocket Relay Server
 *
 * Free hosting options:
 *   Railway.app  → connect your GitHub repo, deploy automatically
 *   Render.com   → "New Web Service" from GitHub, free tier
 *   Fly.io       → `fly launch` from this folder
 *
 * Run locally for testing:
 *   npm install
 *   node server.js
 * Then set RELAY_URL in NetworkManager.gd to "ws://localhost:8080"
 *
 * After deploying, set RELAY_URL to your deployed URL, e.g.:
 *   "wss://your-app.railway.app"
 *
 * Message types (client → server):
 *   host          { name? }          — create a named public lobby
 *   join          { code }           — join lobby by code
 *   list                             — list open lobbies
 *   matchmake                        — enter matchmaking queue
 *   cancel_matchmake                 — leave matchmaking queue
 *   start                            — host starts the game
 *   game          { action, data }   — relay game state to peer
 */

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

/** code → { host, guest, name, createdAt } */
const lobbies = new Map();

/** matchmaking queue: array of WebSocket */
const mmQueue = [];

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify(obj));
}

function openLobbies() {
  const now = Date.now();
  const out = [];
  for (const [code, lobby] of lobbies) {
    if (!lobby.guest)
      out.push({ code, name: lobby.name, age: Math.floor((now - lobby.createdAt) / 1000) });
  }
  return out;
}

function removeFromQueue(ws) {
  const idx = mmQueue.indexOf(ws);
  if (idx !== -1) mmQueue.splice(idx, 1);
}

function startMatchmakedGame(ws1, ws2) {
  let code;
  do { code = genCode(); } while (lobbies.has(code));
  lobbies.set(code, { host: ws1, guest: ws2, name: 'Matched', createdAt: Date.now() });
  ws1.lobbyCode = code; ws1.role = 'host';
  ws2.lobbyCode = code; ws2.role = 'guest';
  send(ws1, { type: 'mm_matched', role: 'host' });
  send(ws2, { type: 'mm_matched', role: 'guest' });
  // Auto-start: both sides get started so game launches immediately
  send(ws1, { type: 'peer_joined' });
  send(ws2, { type: 'joined' });
}

wss.on('connection', (ws) => {
  ws.lobbyCode = null;
  ws.role      = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'host': {
        let code;
        do { code = genCode(); } while (lobbies.has(code));
        const name = (msg.name || '').trim().slice(0, 32) || 'Open Lobby';
        lobbies.set(code, { host: ws, guest: null, name, createdAt: Date.now() });
        ws.lobbyCode = code;
        ws.role      = 'host';
        send(ws, { type: 'code', code, name });
        break;
      }

      case 'join': {
        const code  = (msg.code || '').toUpperCase().trim();
        const lobby = lobbies.get(code);
        if (!lobby)      { send(ws, { type: 'error', msg: 'Lobby not found.' });  return; }
        if (lobby.guest) { send(ws, { type: 'error', msg: 'Lobby is full.' });    return; }
        lobby.guest  = ws;
        ws.lobbyCode = code;
        ws.role      = 'guest';
        send(ws,         { type: 'joined' });
        send(lobby.host, { type: 'peer_joined' });
        break;
      }

      case 'list': {
        send(ws, { type: 'lobby_list', lobbies: openLobbies() });
        break;
      }

      case 'matchmake': {
        if (mmQueue.includes(ws)) return;
        if (mmQueue.length > 0) {
          const opponent = mmQueue.shift();
          startMatchmakedGame(opponent, ws);
        } else {
          mmQueue.push(ws);
          send(ws, { type: 'mm_waiting' });
        }
        break;
      }

      case 'cancel_matchmake': {
        removeFromQueue(ws);
        send(ws, { type: 'mm_cancelled' });
        break;
      }

      case 'start': {
        const lobby = lobbies.get(ws.lobbyCode);
        if (lobby?.guest) send(lobby.guest, { type: 'started' });
        break;
      }

      case 'game': {
        const lobby = lobbies.get(ws.lobbyCode);
        if (!lobby) return;
        const other = ws.role === 'host' ? lobby.guest : lobby.host;
        send(other, msg);
        break;
      }
    }
  });

  ws.on('close', () => {
    removeFromQueue(ws);
    const lobby = lobbies.get(ws.lobbyCode);
    if (!lobby) return;
    const other = ws.role === 'host' ? lobby.guest : lobby.host;
    send(other, { type: 'peer_left' });
    lobbies.delete(ws.lobbyCode);
  });

  ws.on('error', () => {});
});

console.log(`Relay server listening on port ${PORT}`);
