/**
 * IndexNow (PHASE D, Spec v1.1 §19 "IndexNow where appropriate").
 *
 * When an Admin sets an IndexNow key (Settings), the key file is served at
 * /<key>.txt and meaningful public URL changes (publish, unpublish, content
 * change, URL move) are submitted to the IndexNow endpoint. Submission only
 * tells participating engines (e.g. Bing) that a URL changed; it does not
 * mean the URL was indexed, and the log never claims so.
 *
 * Submissions are skipped (not faked) when no key is set, or when the site
 * origin is not public HTTPS — unless INDEXNOW_ENDPOINT is explicitly set
 * (used by local verification against a stub endpoint).
 */

import crypto from 'node:crypto';
import { prisma } from '../db';
import { canonicalPagePath } from '../../src/config/urls';

const DEFAULT_ENDPOINT = 'https://api.indexnow.org/indexnow';
let cachedKey: { value: string | null; at: number } | null = null;

export async function indexNowKey(): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < 30_000) return cachedKey.value;
  const row = await prisma.siteSetting.findUnique({ where: { key: 'indexNowKey' } });
  cachedKey = { value: row?.value || null, at: Date.now() };
  return cachedKey.value;
}

export function forgetIndexNowKey() {
  cachedKey = null;
}

export async function indexNowState(origin: string) {
  const key = await indexNowKey();
  const endpoint = process.env.INDEXNOW_ENDPOINT || DEFAULT_ENDPOINT;
  const publicOrigin = /^https:\/\//.test(origin) && !/\/\/(localhost|127\.|\[::1\])/.test(origin);
  const active = !!key && (publicOrigin || !!process.env.INDEXNOW_ENDPOINT);
  return {
    configured: !!key,
    active,
    keyFileUrl: key ? `${origin}/${key}.txt` : null,
    endpoint,
    reason: !key ? 'No IndexNow key is set (Settings → IndexNow).' : !active ? 'The site origin is not public HTTPS, so submissions are skipped in this environment.' : null,
  };
}

/** Fire-and-forget submission of changed public URLs. Never throws into the caller. */
export function notifyIndexNow(origin: string, paths: string[], reason: string) {
  const urls = [...new Set(paths.filter(Boolean).map((p) => `${origin}${canonicalPagePath(p)}`))];
  if (!urls.length) return;
  void (async () => {
    const state = await indexNowState(origin);
    if (!state.active) return;
    const key = (await indexNowKey())!;
    let status = 'failed';
    let httpStatus: number | null = null;
    let detail = reason;
    try {
      const res = await fetch(state.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: new URL(origin).host, key, keyLocation: state.keyFileUrl, urlList: urls }),
        signal: AbortSignal.timeout(10_000),
      });
      httpStatus = res.status;
      // 200/202 = received by the endpoint (not "indexed").
      status = res.status === 200 || res.status === 202 ? 'submitted' : 'rejected';
      if (status !== 'submitted') detail = `${reason}; endpoint answered HTTP ${res.status}`;
    } catch (err) {
      detail = `${reason}; request failed (${err instanceof Error ? err.name : 'error'})`;
    }
    await prisma.seoIntegrationLog.create({
      data: { id: `seo-log-${crypto.randomUUID()}`, integration: 'indexnow', action: 'submit', status, httpStatus, detail, urls, createdAt: new Date() },
    }).catch(() => undefined);
  })().catch(() => undefined);
}
