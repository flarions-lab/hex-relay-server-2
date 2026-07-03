/**
 * db.js — Postgres connection pool + schema migration.
 *
 * Set DATABASE_URL in the environment (e.g. Render Postgres connection string,
 * or a local Postgres instance for dev).
 */

const { Pool } = require('pg');

const dbEnabled = !!process.env.DATABASE_URL;

function wantsSSL(connectionString) {
  return !!connectionString && !/localhost|127\.0\.0\.1/.test(connectionString);
}

const pool = dbEnabled
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: wantsSSL(process.env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
    })
  : null;

async function migrate() {
  if (!dbEnabled) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS items (
      id          SERIAL PRIMARY KEY,
      sku         TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      price_cents INTEGER NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS entitlements (
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      item_id     INTEGER NOT NULL REFERENCES items(id),
      granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      source      TEXT NOT NULL DEFAULT 'purchase',
      PRIMARY KEY (account_id, item_id)
    );
  `);
}

module.exports = { pool, migrate, dbEnabled };
