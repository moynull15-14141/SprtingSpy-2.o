/**
 * SportingSpy JSON -> PostgreSQL Migration Script
 * =================================================
 * PHASE 2 — POSTGRESQL MIGRATION.
 *
 * Reads the existing data/db.json (read-only — this script never writes to
 * it), applies the same Phase 1 field-normalization that the running server
 * already performs (server/jsonSchema.ts's migrateSchema — assigns a
 * default password hash to any pre-Phase-1 seed user, links Author<->User
 * by email, etc.) to an IN-MEMORY copy only, then upserts everything into
 * PostgreSQL via Prisma in dependency-safe order:
 *
 *   Sport -> SportEvent -> EventEdition -> User -> Author -> Article ->
 *   Comment -> MediaItem -> AdSlotConfig -> RedirectRule -> AuditLog -> Session
 *
 * Safe to re-run: every insert is an `upsert` keyed by the record's existing
 * id, so running this script twice converges to the same end state instead
 * of creating duplicates. The whole migration runs inside one Prisma
 * transaction — it either fully succeeds or fully rolls back, so a failure
 * partway through never leaves the database half-migrated.
 *
 * PHASE 2.1: before touching the database at all, this now calls
 * assertSafeForBulkDbOperation() (see server/dbSafety.ts) — a guard against
 * accidentally running a bulk-upsert script against a DATABASE_URL that
 * doesn't look like a local development database.
 *
 * Run with: npm run db:migrate-data
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '../db';
import { DatabaseSchema, migrateSchema } from '../jsonSchema';
import { Prisma } from '../generated/prisma/client';
import { assertSafeForBulkDbOperation } from '../dbSafety';

assertSafeForBulkDbOperation('db:migrate-data');

const DB_FILE = path.resolve(process.cwd(), 'data', 'db.json');

function toDate(value: string | undefined | null): Date | null {
  return value ? new Date(value) : null;
}

/** Prisma requires the Prisma.JsonNull sentinel (not plain `null`) to store a SQL NULL in a nullable Json column. */
function jsonOrNull(value: unknown): object | typeof Prisma.JsonNull {
  return value === undefined || value === null ? Prisma.JsonNull : (value as object);
}

function toDateRequired(value: string): Date {
  return new Date(value);
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`[migrate] No data/db.json found at ${DB_FILE} — nothing to migrate.`);
    process.exit(1);
  }

  console.log(`[migrate] Reading ${DB_FILE} (read-only — this file will not be modified)...`);
  const raw = fs.readFileSync(DB_FILE, 'utf-8');
  const db: DatabaseSchema = JSON.parse(raw);

  // Normalize in-memory only (assigns default password hashes to legacy
  // seed users, links Author.userId, ensures a sessions array exists) —
  // mirrors exactly what the running server's getDb() would do, but never
  // writes the result back to data/db.json.
  migrateSchema(db);

  const counts = {
    sports: 0,
    events: 0,
    editions: 0,
    users: 0,
    authors: 0,
    articles: 0,
    comments: 0,
    mediaItems: 0,
    adSlots: 0,
    redirectRules: 0,
    auditLogs: 0,
    sessions: 0,
  };

  await prisma.$transaction(async (tx) => {
    console.log('[migrate] Sports...');
    for (const s of db.sports) {
      await tx.sport.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          slug: s.slug,
          name: s.name,
          tagline: s.tagline,
          description: s.description,
          order: s.order,
          isVisible: s.isVisible,
          featuredEventIds: s.featuredEventIds || [],
          colorTheme: s.colorTheme ?? null,
          heroImage: s.heroImage ?? null,
          seo: s.seo as object,
        },
        update: {
          slug: s.slug,
          name: s.name,
          tagline: s.tagline,
          description: s.description,
          order: s.order,
          isVisible: s.isVisible,
          featuredEventIds: s.featuredEventIds || [],
          colorTheme: s.colorTheme ?? null,
          heroImage: s.heroImage ?? null,
          seo: s.seo as object,
        },
      });
      counts.sports++;
    }

    console.log('[migrate] Sport Events...');
    for (const e of db.events) {
      await tx.sportEvent.upsert({
        where: { id: e.id },
        create: {
          id: e.id,
          sportSlug: e.sportSlug,
          slug: e.slug,
          name: e.name,
          shortName: e.shortName,
          description: e.description,
          history: e.history ?? null,
          frequency: e.frequency,
          defaultVenue: e.defaultVenue,
          defaultLocation: e.defaultLocation,
          currentEditionYear: e.currentEditionYear,
          allEditionYears: e.allEditionYears || [],
          featured: e.featured,
          isVisible: e.isVisible,
          featuredImage: e.featuredImage ?? null,
          seo: e.seo as object,
        },
        update: {
          sportSlug: e.sportSlug,
          slug: e.slug,
          name: e.name,
          shortName: e.shortName,
          description: e.description,
          history: e.history ?? null,
          frequency: e.frequency,
          defaultVenue: e.defaultVenue,
          defaultLocation: e.defaultLocation,
          currentEditionYear: e.currentEditionYear,
          allEditionYears: e.allEditionYears || [],
          featured: e.featured,
          isVisible: e.isVisible,
          featuredImage: e.featuredImage ?? null,
          seo: e.seo as object,
        },
      });
      counts.events++;
    }

    console.log('[migrate] Event Editions...');
    for (const ed of db.editions) {
      await tx.eventEdition.upsert({
        where: { id: ed.id },
        create: {
          id: ed.id,
          eventSlug: ed.eventSlug,
          sportSlug: ed.sportSlug,
          year: ed.year,
          title: ed.title,
          startDate: ed.startDate,
          endDate: ed.endDate,
          venue: ed.venue,
          location: ed.location,
          status: ed.status,
          quickFacts: (ed.quickFacts || []) as object,
          prizeMoneyTotal: ed.prizeMoneyTotal ?? null,
          defendingChampions: jsonOrNull(ed.defendingChampions),
          qualificationInfo: ed.qualificationInfo ?? null,
          participantsCount: ed.participantsCount ?? null,
          officialSourceUrl: ed.officialSourceUrl ?? null,
          description: ed.description,
          featuredImage: ed.featuredImage,
          seo: ed.seo as object,
        },
        update: {
          eventSlug: ed.eventSlug,
          sportSlug: ed.sportSlug,
          year: ed.year,
          title: ed.title,
          startDate: ed.startDate,
          endDate: ed.endDate,
          venue: ed.venue,
          location: ed.location,
          status: ed.status,
          quickFacts: (ed.quickFacts || []) as object,
          prizeMoneyTotal: ed.prizeMoneyTotal ?? null,
          defendingChampions: jsonOrNull(ed.defendingChampions),
          qualificationInfo: ed.qualificationInfo ?? null,
          participantsCount: ed.participantsCount ?? null,
          officialSourceUrl: ed.officialSourceUrl ?? null,
          description: ed.description,
          featuredImage: ed.featuredImage,
          seo: ed.seo as object,
        },
      });
      counts.editions++;
    }

    // DATA INTEGRITY FINDING: the JSON source never enforced a real foreign
    // key from Article -> EventEdition, so it's possible (and, in the actual
    // current data/db.json, actually the case for one seeded draft article —
    // "art-wimbledon-draft", referencing a 2027 Wimbledon edition that was
    // never staged) for an article to reference a (sportSlug, eventSlug,
    // year) combination with no matching EventEdition row. PostgreSQL's real
    // FK constraint would reject that article outright. Rather than silently
    // dropping the article's edition reference or failing the whole
    // migration over a legitimate pre-existing editorial draft, this creates
    // a minimal placeholder EventEdition (derived from the parent
    // SportEvent's own defaults) for any such dangling reference, so the
    // article's original data is preserved byte-for-byte and the new FK
    // constraint is satisfied. Each occurrence is logged explicitly below —
    // this is never done silently.
    const existingEditionKeys = new Set(db.editions.map((e) => `${e.sportSlug}|${e.eventSlug}|${e.year}`));
    const seenDanglingKeys = new Set<string>();
    for (const art of db.articles) {
      if (!art.eventSlug || !art.editionYear) continue;
      const key = `${art.sportSlug}|${art.eventSlug}|${art.editionYear}`;
      if (existingEditionKeys.has(key) || seenDanglingKeys.has(key)) continue;
      seenDanglingKeys.add(key);

      const parentEvent = db.events.find((e) => e.sportSlug === art.sportSlug && e.slug === art.eventSlug);
      console.warn(
        `[migrate] DATA INTEGRITY NOTE: article "${art.id}" references ${art.sportSlug}/${art.eventSlug}/${art.editionYear}, ` +
          `which has no EventEdition row in data/db.json. Creating a placeholder edition (marked in its title) so this ` +
          `pre-existing article is not lost or altered. This does not reflect newly introduced test data — it surfaces a ` +
          `gap that already existed in the JSON source.`
      );

      const placeholderId = `${art.eventSlug}-${art.editionYear}`;
      await tx.eventEdition.upsert({
        where: { id: placeholderId },
        create: {
          id: placeholderId,
          eventSlug: art.eventSlug,
          sportSlug: art.sportSlug,
          year: art.editionYear,
          title: `${art.editionYear} ${parentEvent?.name || art.eventSlug} (placeholder — auto-created during Phase 2 migration for a pre-existing dangling article reference)`,
          startDate: `${art.editionYear}-01-01`,
          endDate: `${art.editionYear}-01-01`,
          venue: parentEvent?.defaultVenue || 'To Be Confirmed',
          location: parentEvent?.defaultLocation || 'To Be Confirmed',
          status: 'upcoming',
          quickFacts: [],
          description: 'Placeholder edition auto-created during the Phase 2 JSON-to-PostgreSQL migration to satisfy a pre-existing article reference that had no staged edition in data/db.json.',
          featuredImage: parentEvent?.featuredImage || art.featuredImage,
          seo: { metaTitle: `${art.editionYear} ${parentEvent?.name || art.eventSlug}`, noIndex: true },
        },
        update: {},
      });
      counts.editions++;
    }

    console.log('[migrate] Users (passwords preserved as-hashed, never re-hashed or reset)...');
    for (const u of db.users) {
      // PHASE 2.1 FIX: data/db.json never actually stores a passwordHash
      // (the running server's migrateSchema() only ever normalizes an
      // in-memory copy — see server/jsonSchema.ts), so every time THIS
      // script re-reads the JSON, migrateSchema() generates a brand-new
      // random-salted hash of the same legacy default password. Including
      // `passwordHash` in the upsert's `update` clause meant re-running this
      // script silently rotated every legacy user's stored hash to a new
      // (still-valid, but DIFFERENT) value on every run — a real Phase 2.1
      // repeatability bug, found and fixed by verification testing.
      // Fix: only set passwordHash when CREATING a user for the first time.
      // On update, the field is omitted entirely, so an existing row's
      // hash — whether it came from an earlier migration run or a real
      // password change made through the live app — is never touched.
      await tx.user.upsert({
        where: { id: u.id },
        create: {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar,
          joinedAt: toDateRequired(u.joinedAt),
          updatedAt: toDate(u.updatedAt),
          status: u.status || 'active',
          passwordHash: u.passwordHash!,
        },
        update: {
          name: u.name,
          email: u.email,
          role: u.role,
          avatar: u.avatar,
          joinedAt: toDateRequired(u.joinedAt),
          updatedAt: toDate(u.updatedAt),
          status: u.status || 'active',
        },
      });
      counts.users++;
    }

    console.log('[migrate] Authors (linked to User accounts where matched by email)...');
    for (const a of db.authors) {
      await tx.author.upsert({
        where: { id: a.id },
        create: {
          id: a.id,
          slug: a.slug,
          name: a.name,
          roleTitle: a.roleTitle,
          bio: a.bio,
          avatar: a.avatar,
          twitter: a.twitter ?? null,
          email: a.email ?? null,
          articleCount: a.articleCount ?? 0,
          userId: a.userId ?? null,
        },
        update: {
          slug: a.slug,
          name: a.name,
          roleTitle: a.roleTitle,
          bio: a.bio,
          avatar: a.avatar,
          twitter: a.twitter ?? null,
          email: a.email ?? null,
          articleCount: a.articleCount ?? 0,
          userId: a.userId ?? null,
        },
      });
      counts.authors++;
    }

    console.log('[migrate] Articles...');
    for (const art of db.articles) {
      await tx.article.upsert({
        where: { id: art.id },
        create: {
          id: art.id,
          slug: art.slug,
          title: art.title,
          subtitle: art.subtitle ?? null,
          sportSlug: art.sportSlug,
          eventSlug: art.eventSlug ?? null,
          editionYear: art.editionYear ?? null,
          articleType: art.articleType,
          excerpt: art.excerpt,
          content: art.content,
          featuredImage: art.featuredImage,
          authorId: art.authorId,
          publishedAt: toDateRequired(art.publishedAt),
          updatedAt: toDate(art.updatedAt),
          scheduledFor: toDate(art.scheduledFor),
          status: art.status,
          readingTimeMinutes: art.readingTimeMinutes,
          featured: art.featured ?? false,
          tables: jsonOrNull(art.tables),
          references: jsonOrNull(art.references),
          seo: art.seo as object,
        },
        update: {
          slug: art.slug,
          title: art.title,
          subtitle: art.subtitle ?? null,
          sportSlug: art.sportSlug,
          eventSlug: art.eventSlug ?? null,
          editionYear: art.editionYear ?? null,
          articleType: art.articleType,
          excerpt: art.excerpt,
          content: art.content,
          featuredImage: art.featuredImage,
          authorId: art.authorId,
          publishedAt: toDateRequired(art.publishedAt),
          updatedAt: toDate(art.updatedAt),
          scheduledFor: toDate(art.scheduledFor),
          status: art.status,
          readingTimeMinutes: art.readingTimeMinutes,
          featured: art.featured ?? false,
          tables: jsonOrNull(art.tables),
          references: jsonOrNull(art.references),
          seo: art.seo as object,
        },
      });
      counts.articles++;
    }

    console.log('[migrate] Comments...');
    for (const c of db.comments) {
      await tx.comment.upsert({
        where: { id: c.id },
        create: {
          id: c.id,
          articleId: c.articleId,
          userId: c.userId,
          userName: c.userName,
          userAvatar: c.userAvatar ?? null,
          userRole: c.userRole ?? null,
          content: c.content,
          createdAt: toDateRequired(c.createdAt),
          status: c.status,
        },
        update: {
          articleId: c.articleId,
          userId: c.userId,
          userName: c.userName,
          userAvatar: c.userAvatar ?? null,
          userRole: c.userRole ?? null,
          content: c.content,
          createdAt: toDateRequired(c.createdAt),
          status: c.status,
        },
      });
      counts.comments++;
    }

    console.log('[migrate] Media Items...');
    for (const m of db.mediaItems) {
      await tx.mediaItem.upsert({
        where: { id: m.id },
        create: {
          id: m.id,
          title: m.title,
          url: m.url,
          altText: m.altText,
          caption: m.caption ?? null,
          credit: m.credit ?? null,
          source: m.source ?? null,
          license: m.license ?? null,
          creationType: m.creationType,
          uploadedAt: toDateRequired(m.uploadedAt),
          fileSize: m.fileSize ?? null,
          dimensions: m.dimensions ?? null,
        },
        update: {
          title: m.title,
          url: m.url,
          altText: m.altText,
          caption: m.caption ?? null,
          credit: m.credit ?? null,
          source: m.source ?? null,
          license: m.license ?? null,
          creationType: m.creationType,
          uploadedAt: toDateRequired(m.uploadedAt),
          fileSize: m.fileSize ?? null,
          dimensions: m.dimensions ?? null,
        },
      });
      counts.mediaItems++;
    }

    console.log('[migrate] Ad Slots...');
    for (const ad of db.adSlots) {
      await tx.adSlotConfig.upsert({
        where: { id: ad.id },
        create: {
          id: ad.id,
          name: ad.name,
          placementDescription: ad.placementDescription,
          enabled: ad.enabled,
          sponsorName: ad.sponsorName ?? null,
          bannerText: ad.bannerText ?? null,
          linkUrl: ad.linkUrl ?? null,
          dimensions: ad.dimensions,
        },
        update: {
          name: ad.name,
          placementDescription: ad.placementDescription,
          enabled: ad.enabled,
          sponsorName: ad.sponsorName ?? null,
          bannerText: ad.bannerText ?? null,
          linkUrl: ad.linkUrl ?? null,
          dimensions: ad.dimensions,
        },
      });
      counts.adSlots++;
    }

    console.log('[migrate] Redirect Rules...');
    for (const r of db.redirectRules) {
      await tx.redirectRule.upsert({
        where: { id: r.id },
        create: {
          id: r.id,
          sourceUrl: r.sourceUrl,
          targetUrl: r.targetUrl,
          statusCode: r.statusCode,
          createdAt: toDateRequired(r.createdAt),
          isActive: r.isActive,
        },
        update: {
          sourceUrl: r.sourceUrl,
          targetUrl: r.targetUrl,
          statusCode: r.statusCode,
          createdAt: toDateRequired(r.createdAt),
          isActive: r.isActive,
        },
      });
      counts.redirectRules++;
    }

    console.log('[migrate] Audit Logs...');
    for (const log of db.auditLogs) {
      await tx.auditLog.upsert({
        where: { id: log.id },
        create: {
          id: log.id,
          userId: log.userId,
          userName: log.userName,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          timestamp: toDateRequired(log.timestamp),
          details: log.details,
        },
        update: {
          userId: log.userId,
          userName: log.userName,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          timestamp: toDateRequired(log.timestamp),
          details: log.details,
        },
      });
      counts.auditLogs++;
    }

    console.log('[migrate] Sessions...');
    for (const s of db.sessions || []) {
      await tx.session.upsert({
        where: { id: s.id },
        create: {
          id: s.id,
          userId: s.userId,
          createdAt: toDateRequired(s.createdAt),
          expiresAt: toDateRequired(s.expiresAt),
        },
        update: {
          userId: s.userId,
          createdAt: toDateRequired(s.createdAt),
          expiresAt: toDateRequired(s.expiresAt),
        },
      });
      counts.sessions++;
    }
  });

  console.log('\n[migrate] Migration summary (JSON source -> PostgreSQL rows upserted):');
  console.log('----------------------------------------------------');
  console.log(`Sports:          ${counts.sports}`);
  console.log(`Events:          ${counts.events}`);
  console.log(`Editions:        ${counts.editions}`);
  console.log(`Users:           ${counts.users}`);
  console.log(`Authors:         ${counts.authors}`);
  console.log(`Articles:        ${counts.articles}`);
  console.log(`Comments:        ${counts.comments}`);
  console.log(`Media:           ${counts.mediaItems}`);
  console.log(`Ads:             ${counts.adSlots}`);
  console.log(`Redirects:       ${counts.redirectRules}`);
  console.log(`Audit Logs:      ${counts.auditLogs}`);
  console.log(`Sessions:        ${counts.sessions}`);
  console.log('----------------------------------------------------');
  console.log('[migrate] data/db.json was NOT modified — it remains the untouched migration source/backup.');
}

main()
  .catch((err) => {
    console.error('[migrate] FAILED — transaction rolled back, PostgreSQL was not left in a partial state.');
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
