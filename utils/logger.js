// Structured JSON logging (pino) + per-request child loggers with request IDs.
// Render captures stdout, so JSON lines there become searchable; locally the
// output is still readable enough without a pretty-printer dependency.
const pino = require('pino');
const pinoHttp = require('pino-http');
const crypto = require('crypto');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined, // drop pid/hostname noise — Render adds instance context
  timestamp: pino.stdTimeFunctions.isoTime,
});

const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
  // Health checks ping every few minutes — pure noise.
  autoLogging: {
    ignore: (req) => req.url === '/api/health' || req.url.startsWith('/static/') || req.url.startsWith('/fonts/'),
  },
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, url: req.url }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

module.exports = { logger, httpLogger };
