/**
 * CMS settings registry (PHASE C): allowed keys, validators, and which keys
 * may reach public pages. Kept free of Express so the Next.js server can use it.
 */

import { prisma } from './db';
import { validateSafeUrl, validateText, type ValidationResult } from './validation';

type Validator = (value: string) => ValidationResult;
const pattern = (re: RegExp, message: string): Validator => (v) => (re.test(v) ? { valid: true } : { valid: false, error: message });

export const SETTINGS = {
  // Site identity (PHASE H: rendered publicly — site name in titles, header,
  // footer, Open Graph and JSON-LD; description as the default meta description)
  siteName: { group: 'Site identity', label: 'Site name', public: true, validate: (v: string) => validateText(v, 'siteName', 80) },
  siteDescription: { group: 'Site identity', label: 'Site description', public: true, validate: (v: string) => validateText(v, 'siteDescription', 300) },
  // SEO / social defaults (PHASE H: rendered publicly as og:image / twitter:site fallbacks)
  defaultOgImage: { group: 'SEO & social defaults', label: 'Default social image URL', public: true, validate: (v: string) => validateSafeUrl(v, 'defaultOgImage') },
  twitterHandle: { group: 'SEO & social defaults', label: 'X/Twitter handle', public: true, validate: pattern(/^@[A-Za-z0-9_]{1,15}$/, 'twitterHandle must look like @SportingSpy.') },
  // Search engine verification (rendered into public <head>)
  googleSiteVerification: { group: 'Search engine verification', label: 'Google Search Console verification token', public: true, validate: pattern(/^[A-Za-z0-9_-]{10,100}$/, 'Enter only the token from the google-site-verification tag.') },
  bingSiteVerification: { group: 'Search engine verification', label: 'Bing Webmaster verification token', public: true, validate: pattern(/^[A-Za-z0-9]{10,64}$/, 'Enter only the token from the msvalidate.01 tag.') },
  // Analytics / advertising identifiers (PHASE F: activate the provider in production, behind visitor consent; see trackingConfig.ts)
  ga4MeasurementId: { group: 'Analytics & advertising', label: 'GA4 measurement ID', public: false, validate: pattern(/^G-[A-Z0-9]{4,15}$/, 'ga4MeasurementId must look like G-XXXXXXX.') },
  // PHASE D: IndexNow (the key is public by design: it is served at /<key>.txt)
  indexNowKey: { group: 'IndexNow', label: 'IndexNow key (8–128 letters, digits or dashes)', public: false, validate: pattern(/^[A-Za-z0-9-]{8,128}$/, 'indexNowKey must be 8–128 letters, digits or dashes.') },
  adsensePublisherId: { group: 'Analytics & advertising', label: 'AdSense publisher ID', public: false, validate: pattern(/^ca-pub-\d{16}$/, 'adsensePublisherId must look like ca-pub-0000000000000000.') },
  // PHASE R: AdSense Auto Ads (in addition to the controlled slots), off unless chosen.
  adsenseAutoAds: { group: 'Analytics & advertising', label: 'AdSense Auto ads', public: false, options: ['enabled', 'disabled'], validate: oneOf(['enabled', 'disabled']) },
  // PHASE R (Spec v2.0 §22.7): which consent interface visitors see. "google-cmp"
  // loads Google's certified CMP (AdSense Privacy & messaging) instead of the
  // built-in banner. The CMP message itself is configured in the AdSense account.
  consentMode: { group: 'Privacy & consent', label: 'Consent interface', public: false, options: ['builtin', 'google-cmp'], validate: oneOf(['builtin', 'google-cmp']) },
  // PHASE R: first-party, aggregate real-user performance + page-view measurement.
  realUserMonitoring: { group: 'Privacy & consent', label: 'Real-user monitoring', public: false, options: ['enabled', 'disabled'], validate: oneOf(['enabled', 'disabled']) },
  // PHASE R: Search Console / Bing data import (credentials are environment secrets).
  searchConsoleProperty: { group: 'Search engine data', label: 'Search Console property', public: false, validate: pattern(/^(sc-domain:[a-z0-9.-]+|https:\/\/[^\s]+\/)$/i, 'Use "sc-domain:example.com" or a URL-prefix property ending in "/".') },
  bingSiteUrl: { group: 'Search engine data', label: 'Bing Webmaster site URL', public: false, validate: pattern(/^https:\/\/[^\s]+\/$/i, 'Use the site URL exactly as registered in Bing, ending in "/".') },
  // PHASE R (v2.2): the site-wide /faq/ page is off at launch; contextual FAQ is the default.
  globalFaqPage: { group: 'FAQ', label: 'Site-wide /faq/ page', public: false, options: ['enabled', 'disabled'], validate: oneOf(['enabled', 'disabled']) },
  // FAQPage structured data for the site-wide page (per-page toggles live on each Article/Edition/Event/Sport).
  globalFaqSchema: { group: 'FAQ', label: 'FAQ structured data on /faq/', public: false, options: ['enabled', 'disabled'], validate: oneOf(['enabled', 'disabled']) },
} as const;

function oneOf(values: string[]): Validator {
  return (v) => (values.includes(v) ? { valid: true } : { valid: false, error: `Choose one of: ${values.join(', ')}.` });
}

export type SettingKey = keyof typeof SETTINGS;
export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** Settings that public pages may read (server-side only). */
export async function publicSettings(): Promise<Partial<Record<SettingKey, string>>> {
  const keys = SETTING_KEYS.filter((k) => SETTINGS[k].public);
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

