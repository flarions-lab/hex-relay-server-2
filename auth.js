/**
 * auth.js — password hashing, opaque session tokens, and an Express
 * middleware that resolves `Authorization: Bearer <token>` into req.accountId.
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool, dbEnabled } = require('./db');

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** 6-digit password-reset code, e.g. "042917" — easy to type on mobile. */
function generateResetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function hashResetCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

async function createSession(accountId) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query(
    'INSERT INTO sessions (token, account_id, expires_at) VALUES ($1, $2, $3)',
    [token, accountId, expiresAt]
  );
  return token;
}

/** Resolves a bearer token to an account_id, or null if missing/invalid/expired. */
async function resolveToken(token) {
  if (!token || !dbEnabled) return null;
  const { rows } = await pool.query(
    'SELECT account_id FROM sessions WHERE token = $1 AND expires_at > now()',
    [token]
  );
  return rows.length ? rows[0].account_id : null;
}

/** Express middleware — requires a valid bearer token, attaches req.accountId. */
async function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const accountId = await resolveToken(token);
  if (!accountId) return res.status(401).json({ error: 'Unauthorized' });
  req.accountId = accountId;
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  resolveToken,
  requireAuth,
  generateResetCode,
  hashResetCode,
};
