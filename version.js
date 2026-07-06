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
  VERSION: '1.0.8',
  PCK_URL: 'https://github.com/flarions-lab/hex-relay-server-2/releases/download/v1.0.8/Hex-A-Gone.pck',
  PCK_SHA256: '83fe141eec2450065c49677395a11e2333c3deb4850dd97f95e8ca3e37d0d9b4',
};
