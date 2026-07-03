/**
 * achievements.js — server-side catalog mapping each achievement id to the
 * concrete unlockable assets it grants. Skus mirror the client-side
 * AchievementManager.gd mapping (scripts/AchievementManager.gd) — keep the
 * two in sync when adding achievements.
 *
 * These assets are achievement-only unlocks, not purchasable — items are
 * created with price_cents: 0, purchasable: false so they never show up in
 * /store/items.
 */

const ACHIEVEMENT_CATALOG = {
  win_easy: [{ sku: 'blade_solid', name: 'Solid Blade Variant' }],
  win_medium: [{ sku: 'blade_powerstripe', name: 'Power Stripe Blade Variant' }],
  win_hard: [{ sku: 'blade_sharp', name: 'Sharp Blade Variant' }],
  win_extra_hard: [{ sku: 'blade_solidsharp', name: 'Solid Sharp Blade Variant' }],
  win_puzzle: [{ sku: 'blade_ornate', name: 'Ornate Blade Variant' }],
  win_3_tiles_remaining: [{ sku: 'screenfx_dramatic_zoom', name: 'Dramatic Zoom Screen Effect' }],
  triple_capture: [
    { sku: 'dronebody_blackweb', name: 'Black Web Drone Body' },
    { sku: 'dronebody_reverseweb', name: 'Reverse Web Drone Body' },
  ],
  like_a_song: [{ sku: 'glow_bpm', name: 'BPM Glow Effect' }],
  defeat_bey: [
    { sku: 'drivefx_spin', name: 'Spin Drive Effect' },
    { sku: 'drivefx_multispin', name: 'Multi Spin Drive Effect' },
    { sku: 'destroyfx_split', name: 'Split Destroy Effect' },
  ],
  defeat_tron: [
    { sku: 'dronebody_hollow', name: 'Hollow Drone Body' },
    { sku: 'bg_circuit_loop', name: 'Circuit Loop Background' },
  ],
  defeat_clu: [
    { sku: 'glow_trail', name: 'Trail Glow Effect' },
    { sku: 'destroyfx_pixilate', name: 'Pixilate Destroy Effect' },
  ],
  defeat_omnitrix: [
    { sku: 'sound_omnitrix_move', name: 'Omnitrix Move Sound' },
    { sku: 'sound_omnitrix_capture', name: 'Omnitrix Capture Sound' },
    { sku: 'sound_omnitrix_time_in', name: 'Omnitrix Time In Sound' },
    { sku: 'sound_omnitrix_rotate', name: 'Omnitrix Rotate Sound' },
    { sku: 'destroyfx_explodeflash', name: 'Explode Flash Destroy Effect' },
  ],
  defeat_skynet: [{ sku: 'dronebody_metallic', name: 'Metallic Drone Body' }],
  defeat_microbots: [
    { sku: 'sound_microbot_move', name: 'Microbot Move Sound' },
    { sku: 'sound_servo_whir', name: 'Servo Whir Sound' },
  ],
  defeat_candytech: [
    { sku: 'dronebody_peppermint', name: 'Peppermint Drone Body' },
    { sku: 'sound_ballblamburgler', name: 'Ballblamburgler Sound' },
    { sku: 'sound_explosion', name: 'Explosion Sound' },
  ],
  first_mp_win: [{ sku: 'bg_heartbeat', name: 'Heartbeat Background' }],
};

module.exports = { ACHIEVEMENT_CATALOG };
