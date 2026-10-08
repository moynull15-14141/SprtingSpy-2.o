# Phase 6 — Article Editor Audit Report

Date: 2026-10-08 · Scope: the existing Admin Article Editor and its source-import, autosave, preview, SEO, media and workflow integrations. Audit first; fixes are listed in `PHASE_6_ARTICLE_EDITOR_REPORT.md`.

## Executive Summary

The Article Editor is architecturally sound. Its security model is strong and enforced on the server:

- rich text is checked against an allow-list;
- images must come from the Media Library;
- links must be http(s), mailto or site paths;
- the article fields that can be written are allow-listed;
- review state is protected;
- Author ownership is checked on the server.

Autosave and recovery are mature, and the Phase 5 source workflow converges correctly into the single editor.

The audit found **three real data-safety defects**:

1. A new article's slug locked after the first keystroke.
2. Preview could schedule, archive or unpublish an article, or commit edits to a scheduled one.
3. "Save draft" silently unpublished a live article.

It also found **four authoring gaps**:

1. Bangla-only titles produced an empty slug with a vague error.
2. One pasted web image blocked saving the whole article.
3. Nothing showed the article's current saved state.
4. Source tables arrived as flattened "a | b" text.

No new editor, API, model, media system or FAQ system is needed.

## Current Article Editor Architecture

| Layer | Implementation |
|---|---|
| Editor surface | `src/components/admin/AdminArticles.tsx` (single form, `cms-article-form`) |
| Body editor | `src/components/admin/editor/RichTextEditor.tsx` (TipTap; H2–H4, marks, lists, task lists, quotes, rules, tables, code, news box, embeds, related story, media group, library images) |
| Stored format | `src/lib/richText.ts` `validateRichDoc` (allow-list, 20k nodes, depth 12, 200k chars, 600 KB) — validated live in the editor and again on the server |
| Save API | `POST/PUT /api/articles` in `server.ts`; `checkArticlePayload` + `authorWriteGuard` (`server/editorialWorkflow.ts`); `prepareArticleContent` (`server/articleContent.ts`) |
| Media | Media Library only; server re-derives image URLs from the library; copyright-restricted items rejected; `ArticleMedia` usage synced |
| Autosave | `useAutosave` → `/api/drafts` working copies; 2 s debounce / 15 s max wait; recovery banner, Unsaved Work panel, stale-version guard |
| Preview | `/admin/preview/<id>/` — same `ArticlePage` template as public, staff-only, noindex, read-only |
| Workflow | Phase I: Author drafts → review; Admin/Editor publish/schedule/archive; protected review fields |
| Source import | Phase 2–5: PDF/DOCX/Manual Source → shared review → `applyDocumentImport` → same editor; pending FAQ → `/api/faq/import` |

## Existing Capabilities (verified present)

- **Text fields:** title (H1), subtitle, excerpt, slug.
- **Taxonomy:** sport → event → edition, plus article type from the database.
- **People:** byline author, and a reviewer for Author submissions.
- **Publication:** status, scheduling with time zone display, freshness review.
- **SEO and social:** SEO title, meta description, canonical URL and noIndex (kept through `otherSeo`), keywords, Open Graph title/description/image, SEO check and SEO assistant, publish-readiness list.
- **Media:** featured image and body images from the Media Library, with alt text, caption, credit, align, width, lightbox, replace and remove.
- **Content extras:** references (≤30, URLs validated), FAQ section with FAQPage schema opt-in and pending source FAQ.
- **Preview, autosave and recovery:** all present.

## Verified Working Features

- **Rich content:** headings, bold, italic, underline, strike, links with rel options, ordered, bulleted and task lists, blockquotes, tables, rules, line breaks, library images with captions, and embeds through an allow-list. Bangla, English and mixed Unicode round-trip exactly.
- **Security:** unsafe pasted markup (`<script>`, event handlers, `javascript:` links) never reaches the stored document or preview. The server rejects free-URL images and unsafe links even if the client were bypassed.
- **Permissions:**
  - Author: create, edit own drafts, preview, no publish control. The server returns 403 on publish and on editing another byline.
  - Admin and Editor: full workflow, as in Phase I.
- **Autosave and recovery:** working copies are kept for manual edits, source transfers and pending FAQ, and survive refresh, close and reopen. They also cover failed saves with retry and stale-version conflicts.
- **Duplicate slug:** returns 409, including the event/article URL collision rule.

## Real Gaps Found

| # | Severity | Component | Current behaviour | Expected | Why it matters | Proposed fix |
|---|---|---|---|---|---|---|
| G1 | High | `AdminArticles.handleTitleChange` | Slug set only while empty, so typing "Final preview" gives slug `f` | Slug follows the title until the editor edits it | Wrong public URLs on real (typed) articles; tests used `fill()` and missed it | Derive while slug equals the slug of the previous title; cap at 120 chars |
| G2 | High | `handlePreview` | Saves with the *selected* state. "Scheduled"/"Archived" selected → schedules or archives. A live article with "Draft" selected → unpublished. A scheduled article → unsaved edits committed | Preview never changes public or scheduled state | Accidental publication-state changes | Save only a private article that stays private; otherwise open the last saved version |
| G3 | High | `saveAs('draft')` | "Save draft" on a live article takes it offline without warning, and on a scheduled article cancels the schedule | Explicit confirmation | Accidental unpublish | Confirm dialog; the explicit "Cancel schedule" action is not asked twice |
| G4 | Medium | Slug validation (client) | A Bangla-only title gives an empty slug and "Add a title and URL slug before saving." | Explain why and focus the slug field | The main audience writes in Bangla | Specific message and focus; slug rules unchanged |
| G5 | Medium | `RichTextEditor` paste | A pasted web/Word image becomes an image without `mediaId`, so the body is invalid and the whole article can't be saved | Free-URL images left out on paste, with a notice | One paste blocks saving | `transformPastedHTML` drops non-library `<img>`; in-editor copies keep `mediaId` |
| G6 | Medium | Editor header | Only the *intended* state (dropdown) is shown; nothing says what is saved now | Clear saved state | Users must know whether they are editing a live article | Compact badge: New / Draft or Preview · private / Published · live / Scheduled · time / Archived, plus review state |
| G7 | Low–Medium | Import body mapping | Source tables arrive as "a \| b" text lines | Real editable tables | Tables are common in sports sources | Convert runs of ≥2 consistent pipe rows (2–20 cells) to tables, import path only |

### Lower-severity findings not changed in this phase

- **N1 — Preview hides FAQ drafts.** Preview shows only *published* FAQ entries, so imported FAQ drafts aren't visible until they're published in FAQ. Changing this alters the FAQ rendering, which the phase constraints protect.
- **N2 — Generic inline save error.** The inline save error says "check the server message", and the exact server text appears only in the toast notification.
- **N3 — Excerpt marked required but not enforced.** The excerpt is labelled `*`, but only the HTML "Save using selected state" submit enforces it; the server doesn't require it. Changing this would be a workflow-rule change.
- **N4 — Malformed staff input can cause a 500.** On `PUT /api/articles/:id`, non-string `publishedAt`, non-number `readingTimeMinutes`, or an unknown `authorId` from staff (not the UI) returns 500 instead of 400. There is no privilege escalation, because the field allow-list and role guards hold.
- **N5 — Asterisks in imported text.** Legacy inline markup conversion can italicise text between single asterisks in imported text.

## Features That Should NOT Be Changed

The following are already good and should stay as they are:

- server allow-list validation (`validateRichDoc`, `checkArticlePayload`, `validateSeo`, `isSafeHref`);
- the Media Library–only image model and the R2/local storage provider;
- the autosave/recovery architecture (`useAutosave`, `/api/drafts`, stale-version guard);
- the preview route and template;
- the FAQ system and `/api/faq/import`;
- the Phase I workflow and permissions;
- the Phase 5 creation flow;
- the SEO panel, SEO check and assistant;
- scheduling.

## Regression Risks

- Slug derivation must never overwrite a slug typed by the editor, or the slug of an existing article.
- Preview must keep saving private drafts first, so they show edits, as Flow A expects.
- The confirm dialog on "Save draft" may block automated tests that don't handle dialogs. Phase I, autosave and admin UI were re-run.
- Paste filtering must keep images copied within the editor; the filter keys on `mediaid`.
- Table conversion must not touch legacy bodies; it runs on the import path only.

## Implementation Plan

1. Add `src/lib/articleEditor.ts` with pure, testable rules: `slugFromTitle`, `previewPlan`, `leavesPublicState`, `savedStateLabel`, `stripNonLibraryImages`.
2. In `AdminArticles.tsx`: slug derivation (G1), slug guidance (G4), preview plan (G2), unpublish confirmation (G3), saved-state badge (G6).
3. In `RichTextEditor.tsx`: paste filter with a notice (G5).
4. In `src/lib/documentImport.ts`: `sourceTablesToRich` in body mapping (G7).
5. Tests: `verify-article-editor.ts` (unit/static) and `verify-article-editor-browser.ts` (flows A–H, local PostgreSQL), then the full regression run.

## Final Recommendation

Implement G1–G7. They are small and local, add no new API or model, and fix concrete data-safety and authoring defects. Defer N1–N5 and record them as known limitations.
