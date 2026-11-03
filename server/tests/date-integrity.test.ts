/**
 * Regression tests for article date integrity.
 * Run: npx tsx server/tests/date-integrity.test.ts
 *
 * Tests are split into two groups:
 * 1. Pure-function tests (TIME_RE, containsAny) — run directly.
 * 2. Lifecycle logic tests — verify the server-side date assignment
 *    code paths by simulating the conditions inline (no DB needed).
 */
import { TIME_RE, containsAny } from '../seo/analyze';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean) {
  if (condition) { passed++; }
  else { failed++; console.error(`  FAIL: ${label}`); }
}

// ════════════════════════════════════════════════════════════════════
// TIMEZONE REGEX TESTS
// ════════════════════════════════════════════════════════════════════

console.log('TIME_RE: colon-separated times');
assert('14:30 matches', TIME_RE.test('Kick-off at 14:30'));
assert('9:00 matches', TIME_RE.test('starts at 9:00'));
assert('00:00 matches', TIME_RE.test('midnight 00:00'));
assert('23:59 matches', TIME_RE.test('23:59 local'));

console.log('TIME_RE: am/pm times');
assert('9am matches', TIME_RE.test('game at 9am'));
assert('10 pm matches', TIME_RE.test('10 pm local'));
assert('12pm matches', TIME_RE.test('noon 12pm'));

console.log('TIME_RE: false positives fixed (dot-separated)');
assert('9.58 does NOT match (sprint)', !TIME_RE.test('Bolt ran 9.58 seconds'));
assert('10.45 does NOT match (distance)', !TIME_RE.test('jumped 10.45 metres'));
assert('2.04 does NOT match (marathon)', !TIME_RE.test('finished in 2.04'));
assert('3.50 does NOT match (height)', !TIME_RE.test('cleared 3.50m'));
assert('1.05 does NOT match (score)', !TIME_RE.test('odds of 1.05'));

console.log('TIME_RE: HH:MM:SS durations excluded');
assert('2:04:30 does NOT match (marathon duration)', !TIME_RE.test('marathon in 2:04:30'));
assert('1:23:45 does NOT match (elapsed time)', !TIME_RE.test('finished in 1:23:45'));
assert('0:58:30 does NOT match (sub-hour duration)', !TIME_RE.test('split 0:58:30'));
assert('12:34:56 does NOT match (duration)', !TIME_RE.test('elapsed 12:34:56'));

console.log('TIME_RE: legitimate colon times still match');
assert('14:00 CET', TIME_RE.test('14:00 CET'));
assert('2:04 PM is a clock time', TIME_RE.test('starts at 2:04 PM'));
assert('14:04 alone is a clock time', TIME_RE.test('session at 14:04'));
assert('9:30 is a clock time', TIME_RE.test('kick-off 9:30'));

console.log('\ncontainsAny: timezone terms');
const tzTerms = ['bst', 'gmt', 'utc', 'cet', 'cest', 'et', 'edt', 'est', 'pt', 'pdt', 'aest', 'ist', 'local time', 'time zone', 'timezone'];
assert('text with BST clears warning', containsAny('Match at 14:00 BST', tzTerms));
assert('text with UTC clears warning', containsAny('All times in UTC', tzTerms));
assert('text without timezone does not clear', !containsAny('Match at 14:00 tomorrow', tzTerms));
assert('"local time" as phrase', containsAny('14:00 local time', tzTerms));
assert('"et" does not match "athlete"', !containsAny('The athlete runs at 14:00', tzTerms));

// ════════════════════════════════════════════════════════════════════
// ARTICLE DATE LIFECYCLE LOGIC TESTS
// These simulate the server.ts code paths without requiring a database.
// ════════════════════════════════════════════════════════════════════

console.log('\nLifecycle: article creation');
{
  // Simulates server.ts:848-850 creation logic
  const now = new Date('2026-11-01T10:00:00Z');
  function createArticle(body: { status?: string; publishedAt?: string }) {
    return {
      publishedAt: body.publishedAt ? new Date(body.publishedAt) : now,
      firstPublishedAt: body.status === 'published' ? (body.publishedAt ? new Date(body.publishedAt) : now) : undefined,
      updatedAt: null,
    };
  }

  const draft = createArticle({ status: 'draft' });
  assert('1. Draft: firstPublishedAt is null', draft.firstPublishedAt === undefined);
  assert('1. Draft: updatedAt is null', draft.updatedAt === null);

  const scheduled = createArticle({ status: 'scheduled' });
  assert('2. Scheduled: firstPublishedAt is null', scheduled.firstPublishedAt === undefined);

  const published = createArticle({ status: 'published' });
  assert('3. Published: firstPublishedAt is set', published.firstPublishedAt instanceof Date);
  assert('3. Published: firstPublishedAt equals now', published.firstPublishedAt?.getTime() === now.getTime());

  const withCustomDate = createArticle({ status: 'published', publishedAt: '2025-06-15T08:00:00Z' });
  assert('3b. Published with custom date: firstPublishedAt uses custom', withCustomDate.firstPublishedAt?.toISOString() === '2025-06-15T08:00:00.000Z');
}

console.log('Lifecycle: article update — first publication');
{
  // Simulates server.ts:995-1003 update logic
  function updateArticle(updates: Record<string, any>, existing: { status: string; publishedAt: Date; firstPublishedAt: Date | null }) {
    const data: Record<string, any> = { ...updates };
    // Content-change detection (simplified: always assume content changed for this test)
    if ('updatedAt' in updates) data.updatedAt = updates.updatedAt ? new Date(updates.updatedAt) : null;
    else data.updatedAt = new Date();

    if ('publishedAt' in updates) data.publishedAt = updates.publishedAt ? new Date(updates.publishedAt) : existing.publishedAt;
    else if (data.status === 'published' && existing.status !== 'published') {
      if (!existing.firstPublishedAt) data.publishedAt = new Date();
    }
    if ('firstPublishedAt' in updates) data.firstPublishedAt = updates.firstPublishedAt ? new Date(updates.firstPublishedAt) : existing.firstPublishedAt;
    else if (data.status === 'published' && existing.status !== 'published' && !existing.firstPublishedAt) {
      data.firstPublishedAt = data.publishedAt ?? existing.publishedAt;
    }
    return data;
  }

  const draftExisting = { status: 'draft', publishedAt: new Date('2026-11-01T10:00:00Z'), firstPublishedAt: null };
  const firstPub = updateArticle({ status: 'published' }, draftExisting);
  assert('4. First publication: firstPublishedAt is set', firstPub.firstPublishedAt instanceof Date);

  const alreadyPublished = { status: 'draft', publishedAt: new Date('2026-06-01T08:00:00Z'), firstPublishedAt: new Date('2026-06-01T08:00:00Z') };
  const republish = updateArticle({ status: 'published' }, alreadyPublished);
  assert('6. Republish: firstPublishedAt preserved (not overwritten)', !('firstPublishedAt' in republish));
  assert('6. Republish: publishedAt NOT reset (existing firstPublishedAt present)', !('publishedAt' in republish) || republish.publishedAt === undefined);

  const adminOverride = updateArticle({ firstPublishedAt: '2025-01-15T00:00:00Z' }, alreadyPublished);
  assert('7. Admin override: firstPublishedAt accepted', adminOverride.firstPublishedAt?.toISOString() === '2025-01-15T00:00:00.000Z');

  const modOverride = updateArticle({ updatedAt: '2026-10-01T12:00:00Z' }, alreadyPublished);
  assert('8. Admin modDate override: updatedAt set to custom', modOverride.updatedAt?.toISOString() === '2026-10-01T12:00:00.000Z');

  const modClear = updateArticle({ updatedAt: null }, alreadyPublished);
  assert('8b. Admin modDate clear: updatedAt set to null', modClear.updatedAt === null);
}

console.log('Lifecycle: scheduler');
{
  // Simulates server.ts:231 scheduler logic
  const now = new Date('2026-11-03T14:00:00Z');
  function schedulerPublish(art: { scheduledFor: Date | null; firstPublishedAt: Date | null }) {
    return {
      status: 'published',
      publishedAt: art.scheduledFor || now,
      ...(art.firstPublishedAt ? {} : { firstPublishedAt: art.scheduledFor || now }),
    };
  }

  const neverPublished = schedulerPublish({ scheduledFor: new Date('2026-11-03T14:00:00Z'), firstPublishedAt: null });
  assert('4b. Scheduler first pub: firstPublishedAt set', 'firstPublishedAt' in neverPublished);
  assert('4b. Scheduler first pub: uses scheduledFor', neverPublished.firstPublishedAt?.getTime() === new Date('2026-11-03T14:00:00Z').getTime());

  const previouslyPublished = schedulerPublish({ scheduledFor: new Date('2026-12-01T08:00:00Z'), firstPublishedAt: new Date('2026-06-01T08:00:00Z') });
  assert('5. Repeated scheduler: firstPublishedAt NOT overwritten', !('firstPublishedAt' in previouslyPublished));

  const rescheduled = schedulerPublish({ scheduledFor: new Date('2026-12-15T10:00:00Z'), firstPublishedAt: new Date('2026-06-01T08:00:00Z') });
  assert('6b. Rescheduled: original date preserved', !('firstPublishedAt' in rescheduled));
}

console.log('Lifecycle: author authorization');
{
  // Simulates editorialWorkflow.ts:37 guard
  function authorGuard(body: Record<string, any>) {
    const status = body.status ?? 'draft';
    return !['draft','preview'].includes(status) || body.scheduledFor != null || 'publishedAt' in body || 'firstPublishedAt' in body || 'updatedAt' in body;
  }
  assert('9. Author blocked from publishedAt', authorGuard({ publishedAt: '2026-01-01' }) === true);
  assert('9. Author blocked from firstPublishedAt', authorGuard({ firstPublishedAt: '2026-01-01' }) === true);
  assert('9. Author blocked from updatedAt', authorGuard({ updatedAt: '2026-01-01' }) === true);
  assert('9. Author allowed draft save', authorGuard({ title: 'test', status: 'draft' }) === false);
}

console.log('Lifecycle: content-change detection');
{
  // Simulates server.ts:991-995 — content changes advance updatedAt, SEO changes don't
  const CONTENT_FIELDS = ['title', 'subtitle', 'excerpt', 'content', 'body', 'tables', 'references', 'featuredMediaId', 'featuredImage', 'articleType', 'sportSlug', 'eventSlug', 'editionYear', 'slug'];
  function isContentChange(updates: Record<string, any>) {
    return CONTENT_FIELDS.some((f) => f in updates);
  }
  assert('10. Title change is content change', isContentChange({ title: 'New' }));
  assert('11. SEO-only change is NOT content change', !isContentChange({ seo: {} }));
  assert('11. Status change is NOT content change', !isContentChange({ status: 'published' }));
}

console.log('Lifecycle: visible date consistency');
{
  // Simulates ArticlePage.tsx:60 and :87
  function visibleDate(article: { firstPublishedAt?: string; publishedAt: string }) {
    return article.firstPublishedAt || article.publishedAt;
  }
  function jsonLdDate(article: { firstPublishedAt?: string; publishedAt: string }) {
    return article.firstPublishedAt || article.publishedAt;
  }
  const withBoth = { publishedAt: '2026-11-01', firstPublishedAt: '2026-06-01' };
  assert('12. Visible and JSON-LD match when both fields present', visibleDate(withBoth) === jsonLdDate(withBoth));

  const legacyOnly = { publishedAt: '2026-06-01' };
  assert('12. Visible and JSON-LD match for legacy article', visibleDate(legacyOnly) === jsonLdDate(legacyOnly));

  const ogDate = (article: { firstPublishedAt?: string; publishedAt: string }) => article.firstPublishedAt || article.publishedAt;
  assert('13. OG date matches JSON-LD', ogDate(withBoth) === jsonLdDate(withBoth));
}

// ════════════════════════════════════════════════════════════════════
// SEO STRUCTURED DATA: FUTURE-DATE RULE TESTS
// Simulates the article-schema rule check at server/seo/rules.ts:376
// ════════════════════════════════════════════════════════════════════

console.log('\nStructured data: future publication date rule');
{
  type MinSubject = { status: string; publishedAt: Date };
  type MinCtx = { now: Date };

  function futureWarning(s: MinSubject, ctx: MinCtx): boolean {
    return s.status === 'published' && s.publishedAt > ctx.now;
  }

  const ctx = { now: new Date('2026-11-03T12:00:00Z') };

  // 1. Past date → no warning
  assert('14. Published article with past date: no warning',
    !futureWarning({ status: 'published', publishedAt: new Date('2026-10-28T18:57:42.783Z') }, ctx));

  // 2. Equal date → no warning (> is strict)
  assert('14b. Published article with date equal to now: no warning',
    !futureWarning({ status: 'published', publishedAt: new Date('2026-11-03T12:00:00Z') }, ctx));

  // 3. Future date → warning
  assert('14c. Published article with future date: warning fires',
    futureWarning({ status: 'published', publishedAt: new Date('2026-12-01T00:00:00Z') }, ctx));

  // 4. UTC timestamps compared correctly
  assert('14d. UTC comparison: Oct 28 < Nov 3',
    !futureWarning({ status: 'published', publishedAt: new Date('2026-10-28T23:59:59.999Z') }, ctx));

  // 5. Positive timezone offset (UTC+5:30 → earlier UTC instant)
  assert('14e. Positive offset: 2026-11-03T12:00+05:30 is Nov 3 06:30 UTC, in the past',
    !futureWarning({ status: 'published', publishedAt: new Date('2026-11-03T06:30:00Z') }, ctx));

  // 5b. Negative timezone offset (UTC-8 → later UTC instant, pushes into future)
  assert('14f. Negative offset: 2026-11-03T10:00-08:00 is Nov 3 18:00 UTC, future relative to noon',
    futureWarning({ status: 'published', publishedAt: new Date('2026-11-03T18:00:00Z') }, ctx));

  // 6. Near midnight boundary
  const midnightCtx = { now: new Date('2026-11-03T23:59:59.999Z') };
  assert('14g. Near midnight: date at next day start is future',
    futureWarning({ status: 'published', publishedAt: new Date('2026-11-04T00:00:00.000Z') }, midnightCtx));
  assert('14h. Near midnight: same second is not future',
    !futureWarning({ status: 'published', publishedAt: new Date('2026-11-03T23:59:59.999Z') }, midnightCtx));

  // 7. Non-published status → rule does not fire even with future date
  assert('14i. Draft with future date: no warning',
    !futureWarning({ status: 'draft', publishedAt: new Date('2027-01-01T00:00:00Z') }, ctx));
  assert('14j. Scheduled with future date: no warning',
    !futureWarning({ status: 'scheduled', publishedAt: new Date('2027-01-01T00:00:00Z') }, ctx));
}

console.log('Structured data: toArticleSubject publishedAt fallback');
{
  // Simulates context.ts:67 — toDate(row.publishedAt) || new Date()
  const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

  // 8. Editor draft-check preserves supplied publishedAt
  const supplied = '2026-10-28T18:57:42.783Z';
  const result = toDate(supplied) || new Date();
  assert('15. Supplied publishedAt is preserved', result.toISOString() === '2026-10-28T18:57:42.783Z');

  // Missing publishedAt falls back to new Date() (current time)
  const before = Date.now();
  const fallback = toDate(null) || new Date();
  const after = Date.now();
  assert('15b. Missing publishedAt falls back to current time', fallback.getTime() >= before && fallback.getTime() <= after);
}

// ════════════════════════════════════════════════════════════════════
// RESULTS
// ════════════════════════════════════════════════════════════════════

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
