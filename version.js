/**
 * version.js — the current published game version + downloadable content
 * patch, checked by scripts/UpdateManager.gd on launch.
 *
 * Release process (large .pck files can't be committed to this git repo —
 * GitHub rejects pushes with files over 100MB — so they're hosted as a
 * GitHub Release asset instead, which allows up to 2GB per file):
 *   1. In Godot, Project > Export > (select preset) > Export PCK/Zip... to
 *      produce a .pck containing the updated scripts/scenes/assets.
 *   2. Create a GitHub Release (any repo works, e.g. hex-relay-server-2) via
 *      the GitHub web UI and upload the .pck as a release asset. Copy its
 *      direct download URL.
 *   3. Compute its hash: `sha256sum <file>` (or Windows:
 *      `CertUtil -hashfile <file> SHA256`).
 *   4. Bump VERSION and set PCK_URL/PCK_SHA256 below.
 *   5. Sync + push into relay_server/hex-relay-server/ like any other server
 *      change (see project memory: project_accounts_store_backend).
 */

module.exports = {
  VERSION: '1.0.5',
  PCK_URL: 'https://github.com/flarions-lab/hex-relay-server-2/releases/download/v1.0.5/Hex-A-Gone.pck',
  PCK_SHA256: '054de04baa23373543496dcbeedf1771874b0b4fe8280f7cc0dc6f440f618622',
};
