/**
 * FAQ API (PHASE H). Editor-managed questions and answers for /faq/.
 *
 *   GET    /api/faq          every entry, any status            Admin, Editor
 *   POST   /api/faq          create                             Admin, Editor
 *   PUT    /api/faq/:id      edit / publish / unpublish / archive  Admin, Editor
 *   DELETE /api/faq/:id      permanent delete                   Admin
 *
 * Content is plain text (React renders it escaped; no HTML is stored or
 * interpreted). Public pages read published entries through
 * server/services/public/faq.ts, never through this API.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { FAQ_STATUSES, type FaqStatus } from '../src/lib/faq';

const FIELDS = ['question', 'answer', 'displayOrder', 'status'] as const;
// Plain text: printable characters plus newlines/tabs only.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

type FaqInput = { question?: string; answer?: string; displayOrder?: number; status?: FaqStatus };

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
  return { ok: true, value };
}

export function faqRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  const staff = requireRole(getLookup, ['Admin', 'Editor']);
  const audit = (req: Request, action: string, id: string, details: string) => prisma.auditLog.create({
    data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action, entityType: 'Faq', entityId: id, timestamp: new Date(), details },
  });

  router.get('/', staff, wrap(async (_req, res) => {
    res.json(await prisma.faqEntry.findMany({ orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }));
  }));

  router.post('/reorder', staff, wrap(async (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'ids') ||
        !Array.isArray(body.ids) || body.ids.some((id: unknown) => typeof id !== 'string' || id.length > 200) ||
        new Set(body.ids).size !== body.ids.length) {
      return res.status(400).json({ error: 'Send a unique, ordered list of all FAQ entry IDs.' });
    }
    const ids: string[] = body.ids;
    const result = await prisma.$transaction(async (tx) => {
      const entries = await tx.faqEntry.findMany({ select: { id: true } });
      if (entries.length !== ids.length || entries.some((entry) => !ids.includes(entry.id))) return false;
      for (const [displayOrder, id] of ids.entries()) {
        await tx.faqEntry.update({ where: { id }, data: { displayOrder, updatedBy: req.authContext!.userName } });
      }
      await tx.auditLog.create({ data: {
        id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName,
        action: 'Reordered FAQ Entries', entityType: 'Faq', entityId: 'faq-order', timestamp: new Date(),
        details: `${req.authContext!.userName} reordered ${ids.length} FAQ entries.`,
      } });
      return true;
    }, { isolationLevel: 'Serializable' });
    if (!result) return res.status(409).json({ error: 'The FAQ list changed. Reload it before reordering.' });
    return res.json({ success: true });
  }));

  router.post('/', staff, wrap(async (req, res) => {
    const parsed = parseFaqInput(req.body, false);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    const { question, answer, status = 'draft' } = parsed.value;
    // New entries go to the end unless an order was chosen.
    const displayOrder = parsed.value.displayOrder ?? Math.min(10000, (((await prisma.faqEntry.aggregate({ _max: { displayOrder: true } }))._max.displayOrder ?? -10) + 10));
    const created = await prisma.faqEntry.create({ data: { id: `faq-${crypto.randomUUID()}`, question: question!, answer: answer!, displayOrder, status, updatedBy: req.authContext!.userName } });
    await audit(req, 'Created FAQ Entry', created.id, `${req.authContext!.userName} created a FAQ entry (status: ${status}).`);
    return res.status(201).json(created);
  }));

  router.put('/:id', staff, wrap(async (req, res) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'FAQ entry not found.' });
    const parsed = parseFaqInput(req.body, true);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    if (!Object.keys(parsed.value).length) return res.status(400).json({ error: 'Nothing to update.' });
    const updated = await prisma.faqEntry.update({ where: { id: existing.id }, data: { ...parsed.value, updatedBy: req.authContext!.userName } });
    const change = parsed.value.status && parsed.value.status !== existing.status ? ` (status: ${existing.status} → ${parsed.value.status})` : '';
    await audit(req, 'Updated FAQ Entry', updated.id, `${req.authContext!.userName} updated a FAQ entry${change}.`);
    return res.json(updated);
  }));

  router.delete('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const existing = await prisma.faqEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'FAQ entry not found.' });
    await prisma.faqEntry.delete({ where: { id: existing.id } });
    await audit(req, 'Deleted FAQ Entry', existing.id, `${req.authContext!.userName} permanently deleted a FAQ entry.`);
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
