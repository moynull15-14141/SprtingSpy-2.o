# Phase M — Search Redesign

## Status

**COMPLETE for the repository implementation.** Verified on 2026-10-04 against the local development database, a production build and real Chrome. No deployment or production database action was performed.

## 0. E5 Remaining Items

| Item | Finding | Action |
|---|---|---|
| Monaco 2026 (`monaco-gp-2026`) | Still `upcoming`; dates 22–24 May 2026 had passed | Set to `completed` through the CMS API (`PUT /api/editions/:id`, Admin session, audit-logged) |
| Masters 2026 (`the-masters-2026`) | Still `upcoming`; dates 9–12 April 2026 had passed | Same |
| Public result | — | Both pages now emit `eventStatus: EventCompleted`, FAQ answers use past tense, both appear under Past in `/events/?when=past` |
| Migration `20261008090000_phase_e5_event_faq` | Applied 2026-10-04; `_prisma_migrations` row finished; no drift | **Harmless.** Every migration since Phase H uses a one-day-per-migration sequence name ahead of its apply date (e.g. `20261004…phase_h` was applied 2026-09-29). Prisma orders migrations lexically only. Phase M continues the sequence with `20261009090000`. No history was altered. |

The temporary maintenance login used for the status change was removed afterwards. Its two audit-log entries were kept as the record of the change.

## 1. Audit Findings

| Area | Before M |
|---|---|
| Article search | Strong: weighted `searchVector` (A title; B subtitle/category/sport/event/keywords; C excerpt; D body), GIN, AND-of-prefixes, web syntax (quotes, `-word`, `or`), title bonuses, per-term trigram fallback, deterministic paging |
| Event search in `/search/` | Reference "chips" only, on page 1 of an unfiltered search. Matched by case-insensitive substring of the *whole* query, so multi-word queries in a different order and typos failed. Not ranked, not paginated, absent from `/api/search`. Chips linked to the current *Edition*, not the Event |
| Event autocomplete | E5 substring match, unranked |
| Indexes | No full-text or trigram index on `SportEvent` / `EventEdition` |
| Filters | Sport, category (`type`), author, date range, sort. No content-type filter |
| Bugs found | Search-page heading and tests assumed Article-only results; Phase E test chose its edition nondeterministically (see §17) |

## 2. Existing Architecture (kept)

```
SearchBox / URL → GET /search/ (server-rendered) or /api/search
  → params.ts (one validator; strict for APIs, lenient for the page)
  → services/public/search.ts (visibility boundary)
  → services/search/articleSearch.ts + eventSearch.ts (SQL ranking, filtering, paging)
  → hydrate the page of ids (batched) → SearchPage.tsx
```

No second engine was introduced. Events use the same PostgreSQL FTS + pg_trgm design as Articles.

## 3. Article Search

Behavior preserved. One ranking addition: for multi-word plain queries, a **phrase bonus** (+0.3) applies when the words appear adjacent and in order (`phraseto_tsquery`). The fallback's stop-word filter and helpers were extracted for reuse by Events; the SQL is unchanged.

## 4. Event Search

**Decision: the Event is the search result; the Edition is a secondary detail.** This matches the product model, where an Event is the permanent page and Editions are its yearly stagings. Each Event appears at most once. When an Edition explains the match (the Event's own text did not match, or the query names that Edition's year), the result shows a link to that Edition (e.g. "french open 2027" → French Open, with the 2027 edition link).

Searchable fields, all real columns:

| Weight | SportEvent | EventEdition |
|---|---|---|
| A | name, short name | title |
| B | sport slug words, event slug words, event type | year |
| C | default venue, default location, frequency | venue, location |
| D | description, history | description |

## 5. Ranking Design

```
Articles: ts_rank_cd(weighted) + title bonus (exact 2.0 > prefix 0.6 > contains 0.4) + phrase 0.3
Events:   ts_rank_cd(Event) + 0.5 × best Edition rank
          + name/short-name bonus (exact 2.0 > prefix 0.6 > contains 0.4) + phrase 0.3
Ties:     Articles → publishedAt DESC, id; Events → name, id (deterministic paging)
Fallback: trigram only when full-text returns nothing
```

The result is exact name > exact phrase > prefix > weighted title/name text > metadata > description/body, and fuzzy only as a fallback.

## 6. Multi-word Search

Every plain word must match as a word prefix (AND), so one common word cannot pull in unrelated results ("grand trophy" excludes "Junior Series"). Quoted phrases, `-exclusions` and `or` keep the web-search syntax. Adjacent in-order matches rank above loose matches. Punctuation and repeated spaces are normalized; queries are capped at 100 characters and 8 words.

## 7. Typo / Fuzzy Search

Three steps for both types:
1. exact and prefix bonuses
2. weighted full-text
3. per-term fallback

In the fallback, every meaningful word must match as a prefix or by trigram similarity, and at least one must be a fuzzy title/name match. It runs only when full-text finds nothing and uses GIN trigram indexes.

| Type | Threshold | Notes |
|---|---|---|
| Articles | 0.45 | Unchanged |
| Event names | 0.40 | Short, distinctive proper nouns. "wimbeldon" (similarity 0.43) → Wimbledon; "rolan garos" → French Open |

## 8. Filters

| Filter | Applies to | Notes |
|---|---|---|
| `kind` = (all) / `article` / `event` | — | New. Shown as tabs with counts |
| `sport` | Articles + Events | |
| `type` (category), `author`, `date`/`from`/`to`, `sort` | Articles only | Hidden in the Events view. In "All", the Event group is omitted while they are active |

The name `type` was not reused for content type because it is already the Article-category parameter (existing contract). `kind` is the new content-type parameter.

## 9. Autocomplete

- Up to 3 sports, 3 Events and 6 Article titles.
- Events are now ranked full-text matches on the name/slug/type fields (prefix, every word) plus trigram near-matches ("halvorsem" → "Halvorsen…").
- Each URL appears at most once, and visibility is enforced in SQL.
- The existing keyboard UX (arrow keys, Enter, Escape, `aria-activedescendant`) is unchanged.
- Types are labelled "{Sport} · Event", "{Sport} · {Category}" and "Sport".

## 10. Search UI

- Type tabs: All / Articles / Events, with counts.
- In "All", page 1 shows a ranked Events group (top 4, with "See all N events") above the paginated Article list.
- The Events view is paginated.
- Event rows show sport, highlighted name, description, venue/location and an optional matched-Edition link.
- Typo notice, past-the-end page, no-result (with links to all results and `/events/`), the existing loading skeleton and error boundary are covered for both types.
- The heading keeps "N results for …" unless Events also match ("N articles and M events for …").
- Sport chips remain; the old Event chips were replaced by real results.

## 11. Database / Index Changes

**DATABASE SCHEMA CHANGED: YES (additive only).**

Migration `20261009090000_phase_m_event_search` adds:
- `SportEvent.searchVector` and `EventEdition.searchVector`: STORED generated tsvectors, maintained by PostgreSQL and never written by the application
- `SportEvent_searchVector_idx` (GIN)
- `EventEdition_searchVector_idx` (GIN)
- `SportEvent_name_trgm_idx` (GIN trigram)

No duplicate indexes: the suite compares every index definition. The planner uses the Event GIN index (EXPLAIN-verified). Applied with `db:migrate:deploy`; `prisma migrate diff` against the database is empty. No data was modified by the migration.

## 12. API Changes (backwards compatible)

**`GET /api/search`**
- Accepts `kind=article|event`.
- Existing fields keep their meaning: `total` and `results` are Articles.
- Adds `kind`, `eventTotal` and `events[]` (`id, name, shortName, url, sport, sportName, description, venue, location, matchedEdition`).
- `totalPages` counts pages of the paginated type (Events when `kind=event`).

**`GET /api/search/suggestions`**
- Same shape as E5 (`sports`, `events`, `articles`), now ranked and de-duplicated.

**Validation**
- Invalid `kind`, repeated parameters, `page` outside 1–500, `limit` outside 1–50, oversized `q` and unknown keys → 400.
- `kind` is rejected by CMS search.
- The page parser stays lenient.

## 13. Security / Visibility

All filtering happens in SQL on the server:
- Articles: `published`, in a visible sport, not attached to a hidden Event (unchanged).
- Events: `isVisible` and the sport visible.
- Editions are reached only through visible Events.

Drafts, hidden Events, Events of hidden sports and their articles are excluded from results, counts and suggestions (all tested).

## 14. Tests

`server/scripts/verify-phase-m.ts` (`npm run test:phase-m`), 7 groups:
1. **Articles:** exact title first, prefix, multi-word, body, category filter, typo, empty-query browse, draft and hidden-event exclusion.
2. **Events:** exact, partial and multi-word name; ranking; location, venue and description; typo; Edition year and venue; one result per Event; hidden Event and hidden sport.
3. **Unified:** All, Articles and Events views; tab counts; sport and type combinations; Article and Event pagination (stable, no duplicates, past-the-end).
4. **Autocomplete:** Article and Event, partial and near matches, hidden exclusion, unique URLs, limits.
5. **Validation and edge cases:** empty, whitespace, long, punctuation-only, repeated spaces, invalid page/limit/kind, repeated and unknown parameters, no results.
6. **Indexes and SEO:** required indexes exist, no duplicates, the GIN index is used, noindex with the `/search/` canonical.
7. **Real Chrome** (§15).

Fixtures use invented words; original Sport/Event/Edition/Article/Author rows are hash-verified after cleanup.

## 15. Browser Verification

Real Chrome (headless) covered:
- grouped Events and Articles at 1440 px and 390 px, with no horizontal overflow
- type tabs and the Events view (Article-only filters hidden)
- typo notice and the matched-Edition link
- Article pagination to page 2
- no-result state
- typed autocomplete with keyboard selection, navigating to the Event
- no page errors

The suite passed twice in a row. The `search-ui` and `search-states` suites also ran in Chrome.

## 16. Production Build

`npm run build` (`tsc --noEmit` + `next build`): **PASS**.

## 17. Regression Results

| Command | Result |
|---|---|
| `npm run test:phase-m` | 7/7 PASS (twice) |
| `npm run test:phase-e` | PASS |
| `npm run test:search-ui` | PASS (needs a server on :3000) |
| `npm run test:search-states` | PASS |
| `test:phase-e1` / `e2` / `e3` / `e4` / `e5` | 8 / 8 / 13 / 6 / 7 PASS |
| `test:phase-a` / `test:phase-b` (with `PLAYWRIGHT_MODULE`) | 15 / 11 PASS incl. browser |
| `test:phase-h` / `test:phase-i` | 12 / 9 PASS |
| `SMOKE_EXPECT_ORIGIN=https://sportingspy.com npm run smoke` | 6 PASS (authenticated part skipped: no credentials) |
| `npx tsc --noEmit`, `git diff --check` | PASS |

Test changes, each explained:
- **`verify-search-states.ts`, `verify-search-ui.ts`:** the heading regex also accepts "N articles and M events for …", the intended M heading when Events match (real data: "champions" and "prize" now match Events).
- **`verify-phase-e.ts`:** the test picked its edition with `findFirst` and no `orderBy`. After the Step 0 status updates changed row order, it picked `the-masters` and derived the stop word "the" as its "event word". The search correctly ignores stop words, so the assertion could not hold. The edition is now ordered by id and stop words are skipped. No search behavior changed.
- **`verify-search-ui.ts`:** the CMS step's loose `/Articles/` button selector became ambiguous after Phase I added an "articles awaiting editorial review" dashboard button. This was pre-existing and unrelated to M; the selector is now `exact: true`, as in the other suites.

## 18. Known Limitations

- Short words match as prefixes (existing Phase E semantics). "us open" requires a word starting with "us" ("use", "usual") and finds no Event because the data has no US Open; the phrase and title bonuses still rank genuine phrase matches first.
- An Event matches when all words are in the Event's own text or all are in one Edition's text; words split across the two (e.g. a description word plus an Edition year) do not combine.
- The "All" view interleaves nothing: Events are a separate ranked group, because Article and Event scores are not on a comparable scale.
- Sport *names* are not in the Event vector (a generated column cannot join); the sport *slug* words are, which covers current sports ("motorsport", "golf").
- Counts run as separate indexed `count(*)` queries (the existing Phase E strategy).
- The Event trigram index covers `name`; short-name similarity is evaluated on candidates without its own index (small reference table).

## 19. Deferred Work

- **K (scaling):** result/count caching, query-plan monitoring at larger data volumes.
- **N (migration):** none required.
- **L (analytics):** the existing search events (`SearchAnalytics`) are unchanged; Event-result click tracking and zero-result reporting are deferred.
- **O (general polish):** visual refresh of result rows, localized/Bangla stemming configuration, and a unified Article/Event interleaving if ever wanted.

## 20. Next Recommended Phase

**K (scaling).** Caching and count strategy for search and discovery, sized on real traffic. Run L afterwards to measure search quality (zero-result queries, Event-result clicks) before any further ranking tuning.
