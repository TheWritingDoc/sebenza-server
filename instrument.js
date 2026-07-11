// Sentry must initialize before Express is loaded so its auto-instrumentation
// can hook the framework — this file is require()'d as the FIRST line of
// index.js. No-op unless SENTRY_DSN is set (same pattern as Twilio/SMTP:
// add the env var and it goes live, no code change).
require('dotenv').config();

const Sentry = require('@sentry/node');

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    // Errors are the point; keep performance sampling light on the free tier.
    tracesSampleRate: 0.1,
    // Don't send request bodies (may contain phone numbers / KYC fields).
    sendDefaultPii: false,
  });
  console.log('Sentry error tracking: ON');
}

module.exports = Sentry;
