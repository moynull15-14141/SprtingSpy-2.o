/**
 * Analytics (PHASE F): the single, provider-agnostic entry point.
 *
 *   analytics.page(url, navigationId)   one page_view per navigation
 *   analytics.track(name, params)       a named event from EVENTS below
 *
 * Nothing is sent unless the analytics consent category is granted AND a
 * provider is configured (see components/privacy/PrivacyProvider). Payloads
 * are allow-listed and sanitized; staff/account/API paths are never measured.
 * Providers (GA4 today) register themselves and can be swapped without
 * touching the components that report events.
 *
 * Event naming: snake_case "<object>_<action>" (or the GA4 recommended name
 * where one exists: page_view, search). One name per action.
 */

import { isPrivatePath, sanitizeParams, sanitizePath, type Params } from './sanitize';

/** Every event the site may report, with the parameters it may carry. */
export const EVENTS = {
  page_view: ['page_path', 'page_title'],
  article_view: ['article_id', 'sport', 'category', 'author', 'event', 'published_at'],
  // PHASE Q: Event and Edition pages (the Event counterpart of article_view).
  event_view: ['event_id', 'sport', 'event', 'edition_year', 'edition_status'],
  // PHASE Q: GA4 recommended event for content discovery: a click on an
  // article/event/edition card; `placement` = "<page type>:<section>".
  select_content: ['content_type', 'content_id', 'placement'],
  search: ['search_term', 'result_count', 'page', 'sport', 'category', 'author', 'date', 'sort'],
  // PHASE Q: result_type = article | event (Event results are listed separately, positions per list).
  search_result_click: ['search_term', 'link_path', 'position', 'result_type'],
  search_suggestion_click: ['search_term', 'link_path'],
  ad_click: ['ad_placement', 'ad_provider', 'sponsor'],
} as const;

export type EventName = keyof typeof EVENTS;

export interface AnalyticsProvider {
  name: string;
  send(event: EventName, params: Params): void;
}

// Keyed by path, not navigation: a page's own components report before the
// page tracker (child effects run first), so the event may predate page().
type Pending = { name: EventName; params: Params; path: string; sent: boolean };

const state: {
  enabled: boolean;
  providers: AnalyticsProvider[];
  navigationId: number;
  lastPage: { url: string; navigationId: number } | null;
  sentPageFor: number;
  /** Events describing the current page (e.g. article_view), replayed if consent arrives while on it. */
  pageEvents: Pending[];
} = { enabled: false, providers: [], navigationId: 0, lastPage: null, sentPageFor: -1, pageEvents: [] };

const debug = () => { try { return localStorage.getItem('sportingspy_analytics_debug') === '1'; } catch { return false; } };

function emit(name: EventName, params: Params) {
  if (!state.enabled || isPrivatePath(location.pathname)) return;
  for (const provider of state.providers) {
    try { provider.send(name, params); } catch { /* a provider failure must never break the page */ }
  }
  // Local debugging only: never leaves the browser.
  if (debug()) console.debug('[analytics]', name, params); // eslint-disable-line no-console
  window.dispatchEvent(new CustomEvent('sportingspy:analytics', { detail: { name, params } }));
}

function sendPage() {
  const page = state.lastPage;
  if (!page || state.sentPageFor === page.navigationId) return;
  state.sentPageFor = page.navigationId;
  emit('page_view', sanitizeParams({ page_path: sanitizePath(page.url, location.origin), page_title: document.title }, EVENTS.page_view));
  const path = new URL(page.url, location.origin).pathname;
  for (const e of state.pageEvents) if (!e.sent && e.path === path) { e.sent = true; emit(e.name, e.params); }
}

export const analytics = {
  /** Called by the page tracker once per navigation. */
  page(url: string) {
    state.navigationId++;
    state.lastPage = { url, navigationId: state.navigationId };
    const path = new URL(url, location.origin).pathname;
    state.pageEvents = state.pageEvents.filter((e) => e.path === path);
    if (state.enabled) sendPage();
  },

  /**
   * Reports an event. `pageScoped` events describe the page itself (e.g.
   * article_view): if consent is granted later while still on that page they
   * are sent together with its page_view.
   */
  track(name: EventName, params: Record<string, unknown> = {}, options: { pageScoped?: boolean } = {}) {
    const clean = sanitizeParams(params, EVENTS[name]);
    if (!options.pageScoped) { emit(name, clean); return; }
    const pending: Pending = { name, params: clean, path: location.pathname, sent: false };
    state.pageEvents.push(pending);
    // Sent now if this page's view was already reported; otherwise with it.
    if (state.enabled && state.lastPage && state.sentPageFor === state.lastPage.navigationId && new URL(state.lastPage.url, location.origin).pathname === pending.path) {
      pending.sent = true;
      emit(name, clean);
    }
  },

  /** Consent granted + provider configured: start sending (the current page is reported once). */
  enable(provider: AnalyticsProvider) {
    if (!state.providers.some((p) => p.name === provider.name)) state.providers.push(provider);
    state.enabled = true;
    sendPage();
  },

  /** Consent withdrawn or provider removed: stop sending immediately. */
  disable() {
    state.enabled = false;
    state.providers = [];
    // Pages seen while disabled must not be reported later.
    state.sentPageFor = state.navigationId;
  },

  get enabled() { return state.enabled; },
};
