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
      email         TEXT UNIQUE,
      password_hash TEXT,
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

    CREATE TABLE IF NOT EXISTS achievements (
      account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      achievement_id  TEXT NOT NULL,
      unlocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, achievement_id)
    );

    CREATE TABLE IF NOT EXISTS platform_identities (
      id               SERIAL PRIMARY KEY,
      account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform         TEXT NOT NULL,
      platform_user_id TEXT NOT NULL,
      linked_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (platform, platform_user_id)
    );

    -- One row per redeemed Google Play purchase token. The PRIMARY KEY on
    -- purchase_token is what stops the same real-money purchase from being
    -- replayed to grant the item to a second account.
    CREATE TABLE IF NOT EXISTS processed_purchases (
      purchase_token  TEXT PRIMARY KEY,
      account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      item_id         INTEGER NOT NULL REFERENCES items(id),
      order_id        TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- One row per requested password-reset code. code_hash, not the raw code,
    -- is stored — same reasoning as password_hash on accounts.
    CREATE TABLE IF NOT EXISTS password_resets (
      id          SERIAL PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      code_hash   TEXT NOT NULL,
      expires_at  TIMESTAMPTZ NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      used        BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    ALTER TABLE items ADD COLUMN IF NOT EXISTS purchasable BOOLEAN NOT NULL DEFAULT true;
  `);
  await pool.query(`
    -- Google Play Console in-app product id, if it differs from our own sku.
    -- Falls back to sku when null (the common case: keep them identical).
    ALTER TABLE items ADD COLUMN IF NOT EXISTS google_play_product_id TEXT;
  `);
  await pool.query(`
    ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL;
    ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
  `);
}

module.exports = { pool, migrate, dbEnabled };
