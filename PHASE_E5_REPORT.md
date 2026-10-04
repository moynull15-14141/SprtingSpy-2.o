# Phase E5 — Event Discovery, FAQ, SEO & Structured Data

## 1. Status

**COMPLETE for the repository implementation.** Verified on 2026-10-04 against the local development database, a production build and real Chrome. No deployment or production database action was performed.

## 2. Audit Findings

Before E5, the repository had:

| Area | Already in place | Gap found |
|---|---|---|
| Event FAQ | Global CMS FAQ at `/faq/` with FAQPage JSON-LD (`server/faq.ts`, `src/views/FaqPage.tsx`) | No Event-level FAQ, neither editable nor derived from Event data |
| Discovery | `/events/` with sport filter; Sport hub lists Events; same-Sport related Events on the Event page | No upcoming/ongoing/past view. The directory loaded every visible Event and filtered in memory, with no pagination |
| Home "upcoming" | `upcomingEditions` section | Filtered on `status = upcoming` only, with no ordering, so editions whose dates had passed (e.g. Monaco 2026, the Masters 2026) still appeared as upcoming |
| Search | Events matched in `/search/` results (name, short name, description, venue) | Events missing from autocomplete; location not searchable |
| Event SEO | Title, canonical, OG and X metadata, editor SEO overrides | Empty Event/Edition description produced an empty meta description; long descriptions were not capped |
| Indexability | Sitemap marks Editions of a noindexed Event as non-indexable | The Edition page itself still sent `index, follow`, so the page disagreed with the sitemap |
| Structured data | SportsEvent on Event (current Edition) and Edition pages; BreadcrumbList everywhere | The two pages described the same edition as unrelated entities; Edition schema lacked `eventStatus`/`image`; the Edition breadcrumb skipped "Sports" |

## 3. Implemented Changes

### FAQ
- **Derived Event FAQ** (`src/lib/eventFaq.ts`): questions are built only from stored facts (current Edition dates and venue, defending champions, participant count, Event frequency, and sport). A question appears only when its answer exists. The sport question never appears on its own. Tense follows the Edition's timing ("When was…" for past editions).
- **Editor Event FAQ**: `FaqEntry.eventId` (nullable) scopes an entry to one Event. Published scoped entries appear first on that Event page. A derived question with the same wording is dropped. Scoped entries never appear on `/faq/`.
- **FAQPage JSON-LD** is built from the same list as the visible accordion and is emitted only when that list is non-empty.
- Admin → FAQ has a "Show on" picker (global or a specific Event, hidden Events marked) and an Event badge on each scoped entry.
- Deleting an Event is refused while FAQ entries reference it. The database also enforces this with `ON DELETE RESTRICT`.

### Discovery
- One shared timing rule (`src/lib/eventTiming.ts`) has a JS form for rendering and a SQL form (`editionTimingWhere`) for queries. The suite checks the two agree:
  - **past**: status completed/archived, or the last stored day is before today (UTC)
  - **upcoming**: not past, and the first day is after today (or undated with status `upcoming`)
  - **ongoing**: everything else
- Editor statuses are never rewritten; a stale `upcoming` status with past dates is simply listed as past.
- `/events/`:
  - Happening now / Upcoming / Recently completed previews
  - A paginated Event index (12 per page)
  - Timing tabs with counts (`?when=upcoming|ongoing|past`), combinable with `?sport=`
  - All lists are bounded and filtered in SQL
- The Home upcoming section uses the same timing rule, ordered soonest first.
- New links: "All {Sport} events" from the Event page, and "Event calendar" from the Sport hub.

### SEO / Schema
- Event and Edition meta descriptions fall back to a factual default when empty and are cut at a word boundary within 160 characters. Editor `seo.metaDescription` is never altered.
- Edition pages are `noindex, follow` when their Event is editor-noindexed, matching `editionIndexability` and the sitemap.
- The Event and Edition pages give the current Edition the same `@id` (`…/{year}/#event`), so crawlers see one entity, not two.
- Edition SportsEvent gains `eventStatus` and `image` when stored. The Event page SportsEvent gains `sport`.
- No `offers`, `organizer` or `eventAttendanceMode` are emitted: none are modelled. The test asserts they never appear.
- The Edition breadcrumb is now Home → Sports → Sport → Event → Edition, consistent with the Event page.

### Search
- Autocomplete returns up to 3 visible Events (name or short name). The SearchBox renders them as "{Sport} · Event".
- Event reference results also match `defaultLocation`.
- Article search is unchanged.

## 4. Files Changed

**New**
- `prisma/migrations/20261008090000_phase_e5_event_faq/migration.sql`
- `src/lib/eventTiming.ts`, `src/lib/eventFaq.ts`, `src/lib/eventDates.ts`
- `src/components/editorial/EditionCard.tsx`
- `server/scripts/verify-phase-e5.ts`
- `PHASE_E5_REPORT.md`

**Modified**
- `prisma/schema.prisma`
- `server.ts` (Event delete guard), `server/faq.ts`, `server/seo/siteIndex.ts`
- `server/services/public/content.ts`, `faq.ts`, `search.ts`, `siteLayout.ts`
- `src/app/events/page.tsx`, `src/app/[sport]/[event]/page.tsx`, `src/app/[sport]/[event]/[year]/page.tsx`
- `src/views/EventsDirectoryPage.tsx`, `EventPage.tsx`, `EventEditionPage.tsx`, `SportPage.tsx`
- `src/components/admin/AdminFaq.tsx`, `src/components/search/SearchBox.tsx`
- `src/lib/faq.ts`, `src/lib/seo.ts`
- `server/scripts/verify-phase-b.ts`, `server/scripts/verify-phase-e.ts` (expectations updated for the new FAQPage and `events` suggestion key)
- `package.json` (`test:phase-e5`), `PROJECT_STATE.json` (meta only)

## 5. Database Changes

**DATABASE SCHEMA CHANGED: YES (additive only).**

One migration, `20261008090000_phase_e5_event_faq`, adds:
- the nullable column `FaqEntry.eventId`
- the index `(eventId, status, displayOrder)`
- a foreign key to `SportEvent.id` (`ON DELETE RESTRICT ON UPDATE CASCADE`)

Existing FAQ rows keep `eventId = NULL` and stay on `/faq/`. The migration was applied locally with `npm run db:migrate:deploy`, and `prisma migrate diff` against the live database reports no drift. No data was modified.

## 6. API Changes

- `POST/PUT /api/faq` accept an optional `eventId` (string or null). An unknown Event returns 400. `GET /api/faq` returns `eventId`.
- `GET /api/search/suggestions` adds `events: [{ name, url, sportName }]`. The existing keys are unchanged.
- `DELETE /api/events/:id` returns 400 while FAQ entries reference the Event.

## 7. Testing Performed

| Command | Result |
|---|---|
| `npx tsc --noEmit` / `npm run lint` | PASS |
| `npm run build` | PASS |
| `npm run test:phase-e5` | 7/7 groups PASS (timing parity, discovery, derived FAQ, editor FAQ/API, SEO/schema, search, real Chrome incl. admin) and full-row hashes restored |
| `npm run test:phase-e1` / `e2` / `e3` / `e4` | 8 / 8 / 13 / 6 groups PASS |
| `npm run test:phase-a` (with `PLAYWRIGHT_MODULE`) | 15 groups PASS incl. browser |
| `npm run test:phase-b` (with `PLAYWRIGHT_MODULE`) | 11 groups PASS incl. browser |
| `npm run test:phase-e` (article search) | PASS |
| `npm run test:phase-h` / `test:phase-i` | 12 / 9 groups PASS |
| `SMOKE_EXPECT_ORIGIN=https://sportingspy.com npm run smoke` | 6 groups PASS (authenticated smoke skipped: no `SMOKE_EMAIL`/`SMOKE_PASSWORD`) |
| `git diff --check` | PASS |

The Phase B and Phase E suites first failed only on the two contracts E5 intentionally changed (Event page JSON-LD types now include FAQPage; empty suggestions now include `events: []`). Their expectations were updated and they pass. Smoke must run against a live server on :3000, with the dev server's configured canonical origin.

## 8. Regression Result

Articles, article search, categories, Sports, admin authentication, the admin Event editor (E3), the Event/Edition publishing workflow, the public Event page (E4), E1 data-truth rules and E2 Sport configuration all pass their existing suites. Every suite restored its pre-existing rows; E5 checks Sport/Event/Edition/FAQ/Article full-row hashes.

## 9. Known Limitations

- Upcoming-list ordering sorts by start date, then end date. An edition with only an end date sorts after every edition that has a start date, even when it ends sooner. Prisma has no `COALESCE` ordering; this is an edge case of incomplete data.
- `eventStatus` still maps only from the editor's status (E4 rule). An edition marked `upcoming` whose dates have passed still emits `EventScheduled`. That value is valid for a held, non-cancelled event, but editors should mark finished editions `completed`. Two live editions currently look stale this way: Monaco 2026 and the Masters 2026. Discovery already lists them as past.
- Derived FAQ text is English-only and follows fixed sentence templates.
- The FAQ reorder endpoint orders global and Event-scoped entries in one list, as before. Ordering is per position in that list.
- Event-name search is a case-insensitive substring match. Event matching is not part of the weighted full-text search.

## 10. Explicitly Deferred

- **M (search redesign):** Events in weighted full-text ranking, multi-word/typo matching for Events, Event filters in `/search/`, unified result types.
- **K (scaling):** caching/ISR for discovery pages, count caching.
- **N (migration):** none required by E5.
- **L (analytics):** discovery and FAQ interaction tracking.
- **O (general polish):** visual refresh of discovery cards, localized FAQ templates.

## 11. Recommended Next Phase

Run M (search redesign) next, so Events join the weighted PostgreSQL search instead of the substring reference match. Before that, an editorial pass should mark finished editions `completed`.
