/**
 * Editor working copies (PHASE AUTOSAVE): rules shared by the drafts API
 * (server/drafts.ts) and the CMS autosave hook (src/lib/autosave).
 */

export const DRAFT_KINDS = ['article', 'event', 'edition', 'page'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

export const DRAFT_KIND_LABEL: Record<DraftKind, string> = { article: 'Article', event: 'Event', edition: 'Edition', page: 'Page' };

/** Payload cap matches the rich-text document limit plus room for the other form fields. */
export const DRAFT_LIMITS = { title: 300, payloadBytes: 750_000 };

/** Autosave timing: save once typing pauses, but never wait longer than the max. */
export const AUTOSAVE_TIMING = { debounceMs: 2000, maxWaitMs: 15000, retryBaseMs: 2000, retryMaxMs: 60000 };

/** Sent with a 409 when the live item changed after editing began. */
export const STALE_VERSION_MESSAGE = 'This content was changed by another editor. Your draft is still safe. Review the newer version before applying your changes.';

/** Header carrying the item version the editor started from (optional precondition on item saves). */
export const EXPECTED_VERSION_HEADER = 'X-Expected-Version';

export interface DraftSummary {
  id: string;
  kind: DraftKind;
  entityId: string | null;
  title: string;
  revision: number;
  baseVersion: string | null;
  ownerId: string;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
  /** The live item changed since this working copy started. */
  stale?: boolean;
}

export interface DraftWithPayload<P = Record<string, unknown>> extends DraftSummary {
  payload: P;
}

/**
 * JSON with object keys sorted. PostgreSQL jsonb does not keep key order, so
 * payload equality (idempotent retries) must not depend on it.
 */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}
