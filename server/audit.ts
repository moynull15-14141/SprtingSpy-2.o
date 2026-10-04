/**
 * Structured audit logging (PHASE R, Spec §24.3: who / what / when /
 * previous value / new value).
 *
 * `recordAudit` writes one AuditLog row. When `before` and `after` objects are
 * given, only the fields that actually changed are stored, so the log shows
 * exactly what an edit did. Secret-like fields are never written: password
 * hashes, TOTP secrets, reset tokens and anything whose name looks like a key
 * or credential are replaced by "[redacted]".
 */

import crypto from 'node:crypto';
import type { Prisma } from './generated/prisma/client';
import { prisma } from './db';

type Db = Prisma.TransactionClient | typeof prisma;
type EntityType = Prisma.AuditLogCreateInput['entityType'];

const SECRET_KEY = /(password|passwordhash|secret|token|apikey|api_key|privatekey|private_key|credential)/i;
const MAX_VALUE_CHARS = 4000;

/** JSON-safe, size-bounded copy of a value (Dates → ISO strings, long text truncated). */
function clean(value: unknown, depth = 0): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.length > MAX_VALUE_CHARS ? `${value.slice(0, MAX_VALUE_CHARS)}… [truncated, ${value.length} characters]` : value;
  if (depth > 6) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => clean(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : clean(v, depth + 1);
    return out;
  }
  return String(value);
}

/** Stable comparison of two JSON-able values (object key order ignored). */
const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v as object).sort().map((k) => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',')}}` : JSON.stringify(v ?? null);

/**
 * The changed fields between two records, restricted to `fields` when given.
 * Returns null when nothing changed.
 */
export function diffFields(before: Record<string, unknown> | null | undefined, after: Record<string, unknown> | null | undefined, fields?: readonly string[]) {
  const keys = fields ?? [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of keys) {
    const prev = clean(before?.[key]);
    const next = clean(after?.[key]);
    if (stable(prev) === stable(next)) continue;
    b[key] = SECRET_KEY.test(key) ? '[redacted]' : prev;
    a[key] = SECRET_KEY.test(key) ? '[redacted]' : next;
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}

export interface AuditInput {
  userId: string;
  userName: string;
  action: string;
  entityType: EntityType;
  entityId: string;
  details: string;
  /** Previous record (or the relevant part of it). */
  before?: Record<string, unknown> | null;
  /** New record (or the relevant part of it). */
  after?: Record<string, unknown> | null;
  /** Only compare these fields. */
  fields?: readonly string[];
}

export async function recordAudit(db: Db, input: AuditInput) {
  const changes = input.before !== undefined || input.after !== undefined ? diffFields(input.before, input.after, input.fields) : null;
  // A create has no "before"; a delete has no "after". Keep those sides null.
  const before = input.before === null ? null : changes?.before ?? null;
  const after = input.after === null ? null : changes?.after ?? null;
  return db.auditLog.create({
    data: {
      id: `log-${crypto.randomUUID()}`,
      userId: input.userId,
      userName: input.userName,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      timestamp: new Date(),
      details: input.details,
      ...(before ? { before: before as Prisma.InputJsonValue } : {}),
      ...(after ? { after: after as Prisma.InputJsonValue } : {}),
      // A creation records the new values; a deletion records the old ones.
      ...(input.before === null && input.after ? { after: clean(input.fields ? pick(input.after, input.fields) : input.after) as Prisma.InputJsonValue } : {}),
      ...(input.after === null && input.before ? { before: clean(input.fields ? pick(input.before, input.fields) : input.before) as Prisma.InputJsonValue } : {}),
    },
  });
}

const pick = (obj: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter((f) => f in obj).map((f) => [f, obj[f]]));
