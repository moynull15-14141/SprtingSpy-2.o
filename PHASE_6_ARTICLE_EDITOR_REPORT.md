# Phase 6 — Article Editor Report

## Status

**READY**

Every requirement in the Definition of Done is met. Browser acceptance ran against the local PostgreSQL 17 database. No Docker or Aiven database was used, no database was reset, and nothing was committed, pushed or deployed.

## What Was Audited

See `PHASE_6_ARTICLE_EDITOR_AUDIT_REPORT.md`. The audit covered:

- editor structure and fields;
- rich content and paste;
- media;
- autosave and recovery;
- preview;
- SEO;
- source-import compatibility;
- validation;
- security;
- performance.

## What Was Already Good

- **Server enforcement:** rich-text allow-list, article field allow-list, protected review state, Author ownership checks, Media Library–only images, safe links and URLs, and SEO and reference validation.
- **Autosave and recovery:** stale-version guard and failed-save retry.
- **Preview:** same template as the public page, read-only.
- **Workflow:** Phase I rules.
- **Source import:** the Phase 5 creation flow and FAQ handoff.

These were left unchanged.

## What Was Changed

| File | Purpose | Before | After |
|---|---|---|---|
| `src/lib/articleEditor.ts` (new) | Pure editor rules: `slugFromTitle`, `previewPlan`, `leavesPublicState`, `savedStateLabel`, `stripNonLibraryImages` | Rules were inline or absent | Single, unit-tested source of the rules |
| `src/components/admin/AdminArticles.tsx` | **G1 slug** | Typing a title produced a 1-character slug (`f` for "Final preview") | The slug follows the whole title until the editor types their own; capped at 120 chars |
| ″ | **G4 Bangla slug guidance** | "Add a title and URL slug before saving." | Separate title/slug messages; a Bangla-only title explains why a slug is needed and focuses the slug field |
| ″ | **G2 Preview** | Saved with the *selected* state, which could schedule, archive, unpublish, or commit edits to a scheduled article | Only a private article that stays private is saved first. Live, scheduled and archived articles open their last saved version with a notice. A new article set to non-private can't be previewed until saved |
| ″ | **G3 Unpublish confirmation** | "Save draft" on a live or scheduled article silently unpublished it or cancelled the schedule | A confirm dialog appears; declining changes nothing. "Cancel schedule" isn't asked twice |
| ″ | **G6 Saved-state badge** | The header showed no saved state | The badge under the header shows the saved state, e.g. "New · not saved yet", "Draft · private · Needs review", "Published · live", "Scheduled · …", "Archived" |
| `src/components/admin/editor/RichTextEditor.tsx` | **G5 Paste** | A pasted web/Word image made the body invalid and blocked saving | Non-library images are dropped on paste with a dismissible notice. Library images copied inside the editor keep their `mediaId` |
| `src/lib/documentImport.ts` | **G7 Source tables** | Tables arrived as "a \| b" text | Runs of 2+ consistent pipe rows (2–20 cells) become real tables, also when embedded in a PDF paragraph. Irregular or formatted lines stay text. Import path only |
| `server/scripts/verify-article-editor.ts` (new) | Unit/static tests for the changes | — | 7 groups |
| `server/scripts/verify-article-editor-browser.ts` (new) | Browser acceptance, flows A–H | — | 10 groups |
| `package.json` | `test:article-editor`, `test:article-editor-browser` | — | Added |

There are no database schema, API or permission changes.

## What Was Not Changed

None of the following were changed:

- the server article API, validation, the field allow-list and the workflow (Phase I);
- the autosave/recovery architecture;
- the FAQ system and API;
- the media system;
- the SEO panel;
- the preview route and template;
- the document extraction and worker;
- the Phase 5 creation flow;
- Homepage, dashboard and taxonomy.

The deferred items are N1–N5 in the audit report.

## Tests

All results are from runs in this session:

| Suite | Result |
|---|---|
| `test:document-import` | 28 checks passed |
| `test:document-review` | 11 checks passed |
| `test:manual-source` | 12 checks passed |
| `test:source-faq` | 12 checks passed |
| `test:newsroom-editor` | 7 groups passed |
| `test:article-creation` (Phase 5) | 9 checks passed |
| `test:article-editor` (new) | 7 groups passed |
| `test:article-creation-browser` (Phase 5, local DB) | 13 checks passed |
| `test:autosave` (local DB, browser) | 25 checks passed |
| `test:phase-i` (workflow, local DB, browser) | 9 groups passed |
| `test:admin-article-ui` (browser) | passed |
| `npm run lint` (tsc) | clean |
| `npm run build` | succeeded |
| `git diff --check` | clean |

No existing test was changed in Phase 6.

## Browser Acceptance

`npm run test:article-editor-browser` ran on local PostgreSQL in real Chrome against a production build. **10 checks passed:**

- **Flow A — manual article:** the typed title keeps a full slug. Bold text and Bangla/English text autosave and recover after a refresh. Preview saves it as a private draft and renders the formatting.
- **Flow G — unsafe paste:** pasted web HTML keeps bold and the safe link. The free-URL image, the `javascript:` link, `onerror`/`onclick` and `<script>` are all removed. The body saves with no executable markup stored, preview stays inert, and no alert fires.
- **Data safety:**
  - Preview of a live article (with Draft selected and an unsaved title edit) shows the saved version and changes nothing in the database.
  - "Save draft" on a live article: declining the confirmation keeps it live; accepting unpublishes it.
  - Preview is disabled for a new article set to Scheduled.
- **Flow B — PDF:** a PDF with a standings table becomes a 3-row table in the editor, then edit, autosave, and preview with the table, as a draft.
- **Flow C — DOCX:** after transfer, the subtitle and body are edited, autosaved and previewed.
- **Flow D/E — Bangla manual source:** Save shows the slug guidance and focuses the slug field. After entering a slug, the draft saves, the FAQ becomes a draft `FaqEntry` in the existing system, and preview works.
- **Flow F — Author:** creates and previews a private draft, with no Publish button and no source import. An API publish attempt returns 403, and editing another byline returns 403.
- **Flow H — viewports:** at 1024 and 768 px there is no horizontal overflow, and the saved-state badge, autosave status and actions stay visible.
- No uncaught browser errors or alerts in any flow. Fixtures were cleaned up and leftover rows checked as 0.

## Security Verification

- **XSS and pasted markup:** stripped in the editor and rejected by the server allow-list (Flow G). Imported content stays plain text (Phase 5 checks were re-run).
- **Unsafe links and images:** `javascript:` links aren't kept, and free-URL images are rejected on the server and filtered on paste.
- **Authorization:** Author publish attempts and edits to another byline return 403 (Flow F, Phase I).
- **Review state:** protected fields still return 403, through the unchanged `checkArticlePayload`.
- **CSRF:** enforced on all writes (Phase 5 suite).
- **Preview:** staff-only and read-only, and it can no longer change publication state (G2).

## Performance Verification

- **Article size:** a 165,000-character Bangla/English article (174 KB JSON) validates in 1.6 ms and serialises in 1.4 ms. Per-keystroke validation and autosave serialisation are well under a frame, so no optimisation was needed.
- **Autosave traffic:** 2 s debounce and 15 s maximum wait, with one request in flight (unchanged). The autosave suite confirms a single retry after reconnecting.
- **Phase 6 overhead:** the paste filter runs only on paste and only when the pasted HTML contains `<img>`. Table conversion runs once per transfer.

## Regression Verification

| Check | Result |
|---|---|
| Phase 5 article creation | Works (13-check browser suite) |
| PDF, DOCX and Manual Source Text | Work (Phase 5 and Phase 6 browser suites, plus unit suites) |
| FAQ import | Works (Phase 5 Flow D; Phase 6 Flow D/E) |
| Autosave and recovery | Works (25 checks; Phase 6 Flow A) |
| Existing article editing | Works (Phase 5 Flow C/D; Phase 6 live-article flow; admin UI) |
| Workflow and permissions | Unchanged and passing (Phase I, 9 groups) |
| Homepage behaviour | Unchanged (no Homepage files touched) |
| Database | No reset (local DB used with disposable, cleaned fixtures) |
| Docker | Not used |
| Aiven | Not used (every run used the local-DB guard) |

## Remaining Limitations

1. **Preview hides FAQ drafts (N1).** Preview shows only *published* FAQ entries, so imported FAQ drafts appear after they're published in FAQ. This is unchanged on purpose, because the FAQ architecture was out of scope.
2. **Generic inline save error (N2).** The exact server reason appears in the toast, not inline.
3. **Excerpt `*` marker (N3).** It's enforced only by the "Save using selected state" submit. Changing this would change workflow rules.
4. **500 on malformed staff API input (N4).** `PUT /api/articles/:id` returns 500, not 400, for malformed staff-only API input (wrong-typed `publishedAt` or `readingTimeMinutes`, unknown `authorId`). There is no security impact.
5. **Asterisks in imported text (N5).** Imported text with single `*asterisks*` may become italic.
6. **Suites not re-run.** `test:phase-a`, `test:phase-c` and `audit-ui-layout` (edited in Phase 5) weren't re-run.

## Recommended Next Phase

A small hardening follow-up for N2 and N4: show the server's save error inline, and return 400 for wrongly-typed staff API fields. After that, decide as a product question whether preview should show FAQ drafts, labelled as drafts (N1). Not started.
