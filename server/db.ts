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

// PHASE R (deployment): `next build` imports this module while collecting page
// data but never queries (every page is dynamic; the pool connects lazily), so
// a clean build, e.g. on Render, needs no database. The running server still
// refuses to start without DATABASE_URL.
if (!process.env.DATABASE_URL && process.env.NEXT_PHASE !== 'phase-production-build') {
  // eslint-disable-next-line no-console
  console.error(
    '[FATAL] DATABASE_URL is not set. Copy .env.example to .env and point it at your local PostgreSQL ' +
      'database (see DEPLOYMENT.md and DATABASE_OPERATIONS.md for setup). Refusing to start without it.'
  );
  process.exit(1);
}

// PHASE B: Express (loaded by tsx) and the Next.js server bundle both
// import this module inside the same Node process, so it can be evaluated
// twice. A process-wide singleton keeps ONE connection pool. The HTTP server
// owns shutdown so it can drain requests before disconnecting this pool.
const globalForPrisma = globalThis as unknown as { __sportingspyPrisma?: PrismaClient };

// PHASE P (diagnostics, off by default): PRISMA_QUERY_LOG=true prints one
// "[db-query] <ms>ms <sql>" line per query, so performance audits can count
// and time the queries behind a request. Never enable it in production.
// Pool size cap: managed PostgreSQL plans allow few connections (Aiven's
// smallest: 20, 3 reserved), and a zero-downtime deploy briefly runs the old
// and new instance side by side, plus any local process on the same database.
// pg's default of 10 per process can exhaust that (P2037), so default to 5.
export function poolMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.DATABASE_POOL_MAX);
  return Number.isInteger(n) && n >= 1 && n <= 50 ? n : 5;
}

function createClient(): PrismaClient {
  const queryLog = process.env.PRISMA_QUERY_LOG === 'true';
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, max: poolMax(), idleTimeoutMillis: 10_000 }), ...(queryLog ? { log: [{ emit: 'event' as const, level: 'query' as const }] } : {}) });
  if (queryLog) (client as unknown as { $on: (e: 'query', cb: (q: { duration: number; query: string }) => void) => void }).$on('query', (q) => console.log(`[db-query] ${q.duration}ms ${q.query.replace(/\s+/g, ' ').slice(0, 300)}`));
  return client;
}

export const prisma: PrismaClient =
  globalForPrisma.__sportingspyPrisma ??
  (globalForPrisma.__sportingspyPrisma = createClient());
