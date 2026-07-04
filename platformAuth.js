/**
 * platformAuth.js — verifies a platform auth token and returns the stable
 * platform_user_id to link/log in against.
 *
 * DEV STUB: neither a Steam App ID nor a Google Play Console app exists yet,
 * so there is no real Steamworks/Google API to call. Instead this derives a
 * deterministic fake platform_user_id from the token string itself, so the
 * account-linking flow (create/find/link) is fully exercisable end-to-end
 * before real credentials exist.
 *
 * Replace this function's body with real verification before shipping:
 *   - steam: call Steamworks Web API `ISteamUserAuth/AuthenticateUserTicket`
 *     with the session ticket the client got from GodotSteam, extract the
 *     verified SteamID64.
 *   - google_play: verify the ID token (Google Sign-In) or server-side
 *     Play Games Services auth code, extract the verified Google/Play user id.
 * Everything else in server.js (platform-login, link-platform) stays the same
 * — only this function's internals need to change.
 */

const crypto = require('crypto');

async function verifyPlatformToken(platform, token) {
  if (platform !== 'steam' && platform !== 'google_play') {
    throw new Error('Unsupported platform');
  }
  if (!token || typeof token !== 'string') {
    throw new Error('Missing token');
  }

  const hash = crypto.createHash('sha256').update(`${platform}:${token}`).digest('hex');
  return {
    platform_user_id: `devstub_${hash.slice(0, 24)}`,
    display_name: null,
  };
}

module.exports = { verifyPlatformToken };
