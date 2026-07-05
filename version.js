/**
 * version.js — the current published game version + downloadable content
 * patch, checked by scripts/UpdateManager.gd on launch.
 *
 * Release process:
 *   1. In Godot, Project > Export > (select preset) > Export PCK/Zip... to
 *      produce a .pck containing the updated scripts/scenes/assets.
 *   2. Drop that file into relay_server/downloads/.
 *   3. Compute its hash: `sha256sum <file>` (or Windows:
 *      `CertUtil -hashfile <file> SHA256`).
 *   4. Bump VERSION and update PCK_FILENAME/PCK_SHA256 below.
 *   5. Sync + push into relay_server/hex-relay-server/ like any other server
 *      change (see project memory: project_accounts_store_backend).
 */

module.exports = {
  VERSION: '1.0.0',
  PCK_FILENAME: '',
  PCK_SHA256: '',
};
