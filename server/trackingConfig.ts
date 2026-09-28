/**
 * Which optional third-party technologies are active (PHASE F).
 *
 * The IDs are the existing CMS settings `ga4MeasurementId` and
 * `adsensePublisherId` (Admin-only, Settings screen). Nothing is active until
 * an Admin enters a real ID; no ID is ever hard-coded.
 *
 * Outside production the providers stay off, so local development never
 * sends data to a real analytics/advertising account. Set
 * ALLOW_THIRD_PARTY_IN_DEVELOPMENT=true to test a provider locally on purpose.
 *
 * The result is cached briefly because the CSP middleware needs it on every
 * request; saving a setting clears the cache immediately.
 */

import type { PrivacyConfig } from '../src/lib/consent';

const TTL_MS = 60_000;
// Express (tsx) and the Next.js server bundle can each evaluate this module in
// the same process (see db.ts), so the cache lives on globalThis: a settings
// save through Express must clear the copy Next.js reads too.
type Cache = { cached: { at: number; value: PrivacyConfig } | null; inflight: Promise<PrivacyConfig> | null; generation: number };
const store = ((globalThis as unknown as { __sportingspyTracking?: Cache }).__sportingspyTracking ??= { cached: null, inflight: null, generation: 0 });

const OFF: PrivacyConfig = { ga4MeasurementId: null, adsenseClient: null };

function thirdPartyAllowed(): boolean {
  return process.env.NODE_ENV === 'production' || (process.env.ALLOW_THIRD_PARTY_IN_DEVELOPMENT || '').trim().toLowerCase() === 'true';
}

async function load(): Promise<PrivacyConfig> {
  if (!thirdPartyAllowed()) return OFF;
  const { prisma } = await import('./db');
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: ['ga4MeasurementId', 'adsensePublisherId'] } } });
  const get = (key: string) => rows.find((r) => r.key === key)?.value?.trim() || null;
  // Re-check the stored format: these values end up in script URLs.
  const ga = get('ga4MeasurementId');
  const ads = get('adsensePublisherId');
  return {
    ga4MeasurementId: ga && /^G-[A-Z0-9]{4,15}$/.test(ga) ? ga : null,
    adsenseClient: ads && /^ca-pub-\d{16}$/.test(ads) ? ads : null,
  };
}

/** Current provider configuration (cached up to a minute). */
export async function trackingConfig(): Promise<PrivacyConfig> {
  if (store.cached && Date.now() - store.cached.at < TTL_MS) return store.cached.value;
  if (!store.inflight) {
    const generation = store.generation;
    const request: Promise<PrivacyConfig> = load()
      // A load that started before an invalidation must not overwrite it.
      .then((value) => { if (generation === store.generation) store.cached = { at: Date.now(), value }; return value; })
      .finally(() => { if (store.inflight === request) store.inflight = null; });
    store.inflight = request;
  }
  return store.inflight;
}

/** Last known configuration without waiting (used by synchronous middleware). */
export function trackingConfigSnapshot(): PrivacyConfig {
  if (!store.cached || Date.now() - store.cached.at >= TTL_MS) void trackingConfig().catch(() => undefined);
  return store.cached?.value ?? OFF;
}

/** Called when settings change. */
export function invalidateTrackingConfig(): void {
  store.generation++;
  store.cached = null;
  store.inflight = null;
  void trackingConfig().catch(() => undefined);
}
