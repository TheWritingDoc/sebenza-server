/**
 * Email sending — demo-aware, mirroring the SMS convention in routes/sms.js.
 *
 * If SMTP credentials are configured (EMAIL_HOST/EMAIL_USER/EMAIL_PASS, or
 * a SendGrid API key), real email is sent. Otherwise we run in demo mode:
 * the code is logged to the server console and returned to the caller so the
 * flow is fully testable without a mail provider. Add creds later and it goes
 * live with no code change.
 *
 * Env (any one setup works):
 *   EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS, EMAIL_FROM   (generic SMTP)
 *   or SENDGRID_API_KEY (uses SendGrid SMTP), EMAIL_FROM
 */

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* optional */ }

const FROM = process.env.EMAIL_FROM || 'Sebenza <no-reply@sebenza.app>';

function isConfigured() {
  return !!(
    (process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS) ||
    process.env.SENDGRID_API_KEY
  );
}

function buildTransport() {
  if (!nodemailer) return null;
  if (process.env.SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    });
  }
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: String(process.env.EMAIL_PORT) === '465',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

/**
 * Send a Sebenza verification code by email.
 * @returns {{ sent: boolean, demo: boolean, code?: string }}
 *   In demo mode, `demo:true` and the `code` is returned so the client can
 *   surface it for testing. In live mode, `sent:true` and no code is returned.
 */
async function sendVerificationEmail(to, code) {
  const subject = 'Your Sebenza verification code';
  const text = `Your Sebenza email verification code is: ${code}\n\nIt expires in 15 minutes. If you didn't request this, you can ignore this email.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:440px;margin:auto">
      <h2 style="color:#4f46e5">Verify your email</h2>
      <p>Enter this code in the Sebenza app to verify your email address:</p>
      <div style="font-size:32px;font-weight:800;letter-spacing:6px;color:#1e293b;
                  background:#f1f5f9;border-radius:12px;padding:16px;text-align:center">${code}</div>
      <p style="color:#64748b;font-size:13px">It expires in 15 minutes.</p>
    </div>`;

  // SECURITY: only expose the code in the response outside production. In prod
  // without mail creds the caller gets a "not configured" signal, never the code.
  const isProd = process.env.NODE_ENV === 'production';
  if (!isConfigured()) {
    console.log(`Demo mode - Email code for ${to}: ${code}`);
    return { sent: false, demo: !isProd, code: isProd ? undefined : code, configured: false };
  }

  const transport = buildTransport();
  if (!transport) {
    console.log(`Email transport unavailable - code for ${to}: ${code}`);
    return { sent: false, demo: !isProd, code: isProd ? undefined : code, configured: false };
  }
  await transport.sendMail({ from: FROM, to, subject, text, html });
  return { sent: true, demo: false };
}

module.exports = { sendVerificationEmail, isConfigured };
