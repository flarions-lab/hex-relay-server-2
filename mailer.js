/**
 * mailer.js — sends transactional email (currently just password-reset codes)
 * via SMTP.
 *
 * Gated on SMTP_HOST/SMTP_USER/SMTP_PASS/FROM_EMAIL; until all four are set,
 * mailConfigured() is false and sendPasswordResetEmail() just logs the code
 * to the server console instead of emailing it, so the reset flow stays
 * testable without a real mail provider.
 *
 * Works with any SMTP provider (SendGrid, Mailgun, Postmark, Amazon SES, Gmail
 * SMTP, etc.) — whichever you already use for the developer/support email.
 * To go live:
 *   1. Get SMTP credentials from your provider of choice.
 *   2. Set SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASS, FROM_EMAIL
 *      on the relay server.
 *   3. `npm install` (adds nodemailer) and redeploy.
 */

const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_EMAIL = process.env.FROM_EMAIL || '';

function mailConfigured() {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS && FROM_EMAIL);
}

let _transporter = null;
function transporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return _transporter;
}

async function sendPasswordResetEmail(toEmail, code) {
  if (!mailConfigured()) {
    console.log(`[mailer] SMTP not configured — password reset code for ${toEmail}: ${code}`);
    return;
  }
  await transporter().sendMail({
    from: FROM_EMAIL,
    to: toEmail,
    subject: 'Hex-A-Gone password reset',
    text: `Your password reset code is: ${code}\n\nThis code expires in 30 minutes. If you didn't request this, you can safely ignore this email.`,
  });
}

module.exports = { mailConfigured, sendPasswordResetEmail };
