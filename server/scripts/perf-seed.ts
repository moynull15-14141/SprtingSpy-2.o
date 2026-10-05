/**
 * PHASE P: fills a DEDICATED performance database with synthetic content at
 * launch-plus scale, so query plans, payload sizes and response times can be
 * measured honestly (the development database holds only a handful of rows).
 *
 * Refuses to run unless DATABASE_URL points at a local database whose name
 * ends in "_perf". Every row id starts with "perf-"; nothing here is real
 * content, and it never touches the development or production database.
 *
 *   DATABASE_URL=postgresql://…/sportingspy_perf npm run perf:seed
 *   (PERF_ARTICLES, PERF_EVENTS, PERF_MEDIA override the volumes)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

const url = new URL(process.env.DATABASE_URL ?? 'invalid://');
assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe && url.pathname.replace(/^\//, '').endsWith('_perf'), 'perf:seed only runs against a local database whose name ends in "_perf".');

const ARTICLES = Number(process.env.PERF_ARTICLES || 20000);
const EVENTS = Number(process.env.PERF_EVENTS || 400);
const MEDIA = Number(process.env.PERF_MEDIA || 3000);
const SPORTS = ['tennis', 'golf', 'football', 'rugby', 'athletics', 'motorsport', 'cricket', 'basketball', 'boxing', 'cycling', 'hockey', 'netball', 'swimming', 'racing', 'rodeo', 'curling', 'volleyball', 'baseball', 'sailing', 'triathlon'];
const WORDS = 'schedule results tickets broadcast stream venue final semifinal qualifying champion record prize money draw seed bracket weather travel guide history format rules players teams preview analysis highlights timetable coverage session round stage course circuit stadium arena opening ceremony'.split(' ');
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const sentence = (n: number) => Array.from({ length: n }, () => pick(WORDS)).join(' ');
const id = (kind: string, i: number) => `perf-${kind}-${i}`;
const now = Date.now();

const already = await prisma.article.count();
assert.equal(already, 0, 'The perf database already has articles; drop and recreate it before seeding again.');
const types = (await prisma.articleType.findMany({ where: { isActive: true }, select: { name: true } })).map((t) => t.name);

await prisma.user.create({ data: { id: 'perf-admin', name: 'Perf Admin', email: 'perf-admin@example.test', role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(process.env.PERF_ADMIN_PASSWORD || 'Perf-Admin-Password-1') } });
await prisma.author.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ id: id('author', i), slug: id('author', i), name: `Perf Author ${i}`, roleTitle: 'Reporter', bio: sentence(30), avatar: '/favicon.ico', ...(i === 0 ? { userId: 'perf-admin' } : {}) })) });
await prisma.sport.createMany({ data: SPORTS.map((slug, i) => ({ id: id('sport', i), slug, name: slug[0].toUpperCase() + slug.slice(1), tagline: sentence(6), description: sentence(40), order: i + 1, seo: {} })) });

const events = Array.from({ length: EVENTS }, (_, i) => ({ sportSlug: SPORTS[i % SPORTS.length], slug: `perf-event-${i}`, i }));
await prisma.sportEvent.createMany({ data: events.map((e) => ({ id: id('event', e.i), sportSlug: e.sportSlug, slug: e.slug, name: `Perf Event ${e.i} ${pick(WORDS)}`, shortName: `PE${e.i}`, description: sentence(60), featured: e.i % 25 === 0, currentEditionYear: 2026, allEditionYears: [2022, 2023, 2024, 2025, 2026, 2027], seo: {} })) });
const editions = events.flatMap((e) => [2022, 2023, 2024, 2025, 2026, 2027].map((year) => ({ ...e, year })));
for (let i = 0; i < editions.length; i += 1000) {
  await prisma.eventEdition.createMany({ data: editions.slice(i, i + 1000).map((ed) => {
    const day = 1 + ((ed.i * 7) % 300);
    const start = new Date(Date.UTC(ed.year, 0, 1) + day * 86400000).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(ed.year, 0, 1) + (day + 10) * 86400000).toISOString().slice(0, 10);
    const status = ed.year < 2026 ? 'completed' : ed.year === 2026 ? 'active' : 'upcoming';
    return { id: `perf-edition-${ed.i}-${ed.year}`, sportSlug: ed.sportSlug, eventSlug: ed.slug, year: ed.year, title: `Perf Event ${ed.i} ${ed.year}`, startDate: start, endDate: end, status, description: sentence(50), seo: {} } as const;
  }) });
}
for (let i = 0; i < MEDIA; i += 1000) {
  await prisma.mediaItem.createMany({ data: Array.from({ length: Math.min(1000, MEDIA - i) }, (_, k) => ({ id: id('media', i + k), title: `Perf image ${i + k}`, url: '/favicon.ico', altText: sentence(8), uploadedAt: new Date(now - (i + k) * 60000), width: 1600, height: 900, mimeType: 'image/png' })) });
}

const body = (title: string) => {
  const paragraphs = Array.from({ length: 12 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: `${title}. ${sentence(70)}.` }] }));
  return { type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: title }] }, ...paragraphs] };
};
const plain = (doc: ReturnType<typeof body>) => doc.content.map((n) => n.content.map((t) => t.text).join(' ')).join('\n');
for (let i = 0; i < ARTICLES; i += 500) {
  const batch = Array.from({ length: Math.min(500, ARTICLES - i) }, (_, k) => {
    const n = i + k;
    const e = events[n % events.length];
    const kind = n % 10; // 60 % edition, 20 % event-level, 20 % general
    const title = `Perf ${e.slug} ${pick(WORDS)} ${pick(WORDS)} ${n}`;
    const doc = body(title);
    return {
      id: id('article', n), slug: `perf-article-${n}`, title, sportSlug: e.sportSlug,
      eventSlug: kind < 8 ? e.slug : null, editionYear: kind < 6 ? 2022 + (n % 6) : null,
      articleType: pick(types), excerpt: sentence(25), content: plain(doc), body: doc, featuredImage: '/favicon.ico',
      featuredMediaId: id('media', n % MEDIA), authorId: id('author', n % 50), publishedAt: new Date(now - n * 3600000),
      status: n % 20 === 19 ? 'draft' as const : 'published' as const, readingTimeMinutes: 5, featured: n % 200 === 0,
      seo: { metaTitle: title, metaDescription: sentence(20), keywords: [pick(WORDS), pick(WORDS)] },
    };
  });
  await prisma.article.createMany({ data: batch });
}
await prisma.faqEntry.createMany({ data: Array.from({ length: 2000 }, (_, i) => ({ id: id('faq', i), question: `${sentence(8)}?`, answer: sentence(40), status: 'published', updatedBy: 'perf', displayOrder: i % 8, ...(i % 2 ? { articleId: id('article', i) } : { eventId: id('event', i % EVENTS) }) })) });
await prisma.redirectRule.createMany({ data: Array.from({ length: 2000 }, (_, i) => ({ id: id('redirect', i), sourceUrl: `/perf-old-${i}`, targetUrl: `/${events[i % events.length].sportSlug}/${events[i % events.length].slug}`, statusCode: 301, createdAt: new Date(), origin: 'migration' })) });
await prisma.auditLog.createMany({ data: Array.from({ length: 5000 }, (_, i) => ({ id: id('audit', i), userId: 'perf-admin', userName: 'Perf Admin', action: 'Updated Article', entityType: 'Article', entityId: id('article', i), timestamp: new Date(now - i * 60000), details: sentence(15) })) });
const counts = await Promise.all([prisma.article.count(), prisma.sportEvent.count(), prisma.eventEdition.count(), prisma.mediaItem.count()]);
console.log(`[perf:seed] articles=${counts[0]} events=${counts[1]} editions=${counts[2]} media=${counts[3]} faq=2000 redirects=2000 audit=5000 (synthetic)`);
await prisma.$executeRawUnsafe('ANALYZE');
await prisma.$disconnect();
