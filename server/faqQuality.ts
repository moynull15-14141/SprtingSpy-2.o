/**
 * FAQ quality diagnostics and suggestions (PHASE R, v2.2 FAQ & Reader
 * Questions).
 *
 * Diagnostics (deterministic, "where practical"):
 *   duplicate      — the same question twice in one context
 *   repetitive     — questions that ask nearly the same thing (word overlap)
 *   outdated       — future-tense answers about dates that have passed, or
 *                    answers not reviewed for a year
 *   contradiction  — dates far outside the edition, or amounts that differ
 *                    from the edition's prize money / the article text
 *   irrelevant     — a question that names none of the context's subjects
 *   unsupported    — an answer stating facts (dates, amounts, numbers) on a
 *                    page that cites no official source
 *   missing        — useful questions the stored facts can answer but no
 *                    entry covers yet
 *
 * Suggestions: questions derived from stored facts (never invented) and,
 * when GEMINI_API_KEY is configured, AI-suggested questions with draft
 * answers that may only restate the supplied facts. Suggestions are returned
 * to the editor; accepting one creates a DRAFT entry. Nothing here publishes.
 */

import { prisma } from './db';
import { extractDates } from './seo/analyze';
import { legacyToDoc, docToPlainText as plainText, type RichDoc } from '../src/lib/richText';
import { buildEventFaq } from '../src/lib/eventFaq';
import { resolveSportEventConfiguration } from './sportEventConfiguration';
import { utcToday } from '../src/lib/eventTiming';
import { assistantState } from './seo/assistant';
import type { FaqContext } from '../src/lib/faq';
import type { EventEdition } from '../src/types';

export type FaqIssueKind = 'duplicate' | 'repetitive' | 'outdated' | 'contradiction' | 'irrelevant' | 'unsupported' | 'missing';
export interface FaqIssue { kind: FaqIssueKind; severity: 'warning' | 'info'; entryId: string | null; message: string }
export interface FaqSuggestion { question: string; answer: string; source: 'data-suggestion' | 'ai-suggestion'; basis: string }

const DAY = 86_400_000;
const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'what', 'when', 'where', 'who', 'how', 'which', 'does', 'do', 'did', 'can', 'will', 'be', 'it', 'this', 'that', 'there', 'i', 'you']);
const words = (text: string) => new Set(normalize(text).split(' ').filter((w) => w.length > 1 && !STOP.has(w)));
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
};
const amounts = (text: string) => [...text.matchAll(/(?:[€$£]\s?\d[\d,.]*(?:\s?(?:m|million|bn|billion))?|\d[\d,.]*\s?(?:million|m)\s?(?:euros?|dollars?|pounds?|usd|eur|gbp))/gi)].map((m) => m[0].toLowerCase().replace(/\s+/g, ''));
const FUTURE = /\b(will|is scheduled|are scheduled|is expected|takes place on|is set to|upcoming)\b/i;

export interface LoadedContext {
  context: FaqContext;
  label: string;
  /** Names a relevant question would mention. */
  subjects: string[];
  /** Text the answers must agree with (article body, edition description). */
  referenceText: string;
  edition: EventEdition | null;
  hasOfficialSource: boolean;
  schemaEnabled: boolean;
  /** Derived (never invented) suggestion candidates. */
  derived: { question: string; answer: string; basis: string }[];
  facts: string[];
}

/** Loads what the checks need about a context; null when the context does not exist. */
export async function loadFaqContext(context: FaqContext): Promise<LoadedContext | null> {
  const today = utcToday();
  if (context.kind === 'site') {
    return { context, label: 'Site-wide FAQ', subjects: ['sportingspy', 'site', 'coverage'], referenceText: '', edition: null, hasOfficialSource: true, schemaEnabled: false, derived: [], facts: [] };
  }
  if (context.kind === 'sport') {
    const sport = await prisma.sport.findUnique({ where: { id: context.id! } });
    if (!sport) return null;
    return { context, label: `${sport.name} (sport guide)`, subjects: [sport.name, sport.slug.replace(/-/g, ' ')], referenceText: sport.description, edition: null, hasOfficialSource: false, schemaEnabled: sport.faqSchemaEnabled, derived: [], facts: [`Sport: ${sport.name}`, sport.description ? `Description: ${sport.description.slice(0, 800)}` : ''].filter(Boolean) };
  }
  if (context.kind === 'event' || context.kind === 'edition') {
    const edition = context.kind === 'edition' ? await prisma.eventEdition.findUnique({ where: { id: context.id! } }) : null;
    const event = context.kind === 'event'
      ? await prisma.sportEvent.findUnique({ where: { id: context.id! } })
      : edition ? await prisma.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: edition.sportSlug, slug: edition.eventSlug } } }) : null;
    if (!event || (context.kind === 'edition' && !edition)) return null;
    const sport = await prisma.sport.findUnique({ where: { slug: event.sportSlug } });
    const current = edition ?? (event.currentEditionYear !== null ? await prisma.eventEdition.findFirst({ where: { sportSlug: event.sportSlug, eventSlug: event.slug, year: event.currentEditionYear } }) : null);
    const terminology = resolveSportEventConfiguration(sport?.eventConfiguration).terminology;
    const ed = current ? ({ ...current, defendingChampions: (current.defendingChampions ?? undefined) as EventEdition['defendingChampions'], quickFacts: [] as EventEdition['quickFacts'], participantsCount: current.participantsCount ?? undefined } as unknown as EventEdition) : null;
    const derived = buildEventFaq({ event, sport: { name: sport?.name || event.sportSlug }, terminology, currentEdition: ed ?? undefined, editorFaqs: [], today })
      .filter((d) => d.source === 'event-data')
      .map((d) => ({ question: d.question, answer: d.answer, basis: 'Stored event/edition facts' }));
    if (edition?.prizeMoneyTotal) derived.push({ question: `What is the prize money at ${edition.title}?`, answer: `The total prize money listed for ${edition.title} is ${edition.prizeMoneyTotal}.`, basis: 'Edition prize money field' });
    if (edition?.qualificationInfo) derived.push({ question: `How do players qualify for ${edition.title}?`, answer: edition.qualificationInfo.slice(0, 1200), basis: 'Edition qualification field' });
    const label = edition ? edition.title : event.name;
    const facts = [
      `Event: ${event.name}${event.shortName && event.shortName !== event.name ? ` (also ${event.shortName})` : ''}`,
      sport ? `Sport: ${sport.name}` : '',
      event.frequency ? `Frequency: ${event.frequency}` : '',
      event.officialSourceUrl ? `Official website: ${event.officialSourceUrl}` : '',
      current ? `Edition: ${current.title}; dates: ${[current.startDate, current.endDate].filter(Boolean).join(' – ') || 'not confirmed'}; venue: ${current.venue || 'not confirmed'}; location: ${current.location || 'not confirmed'}; status: ${current.status}` : '',
      current?.prizeMoneyTotal ? `Prize money: ${current.prizeMoneyTotal}` : '',
      current?.description ? `Edition description: ${current.description.slice(0, 800)}` : '',
    ].filter(Boolean);
    return {
      context, label,
      subjects: [event.name, event.shortName, ...event.alternativeNames.split('\n'), sport?.name || '', edition ? String(edition.year) : ''].filter((s) => s && s.trim()),
      referenceText: [edition?.description, event.description].filter(Boolean).join('\n'),
      edition: current ? (current as unknown as EventEdition) : null,
      hasOfficialSource: !!(edition?.officialSourceUrl || event.officialSourceUrl),
      schemaEnabled: edition ? edition.faqSchemaEnabled : event.faqSchemaEnabled,
      derived,
      facts,
    };
  }
  // article
  const article = await prisma.article.findUnique({ where: { id: context.id! } });
  if (!article) return null;
  const [sport, event, edition] = await Promise.all([
    prisma.sport.findUnique({ where: { slug: article.sportSlug } }),
    article.eventSlug ? prisma.sportEvent.findUnique({ where: { sportSlug_slug: { sportSlug: article.sportSlug, slug: article.eventSlug } } }) : null,
    article.eventSlug && article.editionYear ? prisma.eventEdition.findFirst({ where: { sportSlug: article.sportSlug, eventSlug: article.eventSlug, year: article.editionYear } }) : null,
  ]);
  const doc = (article.body as unknown as RichDoc | null) ?? legacyToDoc(article.content);
  const text = plainText(doc);
  const references = Array.isArray(article.references) ? article.references.length : 0;
  const hasExternal = /https?:\/\//.test(JSON.stringify(article.body ?? '')) || references > 0;
  const derived: LoadedContext['derived'] = [];
  if (edition?.startDate && ['Schedule', 'Event Guide', 'How to Watch', 'Sports Viewing Guide'].includes(article.articleType)) {
    derived.push({ question: `When is ${edition.title}?`, answer: `${edition.title} runs ${edition.endDate && edition.endDate !== edition.startDate ? `from ${edition.startDate} to ${edition.endDate}` : `on ${edition.startDate}`}.`, basis: 'Edition dates' });
  }
  if (edition?.venue && ['Event Guide', 'Venue', 'Schedule'].includes(article.articleType)) derived.push({ question: `Where is ${edition.title} held?`, answer: `${edition.title} is held at ${[edition.venue, edition.location].filter(Boolean).join(', ')}.`, basis: 'Edition venue' });
  if (edition?.prizeMoneyTotal && article.articleType === 'Prize Money') derived.push({ question: `What is the total prize money at ${edition.title}?`, answer: `The total prize money listed for ${edition.title} is ${edition.prizeMoneyTotal}.`, basis: 'Edition prize money field' });
  return {
    context,
    label: article.title,
    subjects: [article.title, event?.name || '', event?.shortName || '', sport?.name || '', edition ? String(edition.year) : '', ...words(article.title)].filter((s) => s && String(s).trim()) as string[],
    referenceText: `${article.title}\n${article.excerpt}\n${text}`,
    edition: edition as unknown as EventEdition | null,
    hasOfficialSource: hasExternal || !!(edition?.officialSourceUrl || event?.officialSourceUrl),
    schemaEnabled: article.faqSchemaEnabled,
    derived,
    facts: [`Article type: ${article.articleType}`, `Title: ${article.title}`, event ? `Event: ${event.name}` : '', edition ? `Edition: ${edition.title}; dates: ${[edition.startDate, edition.endDate].filter(Boolean).join(' – ') || 'not confirmed'}; venue: ${edition.venue || 'not confirmed'}` : '', `Article text (excerpt): ${text.slice(0, 3000)}`].filter(Boolean),
  };
}

export function diagnoseFaq(entries: { id: string; question: string; answer: string; status: string; updatedAt: Date }[], ctx: LoadedContext, now = new Date()): FaqIssue[] {
  const issues: FaqIssue[] = [];
  const live = entries.filter((e) => e.status !== 'archived');
  const seen = new Map<string, string>();
  for (const e of live) {
    const key = normalize(e.question);
    if (seen.has(key)) issues.push({ kind: 'duplicate', severity: 'warning', entryId: e.id, message: `"${e.question}" duplicates another question in this context.` });
    else seen.set(key, e.id);
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      if (normalize(live[i].question) === normalize(live[j].question)) continue;
      const sim = jaccard(words(live[i].question), words(live[j].question));
      if (sim >= 0.7) issues.push({ kind: 'repetitive', severity: 'info', entryId: live[j].id, message: `"${live[j].question}" asks nearly the same as "${live[i].question}". Consider merging them.` });
    }
  }
  const ed = ctx.edition;
  const edStart = ed?.startDate ? Date.parse(ed.startDate) : NaN;
  const edEnd = ed?.endDate ? Date.parse(ed.endDate) : edStart;
  const edAmounts = ed?.prizeMoneyTotal ? amounts(ed.prizeMoneyTotal) : [];
  const refAmounts = new Set(amounts(ctx.referenceText));
  const subjects = ctx.subjects.map((s) => normalize(s)).filter((s) => s.length > 2);
  for (const e of live) {
    const text = `${e.question} ${e.answer}`;
    const dates = extractDates(e.answer);
    if (FUTURE.test(e.answer) && dates.some((d) => d.date.getTime() < now.getTime() - DAY)) {
      issues.push({ kind: 'outdated', severity: 'warning', entryId: e.id, message: `The answer to "${e.question}" uses future tense for a date that has passed.` });
    }
    if (now.getTime() - e.updatedAt.getTime() > 365 * DAY) issues.push({ kind: 'outdated', severity: 'info', entryId: e.id, message: `"${e.question}" has not been updated for over a year. Check it is still accurate.` });
    if (!Number.isNaN(edStart)) {
      const far = dates.filter((d) => d.date.getTime() < edStart - 120 * DAY || d.date.getTime() > (Number.isNaN(edEnd) ? edStart : edEnd) + 120 * DAY);
      if (far.length) issues.push({ kind: 'contradiction', severity: 'warning', entryId: e.id, message: `"${far[0].raw}" in the answer to "${e.question}" is far outside the edition dates (${ed!.startDate} – ${ed!.endDate || ed!.startDate}).` });
    }
    const answerAmounts = amounts(e.answer);
    if (edAmounts.length && answerAmounts.length && !answerAmounts.some((a) => edAmounts.includes(a)) && /prize/i.test(text)) {
      issues.push({ kind: 'contradiction', severity: 'warning', entryId: e.id, message: `The prize money in "${e.question}" (${answerAmounts.join(', ')}) differs from the edition record (${ed!.prizeMoneyTotal}).` });
    } else if (ctx.context.kind === 'article' && refAmounts.size && answerAmounts.some((a) => !refAmounts.has(a))) {
      issues.push({ kind: 'contradiction', severity: 'info', entryId: e.id, message: `The answer to "${e.question}" states amounts that do not appear in the article (${answerAmounts.filter((a) => !refAmounts.has(a)).join(', ')}).` });
    }
    if (ctx.context.kind !== 'site' && subjects.length && !subjects.some((s) => normalize(text).includes(s))) {
      issues.push({ kind: 'irrelevant', severity: 'info', entryId: e.id, message: `"${e.question}" does not mention ${ctx.label}. Check it belongs on this page.` });
    }
    if (!ctx.hasOfficialSource && (dates.length || answerAmounts.length || /\b\d{2,}\b/.test(e.answer))) {
      issues.push({ kind: 'unsupported', severity: 'info', entryId: e.id, message: `The answer to "${e.question}" states facts, but this page cites no official source. Add the source.` });
    }
  }
  const covered = new Set(live.map((e) => normalize(e.question)));
  for (const d of ctx.derived) {
    const dw = words(d.question);
    if (!covered.has(normalize(d.question)) && !live.some((e) => jaccard(words(e.question), dw) >= 0.6)) {
      issues.push({ kind: 'missing', severity: 'info', entryId: null, message: `Readers may ask "${d.question}" — the stored facts can answer it (${d.basis}).` });
    }
  }
  return issues;
}

/** Data-derived suggestions not yet covered by an entry. */
export function dataSuggestions(entries: { question: string }[], ctx: LoadedContext): FaqSuggestion[] {
  return ctx.derived
    .filter((d) => !entries.some((e) => normalize(e.question) === normalize(d.question) || jaccard(words(e.question), words(d.question)) >= 0.6))
    .map((d) => ({ question: d.question, answer: d.answer, source: 'data-suggestion' as const, basis: d.basis }));
}

/** Optional AI suggestions (questions + draft answers restating supplied facts only). */
export async function aiFaqSuggestions(entries: { question: string }[], ctx: LoadedContext): Promise<{ ok: true; suggestions: FaqSuggestion[] } | { ok: false; status: number; error: string }> {
  const state = assistantState();
  if (!state.configured) return { ok: false, status: 503, error: state.reason! };
  const prompt = [
    'You help a sports editor write reader FAQ entries. Return JSON: {"suggestions":[{"question":string,"answer":string,"basis":string}]} with at most 5 items.',
    'Rules: only questions readers genuinely ask about this page; answers may ONLY use the facts listed below — never invent dates, broadcasters, prize money, schedules, results, venues or participants.',
    'If a useful question cannot be answered from the facts, give the question with an empty answer and basis "needs research".',
    'Do not repeat existing questions. Plain text, no HTML, no marketing language.',
    '',
    `Page: ${ctx.label}`,
    'Facts:',
    ...ctx.facts.map((f) => `- ${f}`),
    '',
    'Existing questions:',
    ...entries.map((e) => `- ${e.question}`),
  ].join('\n');
  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
    const response = await Promise.race([
      ai.models.generateContent({ model: state.model, contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.2 } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000)),
    ]);
    const parsed = JSON.parse(response.text || '{}') as { suggestions?: { question?: unknown; answer?: unknown; basis?: unknown }[] };
    const suggestions = (parsed.suggestions || [])
      .filter((s) => typeof s.question === 'string' && s.question.trim().length >= 5)
      .slice(0, 5)
      .map((s) => ({ question: String(s.question).trim().slice(0, 300), answer: typeof s.answer === 'string' ? s.answer.trim().slice(0, 2000) : '', source: 'ai-suggestion' as const, basis: typeof s.basis === 'string' ? s.basis.slice(0, 200) : 'AI suggestion' }))
      .filter((s) => !entries.some((e) => normalize(e.question) === normalize(s.question)));
    return { ok: true, suggestions };
  } catch (err) {
    console.error('[FAQ assistant] AI request failed:', err instanceof Error ? err.name : 'error');
    return { ok: false, status: 502, error: 'The AI service did not return usable suggestions. Try again later.' };
  }
}


