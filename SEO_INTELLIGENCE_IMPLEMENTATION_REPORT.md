# SportingSpy v2 — SEO Intelligence: Implementation Master Report

**Purpose of this document.** This is a code-audited reference for how SportingSpy's SEO
system is *actually built* (not how it was planned). It is written so it can be handed to
another team (or to ChatGPT, while designing a different website's blueprint) to **reuse
proven decisions rather than re-derive them from assumptions.** Every claim below was read
from the current `main` branch; file paths are given so each decision can be verified.

- **Stack:** Next.js 16 (App Router, `force-dynamic`) + a custom Express server (`server.ts`),
  Prisma 7 on PostgreSQL, React 19, TypeScript. Node 22.
- **Audit date:** 2026-10-27. Branch: `main`.
- **Scope:** everything that affects how search engines and answer engines see the site, plus
  the back-office "SEO Intelligence" tooling that keeps editorial content search-ready.

---

## 0. The one architectural decision everything else hangs on

SEO is split into **two completely separate halves that never share a hot path**:

1. **Public rendering path** — always on, runs on *every* page request. Produces the HTML that
   crawlers read: `<title>`, meta description, canonical, robots directives, Open Graph /
   Twitter, JSON-LD structured data, plus the files `sitemap.xml`, `robots.txt`, redirects and
   the IndexNow key file. This code is deliberately cheap and does **no** analysis.

2. **SEO Intelligence back-office** — admin/editor triggered only. The rules engine, full-site
   scans, the per-article editor checklist, deterministic suggestions, the optional AI
   assistant, and the technical dashboard. Every file here carries the comment *"nothing here
   runs during public page rendering."*

> **Reusable principle #1:** keep SEO *evaluation* off the request path. Rendering should only
> read already-simple fields; all the expensive "is this good SEO?" logic lives in a separate
> module that the CMS calls on demand.

A second decision makes the two halves agree: there is **one** indexability definition
(`src/lib/indexability.ts`) imported by page metadata, the sitemap, *and* the scanner — so a
page can never be "noindex in the tag but listed in the sitemap." See §2.

---

## 1. Public SEO rendering (the part crawlers see)

### 1.1 Page metadata builder — `src/lib/seo.ts` → `pageMetadata()`
A single async function returns a Next.js `Metadata` object for every page type. Behaviour:

- **Editor overrides win verbatim.** If the editor filled `seo.metaTitle` / `metaDescription`
  / `canonicalUrl` / `ogTitle` / `ogDescription` / `ogImage`, those are used exactly and never
  reshaped. Otherwise the page's own default title/description is used.
- **Site identity is CMS-driven.** Site name, description, default OG image and X/Twitter handle
  come from Admin → Settings (`getSiteIdentity()`), falling back to `src/config/branding.ts`.
  Page-default text has the built-in brand name swapped for the configured site name
  (`withSiteName`).
- **Canonical:** `seo.canonicalUrl` if set, else `absoluteUrl(path)`. Always an absolute URL.
- **robots tag logic:**
  - private area → `index:false, follow:false`
  - editor `noIndex`, forced `noindex`, or canonical-points-elsewhere → `index:false, follow:true`
  - otherwise → `index:true, follow:true`
- **Social:** Open Graph (`type` website/article, siteName, title, description, url, image) with
  Twitter `summary_large_image`. **Twitter reuses the OG values** — there are no separate
  `twitter*` fields stored (one source of truth, Spec §4.4).
- **`descriptionFrom(text, fallback, max=160)`** trims body prose to a word boundary within the
  same 160-char guideline the scanner enforces, so default descriptions match the rules.

### 1.2 Root layout — `src/app/layout.tsx`
- `export const dynamic = 'force-dynamic'` — every page reads live content per request (no stale
  static cache of editorial content).
- `generateMetadata()` sets `metadataBase`, the default title template, and injects **search-engine
  verification meta tags**: Google (`verification.google`) and Bing (`msvalidate.01`) pulled from
  public settings. These are the *only* settings deliberately exposed to the public HTML.
- Server-rendered shell; only interactive islands (menus, filters, CMS) hydrate on the client.

### 1.3 Article metadata — `src/lib/articleRoute.tsx`
Shared by both article URL shapes. Adds `openGraph.type:'article'` with `publishedTime`,
`modifiedTime`, `section` (sport) and `authors`. Delegates everything else to `pageMetadata()`.

---

## 2. Indexability — the single source of truth (`src/lib/indexability.ts`)

One module, imported by **page robots meta, the XML sitemap, redirect validation, and the
scanner**, so they can never disagree. A URL is indexable **only if** it is public, not
editor-noindexed, self-canonical, and not "thin." Per-entity functions:

| Entity | Not indexable when… |
|---|---|
| Sport | hidden; `seo.noIndex`; canonical elsewhere; **thin** = 0 published articles AND 0 visible events |
| Discipline (internal name for a "group") | its sport hidden; group hidden; group retired (keeps its page for old links, but never indexed); noindex; canonical elsewhere; thin |
| Event | event or sport hidden; noindex; canonical elsewhere |
| Edition | its event not indexable; noindex; canonical elsewhere |
| Article | status ≠ published; sport/event hidden; noindex; canonical elsewhere |
| Author | **thin** = 0 published articles |
| CMS page | status ≠ published; editor noindex |

- **`canonicalElsewhere(seo, selfPath, origin)`** is the shared duplicate test: a canonical
  override that differs in origin, path (after trailing-slash normalisation), query, or has a
  hash → this URL is a duplicate, so it is noindexed *and* dropped from the sitemap.
- **Static paths:** `STATIC_INDEXABLE_PATHS = ['/', '/sports/', '/events/', '/latest/']`.
  `/search/` is explicitly *never* indexable (a user tool, not an index target). `/faq/` is
  indexable only once it has published questions.

> **Reusable principle #2:** define "may this URL be indexed?" exactly once, in a pure module,
> and import it everywhere. Thin-content and canonical rules then stay consistent for free.

---

## 3. Structured data (JSON-LD) — server-rendered, XSS-safe

### 3.1 The emitter — `src/components/seo/JsonLd.tsx`
A tiny server component that `JSON.stringify`s the data and escapes `<` → `<`, so
editor-controlled strings can never close the `<script>` element. All schema below flows through
it.

### 3.2 What is emitted, and where
| Schema type | Where | Key fields / rules |
|---|---|---|
| `Article` / `NewsArticle` / `BlogPosting` | Article page (`src/views/ArticlePage.tsx`) | type chosen **per Article Type** (`schemaType`); headline, description, `mainEntityOfPage`, url, datePublished, dateModified, author (`Person` + jobTitle + url), publisher (`Organization` with stable `@id`), image[], articleSection. Canonical-aware URL. |
| `BreadcrumbList` | every page with a trail (`src/components/ui/Breadcrumbs.tsx`) | `ListItem`s with absolute canonical URLs; "Home" prepended. |
| `SportsEvent` | Event page + Edition page (shared helpers in `EventPage.tsx`) | name, sport, startDate, endDate, `eventStatus` (`EventScheduled`/`EventCompleted`), `location` as `Place`. **Only emitted when a confirmed start date exists.** |
| `CollectionPage` | Sport / discipline pages (`SportPage.tsx`) | `isPartOf` links a discipline back to its sport. |
| `Organization` + `WebSite` | Homepage (`HomePage.tsx`) | stable `@id`s; WebSite publisher references the Organization `@id`. |
| `ProfilePage` + `Person` | Author pages (`AuthorPage.tsx`) | author identity. |
| `FAQPage` (`Question`/`Answer`) | any context with FAQs (`ContextFaq.tsx`, `FaqPage.tsx`) | **opt-in + validated** — see below. |

### 3.3 FAQ structured data is opt-in and validated — `src/lib/faq.ts`
A deliberate rule (v2.2): **do not emit FAQ markup just because FAQ content exists.**
`validateFaqSchema(items, enabled)` emits markup only when an editor turned it on for *that*
context **and** entries pass per-item checks: question ≥10 chars ending in `?`, answer ≥20 chars,
no HTML, no duplicates. Failing entries are reported to the editor and left out of the markup, not
silently included.

> **Reusable principle #3:** structured data is a *claim to Google*. Emit it only when it is
> intentional and valid. Gate FAQ/HowTo/Event markup behind an editor toggle + a validator, and
> report what was excluded and why.

### 3.4 Article Type → schema + SEO profile — `server/articleTypes.ts`, `src/types/index.ts`
- 20 seeded system types (Event Guide, Schedule, Results, How to Watch, Sports Viewing Guide,
  Preview, Update, News, Past Winners, Records, Prize Money, Players, Teams, Venue, Qualification,
  Rules & Format, History, Analysis, General Information, Other). The list is **editable and
  expandable** from the CMS.
- Each type carries two SEO-relevant fields:
  - `schemaType` ∈ `Article | NewsArticle | BlogPosting` (drives §3.2 article markup). Defaults:
    Results / Preview / Update / News → `NewsArticle`; everything else → `Article`.
  - `seoProfile` (17 profiles: general, event-guide, schedule, results, viewing, preview, news,
    past-winners, records, prize-money, players, teams, venue, qualification, rules-format,
    history, analysis). A **custom** type inherits the type-aware SEO rules of its profile — so a
    new "How-to-Watch-like" type gets the viewing checks without editing every rule.
- Integrity: `Article.articleType` is a FK (`ON UPDATE/DELETE RESTRICT`). System types can't be
  renamed or deleted; in-use custom types can't be renamed (renaming would silently re-type live
  content). Unused custom types can be deleted; used ones are deactivated instead.

---

## 4. URL policy + redirect engine

### 4.1 Canonical URL shape — `src/config/urls.ts`
- **Canonical public URLs end with a trailing slash** (`/tennis/french-open/2028/`). The
  no-slash form 301s to it. Shared by the Express server and the React client so navigation and
  canonical tags agree.
- `isPagePath()` excludes APIs, files-with-extensions (sitemap.xml, robots.txt, assets) and
  framework internals from the policy. `canonicalPagePath()` / `stripTrailingSlash()` are the
  shared helpers; query string and hash are always preserved.

### 4.2 Redirect engine — `server.ts` (request pipeline, in order)
For GET/HEAD page requests only:
1. **Legacy static redirects** (`/privacy` → `/privacy-policy/`, `/terms` → …) — 301.
2. **Editor-managed redirect rules** (`RedirectRule` table) — the rule's own status code.
3. **Missing trailing slash** → 301 to the slash form.

Safety: self-redirect skip, **chain detection up to 5 steps**, circular-loop break, and every
target is `canonicalPagePath`-normalised so each request resolves in **a single hop**. Query
strings are preserved but never logged (privacy).

### 4.3 Automatic 301s on URL change — `server/urlStability.ts`, `server/redirects.ts`
- Changing a published article's slug auto-creates a 301 (origin `"article-slug"`).
- Renaming a **sport** or **event** slug, or moving an event to another sport, rewrites every
  descendant URL (event, edition, article) via DB `ON UPDATE CASCADE`, then writes
  `old → 301 → new` for **every** changed URL, recorded by stable row id so there are no chains.
  Event-level articles (not FK-linked to the event) are updated explicitly so they never lose
  their event.
- **Deterministic collision rules** enforced on every write: an event owns `/{sport}/{slug}/`, so
  an event-less article, an event, and a discipline in the same sport can never share a slug; a
  sport slug can't equal a top-level site path.

> **Reusable principle #4:** published URLs are permanent contracts. Make slug changes
> *automatically* emit a direct (single-hop) 301, and make URL collisions impossible by rule
> rather than by hoping editors avoid them.

---

## 5. XML sitemaps — `server/seo/sitemap.ts` + `server/seo/siteIndex.ts`
- `/sitemap.xml` is a **sitemap index** pointing to:
  - `/sitemaps/pages.xml` — static pages, sports, disciplines, events, editions, authors.
  - `/sitemaps/articles-<n>.xml` — published articles in chunks of **5,000**.
- **Only indexable URLs** are listed (same `indexability.ts` as the meta tags). `lastmod` is
  emitted **only for articles** and only on a *meaningful* content change
  (`updatedAt > publishedAt`), not on every save.
- `siteIndex.ts` builds the full public URL map from the DB in one pass, resolves visibility
  (hidden sport hides its events/editions/articles), and marks any URL that an active redirect
  claims as non-indexable (the redirect engine runs first, so the page is never served).
- Served with `Cache-Control: public, max-age=900`; the whole index+children are built from one
  cached site-index pass (invalidated by every content write), not rebuilt per crawler hit.
  `publishScheduledArticles()` runs first so scheduled posts appear the moment they go live.
- The sitemap module also returns a **report** (`included` + `excluded` with reasons) consumed by
  the admin technical dashboard — editors can see *why* a page is not in the sitemap.

---

## 6. robots.txt + host canonicalisation — `server/seo/robots.ts`
- **Production:** `Allow: /`, disallow `/admin/ /account/ /api/ /reset-password/`, and a
  `Sitemap:` line. Public pages, `/media` images and `/_next` assets stay crawlable.
  robots.txt is **not** used in place of `noindex`: filtered/search listings stay crawlable so
  crawlers can *see* their noindex tag.
- **Staging** (`APP_ENV=staging`): `Disallow: /` and **no** sitemap, so a staging copy can never
  compete in search.
- **Non-canonical host:** if a request arrives on a host that isn't the configured canonical
  origin (e.g. the platform's `*.onrender.com` hostname), robots.txt returns `Disallow: /` and
  the page is treated as index-blocked. This uses the **received `Host` header, never
  `X-Forwarded-Host`**, so a forged forwarded header can't make another host look canonical.
  `indexingBlocked()` centralises this decision.

> **Reusable principle #5:** your app is reachable on more hosts than you think (preview domains,
> platform hostnames, staging). Pick one canonical host and actively block the rest from search,
> comparing against the real `Host` header only.

---

## 7. Search-engine integrations

### 7.1 IndexNow — `server/seo/indexnow.ts`
- When an admin sets an IndexNow key, the key file is served at `/<key>.txt` and **meaningful
  public URL changes** (publish, unpublish, content change, URL move) are POSTed to the IndexNow
  endpoint (Bing et al).
- **Honesty guarantees baked in:**
  - "submitted" means the endpoint *received* it (HTTP 200/202) — the code and logs **never**
    claim a URL was "indexed."
  - Submission is **skipped, not faked**, when there is no key, the origin isn't public HTTPS, or
    the environment is staging. (`INDEXNOW_ENDPOINT` can point at a stub for local verification.)
  - Every attempt is written to `SeoIntegrationLog` (status, HTTP code, URLs, detail). Failures
    never throw into the caller (fire-and-forget).

### 7.2 Google Search Console / Bing Webmaster
- Verification tokens (`googleSiteVerification`, `bingSiteVerification`) render as meta tags on
  every page (§1.2) and are reported in the dashboard.
- The dashboard is **explicitly honest** that no Search Console API / Bing Webmaster API is
  connected, so **no performance metrics** (clicks, impressions, CTR, position, indexing status)
  are shown — "No metrics are shown until it is [connected]." Nothing is fabricated.

> **Reusable principle #6:** never invent SEO metrics. If an API isn't wired up, say so and show
> nothing, rather than displaying plausible-looking numbers.

---

## 8. The SEO Rules Engine (the "Intelligence") — `server/seo/rules.ts`, `engine.ts`

The core differentiator. ~30 rules across **12 categories**, producing **findings**, never a
score. Each finding carries: **what** is wrong, **why** it matters, **where** (which entity +
a deep-link into the right CMS tab), a concrete **fix**, and a **severity**.

- **Severities:** `blocking | warning | info`. (Blocking = would actively harm indexing/serving.)
- **Rule = code + data.** The *logic* is in `rules.ts`; the *settings* live in the `SeoRule`
  table (`enabled`, `severity`, applicable `articleTypes`, and a `config` of thresholds / term
  lists). Admins tune every threshold **at runtime with no deploy**; stored config merges over
  code defaults key-by-key, so new default keys still apply after an edit.
- **Targets:** `article | edition | event | sport | media | redirect | site`.
- **Type awareness:** an article rule applies to a type *or any type sharing its SEO profile*
  (`typeMatches` / `byTypeFor`), so custom types inherit checks automatically.
- **Two entry points** (`engine.ts`):
  - `runScan(origin, triggeredBy)` — full-site scan, result cached as a `SeoScanRun`
    (findings + summary: counts by severity/category, what was checked, duration).
  - `checkArticleDraft(origin, input)` — evaluates **one, possibly unsaved** article and returns
    a pass/fail **checklist** for the editor panel, plus suggestions (§9).

### 8.1 The rule catalogue (what ships today)
**On-page / search appearance:** title length (30–65), meta description (70–160), duplicate
titles/descriptions across published articles, slug length/quality.

**Technical:** sport/event/edition relationships present (**blocking**); canonical-override
validity — rejects canonicals to a redirect, a 404, another host, or a duplicate (**blocking**);
published-but-noindex notice; search-engine setup (GSC/Bing/IndexNow tokens); **URL collisions**
(**blocking**, from `urlStability`); repeated no-result searches surfaced as content
opportunities.

**Content:** minimum words (per-type thresholds, e.g. News 150 / How to Watch 250); article-type
essentials (e.g. *How to Watch* must mention broadcaster, streaming, region, timezone; *Schedule*
must mention sessions + timezone; *Prize Money* must mention currency + breakdown); dates stated
for time-bound types; times must carry a timezone; dates consistent with the edition window
(catches copy-paste-from-last-year errors); heading structure (no skipped levels; long copy needs
headings).

**External links:** official source cited for time-sensitive types; link hygiene (no `http://`,
no empty/"click here" anchors, no absolute links back to this site).

**Internal links:** broken internal links (**blocking**); links that pass through a redirect
(extra hop); minimum internal links; **orphan detection** (no editorial inbound link from any
other published article).

**Image SEO:** featured image must be a Media Library item with alt text and a completed
copyright review; inline images need alt text; media items need alt + optimised responsive sizes.

**Structured data:** Article-markup completeness (headline length, image, author, no future
`datePublished`); SportsEvent date validity (**blocking**, valid ISO, end ≥ start); event has an
official source.

**AI / answer-engine readiness** (explicitly editorial, *no ranking claims*): answer-first
opening (≤70 words, names the subject); entity coverage (event, edition year, venue named);
structured info present (table/list) for fact-heavy types; topic completeness (enough sections)
for guides/explainers.

**Freshness (Spec §30):** time-sensitive review window (flags unreviewed schedules/broadcasters/
prize-money as an event approaches); long-unreviewed (>365 days); edition status matches its dates
(e.g. still "upcoming" after it started).

**Event coverage (suggestions only, nothing auto-created):** per-edition expected article set by
status (upcoming vs active vs completed); evergreen event coverage (Past Winners / Venue /
History).

**Redirects:** redirect health — chains, loops, targets that 404, and a redirect that hides a now-
live page (**blocking**).

### 8.2 Content analysis helpers — `server/seo/analyze.ts`
Pure functions over the rich-text document model: word/paragraph/heading/link/image/table/list
extraction (adjacent same-href text runs merged into one link), calendar-date extraction (ISO,
"23 May 2027", "May 23, 2027"), loose date/weekday detection, a time regex, and
word-boundary-aware term matching. These feed the content/freshness/AI rules.

---

## 9. Editor-time assistance (deterministic + optional AI)

### 9.1 Deterministic suggestions — `server/seo/suggestions.ts` (read-only, explainable)
- **Internal link suggestions**, ranked: same edition → same event → same sport → topic
  similarity (shared significant terms, stop-worded) → freshness. Only **live, indexable** targets
  are suggested, and each one says whether it is *already mentioned but not linked*.
- **External source suggestions:** the official event/edition source URLs the article hasn't cited
  yet.
- **Coverage gaps:** article types readers expect for this edition's status that aren't published
  yet.

### 9.2 Optional AI assistant — `server/seo/assistant.ts`
- Uses the project's existing Gemini dependency (`@google/genai`) **only if `GEMINI_API_KEY` is
  set**; returns `missingTopics`, `missingEntities`, `factsToVerify`, `sectionIdeas`.
- **Strict guardrails:** suggestions are returned to the editor and **never written** to the
  article, DB or public site; it is told *not to rewrite or invent facts*; without a key the
  feature honestly reports "not configured" (no placeholder output); provider errors/keys are
  never leaked to the client; 30-second timeout.

> **Reusable principle #7:** an "AI content assistant" should be strictly advisory — it suggests
> into the editor UI and writes nothing automatically, and it degrades to an honest "not
> configured" instead of fabricating output.

### 9.3 Internal search analytics — `server/searchAnalytics.ts`
Privacy-first signal that feeds the "content opportunity" rules: stores only the normalised query
text + two counters (searches, zero-results) per UTC day. Personal-looking text (emails, long
digit runs) is stored as `(redacted)`; no user/session/IP/device data; obvious crawlers are
skipped; analytics failures never break search. Repeated no-result queries become the
`search-no-results` finding (§8.1).

---

## 10. Data model (Prisma) — the SEO-relevant tables
- **`RedirectRule`** — one rule per source path (stored without trailing slash), `targetUrl`,
  `statusCode`, `isActive`, `origin` (`manual` | `article-slug`), timestamps.
- **`SeoRule`** — editable per-rule settings: `enabled`, `severity`, `articleTypes[]`, `config`
  (JSON), `version`. (Logic stays in code; this row only overrides defaults.)
- **`SeoScanRun`** — one scan: `startedAt/finishedAt`, `status`, `triggeredBy`, `summary` (JSON),
  `findings` (JSON, cached so the overview is instant).
- **`SeoIntegrationLog`** — outbound integration attempts (IndexNow): integration, action,
  status, httpStatus, detail, urls.
- **`SiteSetting`** — key/value CMS settings (verification tokens, IndexNow key, FAQ schema
  toggle, site identity, etc.); which keys may reach public pages is whitelisted in code.
- **`ArticleType`** — the editable type list with `schemaType` + `seoProfile` (§3.4).
- **`SearchQueryStat`** — `(day, query)` with `searches` + `zeroResults` counters.
- **`SeoMetadata`** JSON is embedded on sports, disciplines, events, editions, articles and CMS
  pages: `metaTitle?, metaDescription?, canonicalUrl?, keywords?[], noIndex?, ogTitle?,
  ogDescription?, ogImage?`.

---

## 11. API surface — `server/seo/routes.ts` (mounted at `/api/seo`, staff only)
| Method & path | Role | Purpose |
|---|---|---|
| `GET /overview` | Admin, Editor | latest cached scan + previous summary (for trend) |
| `POST /scan` | Admin, Editor | run a full scan now (audited) |
| `GET /runs`, `GET /runs/:id` | Admin, Editor | scan history / a stored report |
| `GET /rules` | Admin, Editor | every rule with its current + default settings |
| `PUT /rules/:key` | **Admin** | enable/disable, severity, article types, config (validated to keep the default's shape; audited) |
| `POST /article-check` | Admin, Editor, Author | checklist + suggestions for a draft (unsaved) article |
| `POST /assistant` | Admin, Editor, Author | optional AI suggestions (never writes) |
| `GET /technical` | Admin, Editor | sitemap report, robots.txt, GSC/Bing setup state, IndexNow state + recent log |

All rule-config writes are shape-validated (same keys, same value kinds, numeric bounds) and
recorded in the audit log with before/after.

---

## 12. Reusable decisions checklist (the short version for a new blueprint)

1. **Split SEO evaluation from SEO rendering.** Rendering reads simple precomputed fields; all
   analysis lives in a CMS-triggered module. (§0)
2. **One indexability function**, imported by meta tags + sitemap + scanner, so they can't
   disagree; it encodes public / noindex / self-canonical / not-thin. (§2)
3. **Editor SEO overrides are verbatim; defaults are derived** from content and CMS site
   identity. (§1.1)
4. **Structured data is opt-in and validated**, and you report what you excluded and why —
   especially FAQ/Event markup. Escape JSON-LD against `<`. (§3)
5. **Article types carry both a schema type and an SEO profile**, so content type drives both
   markup and which checks apply; custom types inherit a profile. (§3.4)
6. **Trailing-slash canonical + single-hop redirect engine + automatic 301 on any slug/URL
   change + rule-enforced collision prevention.** (§4)
7. **Sitemap lists only indexable URLs, chunked, with honest `lastmod`**, built from the same
   indexability pass and cached. (§5)
8. **Pick one canonical host; block staging and all other hosts from search** using the real
   `Host` header only. (§6)
9. **Integrations are honest:** "submitted ≠ indexed"; skip (don't fake) when unconfigured; show
   no metrics without a real API. (§7)
10. **Findings, not scores.** Every issue has what/why/where/fix/severity and deep-links to the
    fix. Rule thresholds are DB-editable without a deploy. (§8)
11. **Assistance is advisory only** — deterministic suggestions always on; AI strictly opt-in,
    writes nothing, degrades to "not configured." (§9)
12. **Privacy-preserving internal search analytics** turn real reader demand into content
    opportunities. (§9.3)

---

## 13. Honest gaps / things a new build should decide explicitly
These are *deliberately* not implemented here, so a new blueprint should decide them on purpose:

- **No live Search Console / Bing Webmaster API** → no clicks/impressions/position data in-app
  (stated openly in the dashboard). If the new site needs rank tracking, that API integration is
  net-new work.
- **Structured data coverage is the set in §3.2** (Article family, SportsEvent, BreadcrumbList,
  CollectionPage, Organization, WebSite, ProfilePage, FAQPage). No `HowTo`, `VideoObject`,
  `ItemList` for listing pages, or `Speakable` yet — add per the new domain.
- **AI assistant is single-provider (Gemini) and advisory.** No automated content generation,
  no auto-publish, no embeddings/semantic internal-linking — internal-link suggestions are
  term-overlap + relationship based, not vector similarity.
- **Scans are manual/admin-triggered and full-site**, cached per run; there is no incremental or
  scheduled background re-scan of only changed entities.
- **Image optimisation / Core Web Vitals** are handled elsewhere in the app (media pipeline +
  first-party RUM via `WebVitalsReporter`), not by the SEO module — keep that boundary in mind
  when mapping responsibilities on the new site.

---

*Prepared from a direct read of `server/seo/*`, `src/lib/{seo,indexability,faq,paths}.ts`,
`src/config/urls.ts`, `src/components/seo/*`, `src/views/*`, `src/app/layout.tsx`,
`server/{articleTypes,urlStability,searchAnalytics}.ts`, `server.ts` and `prisma/schema.prisma`
on branch `main`.*
