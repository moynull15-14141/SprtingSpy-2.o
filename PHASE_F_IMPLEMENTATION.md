# Phase F — Analytics, Privacy / Consent, Monetization

## Status

Complete. Verified locally on 2026-09-28 (see Tests).

This is a technical implementation of privacy controls. It has **not** been reviewed for legal compliance (GDPR, CCPA, Bangladesh law or any other). Nothing here claims compliance, and consent wording and the Privacy Policy should go through legal review before launch.

## What existed before

- **Monetization:** the `AdSlotConfig` table (9 slots, all disabled), a server-rendered `<AdSlot>` on the home, article and event pages, an Admin-only "Ad Placements" screen and `PUT /api/ads/:id`. These are house/sponsor text banners only; there was no third-party ad code.
- **Analytics:** no provider installed. `ga4MeasurementId` and `adsensePublisherId` existed as Admin-only CMS settings ("stored only") and were empty. Phase E search hooks dispatched a DOM event and pushed to `window.dataLayer` whenever it existed, without any consent check.
- **Privacy:** no consent layer. The Privacy page was short and contained a claim ("no third-party tracking pixels") that would become false once analytics was on.
- **RBAC:** role-based (Admin / Editor / Author). There is no permission-string system.
- **Pre-existing bugs found:**
  - `PUT /api/ads/:id` passed the request body straight to Prisma (mass assignment).
  - Clearing a sponsor field in the Ads screen never cleared it, because it sent `undefined`.
  - Editors saw working-looking Ad controls that returned 403.

## Architecture

```
visitor choice (cookie) ─► PrivacyProvider ─► analytics layer ─► GA4 provider
                                          └─► AdSlot (server) ─► house banner | AdSense unit
```

### Consent (`src/lib/consent.ts`, `src/components/privacy/*`)

- **Categories:**
  - `necessary`: always on and never asked.
  - `analytics`: GA4.
  - `advertising`: AdSense.
- **States per category:** allowed, refused, or never asked. A category an Admin configures later is asked about, never assumed.
- **Storage:** the first-party cookie `sportingspy_consent` (for example `1.a1.d-`, 180 days, `SameSite=Lax`, `Secure` on https). It holds no identifier. The server reads it, so the first render already has the right banner and ad state: no flash and no layout shift.
- **When the banner appears:** only if an optional provider is configured and unanswered. It never appears in `/admin` or `/account`. Reading, search and navigation never depend on it.
- **Banner buttons:** "Accept all" and "Reject optional" have equal weight, plus "Manage preferences". It is a non-modal region.
- **Preferences dialog:** keyboard trap, Escape to close, focus returned. It can be reopened from "Privacy choices" in the footer and on the Privacy page.

### Analytics (`src/lib/analytics/*`)

- **API:** `analytics.page(url)` and `analytics.track(name, params)`. Providers register through `enable()` and `disable()`. GA4 is the only provider today.
- **Nothing is sent unless:** consent is given AND a provider is configured AND the path is not `/admin`, `/account` or `/api`.
- **GA4 setup:** loaded after consent only, with `send_page_view: false` (page views are sent manually, once per navigation), and with Google signals and ad personalization signals turned off.
- **Withdrawal:** sets Google's `ga-disable-<id>` flag, deletes `_ga*` cookies and stops sending immediately.
- **Payload rules:** every event has an allow-listed parameter list. Values are short primitives only, and page paths keep only allow-listed query keys (`sport, type, date, sort, page, utm_*`). The search text `q` is never in a reported URL.
- **Search terms:** normalized, lower-cased and cut to 50 characters. Anything that looks like an e-mail address or phone/ID number is replaced with `(redacted)`.
- **Local debugging:** `localStorage.sportingspy_analytics_debug = '1'` logs events to the console. It never sends anything.

**Events.** Naming convention: snake_case `<object>_<action>`, or GA4's recommended name where one exists. One name per action.

| Event | Parameters | Source |
|---|---|---|
| `page_view` | page_path, page_title | every public navigation (`PageViewTracker`) |
| `article_view` | article_id, sport, category, author (slug), event, published_at | public article pages; not staff previews |
| `search` | search_term, result_count, page, sport, category, author, date, sort | Phase E hook (a zero-result search is `result_count: 0`) |
| `search_result_click` | search_term, link_path, position | Phase E hook |
| `search_suggestion_click` | search_term, link_path | Phase E hook |
| `ad_click` | ad_placement, ad_provider, sponsor | sponsor links (`a[data-ad-placement]`) |

Phase E's separate `search_zero_results` event was folded into `search`. Its unconditional `dataLayer` push was removed, and all search events now go through the consent-gated layer.

### Monetization (existing ad-slot system, extended)

- **Provider per slot:** `AdSlotConfig.provider` is either `house` (default) or `adsense`, plus `providerSlotId` (the AdSense unit ID).
- **`house`:** the slot's own sponsor banner. It is labelled **Sponsored**, the link is `rel="noopener noreferrer sponsored"`, and it contains no third-party code, so it shows regardless of consent.
- **`adsense`:** rendered only when the AdSense publisher ID is set AND the visitor allowed advertising. It is decided on the server from the consent cookie and re-checked in the browser. It is labelled **Advertisement**, and the script is loaded lazily, once.
- **Editorial separation:** editorial components only place `<AdSlot id=…>`. Nothing in the ad system touches article bodies, search ranking or content.
- **Admin (Admin-only, as before):** provider choice and AdSense unit ID. Other roles now see the screen read-only.
- **API hardening:** the API accepts only `enabled, sponsorName, bannerText, linkUrl, provider, providerSlotId`, each type-checked. `linkUrl` must be http(s) or a site path. An empty field now clears it.
- **Development placeholders:** `SHOW_AD_PLACEHOLDERS=true` outlines disabled slots.
- **Sponsored articles:** the Article model has no sponsored/editorial classification. It was not added; see Future.

### Configuration

- **Provider IDs:** use the existing CMS settings (Admin → Settings). No provider ID is hard-coded anywhere.
- **Environment gate:** providers are active only when `NODE_ENV=production`, so local development never reaches a real property. Set `ALLOW_THIRD_PARTY_IN_DEVELOPMENT=true` to test one on purpose.
- **Caching:** `server/trackingConfig.ts` caches the configuration for 60 s. The cache lives on `globalThis` because Express and Next.js each load the module, and a settings save invalidates it immediately.
- **CSP:** hosts are added only for configured providers:
  - GA4: `www.googletagmanager.com` for scripts; `*.google-analytics.com`, `*.analytics.google.com` and `*.googletagmanager.com` for connect and images.
  - AdSense: Google's published host list, plus `frame-src` and `img-src https:`.
  - With nothing configured, the CSP is byte-for-byte the original.
  - Dynamically added scripts carry the page nonce.
- **New server environment variables:** `ALLOW_THIRD_PARTY_IN_DEVELOPMENT` and `SHOW_AD_PLACEHOLDERS`. No `NEXT_PUBLIC_*` variable was needed.

## Cookies and storage audit

| Name | Type | Purpose | Kept | Category |
|---|---|---|---|---|
| `sid` | Cookie (HttpOnly, SameSite=Lax, Secure in prod) | session | 7 days | Necessary |
| `csrf_token` | Cookie (SameSite=Lax, Secure in prod; readable by JS by design) | CSRF protection | browser session | Necessary |
| `sportingspy_consent` | Cookie | privacy choice | 180 days | Necessary |
| `sportingspy_theme` | localStorage | light/dark mode | until cleared | Preference |
| `sportingspy_account_language` | localStorage | account language (reader accounts) | until cleared | Preference |
| `sportingspy_logout` | localStorage | cross-tab sign-out signal | until cleared | Necessary |
| `cms-nav-collapsed` | localStorage (staff CMS) | navigation layout | until cleared | Preference |
| `sportingspy_analytics_debug` | localStorage (manual, developer) | console logging of events | until cleared | Developer only |
| `_ga`, `_ga_*` | Cookies set by Google | GA4 measurement | set by Google | Analytics — only with consent |
| Google ad cookies | Cookies set by Google | AdSense | set by Google | Advertising — only with consent |

- No sessionStorage or IndexedDB is used.
- IP addresses are held only in memory, for rate limiting; there are no access logs and no IP/User-Agent columns.
- There is no first-party analytics storage. Retention of analytics data is set in the GA4 account, and Phase F sets no retention period of its own.

## Database

- **Migration `20260930090000_phase_f_ad_providers`:** adds `AdSlotConfig.provider TEXT NOT NULL DEFAULT 'house'` and `AdSlotConfig.providerSlotId TEXT`. It is additive and adds no indexes (the table has 9 rows).
- **Safety:**
  - Target verified as `localhost:5432/sportingspy` and status checked before applying.
  - Applied with `prisma migrate deploy`.
  - Row hashes of Article, User, Author, Sport, MediaItem, SiteSetting, RedirectRule and the original AdSlotConfig columns were identical before and after.
  - `migrate status` is up to date and the DB → schema diff is empty.
- No reset, drop, destructive statement or bulk deletion was run.

## SEO

No new URLs and no consent URL parameters were added. Robots, sitemap, the article canonical and the Privacy page's indexing were fetched before and after enabling both providers and were identical (tested).

## Performance

Measured with `npm run perf:measure` on the production build, running Chrome locally with nothing configured. Figures are medians.

| Page | Script before → after | Requests | CLS | LCP before → after (7-run median) |
|---|---|---|---|---|
| Home, desktop | 141.8 → 146.5 KB | 26 → 26 | 0.001 → 0.001 | 448 → 436 ms |
| Article, desktop | 143.5 → 148.4 KB | 31 → 31 | 0.001 → 0.001 | 464 → 456 ms |
| Search, desktop | 145.0 → 149.3 KB | 37 → 37 | 0.032 → 0.032 | 596 → 608 ms |
| Home, mobile | 140.9 → 145.6 KB | 21 → 21 | 0.002 → 0.002 | 432 → 468 ms |
| Article, mobile | 142.5 → 147.4 KB | 24 → 24 | 0.002 → 0.002 | 424 → 468 ms |
| Search, mobile | 145.0 → 149.3 KB | 33 → 33 | 0.166 → 0.166 | 336 → 372 ms |

- Script sizes are the encoded bytes of all scripts on the page.
- About +4.5 KB of script per page; request counts and CLS are unchanged.
- A 3-run pass showed LCP 60–200 ms higher, but the 7-run pass (TTFB ≈ 40 ms) was within ±45 ms of the baseline, so no LCP regression is claimed or excluded beyond that noise.
- The cost of real GA4 and AdSense scripts could not be measured: they are stubbed in tests and no real account exists.
- The mobile `/search` CLS of 0.166 predates Phase F.

## Tests

- **`npm run test:phase-f`:** 11 groups, production build with stubbed Google scripts. Covers:
  - consent format and sanitizers;
  - the development kill-switch;
  - original CSP, no banner and no scripts when nothing is configured;
  - Admin-only configuration, validation and immediate CSP updates;
  - no Google request before consent or after rejecting;
  - analytics-only consent: exactly one page_view plus article_view, no body text;
  - client navigation counted once per page;
  - sanitized search events through the Phase E hooks;
  - accept advertising → AdSense unit and script; `ad_click`;
  - withdrawal: opt-out flag, `_ga` removed, no further events, AdSense removed;
  - CMS never measured and loads no script;
  - mobile fit and keyboard focus trap;
  - SEO unchanged;
  - integrity: all rows restored and hash-compared.
- **Regression:** every suite passed. phase-a 13, phase-b 10, phase-c 13, phase-d 9, d1 11, d1.1 8, phase4 20, newsroom-editor 7, admin-article-ui, phase-e 12, search-ui 7, search-states 5. `tsc`, `next build`, `prisma validate`, `migrate status` and `git diff --check` also passed.
- **One assertion updated as intentionally obsolete:** Phase C's "GA4/AdSense IDs never reach public HTML". It was written when those IDs were "stored only"; once set, they now configure the provider, and they are public identifiers by nature.

## Known limitations

- **Real accounts untested:** there are no real GA4 or AdSense accounts, so delivery to Google, and whether AdSense's own scripts work under the CSP, was not tested end to end. Both were verified only against stubs.
- **Legal review not done:** the consent wording, 180-day re-prompt, Privacy Policy and category descriptions are technical defaults.
- **No legal-entity details:** no legal entity name, address or jurisdiction exists in the repo, and none were invented. The page names only the existing `BRANDING.supportEmail`.
- **Custom dates reported as `custom`:** custom date filters in the search event are reported as `custom`, without the dates.
- **No Consent Mode v2 or TCF:** Google Consent Mode v2 signals and IAB TCF are not implemented. Google tags are simply not loaded without consent. AdSense in some regions may require a Google-certified CMP; that is a business and legal decision.

## Future (outside Phase F)

- Sponsored or partner **article** classification (`editorial` / `sponsored`) with visible labelling.
- Campaign scheduling (start/end dates) and multiple rotating creatives per slot.
- A permission-string RBAC, if roles beyond Admin need monetization access.
- A CSP `frame-src` for the Phase C YouTube/Vimeo embeds. The current production CSP has no `frame-src`, so it falls back to `default-src 'self'` and blocks them; this was found in the audit and is not a Phase F change.
- The mobile `/search` CLS of 0.166.
