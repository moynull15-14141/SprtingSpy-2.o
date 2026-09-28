/**
 * Google Analytics 4 provider (PHASE F). Loaded only after analytics consent,
 * by PrivacyProvider. Page views are sent manually (send_page_view: false) so
 * client-side navigation is counted exactly once. Google signals and ad
 * personalization signals are turned off: this is audience measurement only.
 */

import type { AnalyticsProvider } from './index';
import { loadScriptOnce } from '../scriptLoader';

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: Gtag; [key: `ga-disable-${string}`]: boolean | undefined }
}

export function ga4Provider(measurementId: string): AnalyticsProvider {
  window[`ga-disable-${measurementId}`] = false;
  if (!window.gtag) {
    window.dataLayer = window.dataLayer || [];
    // gtag() must push the `arguments` object itself (Google's documented shim).
    window.gtag = function gtag() { window.dataLayer!.push(arguments); }; // eslint-disable-line prefer-rest-params
    window.gtag('js', new Date());
  }
  window.gtag('config', measurementId, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false });
  loadScriptOnce('ga4-loader', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`);
  return {
    name: 'ga4',
    send(event, params) {
      window.gtag?.('event', event, { ...params, send_to: measurementId });
    },
  };
}

/** Consent withdrawn: Google's documented opt-out flag, and its first-party cookies removed. */
export function stopGa4(measurementId: string) {
  window[`ga-disable-${measurementId}`] = true;
  const host = location.hostname;
  const domains = ['', host, `.${host}`, `.${host.split('.').slice(-2).join('.')}`];
  for (const name of document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => n === '_ga' || n.startsWith('_ga_'))) {
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; Path=/${domain ? `; Domain=${domain}` : ''}`;
  }
}
