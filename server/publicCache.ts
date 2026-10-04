/**
 * Public content cache (PHASE R, Spec §23 "caching built in", §26.2
 * "caching at multiple levels").
 *
 * Why a data cache and not static HTML: every public page is personalised per
 * request — the CSP nonce, the visitor's consent cookie (ads/analytics state)
 * and the staff preview cookie all change the HTML. HTML is therefore never
 * shared between visitors (no CDN/ISR HTML caching). What is identical for
 * everyone is the published DATA a page is built from, so that is cached here,
 * in process memory, keyed by loader name + arguments.
 *
 * Correctness rules:
 *   - Any successful CMS write (POST/PUT/PATCH/DELETE under /api, except a
 *     few non-content endpoints) bumps the generation, so the next request
 *     rebuilds from PostgreSQL. The scheduler bumps it when it publishes.
 *   - Entries also expire after a short TTL, which bounds staleness for
 *     date-driven logic (edition timing) and for other server instances
 *     (each process has its own cache; see ARCHITECTURE.md).
 *   - Staff previews never read or fill this cache (callers bypass it).
 *   - Express (tsx) and the Next.js bundle evaluate this module separately in
 *     the same process, so the store lives on globalThis.
 */

type Entry = { at: number; generation: number; value: Promise<unknown> };
type Store = { generation: number; entries: Map<string, Entry>; hits: number; misses: number; invalidations: number; writesInFlight: number };

const store = ((globalThis as unknown as { __sportingspyPublicCache?: Store }).__sportingspyPublicCache ??= {
  generation: 0,
  entries: new Map(),
  hits: 0,
  misses: 0,
  invalidations: 0,
  writesInFlight: 0,
});
store.writesInFlight ??= 0;

const MAX_ENTRIES = 2000;
const DEFAULT_TTL_MS = 60_000;

const ttlMs = () => {
  const raw = Number(process.env.PUBLIC_CACHE_TTL_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? raw * 1000 : DEFAULT_TTL_MS;
};

/** True when the cache is switched off (PUBLIC_CACHE_TTL_SECONDS=0). */
export const publicCacheDisabled = () => ttlMs() === 0;

/**
 * Wraps an async loader. Arguments must be JSON-serialisable; they form the key.
 * Failed loads are not kept (the next request retries).
 */
export function cached<A extends unknown[], R>(name: string, loader: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => {
    const ttl = ttlMs();
    // PHASE R.1: while a content write is in progress the database is the only
    // source of truth — a read could otherwise cache a pre-commit value that a
    // request arriving between the commit and the invalidation would be served.
    if (ttl === 0 || store.writesInFlight > 0) return loader(...args);
    const key = `${name}:${JSON.stringify(args)}`;
    const now = Date.now();
    const hit = store.entries.get(key);
    if (hit && hit.generation === store.generation && now - hit.at < ttl) {
      store.hits++;
      return hit.value as Promise<R>;
    }
    store.misses++;
    const generation = store.generation;
    const value = loader(...args);
    store.entries.set(key, { at: now, generation, value });
    value.catch(() => {
      const current = store.entries.get(key);
      if (current?.value === value) store.entries.delete(key);
    });
    if (store.entries.size > MAX_ENTRIES) {
      // Drop the oldest entries (Map keeps insertion order).
      for (const k of [...store.entries.keys()].slice(0, store.entries.size - MAX_ENTRIES)) store.entries.delete(k);
    }
    return value;
  };
}

/**
 * Marks a content write as in progress: the cache is cleared and bypassed
 * until the returned function is called (which clears it again). Safe to call
 * the returned function more than once.
 */
export function beginContentWrite(reason: string): () => void {
  store.writesInFlight++;
  invalidatePublicCache(`${reason} (start)`);
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    invalidatePublicCache(reason);
    store.writesInFlight = Math.max(0, store.writesInFlight - 1);
  };
}

/** Every cached value becomes stale immediately. */
export function invalidatePublicCache(reason = 'content change'): void {
  store.generation++;
  store.invalidations++;
  store.entries.clear();
  if (process.env.PUBLIC_CACHE_DEBUG === 'true') console.log(`[PublicCache] invalidated (${reason}); generation ${store.generation}`);
}

export function publicCacheStats() {
  return { generation: store.generation, entries: store.entries.size, hits: store.hits, misses: store.misses, invalidations: store.invalidations, ttlSeconds: ttlMs() / 1000 };
}

/** API writes that never change public content (no invalidation needed). */
const NON_CONTENT_WRITES = [
  /^\/api\/auth\//,
  /^\/api\/rum$/,
  /^\/api\/search\/click$/,
  /^\/api\/seo\/(scan|article-check|assistant|suggestions)/,
  /^\/api\/contact/,
  /^\/api\/account\//,
  /^\/api\/faq\/suggestions$/,
  /^\/api\/migration\/validate$/,
  /^\/api\/search-console\/sync$/,
];

/**
 * Express middleware: after any successful content write, invalidate.
 * Mounted before the API routes; acts when the response finishes.
 */
export function invalidateOnWrite(req: { method: string; path: string }, res: { statusCode: number; on: (e: 'finish', cb: () => void) => void }, next: () => void) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && req.path.startsWith('/api/') && !NON_CONTENT_WRITES.some((re) => re.test(req.path))) {
    // PHASE R.1: the cache is bypassed for the whole write and cleared when it
    // ends — before the response is sent (so a reload right after a save is
    // fresh) and, at the latest, when the connection finishes or closes.
    const end = beginContentWrite(`${req.method} ${req.path}`);
    const json = (res as unknown as { json?: (body: unknown) => unknown }).json;
    if (typeof json === 'function') {
      (res as unknown as { json: (body: unknown) => unknown }).json = function patched(this: unknown, body: unknown) {
        end();
        return json.call(this, body);
      };
    }
    res.on('finish', end);
    (res as unknown as { on: (e: 'close', cb: () => void) => void }).on('close', end);
  }
  next();
}
