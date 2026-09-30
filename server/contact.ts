/**
 * Contact messages (PHASE H).
 *
 *   POST   /api/contact                    public form submission (stored only; no e-mail is sent)
 *   GET    /api/contact-messages           inbox, newest first, ?status=&unread=1&page=   Admin, Editor
 *   PUT    /api/contact-messages/:id       { status?, read? }                              Admin, Editor
 *   DELETE /api/contact-messages/:id       permanent delete                                Admin
 *
 * Abuse protection: CSRF (global middleware), per-IP rate limit, strict field
 * allow-list and length limits, and a hidden honeypot field. No IP address,
 * user agent or message text is ever logged or stored beyond the message row.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { createRateLimiter } from './rateLimit';
import { CONTACT_LIMITS, CONTACT_STATUSES, type ContactStatus } from '../src/lib/contact';

const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const PAGE_SIZE = 50;

type ContactInput = { name: string; email: string; subject: string; message: string };

/** Validates a public submission. `website` is the honeypot: humans never see or fill it. */
export function parseContact(body: unknown): { ok: true; value: ContactInput; honeypot: boolean } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Please fill in the form.' };
  const raw = body as Record<string, unknown>;
  const allowed = ['name', 'email', 'subject', 'message', 'website'];
  if (Object.keys(raw).some((k) => !allowed.includes(k))) return { ok: false, error: 'Unsupported form field.' };
  if (raw.website !== undefined && (typeof raw.website !== 'string' || raw.website.length > 2048)) return { ok: false, error: 'Unsupported form field.' };
  const out: Record<string, string> = {};
  for (const [key, label] of [['name', 'Name'], ['email', 'Email'], ['subject', 'Subject'], ['message', 'Message']] as const) {
    const v = raw[key];
    if (typeof v !== 'string' || !v.trim()) return { ok: false, error: `${label} is required.` };
    const trimmed = v.trim();
    const { min, max } = CONTACT_LIMITS[key];
    if (trimmed.length < min) return { ok: false, error: `${label} must be at least ${min} characters.` };
    if (trimmed.length > max) return { ok: false, error: `${label} must be at most ${max} characters.` };
    if (CONTROL.test(trimmed) || (key !== 'message' && /[\r\n]/.test(trimmed))) return { ok: false, error: `${label} contains unsupported characters.` };
    out[key] = key === 'message' ? trimmed.replace(/\r\n?/g, '\n') : trimmed;
  }
  if (!EMAIL.test(out.email)) return { ok: false, error: 'Enter a valid email address.' };
  const honeypot = typeof raw.website === 'string' && raw.website.trim() !== '';
  return { ok: true, value: out as ContactInput, honeypot };
}

export function contactRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };
  // 5 messages per 10 minutes per client IP (in-process, like the other limiters).
  const limiter = createRateLimiter(10 * 60_000, 5);
  const staff = requireRole(getLookup, ['Admin', 'Editor']);

  router.post('/api/contact', wrap(async (req, res) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const state = limiter.check(key);
    if (state.limited) {
      res.setHeader('Retry-After', String(state.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many messages from this connection. Please try again later.' });
    }
    limiter.record(key);
    const parsed = parseContact(req.body);
    if (!parsed.ok) return res.status(400).json({ error: (parsed as { error: string }).error });
    // Success always means persistence; reject automated submissions explicitly.
    if (parsed.honeypot) return res.status(400).json({ error: 'Unable to submit this form. Reload the page and try again.' });
    await prisma.contactMessage.create({ data: { id: `msg-${crypto.randomUUID()}`, ...parsed.value } });
    return res.status(201).json({ ok: true });
  }));

  router.get('/api/contact-messages', staff, wrap(async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && !(CONTACT_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: 'Unknown status filter.' });
    const page = Math.max(1, Math.min(1000, Number.parseInt(String(req.query.page ?? '1'), 10) || 1));
    const where = { ...(status ? { status } : {}), ...(req.query.unread === '1' ? { readAt: null } : {}) };
    const [items, total, unread] = await Promise.all([
      prisma.contactMessage.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
      prisma.contactMessage.count({ where }),
      prisma.contactMessage.count({ where: { readAt: null, status: { not: 'spam' } } }),
    ]);
    return res.json({ items, total, unread, page, totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)) });
  }));

  router.put('/api/contact-messages/:id', staff, wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => !['status', 'read'].includes(k)) || !Object.keys(body).length) {
      return res.status(400).json({ error: 'Send { status } and/or { read }.' });
    }
    if (body.status !== undefined && !(CONTACT_STATUSES as readonly unknown[]).includes(body.status)) return res.status(400).json({ error: `status must be one of: ${CONTACT_STATUSES.join(', ')}.` });
    if (body.read !== undefined && typeof body.read !== 'boolean') return res.status(400).json({ error: 'read must be true or false.' });
    const existing = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Message not found.' });
    const data: { status?: ContactStatus; readAt?: Date | null } = {};
    if (body.status !== undefined) data.status = body.status as ContactStatus;
    if (body.read !== undefined) data.readAt = body.read ? existing.readAt ?? new Date() : null;
    const updated = await prisma.contactMessage.update({ where: { id: existing.id }, data });
    if (data.status && data.status !== existing.status) {
      await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Updated Contact Message', entityType: 'ContactMessage', entityId: existing.id, timestamp: new Date(), details: `${req.authContext!.userName} marked a contact message as ${data.status}.` } });
    }
    return res.json(updated);
  }));

  router.delete('/api/contact-messages/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const existing = await prisma.contactMessage.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Message not found.' });
    await prisma.contactMessage.delete({ where: { id: existing.id } });
    await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Deleted Contact Message', entityType: 'ContactMessage', entityId: existing.id, timestamp: new Date(), details: `${req.authContext!.userName} permanently deleted a contact message.` } });
    return res.json({ success: true, id: existing.id });
  }));

  return router;
}
