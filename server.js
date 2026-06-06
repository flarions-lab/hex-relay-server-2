/**
 * Hex Prototype — WebSocket Relay Server
 *
 * Run locally: npm install && node server.js
 * Deploy to Render / Railway / Fly.io and set RELAY_URL in NetworkManager.gd.
 */

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

/** code → { host, guest, name, createdAt, host_username, guest_username } */
const lobbies = new Map();

/** matchmaking queue */
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
    if (!lobby.guest && lobby.host)
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
  lobbies.set(code, {
    host: ws1, guest: ws2, name: 'Matched', createdAt: Date.now(),
    host_username: ws1.username, guest_username: ws2.username
  });
  ws1.lobbyCode = code; ws1.role = 'host';
  ws2.lobbyCode = code; ws2.role = 'guest';
  send(ws1, { type: 'mm_matched', role: 'host', opponent_username: ws2.username });
  send(ws2, { type: 'mm_matched', role: 'guest', opponent_username: ws1.username });
  send(ws1, { type: 'peer_joined', guest_username: ws2.username });
  send(ws2, { type: 'joined',      host_username:  ws1.username });
}

wss.on('connection', (ws) => {
  ws.lobbyCode = null;
  ws.role      = null;
  ws.username  = 'Player';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'host': {
        let code;
        do { code = genCode(); } while (lobbies.has(code));
        const name = (msg.name     || '').trim().slice(0, 32) || 'Open Lobby';
        ws.username = (msg.username || 'Player').trim().slice(0, 20) || 'Player';
        lobbies.set(code, {
          host: ws, guest: null, name, createdAt: Date.now(),
          host_username: ws.username, guest_username: null
        });
        ws.lobbyCode = code;
        ws.role      = 'host';
        send(ws, { type: 'code', code, name });
        break;
      }

      case 'join': {
        const code  = (msg.code || '').toUpperCase().trim();
        const lobby = lobbies.get(code);
        if (!lobby)               { send(ws, { type: 'error', msg: 'Lobby not found.' });  return; }
        if (lobby.guest && lobby.host) { send(ws, { type: 'error', msg: 'Lobby is full.' }); return; }
        ws.username = (msg.username || 'Player').trim().slice(0, 20) || 'Player';
        lobby.guest         = ws;
        lobby.guest_username = ws.username;
        ws.lobbyCode = code;
        ws.role      = 'guest';
        send(ws,         { type: 'joined',      host_username:  lobby.host_username || 'Player' });
        if (lobby.host)
          send(lobby.host, { type: 'peer_joined', guest_username: ws.username });
        break;
      }

      case 'list': {
        send(ws, { type: 'lobby_list', lobbies: openLobbies() });
        break;
      }

      case 'matchmake': {
        ws.username = (msg.username || 'Player').trim().slice(0, 20) || 'Player';
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

    // Null out the slot — keep lobby alive 60 s so the player can rejoin
    if (ws.role === 'host') lobby.host  = null;
    else                    lobby.guest = null;

    const code = ws.lobbyCode;
    setTimeout(() => {
      const l = lobbies.get(code);
      if (l && (!l.host || !l.guest)) lobbies.delete(code);
    }, 60000);
  });

  ws.on('error', () => {});
});

console.log(`Relay server listening on port ${PORT}`);
