# PHASE E1 — EVENT DATA TRUTH & FOUNDATION

## 1. Status

**COMPLETE** for the repository-side E1 scope. Verified against the local development database on 2026-09-30. This phase did not deploy or change an external database.

## 2. Scope Implemented

Event identity requires `name`, `slug`, and an existing `sportSlug`. Edition identity requires an existing parent Event, `year`, an editor-provided `title`, and an explicit status. The Event has no date field: dates belong to an Edition and are optional until confirmed. Description may be empty; neither form nor API generates content to fill it. Event `shortName` may use the confirmed Event name as a display alias, not an invented fact.

| Field group | Required? | Stored when absent | Admin and public behavior |
|---|---|---|---|
| Event name/slug/sport | Yes | Rejected | Form marks required; public identity/URL |
| Event description | No | Empty string | Empty form; public paragraph hidden |
| Event frequency, venue, location | No | NULL | Empty form; corresponding public fact hidden |
| Event image | No | NULL | Existing Media Library item or none; no stock URL |
| Current edition year | No | NULL | Explicitly selected only after its Edition exists; no public current link otherwise |
| Edition parent/year/title/status | Yes | Rejected | Explicit form values; stable edition identity |
| Edition start/end date, venue, location | No | NULL | Empty form; public facts and schema omit unknown values |
| Edition description | No | Empty string | Existing 80–150-word recommendation remains guidance, not filler/enforcement |
| Edition image | No | NULL | Existing Media Library item or none |

Existing values are preserved by the migration. E1 adds no sport-specific system or page redesign.

## 3. Event API Changes

`POST /api/events` no longer inserts `Annual`, `Championship Venue`, `Championship Host City`, an Unsplash image, the current calendar year, or a made-up edition-year list. It validates the sport relation, uses NULL for unknown nullable facts, and rejects a current edition year on create. `PUT /api/events/:id` updates only supplied editable fields, supports explicit null/empty clearing, and accepts a selected current year only when that Edition exists under this Event. Unrelated updates preserve existing facts, including legacy image and current-year values.

## 4. Edition API Changes

`POST /api/editions` requires title and status instead of deriving them silently. Missing dates, venue, location, and image are NULL; description is empty. `PUT /api/editions/:id` preserves omitted fields, supports explicit clearing, validates real ISO calendar dates and ordering, and does not accept unmanaged image URLs. Parent Event existence is checked before creation.

## 5. Admin Form Changes

New Event/Edition forms have no fabricated venue, location, date, year, description, quick-fact, or image prefill. Event frequency is editable. Both forms offer a small Media Library image selector with a "No image" choice. An existing image not present in the Library remains displayed and unchanged until the editor chooses a replacement or clears it. The Event edit form can select or clear an existing Edition as current; an unmatched legacy selection survives unrelated saves and is marked as unmatched.

## 6. Public Safety Changes

Event page and Event cards hide unknown venue/location/frequency/current-edition facts. Event, Sport, and Home edition listings omit missing dates/venue. Edition page hides unknown date/location details. `SportsEvent` JSON-LD is omitted without a confirmed start date; optional end date and place are included only when supplied. Public pages do not claim a first/latest Edition is current when the editor has not selected one.

## 7. Image/Media Changes

New or explicitly changed Event/Edition images must exactly match a `MediaItem.url` in the existing Library, or be cleared. Arbitrary external stock URLs and fake IDs are rejected. Existing stored image values were not rewritten; public image display redesign remains outside E1.

## 8. currentEditionYear Changes

No calendar-year default, no first-Edition fallback. A new Event begins with NULL; after creating a real Edition, an Admin/Editor may explicitly select its year. Clearing the selection hides the public current-edition link. Existing unmatched selections are retained for editorial review.

## 9. Validation Changes

Required identity and title/status checks, parent relation checks, managed image checks, nullable date handling, date order, and current-year existence checks are applied server-side. The normal partial-update distinction is maintained: omitted means preserve; explicit null/empty means clear an optional field.

## 10. Database Changes

**DATABASE SCHEMA CHANGED: YES. MIGRATION CREATED: YES.** `20261006090000_phase_e1_event_data_truth` makes only these existing columns nullable: `SportEvent.frequency`, `defaultVenue`, `defaultLocation`, `currentEditionYear`; `EventEdition.startDate`, `endDate`, `venue`, `location`, `featuredImage`. `description` remains a required string and stores empty content as `''`. No column, row, or existing value was removed. The migration was applied to the guard-approved local `localhost:5432/sportingspy` database; Prisma reports 14 migrations applied and up to date. No reset, destructive transformation, or production migration was run.

## 11. Existing Data Quality Findings

Read-only review of the 5 existing Events, 6 Editions, and 6 Media Library items:

| Record | Problem / current value | Why suspicious | Recommended future action |
|---|---|---|---|
| `wimbledon-2027` Edition | `startDate=endDate=2027-01-01`; description explicitly says it was a placeholder auto-created during an earlier JSON→PostgreSQL migration | Confirmed migration-era synthetic content, not an editorially verified staging | Editor verifies official dates and writes genuine description; preserve linked Article and avoid blind deletion |
| `event-wimbledon` | `currentEditionYear=2026`, but its only staged Edition is 2027 | Selected current year has no matching Edition; public current link is now suppressed | Editor selects a genuine staged current Edition, or clears the year |
| `event-wimbledon` image | Same clay-court image as the French Open | A clay image may be misleading for a grass-court Event | Editorial/media-rights review and replacement if unsuitable |
| All 5 Events | `allEditionYears` includes legacy years with no Edition rows (e.g. 2025) | The legacy array is not a reliable list of staged records | Review/retire or explicitly reconcile this unused denormalized field in a later data-model phase; E1 does not rewrite it |

All 11 existing Event/Edition image URLs resolve to one of the 6 existing Media Library rows. No `Championship Venue`, `Championship Host City`, `Official Location`, Unsplash URL, missing Sport parent, or missing Event parent was found in the current local Event/Edition rows. Other historical dates and descriptions have **not** been independently verified against official sources. No existing record was edited by this review.

## 12. Files Changed

E1 changes: `prisma/schema.prisma`, the single E1 migration, `server.ts`, `server/services/public/content.ts`, `server/seo/rules.ts`, `server/seo/assistant.ts`, `src/types/index.ts`, `src/components/admin/AdminEvents.tsx`, `src/components/editorial/EventCard.tsx`, `src/views/EventPage.tsx`, `src/views/EventEditionPage.tsx`, `src/views/HomePage.tsx`, `src/views/SportPage.tsx`, `server/scripts/verify-phase-e1.ts`, `server/scripts/verify-phase-a.ts`, `package.json`, and this report. This worktree already contained unrelated uncommitted changes before E1; they were retained.

## 13. Tests Added/Updated

Added `npm run test:phase-e1`: authenticated production-mode API requests, real server-rendered public pages, real Chrome Admin form/image interactions, explicit current-edition transitions, managed/unmanaged images, partial updates, clearing, date validation, and disposable fixture cleanup with original Event/Edition/Media row-hash comparison. Updated only the Phase A Edition fixture to supply its now-required title.

## 14. Verification Results

| Check | Result |
|---|---|
| Prisma validation, generation, local migration status | PASS; 14 applied, up to date |
| TypeScript/lint and production build | PASS |
| E1 API/public/browser integration | 8 groups PASS; original-row hashes restored |
| Phase A regression | 13 groups PASS; optional browser checks skipped by that script |
| Phase B regression | 10 groups PASS; optional browser checks skipped by that script |
| Phase H regression | 12 groups PASS, including real browser Event/Edition edit and database integrity |
| Phase I regression | 9 groups PASS, including Article queue and Author/Editor/Admin browser workflows |
| Git whitespace check | PASS |

## 15. Remaining Risks

Historical placeholder content remains pending editorial correction. E1 does not verify every historical date/source or show Event/Edition featured images in the current public templates. Local tests do not certify a production database or provider. The existing `allEditionYears` array can disagree with real Edition rows; public page queries use actual Edition relations. Existing unmatched current-year values are preserved but no longer presented as a valid current Edition link.

## 16. Deferred Work

- **E2:** sport-specific configuration and terminology, if approved.
- **E3:** dynamic Event fields/forms/section architecture.
- **E4:** new public Event Details Page design, including deliberate image presentation.
- **E5:** corresponding Edition/public visual redesign and richer content sections.
- **E6:** contextual FAQ, reactions and other later engagement/quality features as separately specified.

No E2–E6 work was started here.

## 17. Final Safety Check

New Event/Edition writes add **no fabricated Event or Edition facts, random stock-image default, synthetic date, venue, or location**. Existing suspicious rows are reported and preserved. There was no unrelated refactor, sport-specific system, or Event-page redesign.
