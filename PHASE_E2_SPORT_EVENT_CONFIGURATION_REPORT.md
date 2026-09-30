# PHASE E2 — SPORT-SPECIFIC EVENT CONFIGURATION

## 1. Status

**COMPLETE** for the E2 backend/data foundation. Verified against the guard-approved local development database. E3 Admin configuration UI and public Event redesign were not started.

## 2. Architecture Decision

Two nullable JSONB columns keep **definitions** and **values** separate: `Sport.eventConfiguration` defines terminology and ordered custom Event fields; `SportEvent.sportSpecificValues` stores only values. The existing common Sport/Event/Edition models and APIs remain authoritative.

| Option | Advantages | Costs / implications |
|---|---|---|
| JSONB definitions + values (**selected**) | Two additive columns; no extra tables or fake seeds; flexible field definitions; simple generic fallback; validated on every API write | Definitions/values are not relationally indexed; validation lives in the service; future search/filter/reporting needs explicit opt-in indexes or projections. E3 must use the typed service contract. |
| Separate definition/value tables | Stronger per-value relational querying and potential indexes | Many rows/joins and migration complexity for a small, currently unconfigured Event feature; field type/options still need application validation; more difficult generic fallback and E3 editor. |

Current requirements do not justify cross-Sport filtering on custom fields. Dynamic values are **not** automatically added to search, SEO, schema, or public text. A later requirement can promote selected fields through explicit projections/indexes without changing the Event identity model.

## 3. Common Event vs Sport-Specific Data

Name, slug, sport, description, image, venue/location, frequency, current Edition, SEO and relationships remain the existing common Event fields. No duplicate Football/Tennis/Cricket Event model was created. Custom values are a separate typed map keyed by field definitions on the parent Sport.

## 4. Terminology System

The generic labels are `Event`, `Participants`, `Competition`, `Venue`, and `Round`. A Sport configuration may override only the labels it needs; unspecified labels inherit the generic terms. Unknown keys, empty labels, control characters and conflicting resolved labels are rejected. No sport-specific example labels were seeded.

## 5. Dynamic Field System

Each definition has `key`, `label`, `type`, `required`, unique `order`, optional `helpText`, `adminVisible`, `publicVisible`, and select `options` when applicable. E2 supports `text`, `textarea`, `number`, `boolean`, `date`, `select`, and absolute HTTP(S) `url`. These cover the current foundation without building reference/entity, multi-select or datetime infrastructure prematurely. Values are primitives only and have type, length, date, URL and option validation. Common Event keys cannot be reused as custom keys.

When supplied, `sportSpecificValues` is a **complete replacement**; omitting the property on a common Event update preserves the stored values. New Events must supply configured required values. If a field later becomes required, existing Events missing it stay readable and can receive unrelated updates. An existing required value cannot be explicitly cleared. Configuration changes that would orphan a stored key or reinterpret an existing value are rejected.

## 6. Configuration Resolution

`Sport configuration → generic fallback`: NULL configuration resolves to generic terminology and zero custom fields. A malformed out-of-band JSON document also resolves safely to generic data for public reads; the staff GET response reports it as invalid. Field order is deterministic. Public Event data exposes only `publicVisible` definitions and validated values; internal-only values stay out of the public contract. `adminVisible` prepares E3's editor presentation and is not a secrets permission system.

## 7. New Sport Behavior

A disposable Padel Sport was created in the real production-mode test server with **no** custom configuration. Its Event was created and rendered with generic fields, without inventing a surface, player, team, or other fact. A configuration was then attached and tested on a second disposable Event. All fixture Sport/Event rows were removed after testing.

Read-only baseline: 14 existing Sports, all currently visible. Event counts: Tennis 2; Motorsport, Golf, Rugby 1 each; the other 10 Sports 0. No existing Sport received a configuration or synthetic Event value.

## 8. Database Changes

**SCHEMA CHANGED: YES. MIGRATION CREATED: YES.** `20261007090000_phase_e2_sport_event_configuration` adds only nullable `Sport.eventConfiguration` and `SportEvent.sportSpecificValues` JSONB columns. It changes no existing content columns or values, deletes no row, and leaves the applied E1 migration untouched. The local `localhost:5432/sportingspy` guard passed before `prisma migrate deploy`; 15 migrations are now applied with no schema drift. No production database was touched.

## 9. API/Service Changes

- `GET /api/sports/:slug/event-configuration`: Admin/Editor read of the stored override and resolved generic/inherited configuration; unknown Sport returns 404.
- `PUT /api/sports/:slug/event-configuration`: Admin-only validated replacement or clear, existing-value compatibility check, existing CSRF protection and Sport audit log. Incompatible changes return 409.
- Existing `POST/PUT /api/events`: optional, validated `sportSpecificValues`. Unrelated common-field updates preserve values. New Sports with no configuration reject invented custom keys and continue to accept normal Event creation.
- Configuration updates and Event writes that set custom values lock the same Sport row while resolving definitions, preventing a concurrent API edit from validating against stale configuration.
- Public `getEventPage` contract now includes resolved, public-filtered `sportConfiguration` and `sportSpecificValues` for E4. Current public page markup is unchanged.

Direct generic Sport update does not accept `eventConfiguration`; configuration must pass through its validated endpoint.

## 10. Validation

Definitions reject duplicate or reserved keys, invalid identifiers/types/order, empty labels, conflicting terminology, malformed/duplicate select options, unsupported properties, and required fields hidden from administrators. Values reject unknown keys, wrong primitive types, impossible dates, unsafe/non-HTTP URLs, unsupported select choices and invalid clearing of required stored values. No data is auto-populated from the configuration.

## 11. Security/RBAC

The existing session/role/CSRF middleware applies. Anonymous configuration reads fail; Editors may read but cannot change configuration; only Admin can write. Hidden Sports remain staff-readable while their Event pages remain public 404. Writes produce the existing `AuditLog` entity type `Sport`; no new permission system was introduced.

## 12. Tests

Added `npm run test:phase-e2`, using disposable Admin/Editor, Sport and Events against a real production-mode command and local PostgreSQL. It tests generic fallback, unknown/hidden Sport behavior, RBAC/CSRF, terminology and field validation, required/optional and typed values, public filtering, compatibility guards, and exact cleanup/integrity. **8 integration groups passed.**

## 13. Regression Results

| Check | Result |
|---|---|
| TypeScript/lint and production build | PASS |
| E2 integration | 8 groups PASS |
| E1 API/public/real Admin browser | 8 groups PASS |
| Phase A routing/auth/Event API | 13 groups PASS; optional browser block skipped by its script |
| Phase B public SSR/indexing | 10 groups PASS; optional browser block skipped by its script |
| Phase H Event/Edition CMS/SEO browser and DB | 12 groups PASS |
| Prisma validate/status/drift | Valid; 15 applied; no difference |
| Git whitespace | PASS |

## 14. Existing Data Integrity Verification

Before/after E2 fixtures: **Sport 14, Event 5, Edition 6**. Full-row hashes, IDs and counts of all three collections matched exactly after cleanup. Read-only final query found **0 configured existing Sports** and **0 existing Events with custom values**. No existing common Event fact, Sport content or Edition record was rewritten.

## 15. Files Changed

E2 files: `prisma/schema.prisma`, `prisma/migrations/20261007090000_phase_e2_sport_event_configuration/migration.sql`, `src/types/index.ts`, `server/sportEventConfiguration.ts`, `server/sportEventConfigurationRoutes.ts`, `server.ts`, `server/cmsFields.ts`, `server/services/public/content.ts`, `server/scripts/verify-phase-e2.ts`, `package.json`, and this report. Earlier uncommitted worktree changes were preserved.

## 16. Deferred Work

- **E3:** Sport Admin Event Configuration UI, terminology editor, field builder, preview and dynamic Event-value editor.
- **E4:** Event Details Page and sport-aware public field presentation.
- **E5:** FAQ, discovery, search/SEO/schema decisions for selected dynamic fields.
- **E6:** final cross-Sport acceptance, accessibility, performance and launch QA.

No specialized scorecard/scoreboard, tickets, reactions, new search or SEO subsystem was created.

## 17. Architecture Risks

JSONB does not automatically index custom values. Search/filter/reporting must opt in to specific stable fields; indexing every custom field would be noisy and costly. Configuration has no historical revision table; compatibility checks protect current stored values, while a required-field change applies to **new** Events and leaves older missing values valid. API writes of custom values and configuration share a Sport-row lock; out-of-band DB writes can bypass this, so production writes must use the endpoints. The current Event Admin form has no dynamic field editor; after configuring a required custom field, E3 is needed for browser-based Event creation under that Sport. Admin visibility metadata controls planned form presentation, not confidential storage.

## 18. Recommended Next Phase

E3 should build the Admin configuration and Event-value editing experience from this typed API/service, then test configuration changes and Event creation through the browser. It should not redesign the public Event page until E4.

## Final Safety Check

No existing Event, Sport or Edition content was rewritten; no Sport/Event values were fabricated or seeded. No sport-specific Event page, full Admin configuration UI, Event Details redesign, search redesign, SEO redesign, destructive migration or unrelated dependency was introduced.
