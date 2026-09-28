/**
 * Privacy choices (PHASE F): the one consent model shared by the server
 * (initial render) and the browser (banner, preferences, providers).
 *
 * Categories:
 *   necessary    always on; the session, CSRF and preference storage the
 *                site needs to work. Never asked for.
 *   analytics    audience measurement (e.g. Google Analytics), if configured.
 *   advertising  third-party advertising (e.g. Google AdSense), if configured.
 *
 * The choice lives in a first-party cookie so the server can render the right
 * state immediately (no banner flash, no ad-slot layout shift). It holds only
 * the choice itself: no identifier, readable by same-origin script.
 * Cookie value: `<version>.a<0|1|->.d<0|1|->`, e.g. `1.a1.d-`, where `-` means
 * the category was not offered (not configured) when the visitor chose. A
 * category configured later is therefore asked about, never assumed.
 */

export const CONSENT_COOKIE = 'sportingspy_consent';
/** Bump when the categories or their meaning change: everyone is asked again. */
export const CONSENT_VERSION = 1;
/** How long a choice is remembered before asking again (a product setting, not a legal claim). */
export const CONSENT_MAX_AGE_DAYS = 180;

export type ConsentCategory = 'analytics' | 'advertising';
/** Per category: true = allowed, false = refused, undefined = never asked. */
export type ConsentChoice = { analytics?: boolean; advertising?: boolean };
/** `null` = the visitor has not chosen anything yet (unknown). */
export type ConsentState = ConsentChoice | null;

const flag = (v: string) => (v === '1' ? true : v === '0' ? false : undefined);
const mark = (v: boolean | undefined) => (v === true ? '1' : v === false ? '0' : '-');

export function parseConsent(value: string | undefined | null): ConsentState {
  const m = /^(\d+)\.a([01-])\.d([01-])$/.exec((value ?? '').trim());
  if (!m || Number(m[1]) !== CONSENT_VERSION) return null;
  return { analytics: flag(m[2]), advertising: flag(m[3]) };
}

export function serializeConsent(choice: ConsentChoice): string {
  return `${CONSENT_VERSION}.a${mark(choice.analytics)}.d${mark(choice.advertising)}`;
}

/** The same answer for every category currently offered; others stay "never asked". */
export function answerAll(categories: ConsentCategory[], allow: boolean): ConsentChoice {
  return { analytics: categories.includes('analytics') ? allow : undefined, advertising: categories.includes('advertising') ? allow : undefined };
}

/** True when an offered category has no recorded answer yet. */
export const needsChoice = (consent: ConsentState, categories: ConsentCategory[]) => categories.some((c) => consent?.[c] === undefined);

/** Which optional technologies are actually switched on for this site. */
export interface PrivacyConfig {
  /** GA4 measurement ID when analytics is active, otherwise null. */
  ga4MeasurementId: string | null;
  /** AdSense publisher ID when third-party advertising is active, otherwise null. */
  adsenseClient: string | null;
}

export const optionalCategories = (config: PrivacyConfig): ConsentCategory[] => [
  ...(config.ga4MeasurementId ? (['analytics'] as const) : []),
  ...(config.adsenseClient ? (['advertising'] as const) : []),
];

/** True when this category may run: configured and consented. */
export function allowed(category: ConsentCategory, consent: ConsentState, config: PrivacyConfig): boolean {
  const configured = category === 'analytics' ? !!config.ga4MeasurementId : !!config.adsenseClient;
  return configured && consent?.[category] === true;
}
