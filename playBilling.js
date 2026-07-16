/**
 * playBilling.js — verifies a Google Play in-app purchase via the Android
 * Publisher API before the store grants the entitlement.
 *
 * Gated on GOOGLE_PLAY_PACKAGE_NAME + GOOGLE_PLAY_SERVICE_ACCOUNT_JSON. Until
 * both are set, billingConfigured() is false and /store/purchase falls back
 * to the old dev-grant stub (no payment check) so local testing keeps working.
 *
 * To go live:
 *   1. Play Console -> Setup -> API access -> link/create a Google Cloud
 *      service account, grant it access to this app (Financial data +
 *      order management permission).
 *   2. Cloud Console -> IAM & Admin -> Service Accounts -> that account ->
 *      Keys -> Add key -> JSON. Download it.
 *   3. Set env vars on the relay server:
 *        GOOGLE_PLAY_PACKAGE_NAME       = com.yourstudio.yourapp
 *        GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = <the raw contents of that JSON key file>
 *      `npm install` (adds googleapis) and redeploy.
 *   4. The client's Play Billing plugin returns a product id + purchase
 *      token after a successful purchase; send both to POST /store/purchase
 *      alongside item_id.
 */

const { google } = require('googleapis');

const PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME || '';
const SERVICE_ACCOUNT_JSON = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '';

function billingConfigured() {
  return !!(PACKAGE_NAME && SERVICE_ACCOUNT_JSON);
}

let _androidPublisher = null;
function androidPublisher() {
  if (_androidPublisher) return _androidPublisher;
  const credentials = JSON.parse(SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });
  _androidPublisher = google.androidpublisher({ version: 'v3', auth });
  return _androidPublisher;
}

// purchaseState per the Android Publisher API: 0 = purchased, 1 = canceled, 2 = pending.
async function verifyPurchase(productId, purchaseToken) {
  if (!billingConfigured()) {
    throw new Error('Google Play billing verification is not configured on this server');
  }
  const publisher = androidPublisher();
  const { data } = await publisher.purchases.products.get({
    packageName: PACKAGE_NAME,
    productId,
    token: purchaseToken,
  });
  if (data.purchaseState !== 0) {
    throw new Error(`Purchase is not in a completed state (purchaseState=${data.purchaseState})`);
  }

  // Unacknowledged purchases get auto-refunded by Google after 3 days.
  if (data.acknowledgementState === 0) {
    await publisher.purchases.products.acknowledge({
      packageName: PACKAGE_NAME,
      productId,
      token: purchaseToken,
      requestBody: {},
    });
  }

  return { orderId: data.orderId || null };
}

module.exports = { billingConfigured, verifyPurchase };
