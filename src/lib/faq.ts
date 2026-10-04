/**
 * FAQ shapes shared by the CMS, the public pages and the server
 * (PHASE H; PHASE E5 Event scope; PHASE R v2.2 FAQ & Reader Questions).
 *
 * An entry belongs to at most ONE context: an Article, an Event Edition, an
 * Event or a Sport-level guide. Entries without a context are site-wide (the
 * optional /faq/ page, off at launch). Only `published` entries are public,
 * and publishing always needs an editor (suggestions are created as drafts).
 */

export const FAQ_STATUSES = ['draft', 'published', 'archived'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export const FAQ_SOURCES = ['editor', 'ai-suggestion', 'data-suggestion'] as const;
export type FaqSource = (typeof FAQ_SOURCES)[number];

export type FaqContextKind = 'article' | 'edition' | 'event' | 'sport' | 'site';
export interface FaqContext { kind: FaqContextKind; id: string | null }

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  displayOrder: number;
  status: FaqStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  /** PHASE E5: set when the entry belongs to one Event page. */
  eventId: string | null;
  /** PHASE R contexts. */
  articleId: string | null;
  editionId: string | null;
  sportId: string | null;
  source: FaqSource;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** The context of an entry (at most one of the ids is set). */
export function faqContextOf(e: Pick<FaqEntry, 'eventId' | 'articleId' | 'editionId' | 'sportId'>): FaqContext {
  if (e.articleId) return { kind: 'article', id: e.articleId };
  if (e.editionId) return { kind: 'edition', id: e.editionId };
  if (e.eventId) return { kind: 'event', id: e.eventId };
  if (e.sportId) return { kind: 'sport', id: e.sportId };
  return { kind: 'site', id: null };
}

/** The four context columns for a context (all others null). */
export function faqContextColumns(c: FaqContext) {
  return {
    articleId: c.kind === 'article' ? c.id : null,
    editionId: c.kind === 'edition' ? c.id : null,
    eventId: c.kind === 'event' ? c.id : null,
    sportId: c.kind === 'sport' ? c.id : null,
  };
}

/** Plain-text answer → paragraphs (blank lines separate paragraphs; single newlines are kept as line breaks). */
export const answerParagraphs = (answer: string): string[][] =>
  answer.split(/\n\s*\n/).map((p) => p.split('\n').map((line) => line.trim()).filter(Boolean)).filter((p) => p.length);

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export interface FaqSchemaCheck<T> { ok: boolean; reasons: string[]; valid: T[] }

/**
 * FAQPage structured data must describe visible FAQ content and is only
 * emitted when an editor turned it on for this context (v2.2: "Do not
 * automatically emit FAQ structured data merely because FAQ content exists").
 * Each entry is checked on its own (a complete question ending in "?", a
 * complete plain-text answer, no duplicates); only passing entries are marked
 * up and the rest are reported. `ok` = markup will be emitted.
 */
export function validateFaqSchema<T extends { question: string; answer: string }>(items: T[], enabled: boolean): FaqSchemaCheck<T> {
  const reasons: string[] = [];
  if (!enabled) reasons.push('FAQ structured data is turned off for this page.');
  if (!items.length) reasons.push('No published questions.');
  const seen = new Set<string>();
  const valid: T[] = [];
  for (const f of items) {
    const q = f.question.trim();
    const a = f.answer.trim();
    const problems: string[] = [];
    if (q.length < 10) problems.push('is too short to be a complete question');
    if (!q.endsWith('?')) problems.push('does not end with a question mark');
    if (a.length < 20) problems.push('has an answer too short to be complete');
    if (/<[a-z/][^>]*>/i.test(q + a)) problems.push('contains HTML markup');
    const key = normalize(q);
    if (seen.has(key)) problems.push('appears more than once');
    seen.add(key);
    if (problems.length) reasons.push(`"${q}" ${problems.join(', ')} — left out of the markup.`);
    else valid.push(f);
  }
  if (enabled && items.length && !valid.length) reasons.push('No question passes validation, so no FAQPage markup is output.');
  return { ok: enabled && valid.length > 0, reasons, valid };
}

/** FAQPage JSON-LD for the given visible items (pass `validateFaqSchema(...).valid`). */
export function faqPageSchema(items: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: answerParagraphs(f.answer).map((p) => p.join(' ')).join('\n\n') },
    })),
  };
}
