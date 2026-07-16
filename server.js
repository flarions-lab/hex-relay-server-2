/**
 * Hex Prototype — WebSocket Relay Server + Accounts/Store API
 *
 * Run locally: npm install && node server.js
 * Requires DATABASE_URL (Postgres) in the environment.
 * Deploy to Render / Railway / Fly.io and set RELAY_URL in NetworkManager.gd.
 */

const http = require('http');
const express = require('express');
const WebSocket = require('ws');
const { pool, migrate, dbEnabled } = require('./db');
const { hashPassword, verifyPassword, createSession, resolveToken, requireAuth, generateResetCode, hashResetCode } = require('./auth');
const { sendPasswordResetEmail } = require('./mailer');
const { ACHIEVEMENT_CATALOG } = require('./achievements');
const { verifyPlatformToken } = require('./platformAuth');
const { billingConfigured, verifyPurchase } = require('./playBilling');
const { VERSION, PCK_URL, PCK_SHA256 } = require('./version');

const PORT = process.env.PORT || 8080;

const app = express();
app.use(express.json());

// Accounts/store need DATABASE_URL. Until it's set, fail those routes cleanly
// instead of crashing — the WebSocket relay below still runs either way.
app.use(['/auth', '/account', '/store'], (req, res, next) => {
  if (!dbEnabled) return res.status(503).json({ error: 'Accounts are not configured on this server yet.' });
  next();
});

// Version check — no DB/auth needed. scripts/UpdateManager.gd polls this once
// per launch. pck_url/sha256 are null until a release is actually published
// (see version.js's release-process comment). The .pck itself is hosted as a
// GitHub Release asset (PCK_URL), not served from this repo — GitHub blocks
// git pushes with files over 100MB, and these patches are much larger.
app.get('/version', (_req, res) => {
  res.json({
    version: VERSION,
    pck_url: PCK_URL || null,
    sha256: PCK_SHA256 || null,
  });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

/** code → { host, guest, name, createdAt, host_username, guest_username } */
const lobbies = new Map();

/** matchmaking queue */
const mmQueue = [];

// ---------------------------------------------------------------------------
// REST API — accounts, sessions, store
// ---------------------------------------------------------------------------

async function getEntitlements(accountId) {
  const { rows } = await pool.query(
    `SELECT items.sku FROM entitlements
     JOIN items ON items.id = entitlements.item_id
     WHERE entitlements.account_id = $1`,
    [accountId]
  );
  return rows.map((r) => r.sku);
}

app.post('/auth/register', async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'username, email, and password are required' });
  }
  const trimmedUsername = String(username).trim().slice(0, 20);
  const trimmedEmail = String(email).trim().toLowerCase().slice(0, 254);
  if (!trimmedUsername || !trimmedEmail || String(password).length < 8) {
    return res.status(400).json({ error: 'Invalid username/email, or password too short (min 8 chars)' });
  }

  try {
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query(
      'INSERT INTO accounts (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [trimmedUsername, trimmedEmail, passwordHash]
    );
    const token = await createSession(rows[0].id);
    res.json({ token, username: trimmedUsername });
  } catch (err) {
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'Username or email already taken' });
    }
    console.error(err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', async (req, res) => {
  const { username_or_email, password } = req.body || {};
  if (!username_or_email || !password) {
    return res.status(400).json({ error: 'username_or_email and password are required' });
  }
  const identifier = String(username_or_email).trim().toLowerCase();

  const { rows } = await pool.query(
    'SELECT id, username, password_hash FROM accounts WHERE lower(username) = $1 OR email = $1',
    [identifier]
  );
  const account = rows[0];
  if (!account || !account.password_hash || !(await verifyPassword(password, account.password_hash))) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = await createSession(account.id);
  res.json({ token, username: account.username });
});

// Step 1 of password reset: emails a 6-digit code if the address matches an
// account. Always responds 200 regardless of a match, so callers can't probe
// which emails have accounts registered.
app.post('/auth/request-password-reset', async (req, res) => {
  const { email } = req.body || {};
  const trimmedEmail = String(email || '').trim().toLowerCase().slice(0, 254);
  if (!trimmedEmail) return res.status(400).json({ error: 'email is required' });

  const { rows } = await pool.query('SELECT id FROM accounts WHERE email = $1', [trimmedEmail]);
  if (rows.length) {
    const accountId = rows[0].id;
    const code = generateResetCode();
    await pool.query(
      `INSERT INTO password_resets (account_id, code_hash, expires_at)
       VALUES ($1, $2, now() + interval '30 minutes')`,
      [accountId, hashResetCode(code)]
    );
    sendPasswordResetEmail(trimmedEmail, code).catch(err => console.error('sendPasswordResetEmail failed:', err));
  }
  res.json({ ok: true });
});

// Step 2: redeems the code and sets a new password. Also clears every
// existing session on the account, since a password reset usually means the
// old password may be compromised.
app.post('/auth/reset-password', async (req, res) => {
  const { email, code, new_password } = req.body || {};
  const trimmedEmail = String(email || '').trim().toLowerCase().slice(0, 254);
  if (!trimmedEmail || !code || !new_password) {
    return res.status(400).json({ error: 'email, code, and new_password are required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'Password too short (min 8 chars)' });
  }

  const { rows: acctRows } = await pool.query('SELECT id FROM accounts WHERE email = $1', [trimmedEmail]);
  if (!acctRows.length) return res.status(400).json({ error: 'Invalid or expired code' });
  const accountId = acctRows[0].id;

  const { rows } = await pool.query(
    `SELECT id, code_hash, attempts FROM password_resets
     WHERE account_id = $1 AND used = false AND expires_at > now()
     ORDER BY created_at DESC LIMIT 1`,
    [accountId]
  );
  const reset = rows[0];
  if (!reset || reset.attempts >= 5 || reset.code_hash !== hashResetCode(String(code).trim())) {
    if (reset) await pool.query('UPDATE password_resets SET attempts = attempts + 1 WHERE id = $1', [reset.id]);
    return res.status(400).json({ error: 'Invalid or expired code' });
  }

  const passwordHash = await hashPassword(new_password);
  await pool.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [passwordHash, accountId]);
  await pool.query('UPDATE password_resets SET used = true WHERE id = $1', [reset.id]);
  await pool.query('DELETE FROM sessions WHERE account_id = $1', [accountId]);

  res.json({ ok: true });
});

app.post('/auth/logout', requireAuth, async (req, res) => {
  const header = req.get('Authorization') || '';
  const token = header.slice(7);
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
});

async function generateUniqueUsername() {
  for (let i = 0; i < 10; i++) {
    const candidate = `Player_${Math.floor(Math.random() * 1e8)}`;
    const { rows } = await pool.query('SELECT 1 FROM accounts WHERE username = $1', [candidate]);
    if (!rows.length) return candidate;
  }
  throw new Error('Could not generate a unique username');
}

// Logs in via a Steam/Google Play identity, creating a new account the first
// time that platform_user_id is seen. See platformAuth.js — token
// verification is currently a dev stub.
app.post('/auth/platform-login', async (req, res) => {
  const { platform, token } = req.body || {};
  let identity;
  try {
    identity = await verifyPlatformToken(platform, token);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const existing = await pool.query(
    'SELECT account_id FROM platform_identities WHERE platform = $1 AND platform_user_id = $2',
    [platform, identity.platform_user_id]
  );

  let accountId, username;
  let isNewAccount = false;
  if (existing.rows.length) {
    accountId = existing.rows[0].account_id;
    const { rows } = await pool.query('SELECT username FROM accounts WHERE id = $1', [accountId]);
    username = rows[0].username;
  } else {
    // display_name isn't guaranteed unique, so always auto-generate the
    // account username for now rather than risk a collision on insert.
    isNewAccount = true;
    username = await generateUniqueUsername();
    const { rows } = await pool.query(
      'INSERT INTO accounts (username) VALUES ($1) RETURNING id',
      [username]
    );
    accountId = rows[0].id;
    await pool.query(
      'INSERT INTO platform_identities (account_id, platform, platform_user_id) VALUES ($1, $2, $3)',
      [accountId, platform, identity.platform_user_id]
    );
  }

  const sessionToken = await createSession(accountId);
  // is_new_account tells the client this identity had never been seen before —
  // used to warn "if you already have an account elsewhere, log in and link
  // this platform instead" rather than silently fragmenting progress across
  // two accounts.
  res.json({ token: sessionToken, username, is_new_account: isNewAccount });
});

app.get('/account/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('SELECT username FROM accounts WHERE id = $1', [req.accountId]);
  if (!rows.length) return res.status(404).json({ error: 'Account not found' });
  const entitlements = await getEntitlements(req.accountId);
  res.json({ username: rows[0].username, entitlements });
});

// Links a Steam/Google Play identity to the currently-authenticated account.
app.post('/account/link-platform', requireAuth, async (req, res) => {
  const { platform, token } = req.body || {};
  let identity;
  try {
    identity = await verifyPlatformToken(platform, token);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const existing = await pool.query(
    'SELECT account_id FROM platform_identities WHERE platform = $1 AND platform_user_id = $2',
    [platform, identity.platform_user_id]
  );
  if (existing.rows.length && existing.rows[0].account_id !== req.accountId) {
    return res.status(409).json({ error: 'That account is already linked to a different HexPrototype account.' });
  }
  if (!existing.rows.length) {
    await pool.query(
      'INSERT INTO platform_identities (account_id, platform, platform_user_id) VALUES ($1, $2, $3)',
      [req.accountId, platform, identity.platform_user_id]
    );
  }
  res.json({ ok: true });
});

app.get('/account/platforms', requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT platform FROM platform_identities WHERE account_id = $1',
    [req.accountId]
  );
  res.json({ platforms: rows.map((r) => r.platform) });
});

app.get('/store/items', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, sku, name, price_cents FROM items WHERE active = true AND purchasable = true ORDER BY id'
  );
  res.json({ items: rows });
});

// Grants every asset an achievement unlocks. Idempotent — safe to call again
// for an already-unlocked achievement (e.g. AchievementManager.gd syncing
// local-only progress up on first login).
app.post('/account/unlock-achievement', requireAuth, async (req, res) => {
  const { achievement_id } = req.body || {};
  const rewards = ACHIEVEMENT_CATALOG[achievement_id];
  if (!rewards) return res.status(400).json({ error: 'Unknown achievement_id' });

  for (const { sku, name } of rewards) {
    const { rows } = await pool.query(
      `INSERT INTO items (sku, name, price_cents, purchasable) VALUES ($1, $2, 0, false)
       ON CONFLICT (sku) DO NOTHING
       RETURNING id`,
      [sku, name]
    );
    const itemId = rows.length ? rows[0].id : (await pool.query('SELECT id FROM items WHERE sku = $1', [sku])).rows[0].id;
    await pool.query(
      `INSERT INTO entitlements (account_id, item_id, source) VALUES ($1, $2, 'achievement')
       ON CONFLICT (account_id, item_id) DO NOTHING`,
      [req.accountId, itemId]
    );
  }

  await pool.query(
    `INSERT INTO achievements (account_id, achievement_id) VALUES ($1, $2)
     ON CONFLICT (account_id, achievement_id) DO NOTHING`,
    [req.accountId, achievement_id]
  );

  const entitlements = await getEntitlements(req.accountId);
  res.json({ ok: true, entitlements });
});

// Verifies a Google Play purchase (when GOOGLE_PLAY_PACKAGE_NAME +
// GOOGLE_PLAY_SERVICE_ACCOUNT_JSON are configured, see playBilling.js) before
// granting the entitlement. Falls back to the old no-payment dev grant when
// billing isn't configured, so local testing without a Play Console app keeps
// working. purchase_token is required only in the real-billing path.
app.post('/store/purchase', requireAuth, async (req, res) => {
  const { item_id, purchase_token } = req.body || {};
  const { rows } = await pool.query(
    'SELECT id, sku, google_play_product_id FROM items WHERE id = $1 AND active = true',
    [item_id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Item not found' });
  const item = rows[0];

  let source = 'dev_grant';
  if (billingConfigured()) {
    if (!purchase_token) return res.status(400).json({ error: 'Missing purchase_token' });

    let verified;
    try {
      verified = await verifyPurchase(item.google_play_product_id || item.sku, purchase_token);
    } catch (err) {
      return res.status(402).json({ error: `Purchase verification failed: ${err.message}` });
    }

    try {
      await pool.query(
        `INSERT INTO processed_purchases (purchase_token, account_id, item_id, order_id)
         VALUES ($1, $2, $3, $4)`,
        [purchase_token, req.accountId, item.id, verified.orderId]
      );
    } catch (err) {
      // purchase_token PRIMARY KEY collision — this token was already redeemed.
      return res.status(409).json({ error: 'This purchase has already been redeemed.' });
    }
    source = 'google_play';
  }

  await pool.query(
    `INSERT INTO entitlements (account_id, item_id, source) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, item_id) DO NOTHING`,
    [req.accountId, item.id, source]
  );
  const entitlements = await getEntitlements(req.accountId);
  res.json({ ok: true, entitlements });
});

// ---------------------------------------------------------------------------
// WebSocket relay — lobbies + matchmaking
// ---------------------------------------------------------------------------

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
  send(ws1, { type: 'peer_joined', guest_username: ws2.username, equipped_item_sku: ws2.equippedItemSku });
  send(ws2, { type: 'joined',      host_username:  ws1.username, equipped_item_sku: ws1.equippedItemSku });
}

/** Resolves msg.token to an account_id + verified equipped_item_sku (or null for both). */
async function resolveIdentity(ws, msg) {
  ws.accountId = await resolveToken(msg.token);
  ws.equippedItemSku = null;
  if (ws.accountId && msg.equipped_item_sku) {
    const owned = await getEntitlements(ws.accountId);
    if (owned.includes(msg.equipped_item_sku)) ws.equippedItemSku = msg.equipped_item_sku;
  }
}

wss.on('connection', (ws) => {
  ws.lobbyCode = null;
  ws.role      = null;
  ws.username  = 'Player';
  ws.accountId = null;
  ws.equippedItemSku = null;

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'host': {
        await resolveIdentity(ws, msg);
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
        await resolveIdentity(ws, msg);
        const code  = (msg.code || '').toUpperCase().trim();
        const lobby = lobbies.get(code);
        if (!lobby)               { send(ws, { type: 'error', msg: 'Lobby not found.' });  return; }
        if (lobby.guest && lobby.host) { send(ws, { type: 'error', msg: 'Lobby is full.' }); return; }
        ws.username = (msg.username || 'Player').trim().slice(0, 20) || 'Player';
        lobby.guest         = ws;
        lobby.guest_username = ws.username;
        ws.lobbyCode = code;
        ws.role      = 'guest';
        send(ws,         { type: 'joined',      host_username:  lobby.host_username || 'Player', equipped_item_sku: lobby.host?.equippedItemSku });
        if (lobby.host)
          send(lobby.host, { type: 'peer_joined', guest_username: ws.username, equipped_item_sku: ws.equippedItemSku });
        break;
      }

      case 'list': {
        send(ws, { type: 'lobby_list', lobbies: openLobbies() });
        break;
      }

      case 'matchmake': {
        await resolveIdentity(ws, msg);
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

if (!dbEnabled) {
  console.warn('DATABASE_URL not set — accounts/store disabled, relay-only mode.');
}

migrate()
  .then(() => {
    server.listen(PORT, () => console.log(`Relay server listening on port ${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to migrate database:', err);
    process.exit(1);
  });
