# Phase E — Search

## Status

Complete for the scope below. Verified locally on 2026-09-29 (see Verification).

## Architecture

PostgreSQL 17 native search. No external search engine was added.

The audit found about 10 articles with bodies under 2 KB, no tag or language model, and the existing `ILIKE` substring search behind `searchPublic()`. PostgreSQL covers every requirement at this scale, and a GIN index keeps it fast well beyond it.

- **Search document:** `Article.searchVector` is a `tsvector GENERATED ALWAYS … STORED` column, weighted as follows:
  - A: `title`.
  - B: `subtitle`, `articleType` (category), `sportSlug`, `eventSlug` and `seo.keywords` (the project's tags).
  - C: `excerpt`.
  - D: `content`, the plain-text body projection maintained on every save.
- **Freshness:** PostgreSQL recomputes `searchVector` on every write, so it cannot go stale and there is no reindex job.
- **Language:** the `english` configuration stems English words. Bangla words tokenize as whole words and pass through unchanged. This was checked with `ts_debug`.
- **Matching:**
  - Plain queries match every word as a prefix (`crick` → cricket, `বাংলাদেশ` → বাংলাদেশের).
  - Quotes, `-word` and `or` switch to `websearch_to_tsquery`, which handles phrases and exclusions.
  - Terms reach `to_tsquery` only as letters and digits, so tsquery operators cannot be injected.
  - Every value is a bound parameter.
- **Ranking:**
  - Base score: `ts_rank_cd` with weights A 1.0, B 0.4, C 0.2, D 0.1, length-normalized.
  - Title bonuses on top: exact title +2, title prefix +0.6, title contains the query +0.4.
  - Ties break on `publishedAt DESC`, then `id`.
  - Scores are never returned to clients.
- **Typo tolerance:** `pg_trgm` word similarity (threshold 0.45) on title and excerpt.
  - It runs only when full-text finds nothing, so fuzzy matches never dilute real matches.
  - Every non-stop-word must match on its own: either as a word prefix in the document, or by being similar to the title or excerpt. One exact word cannot carry an unmatched one.
  - Stop-word-only queries and quoted, `-word` or `or` queries never fall back.
- **Visibility:** the public scope is enforced in SQL and mirrors `publishedArticleWhere()`: published status, a visible sport, and no hidden event.

## Code

| Piece | File |
|---|---|
| Search core (the only search implementation) | `server/services/search/articleSearch.ts` |
| Query validation (page and APIs) | `server/services/search/params.ts` |
| HTTP endpoints | `server/services/search/routes.ts` (mounted in `server.ts`) |
| Public service (internals replaced, same boundary) | `server/services/public/search.ts` |
| Shared term, normalize and highlight helpers | `src/lib/searchText.ts` |
| Public page, loading and error states | `src/app/search/{page,loading,error}.tsx`, `src/views/SearchPage.tsx` |
| Autocomplete, filter sheet, highlight, analytics hooks | `src/components/search/*`, `src/lib/searchEvents.ts` |
| CMS search hook (Articles list, Internal Link, Related Story) | `src/components/admin/useArticleSearch.ts` |

## API

| Endpoint | Access | Notes |
|---|---|---|
| `GET /api/search` | public | `q, sport, type, author, date, from, to, sort, page, limit≤50`. Rate limited to 120/min per IP. |
| `GET /api/search/suggestions` | public | Title matches on A/B fields plus trigram, up to 6 titles and 3 sports. Rate limited to 240/min per IP. |
| `GET /api/cms/articles/search` | Admin, Editor, Author | Same parameters plus `status` and `exclude`, and exact id/slug lookup. |

Unknown, repeated, malformed or oversized parameters return 400. The page parser is lenient and drops invalid values instead.

## Database

- `20260929090000_phase_e_search`:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm`.
  - Adds the generated `searchVector` column.
  - Adds indexes `Article_searchVector_idx` (GIN), `Article_title_trgm_idx` (GIN trigram) and `Article_status_publishedAt_idx`.
- `20260929093000_phase_e_search_excerpt_trgm`: adds `Article_excerpt_trgm_idx` (GIN trigram).
- The schema declares the column as `Unsupported("tsvector")` with its `dbgenerated` expression. `prisma migrate diff` (DB → schema) is empty, so a future `migrate dev` will not try to alter or drop it.
- The migrations were applied with `prisma migrate deploy`, and an article row hash was taken before and after: identical.
- No reset, no destructive statements, no shadow database pointed at the real DB.

## SEO

Phase D policy is unchanged. `/search/` is still `noindex` (verified over HTTP). Search is not in the sitemap and no canonical change was made.

## Analytics

No analytics integration is active: GA4 is stored but not loaded. Search emits `search`, `search_zero_results`, `search_result_click` and `search_suggestion_click` as a `sportingspy:search` DOM event. It also pushes to `window.dataLayer` only if a tag manager has defined it.

## Verification

- `npm run test:phase-e`: 11 groups. Covers:
  - Ranking, tags, multi-word, prefix, phrase, exclusion and typo fallback.
  - Bangla, inflected Bangla and mixed queries.
  - Visibility of draft, scheduled, archived, preview and hidden-sport content.
  - Staff RBAC, id/slug lookup, filters, custom date ranges, sorting and pagination.
  - Validation, SQL/tsquery metacharacters, suggestions and page states.
  - Generated-column sync, GIN plan usage and rate limiting.
  - Pre-existing rows are hash-compared after the run.
- `npm run test:search-ui` (Chrome): 7 groups.
  - Autocomplete debounce and keyboard use (ArrowDown/Enter/Escape, `aria-activedescendant`).
  - URL-state filters survive reload.
  - No-result state.
  - Mobile filter sheet with no overflow.
  - CMS server-side search.
- Regression: phase-a 13, phase-b 10, phase4 20, phase-c 13, phase-d 9, phase-d1 11, phase-d1.1 8, newsroom-editor 7, admin-article-ui. Also `tsc`, `next build`, `prisma validate`, `migrate status` and `git diff --check`.
- Two older tests asserted superseded copy or CSS values and were updated to the current contract:
  - Phase B: the old "No articles matched" empty-state text.
  - D1.1: the pre-120rem width and old container numbers.
- Performance, warm, in process: common keyword 4.6 ms, rare 3.2, multi-word 3.7, Bangla 3.9, no-result with fuzzy fallback 9.8, filtered 3.6.
  - With `enable_seqscan=off`, the plans use `Article_searchVector_idx` and `Article_title_trgm_idx`.
  - At the current 10 rows the planner prefers sequential scans, which is correct at this size.

## Final hardening pass (2026-09-29)

Fixed:
- **Typo fallback was too loose.** It compared the whole query with the title, so `KW results` returned KW articles as "close matches". It now matches each word separately, ignores stop words (`the` no longer lists everything) and never applies to quoted or `-word` queries.
- **Punctuation-only public queries** (`!!!`) listed every article under a "results for" heading. They now match nothing.
- **"Try again" on the error page did not recover** from a server-side failure, because `reset()` alone reuses the failed server render. It now calls `router.refresh()` and `reset()` in a transition.
- **No loading state for filter, sort or page changes on `/search`.** `loading.tsx` only covers arriving from another route. The results are now in a `<Suspense>` keyed on the search state.
- **Mobile filter sheet focus.** It is now a dialog: focus moves to Close when it opens and returns to the Filters button when it closes.
- **Rate limiter memory.** Every IP bucket was kept forever. Expired buckets are now pruned once the map passes 10,000 keys. Limits are unchanged.

Verified:
- **`npm run test:search-states`** runs the production build. The search query is made slow or failing with a rolled-back `LOCK TABLE "Article"` on a test server whose connections use `lock_timeout`; no production code was changed for this. It checks:
  - The loading skeleton shows during a filter change.
  - A failing suggestions API degrades silently.
  - The friendly error appears inside the intact site layout, with no internal details.
  - "Try again" recovers once the database is available.
  - The only reported errors are the sanitized, expected React #441 server-render errors.
- **Search stays in sync after saves through `PUT /api/articles/:id`** for title, subtitle, excerpt, body, category, sport, event, SEO keywords, publish and unpublish, and `DELETE`. After each change the new value matches and the old value no longer does.
- **Bangla behavior**, as tested:
  - Exact words and multiple words match.
  - Prefix matching works: বাংলাদেশ finds বাংলাদেশের.
  - Mixed Bangla and English queries work.
  - A typo with a missing vowel sign (বিশ্বকপ) is found by the trigram fallback.
  - Unrelated words return nothing.
  - There is still no linguistic stemming.
- **SEO:**
  - `/search/` is `noindex, follow` with a single query-free canonical.
  - No sitemap lists search URLs.
  - robots.txt does not block `/search`, so crawlers can read the noindex.
- **Query plans:**
  - At the current size (about 12–22 rows during tests), the natural plan is a sequential scan taking under 0.1 ms. That is correct for a table this small.
  - A diagnostic plan with `enable_seqscan=off`, run only inside the test, shows the GIN indexes are eligible. The planner will switch to them as the table grows.

## Known limitations

- **Bangla:** PostgreSQL has no Bangla stemmer. Bangla is matched as whole words plus prefix, so বাংলাদেশ finds বাংলাদেশের. There are no stop words and no lemmatization; for example, a suffix-changing inflection that does not share the prefix will not match.
- **Typo tolerance:** only applies to titles and excerpts, and only when there are no full-text matches.
- **CMS data load:** the CMS still loads its full dataset once through `/api/cms/data`, as before, because many screens use it. Article search, filtering and paging no longer rely on it. Opening an article for editing still reads the full record from that dataset.
- **Out of scope:** SEO internal-link suggestions (Phase D) are topic/hierarchy scoring during scans, not keyword search, and were left unchanged.
- **Rate limiting:** limits are in-process per server instance, like the existing login and comment limiters.
