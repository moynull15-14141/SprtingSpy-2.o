# Phase E3 — Sport Admin Configuration and Dynamic Event Editor

## 1. Status

**COMPLETE for the repository implementation.** Verified against a local development database and a production build on 2026-09-30. No deployment or production database action was performed.

## 2. Implemented

- Added an Event configuration action to each Sport in the existing Sports admin screen. It uses the E2 `GET/PUT /api/sports/:slug/event-configuration` endpoints; no duplicate endpoint or raw JSON editor was added.
- Added metadata-driven custom controls to the existing permanent Event create/edit form. It uses the E2 Event API's `sportSpecificValues` property and leaves Edition editing and public Event pages alone.
- Added `npm run test:phase-e3` with disposable Sports, Events and accounts, real Chrome checks, API role/compatibility checks and exact original-row verification.

## 3. Configuration UI

- An unconfigured Sport shows the generic state and no fabricated fields. Admins can override the five supported terminology labels, add/edit/remove fields, select all seven E2 types, set required and admin/public visibility, write help text and select options, and move fields with keyboard-accessible up/down buttons.
- The preview displays the resulting admin-visible controls before save. Blank terminology uses E2's generic label. E2's shared parser checks the draft on save; the server remains authoritative for validation and existing-value compatibility. Errors stay visible without discarding the draft. Clearing a configuration goes through the same E2 API and reports a 409 conflict if Event values would be orphaned.
- Loading, retry, save, error and generic states are shown. A failed configuration request does not repeat automatically; Retry starts a new request. Closing, switching Sports, leaving through CMS navigation or leaving the page warns about unsaved changes. The layout uses responsive columns and wrapping labels.

## 4. Event Editor

- The selected Sport's configuration is fetched once per Sport within the mounted Event editor and reused while editing. Unconfigured Sports show only common Event fields. Configured Sports render text, textarea, number, boolean, date, select and URL controls in configured order. `adminVisible` controls presentation; `publicVisible` does not hide an admin-editable field.
- New Events submit typed `sportSpecificValues`; browser required controls and the shared E2 parser provide immediate feedback, followed by authoritative server validation. Existing Event values load into the form, including values for fields hidden from the admin UI. Common-only edits omit the custom-value property so stored values remain unchanged.
- Changing Sport requires confirmation when custom values exist. Confirmation clears the draft values and sends the replacement to the E2 API. Existing values without a current definition are shown as a warning and preserved on common-only edits; custom-value edits are blocked until the definition is restored. Older Events missing a newly required value remain editable under E2's existing-record rule.

## 5. RBAC

- Admins can read and save/clear configuration. Editors can read the configuration in a disabled view and use configured fields in permitted Event edits. Editor/anonymous configuration writes remain rejected by E2 (403/401). No role system changed.

## 6. E3 Tests

`npm run test:phase-e3`: **13 groups passed, 0 failed**, including real Chrome checks for generic configuration and generic Event creation, terminology/field creation and persistence, order, preview, duplicate/reserved/blank-label/select-option validation, dynamic Event create/edit, required controls, common-edit preservation, Sport-switch warning, unsaved navigation warning, clear conflict, Editor read-only UI, recoverable API failure, and controls at 1440/900/390 px. API checks cover role boundaries and compatible clearing. Browser page errors: none.

## 7. Regression

| Check | Result |
|---|---|
| TypeScript / `npm run lint` | PASS |
| Production build | PASS |
| Phase E1 | 8 groups PASS, including Chrome |
| Phase E2 | 8 groups PASS |
| Phase A | 15 groups PASS, including Chrome |
| Phase B | 11 groups PASS, including Chrome / JS-disabled SSR |
| Phase H | 12 groups PASS, including browser |
| Phase I | 9 groups PASS, including browser |
| Git whitespace check | PASS |

## 8. Database

**DATABASE SCHEMA CHANGED: NO.** E3 reused the E2 Sport configuration and Event values columns and their existing migration. No migration was created or applied for E3. No permanent configuration or Event fixtures were seeded.

## 9. Existing Data Integrity

The E3 suite recorded full-row hashes and counts before creating its disposable fixtures and compared them after cleanup:

| Model | Before | After | Original-row hash |
|---|---:|---:|---|
| Sports | 14 | 14 | Unchanged |
| Events | 5 | 5 | Unchanged |
| Editions | 6 | 6 | Unchanged |

The E1/E2/H/I suites also reported their own fixture cleanup and baseline integrity checks. E3 did not rewrite any pre-existing Sport, Event or Edition row.

## 10. Deferred

E4 public Event details, E5 specialized/public layouts and E6 later enhancements remain separate. E3 did not redesign public Event or Edition pages, search, SEO or schema.

## 11. Known Issues

- E2 serializes configuration writes and rejects changes incompatible with stored Event values, but it has no configuration version token. Two compatible Admin edits made from stale browser drafts can still overwrite one another; reopen the configuration to get the latest state.
- The Event editor caches a selected Sport's configuration for that mounted editor session. If another Admin updates that configuration while the form is open, reopening the Events screen refreshes it; the E2 server still validates every save.
