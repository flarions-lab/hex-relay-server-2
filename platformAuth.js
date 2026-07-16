/**
 * platformAuth.js — verifies a platform auth token and returns the stable
 * platform_user_id to link/log in against.
 *
 * google_play: when GOOGLE_OAUTH_CLIENT_ID is set, `token` is treated as a real
 * Google ID token (a JWT from Google Sign-In / Play Games Services on the client)
 * and is verified against Google's public keys via google-auth-library. The
 * audience must match GOOGLE_OAUTH_CLIENT_ID (the OAuth 2.0 *Web* client ID from
 * the Google Cloud Console project linked to your Play Console). The verified
 * Google subject (`sub`) becomes the platform_user_id.
 *
 * Fallback: if GOOGLE_OAUTH_CLIENT_ID is unset (or for `steam`, which has no App
 * ID yet), a deterministic dev-stub id is derived from the token so the
 * create/find/link flow stays fully exercisable in development.
 *
 * To go live for Google:
 *   1. In Google Cloud Console (the project behind your Play Console), create an
 *      OAuth 2.0 "Web application" client ID.
 *   2. Set env var GOOGLE_OAUTH_CLIENT_ID to that client ID on the relay server.
 *   3. `npm install` (adds google-auth-library) and redeploy.
 *   4. Have the Android client send the ID token it gets from the Play Games /
 *      Google Sign-In plugin as `token`.
 */

const crypto = require('crypto');

// Optional at dev time; only needed once GOOGLE_OAUTH_CLIENT_ID is set.
let OAuth2Client = null;
try {
  OAuth2Client = require('google-auth-library').OAuth2Client;
} catch (_) {
  // library not installed yet — dev stub path still works
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
let _googleClient = null;
function googleClient() {
  if (!_googleClient && OAuth2Client) {
    _googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
  }
  return _googleClient;
}

function devStubIdentity(platform, token) {
  const hash = crypto.createHash('sha256').update(`${platform}:${token}`).digest('hex');
  return { platform_user_id: `devstub_${hash.slice(0, 24)}`, display_name: null };
}

async function verifyGoogleIdToken(idToken) {
  const client = googleClient();
  if (!client) {
    throw new Error('Google verification unavailable: run `npm install google-auth-library`');
  }
  const ticket = await client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Invalid Google ID token');
  }
  return {
    platform_user_id: payload.sub, // stable, unique Google account id
    display_name: payload.name || payload.email || null,
  };
}

async function verifyPlatformToken(platform, token) {
  if (platform !== 'steam' && platform !== 'google_play') {
    throw new Error('Unsupported platform');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('Missing token');
  }

  // Real verification once a Google OAuth client id is configured.
  if (platform === 'google_play' && GOOGLE_CLIENT_ID) {
    return verifyGoogleIdToken(token);
  }

  // steam (no App ID yet), or google_play before GOOGLE_OAUTH_CLIENT_ID is set.
  return devStubIdentity(platform, token);
}

module.exports = { verifyPlatformToken };
