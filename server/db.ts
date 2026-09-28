/**
 * SportingSpy PostgreSQL Client Singleton
 * =========================================
 * PHASE 2 — POSTGRESQL MIGRATION.
 *
 * A single shared Prisma Client instance for the whole server process,
 * backed by the `pg` driver adapter (required by Prisma 7's ESM-first
 * client generator — see prisma/schema.prisma's `generator client` block).
 *
 * This is the ONE place the app knows it's talking to PostgreSQL. Every
 * route handler in server.ts imports `prisma` from here and calls
 * `prisma.article.findMany(...)`, etc. — no more read-the-whole-file /
 * write-the-whole-file JSON persistence at runtime.
 */

import 'dotenv/config';
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.env.DATABASE_URL) {
  // eslint-disable-next-line no-console
  console.error(
    '[FATAL] DATABASE_URL is not set. Copy .env.example to .env and point it at your local PostgreSQL ' +
      'database (see PROJECT_BRAIN.md "Phase 2" for exact setup commands). Refusing to start without it.'
  );
  process.exit(1);
}

// PHASE B: Express (loaded by tsx) and the Next.js server bundle both
// import this module inside the same Node process, so it can be evaluated
// twice. A process-wide singleton keeps ONE connection pool and one set of
// shutdown handlers regardless.
const globalForPrisma = globalThis as unknown as { __sportingspyPrisma?: PrismaClient; __sportingspyShutdownHooked?: boolean };

export const prisma: PrismaClient =
  globalForPrisma.__sportingspyPrisma ??
  (globalForPrisma.__sportingspyPrisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }));

// PHASE 2.1: close the connection pool cleanly on shutdown instead of
// leaving it to be torn down abruptly. Registered once per process.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[SportingSpy] Received ${signal}, closing database connection...`);
  try {
    await prisma.$disconnect();
  } catch (err) {
    console.error('[SportingSpy] Error while disconnecting Prisma client:', err);
  } finally {
    process.exit(0);
  }
}
if (!globalForPrisma.__sportingspyShutdownHooked) {
  globalForPrisma.__sportingspyShutdownHooked = true;
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
