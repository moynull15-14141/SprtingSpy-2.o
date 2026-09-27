/**
 * SportingSpy Legacy JSON Database Shape
 * =======================================
 * PHASE 2 — POSTGRESQL MIGRATION.
 *
 * This is the exact shape of data/db.json, extracted out of server.ts so
 * both the running server (during the Phase 2 cutover window) and the
 * one-off `server/scripts/migrate-json-to-postgres.ts` script can agree on
 * what the legacy file looks like and how to normalize it, without
 * duplicating the logic.
 *
 * `migrateSchema()` is the same Phase 1 normalization function, moved here
 * unchanged: it fills in fields the live data/db.json predates (sessions
 * collection, user passwordHash/status/updatedAt, Author.userId linking) —
 * see its own docstring below for why each of those exists. The migration
 * script calls this against an in-memory copy of the JSON and NEVER writes
 * the result back to data/db.json — the file is treated as an immutable
 * migration source per Phase 2's requirements.
 */

import {
  AdSlotConfig,
  Article,
  AuditLog,
  Author,
  Comment,
  EventEdition,
  MediaItem,
  RedirectRule,
  SessionRecord,
  Sport,
  SportEvent,
  User,
} from '../src/types';
import { hashPassword } from './password';

export interface DatabaseSchema {
  sports: Sport[];
  events: SportEvent[];
  editions: EventEdition[];
  articles: Article[];
  authors: Author[];
  users: User[];
  comments: Comment[];
  mediaItems: MediaItem[];
  adSlots: AdSlotConfig[];
  auditLogs: AuditLog[];
  redirectRules: RedirectRule[];
  sessions: SessionRecord[];
}

/**
 * Every seeded demo account that predates Phase 1 gets this password
 * assigned automatically by migrateSchema(), purely so the existing demo
 * dataset remains logged-in-able out of the box. LOCAL DEVELOPMENT DEFAULT
 * for pre-existing seed content only.
 */
export const LEGACY_SEED_DEFAULT_PASSWORD = 'ChangeMe123!';

/**
 * PHASE 1 deterministic, idempotent schema migration (unchanged from
 * server.ts — moved here in Phase 2 so the Postgres migration script can
 * reuse it against an in-memory copy of data/db.json without ever writing
 * back to the file).
 */
export function migrateSchema(db: DatabaseSchema): boolean {
  let changed = false;

  if (!Array.isArray(db.sessions)) {
    db.sessions = [];
    changed = true;
  }

  const now = new Date().toISOString();
  for (const user of db.users) {
    if (!user.passwordHash) {
      user.passwordHash = hashPassword(LEGACY_SEED_DEFAULT_PASSWORD);
      changed = true;
    }
    if (!user.status) {
      user.status = 'active';
      changed = true;
    }
    if (!user.updatedAt) {
      user.updatedAt = user.joinedAt || now;
      changed = true;
    }
  }

  for (const author of db.authors) {
    if (author.userId === undefined) {
      const match = author.email
        ? db.users.find((u) => u.email.toLowerCase() === author.email!.toLowerCase())
        : undefined;
      author.userId = match ? match.id : null;
      changed = true;
    }
  }

  return changed;
}
