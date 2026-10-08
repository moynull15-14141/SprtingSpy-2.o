/**
 * FAQ & Reader Questions API (PHASE H; E5 Event scope; PHASE R v2.2).
 *
 *   GET    /api/faq?context=<kind>:<id>      entries (all or one context)      Admin, Editor
 *   POST   /api/faq                          create                            Admin, Editor
 *   PUT    /api/faq/:id                      edit / publish / archive / move   Admin, Editor
 *   DELETE /api/faq/:id                      permanent delete                  Admin, Editor
 *   POST   /api/faq/reorder { ids }          order within ONE context          Admin, Editor
 *   GET    /api/faq/diagnostics?context=     quality checks                    Admin, Editor
 *   POST   /api/faq/suggestions { context, ai? }  suggestions (never saved)   Admin, Editor
 *
 * Context: an entry belongs to at most one of articleId / editionId /
 * eventId / sportId (DB check constraint); none = site-wide.
 *
 * Human approval (v2.2): only Admin/Editor reach these routes; publishing
 * records approvedBy/approvedAt. Entries created from a suggestion keep their
 * `source` and are ALWAYS created as drafts — nothing here publishes
 * AI or data-derived content without an explicit editor action.
 *
 * Content is plain text (React renders it escaped; no HTML is stored).
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { recordAudit } from './audit';
import { FAQ_STATUSES, FAQ_SOURCES, faqContextColumns, faqContextOf, type FaqContext, type FaqContextKind, type FaqSource, type FaqStatus } from '../src/lib/faq';
import { aiFaqSuggestions, dataSuggestions, diagnoseFaq, loadFaqContext } from './faqQuality';

const FIELDS = ['question', 'answer', 'displayOrder', 'status', 'eventId', 'articleId', 'editionId', 'sportId', 'source'] as const;
const CONTEXT_KEYS = ['eventId', 'articleId', 'editionId', 'sportId'] as const;
// Plain text: printable characters plus newlines/tabs only.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const AUDIT_FIELDS = ['question', 'answer', 'displayOrder', 'status', 'eventId', 'articleId', 'editionId', 'sportId', 'source'] as const;

type FaqInput = { question?: string; answer?: string; displayOrder?: number; status?: FaqStatus; eventId?: string | null; articleId?: string | null; editionId?: string | null; sportId?: string | null; source?: FaqSource };

/** "article:<id>" | "edition:<id>" | "event:<id>" | "sport:<id>" | "site" → context. */
export function parseContext(raw: unknown): FaqContext | null {
  if (raw === 'site') return { kind: 'site', id: null };
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(article|edition|event|sport):(.{1,200})$/);
  return m ? { kind: m[1] as FaqContextKind, id: m[2] } : null;
}

/** Validates a create (all required) or partial update body; returns the clean values or an error. */
export function parseFaqInput(body: unknown, partial: boolean): { ok: true; value: FaqInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send the FAQ entry as an object.' };
  const raw = body as Record<string, unknown>;
  const unknown = Object.keys(raw).find((k) => !(FIELDS as readonly string[]).includes(k));
  if (unknown) return { ok: false, error: `${unknown} is not a FAQ field.` };
  const value: FaqInput = {};
  const text = (key: 'question' | 'answer', min: number, max: number) => {
    const v = raw[key];
    if (v === undefined) return partial ? null : `${key === 'question' ? 'Question' : 'Answer'} is required.`;
    if (typeof v !== 'string') return `${key} must be text.`;
    const trimmed = v.trim();
    if (trimmed.length < min) return `${key === 'question' ? 'Question' : 'Answer'} must be at least ${min} characters.`;
    if (trimmed.length > max) return `${key === 'question' ? 'Question' : 'Answer'} must be at most ${max} characters.`;
    if (CONTROL.test(trimmed)) return `${key} contains unsupported control characters.`;
    value[key] = key === 'question' ? trimmed.replace(/\s+/g, ' ') : trimmed.replace(/\r\n?/g, '\n');
    return null;
  };
  const error = text('question', 5, 300) ?? text('answer', 2, 5000);
  if (error) return { ok: false, error };
  if (raw.displayOrder !== undefined) {
    if (typeof raw.displayOrder !== 'number' || !Number.isInteger(raw.displayOrder) || raw.displayOrder < 0 || raw.displayOrder > 10000) {
      return { ok: false, error: 'displayOrder must be a whole number from 0 to 10000.' };
    }
    value.displayOrder = raw.displayOrder;
  }
  if (raw.status !== undefined) {
    if (typeof raw.status !== 'string' || !(FAQ_STATUSES as readonly string[]).includes(raw.status)) return { ok: false, error: `status must be one of: ${FAQ_STATUSES.join(', ')}.` };
    value.status = raw.status as FaqStatus;
  }
  if (raw.source !== undefined) {
    if (typeof raw.source !== 'string' || !(FAQ_SOURCES as readonly string[]).includes(raw.source)) return { ok: false, error: `source must be one of: ${FAQ_SOURCES.join(', ')}.` };
    value.source = raw.source as FaqSource;
  }
  for (const key of CONTEXT_KEYS) {
    if (raw[key] === undefined) continue;
    if (raw[key] !== null && (typeof raw[key] !== 'string' || !raw[key] || (raw[key] as string).length > 200)) return { ok: false, error: `${key} must be an id or null.` };
    value[key] = raw[key] as string | null;
  }
  if (CONTEXT_KEYS.filter((k) => value[k]).length > 1) return { ok: false, error: 'An FAQ entry belongs to one context only (an article, an edition, an event or a sport).' };
  return { ok: true, value };
}

/** The context row exists. */
async function contextExists(c: FaqContext): Promise<boolean> {
  switch (c.kind) {
    case 'site': return true;
    case 'article': return !!(await prisma.article.findUnique({ where: { id: c.id! }, select: { id: true } }));
    case 'edition': return !!(await prisma.eventEdition.findUnique({ where: { id: c.id! }, select: { id: true } }));
    case 'event': return !!(await prisma.sportEvent.findUnique({ where: { id: c.id! }, select: { id: true } }));
    case 'sport': return !!(await prisma.sport.findUnique({ where: { id: c.id! }, select: { id: true } }));
  }
}

const contextWhere = (c: FaqContext) => faqContextColumns(c);

export function faqRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const staff = requireRole(getLookup, ['Admin', 'Editor']);
  const actor = (req: Request) => ({ userId: req.authContext!.userId, userName: req.authContext!.userName });

  router.get('/', staff, wrap(async (req, res) => {
    const context = req.query.context === undefined ? null : parseContext(req.query.context);
    if (req.query.context !== undefined && !context) return res.status(400).json({ error: 'context must be site, article:<id>, edition:<id>, event:<id> or sport:<id>.' });
    res.json(await prisma.faqEntry.findMany({ where: context ? contextWhere(context) : {}, orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }));
  }));

  router.post('/reorder', staff, wrap(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'ids') ||
        !Array.isArray(body.ids) || !body.ids.length || body.ids.some((id: unknown) => typeof id !== 'string' || id.length > 200) ||
        new Set(body.ids).size !== body.ids.length) {
      return res.status(400).json({ error: 'Send a unique, ordered list of the FAQ entry IDs of one context.' });
    }
    const ids: string[] = body.ids;
    const result = await prisma.$transaction(async (tx) => {
      const first = await tx.faqEntry.findUnique({ where: { id: ids[0] } });
      if (!first) return false;
      const context = faqContextOf(first);
      const entries = await tx.faqEntry.findMany({ where: contextWhere(context), select: { id: true } });
      if (entries.length !== ids.length || entries.some((entry) => !ids.includes(entry.id))) return false;
      for (const [displayOrder, id] of ids.entries()) {
        await tx.faqEntry.update({ where: { id }, data: { displayOrder, updatedBy: req.authContext!.userName } });
      }
      await recordAudit(tx, { ...actor(req), action: 'Reordered FAQ Entries', entityType: 'Faq', entityId: `faq-order:${context.kind}:${context.id ?? 'site'}`, details: `${req.authContext!.userName} reordered ${ids.length} FAQ entries (${context.kind}${context.id ? ` ${context.id}` : ''}).` });
      return true;
    }, { isolationLevel: 'Serializable' });
    if (!result) return res.status(409).json({ error: 'The FAQ list changed. Reload it before reordering.' });
    return res.json({ success: true });
  }));

  router.get('/diagnostics', staff, wrap(async (req, res) => {
    const context = parseContext(req.query.context);
    if (!context) return res.status(400).json({ error: 'context is required (site, article:<id>, edition:<id>, event:<id> or sport:<id>).' });
    const loaded = await loadFaqContext(context);
    if (!loaded) return res.status(404).json({ error: 'That context does not exist.' });
    const entries = await prisma.faqEntry.findMany({ where: contextWhere(context), orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }] });
    const { validateFaqSchema } = await import('../src/lib/faq');
    const published = entries.filter((e) => e.status === 'published');
    return res.json({ context: { ...context, label: loaded.label }, schema: { enabled: loaded.schemaEnabled, ...validateFaqSchema(published, loaded.schemaEnabled) }, issues: diagnoseFaq(entries, loaded) });
  }));

  router.post('/suggestions', staff, wrap(async (req, res) => {
    const context = parseContext(req.body?.context);
    if (!context) return res.status(400).json({ error: 'context is required.' });
    const loaded = await loadFaqContext(context);
    if (!loaded) return res.status(404).json({ error: 'That context does not exist.' });
    const entries = await prisma.faqEntry.findMany({ where: contextWhere(context), select: { question: true } });
    const data = dataSuggestions(entries, loaded);
    if (req.body?.ai !== true) return res.json({ suggestions: data, ai: { requested: false } });
    const ai = await aiFaqSuggestions([...entries, ...data], loaded);
    return res.json({ suggestions: [...data, ...(ai.ok ? ai.suggestions : [])], ai: ai.ok ? { requested: true, ok: true } : { requested: true, ok: false, error: (ai as { error: string }).error } });
  }));

  router.post('/', staff, wrap(async (req, res) => {
    const parsed = parseFaqInput(req.body, false);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const source = parsed.value.source ?? 'editor';
    // Suggestions become drafts; only an editor's later, explicit publish makes them public.
    const status = source === 'editor' ? parsed.value.status ?? 'draft' : 'draft';
    const context = faqContextOf({ eventId: parsed.value.eventId ?? null, articleId: parsed.value.articleId ?? null, editionId: parsed.value.editionId ?? null, sportId: parsed.value.sportId ?? null });
    if (!(await contextExists(context))) return res.status(400).json({ error: `The ${context.kind} this entry belongs to does not exist.` });
    const max = await prisma.faqEntry.aggregate({ where: contextWhere(context), _max: { displayOrder: true } });
    const displayOrder = parsed.value.displayOrder ?? Math.min(10000, (max._max.displayOrder ?? -10) + 10);
    const now = new Date();
    const created = await prisma.faqEntry.create({ data: {
      id: `faq-${crypto.randomUUID()}`, question: parsed.value.question!, answer: parsed.value.answer!, displayOrder, status, source,
      ...faqContextColumns(context), updatedBy: req.authContext!.userName,
      ...(status === 'published' ? { approvedBy: req.authContext!.userName, approvedAt: now } : {}),
    } });
    await recordAudit(prisma, { ...actor(req), action: 'Created FAQ Entry', entityType: 'Faq', entityId: created.id, details: `${req.authContext!.userName} created a FAQ entry (${context.kind}, status: ${status}, source: ${source}).`, before: null, after: created as unknown as Record<string, unknown>, fields: AUDIT_FIELDS });
    return res.status(201).json(created);
  }));

  /** Source review handoff: atomically append ordinary draft entries to one saved Article. */
  router.post('/import', staff, wrap(async (req, res) => {
    const body = req.body as { articleId?: unknown; faqs?: unknown } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !['articleId', 'faqs'].includes(key)) ||
        typeof body.articleId !== 'string' || !body.articleId || body.articleId.length > 200 || !Array.isArray(body.faqs) || !body.faqs.length || body.faqs.length > 50) {
      return res.status(400).json({ error: 'Send articleId and 1–50 reviewed FAQ items.' });
    }
    const article = await prisma.article.findUnique({ where: { id: body.articleId }, select: { id: true } });
    if (!article) return res.status(400).json({ error: 'The Article for these FAQ entries does not exist.' });
    const parsedItems: { question: string; answer: string }[] = [];
    for (const item of body.faqs) {
      const parsed = parseFaqInput({ ...(item as object), articleId: body.articleId, status: 'draft', source: 'editor' }, false);
      if (!parsed.ok) return res.status(400).json({ error: (parsed as { ok: false; error: string }).error });
      parsedItems.push({ question: parsed.value.question!, answer: parsed.value.answer! });
    }
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.faqEntry.findMany({ where: { articleId: body.articleId as string }, select: { question: true, answer: true } });
      const exact = new Set(existing.map((entry) => `${entry.question.toLocaleLowerCase()}\u0000${entry.answer}`));
      const max = await tx.faqEntry.aggregate({ where: { articleId: body.articleId as string }, _max: { displayOrder: true } });
      const created = [];
      let skipped = 0;
      for (const item of parsedItems) {
        const duplicateKey = `${item.question.toLocaleLowerCase()}\u0000${item.answer}`;
        if (exact.has(duplicateKey)) { skipped++; continue; }
        exact.add(duplicateKey);
        const entry = await tx.faqEntry.create({ data: {
          id: `faq-${crypto.randomUUID()}`, question: item.question, answer: item.answer,
          displayOrder: Math.min(10000, (max._max.displayOrder ?? -10) + (created.length + 1) * 10),
          status: 'draft', source: 'editor', articleId: body.articleId as string, updatedBy: req.authContext!.userName,
        } });
        created.push(entry);
        await recordAudit(tx, { ...actor(req), action: 'Created FAQ Entry', entityType: 'Faq', entityId: entry.id, details: `${req.authContext!.userName} created a FAQ entry (article, status: draft) from reviewed source content.`, before: null, after: entry as unknown as Record<string, unknown>, fields: AUDIT_FIELDS });
      }
      return { created, skipped };
    }, { isolationLevel: 'Serializable' });
    return res.status(201).json(result);
  }));

  router.put('/:id', staff, wrap(async (req, res) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'FAQ entry not found.' });
    const parsed = parseFaqInput(req.body, true);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    if (!Object.keys(parsed.value).length) return res.status(400).json({ error: 'Nothing to update.' });
    if (parsed.value.source !== undefined && parsed.value.source !== existing.source) return res.status(400).json({ error: 'The source of an entry cannot be changed.' });
    const data: Record<string, unknown> = { ...parsed.value, updatedBy: req.authContext!.userName };
    delete data.source;
    // Moving to another context: the new context replaces the old one entirely.
    if (CONTEXT_KEYS.some((k) => k in parsed.value)) {
      const next = faqContextOf({ eventId: parsed.value.eventId ?? null, articleId: parsed.value.articleId ?? null, editionId: parsed.value.editionId ?? null, sportId: parsed.value.sportId ?? null });
      if (!(await contextExists(next))) return res.status(400).json({ error: `The ${next.kind} this entry belongs to does not exist.` });
      Object.assign(data, faqContextColumns(next));
    }
    if (parsed.value.status === 'published' && existing.status !== 'published') {
      data.approvedBy = req.authContext!.userName;
      data.approvedAt = new Date();
    }
    const updated = await prisma.faqEntry.update({ where: { id: existing.id }, data });
    const change = parsed.value.status && parsed.value.status !== existing.status ? ` (status: ${existing.status} → ${parsed.value.status})` : '';
    await recordAudit(prisma, { ...actor(req), action: parsed.value.status === 'published' && existing.status !== 'published' ? 'Published FAQ Entry' : 'Updated FAQ Entry', entityType: 'Faq', entityId: updated.id, details: `${req.authContext!.userName} updated a FAQ entry${change}.`, before: existing as unknown as Record<string, unknown>, after: updated as unknown as Record<string, unknown>, fields: AUDIT_FIELDS });
    return res.json(updated);
  }));

  // v2.2: editors delete FAQ entries too (deletion is audit-logged with the full previous entry).
  router.delete('/:id', staff, wrap(async (req, res) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'FAQ entry not found.' });
    await prisma.faqEntry.delete({ where: { id: existing.id } });
    await recordAudit(prisma, { ...actor(req), action: 'Deleted FAQ Entry', entityType: 'Faq', entityId: existing.id, details: `${req.authContext!.userName} permanently deleted a FAQ entry.`, before: existing as unknown as Record<string, unknown>, after: null, fields: AUDIT_FIELDS });
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}

export type { FaqSource };
