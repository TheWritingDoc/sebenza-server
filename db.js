const { PrismaClient, Prisma } = require('@prisma/client');

/**
 * Single Prisma client for the whole server. Connects through the Supabase
 * transaction pooler (DATABASE_URL must include `?pgbouncer=true` so Prisma
 * skips prepared statements). DIRECT_URL (port 5432) is only used by the
 * Prisma CLI for migrations/introspection.
 */
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production' ? ['error'] : ['warn', 'error'],
});

module.exports = { prisma, Prisma };
