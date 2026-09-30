# PHASE E4 — PUBLIC EVENT DETAILS REPORT

## 1. Status

**COMPLETE for the repository implementation.** Verified on 2026-09-30 against the local development database, a production build and real Chrome. No deployment or production database action was performed.

## 2. Public Event Page

- Rebuilt the permanent Event page as a wide SportingSpy-native experience with an accessible breadcrumb, cinematic managed-image hero, one H1, optional short identity, two-column desktop content/sidebar and a single-column mobile flow.
- The main column conditionally renders About, sport-specific facts, history, Edition archive and published Event coverage. Empty sections are omitted instead of displaying invented placeholders.
- The sidebar shows only stored common facts, a safe official-site link and the explicitly selected current Edition. Same-Sport related Events use the existing Event card and an authoritative relationship rather than popularity or random ranking.
- No ticket, registration, attendee, rating, reaction, bookmark, FAQ, gallery or other unsupported engagement UI was added.

## 3. Dynamic Sport-Aware Rendering

- Added a reusable `DynamicPublicEventFields` renderer for E2's text, textarea, number, boolean, date, select and URL types. Fields follow configured `order`; booleans use Yes/No, dates use a UTC-stable readable format, long text wraps, and URL links accept only HTTP/HTTPS.
- The public content service remains authoritative: it resolves terminology, returns only `publicVisible` definitions and validates/filters values before React receives them. The component applies a second presentation filter for defined non-empty values.
- Resolved Event and Venue terminology appears in headings/details. The implementation contains no Sport-name conditionals or Sport-specific page components, and the E4 fixture proves a previously unknown Sport works without a new React component.
- Private/internal fields are absent from visible HTML, public service output, metadata and JSON-LD.

## 4. Event / Edition Presentation

- Event description and history retain authored text only. Default Event venue/location/frequency/type appear only when stored.
- Current Edition is derived solely from `currentEditionYear` and an exact matching Edition. No latest/first/calendar-year fallback exists.
- Edition cards show only known title, year, status, date, venue, location and image. Undated Editions remain neutral and contain no TBA/N/A fabrication.
- Event-linked published articles continue to use the existing server-side query and Article card. Empty coverage is omitted.

## 5. Images / Media

- Managed Event images render in the hero with the Event name as alt text and `object-fit: cover`.
- Missing Event images use a local SportingSpy visual placeholder with no external stock URL.
- Managed Edition images render in Edition cards. Missing or failed Edition images use a local title placeholder and never produce a broken image.

## 6. SEO / Metadata / JSON-LD

- Existing per-Event SEO remains authoritative for title, description and social fields; canonical, OpenGraph and X/Twitter metadata use the established trailing-slash route and managed Event image fallback.
- Breadcrumb JSON-LD includes Home → Sports → Sport → Event.
- A `SportsEvent` object is emitted only when the explicitly selected current Edition has an authoritative start date. End date, location and image appear only when present. Completed status maps only from an explicit `completed` status; archived status is not reinterpreted.
- Events without a confirmed current Edition start date receive no Event/SportsEvent schema. Dynamic fields are not injected into page title, description, social metadata or JSON-LD.
- Phase B's expected Event schema was updated to reflect this factual E4 rule.

## 7. Accessibility / Responsive

- Semantic header/main/aside/section/article elements, one H1, logical H2/H3 hierarchy, an accessible breadcrumb, meaningful links, descriptive image alt text and visible focus styles are present.
- Chrome verified the page at 1440 px, 900 px and 390 px. Long labels/titles wrap and no page-level horizontal overflow or runtime/page error occurred.

## 8. Error / Missing Data Handling

- Unknown Events continue to use the branded HTTP 404 response with no Event page output.
- Missing description, image, venue, location, date, frequency, dynamic values and current Edition were tested together; the page remained valid and hid unavailable facts.
- Invalid/out-of-band configuration is already reduced to E2's generic safe resolver before page rendering.
- A route-level Next `loading.tsx` was tested and removed because its streaming boundary changed a late `notFound()` response from HTTP 404 to 200. E4 preserves correct 404 semantics. Normal server navigation retains the current rendered page until the next response; there is no dedicated Event skeleton in this phase.

## 9. Tests

| Check | Result |
|---|---|
| E4 | 6 integration groups PASS, including SSR, real Chrome and exact original-row hashes |
| E1 | 8 groups PASS, including browser |
| E2 | 8 groups PASS |
| E3 | 13 groups PASS, including browser |
| Phase A | 15 groups PASS, including browser |
| Phase B | 11 groups PASS, including Chrome and JS-disabled SSR |
| Phase H | 12 groups PASS, including browser |
| Phase I | 9 groups PASS, including browser |
| TypeScript / lint | PASS |
| Production build | PASS |
| Git whitespace check | PASS |

E4 covers hero/title, breadcrumb, common metadata, all seven dynamic types, terminology, field order, private/empty filtering, managed and missing Event/Edition images, exact current Edition, coverage, related Events, missing data, SEO/social/canonical, conditional JSON-LD, branded 404, basic accessibility, desktop/tablet/mobile widths and browser errors.

## 10. Database

**DATABASE SCHEMA CHANGED: NO.** E4 reused the E1–E3 schema and created no migration. It did not seed permanent configuration or content.

## 11. Existing Data Integrity

The E4 suite compared full-row hashes and counts before and after disposable fixture cleanup:

| Model | Before | After | Original rows |
|---|---:|---:|---|
| Sports | 14 | 14 | Unchanged |
| Events | 5 | 5 | Unchanged |
| Editions | 6 | 6 | Unchanged |

The E1/E2/E3/A/B/H/I suites also completed their own cleanup and integrity checks.

## 12. Files Changed

- `src/views/EventPage.tsx`
- `src/components/editorial/DynamicPublicEventFields.tsx`
- `server/services/public/content.ts`
- `server/scripts/verify-phase-e4.ts`
- `server/scripts/verify-phase-b.ts`
- `package.json`
- `PHASE_E4_PUBLIC_EVENT_DETAILS_REPORT.md`

## 13. Known Issues

- There is no dedicated Event route skeleton because Next's route-level streaming fallback caused unknown two-segment routes to return HTTP 200 after streaming began. Correct branded HTTP 404 behavior was retained.
- Related Events use a simple same-Sport relationship ordered by existing featured/name fields. E4 does not claim semantic recommendation ranking.
- Event/Edition image fields store managed Media URLs rather than direct Media relations, so the public renderer uses the existing safe image-error fallback and E1's write validation.

## 14. Deferred

**E5:** contextual FAQ, broader discovery/search decisions, advanced SEO/schema policy and any expanded recommendation work.

**E6:** later enhancements defined by the future phase specification.

## 15. Final Safety Check

- Implemented and tested: public Event redesign, dynamic Sport-aware rendering, factual current Edition, images, coverage, related Events, conditional schema, responsive/accessibility basics and missing-data safety.
- Not tested: production deployment, external monitoring/provider behavior and manual screen-reader certification.
- Deferred: E5/E6 scope, ticketing, engagement systems, contextual FAQ and discovery overhaul.
- No fabricated dates, venue, organizer, tickets, attendees, social proof, gallery, FAQ or external stock image was introduced.
