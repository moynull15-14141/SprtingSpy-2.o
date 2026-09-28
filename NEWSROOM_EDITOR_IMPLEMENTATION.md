# Advanced Newsroom Editor + Admin Workspace

## Status

Implemented and verified locally on 2026-09-27. The existing TipTap editor, Article JSON field, Media Library/R2 pipeline, article API, preview/public renderer, SEO workflow, permissions and publishing actions were extended rather than replaced. No database migration or destructive database operation was used.

## Implemented

- Expanded text editing: H2-H4, paragraph, bold, italic, underline, strike, inline code, alignment, bullet/number/check lists, quote, divider, code block, responsive table, undo, redo and clear formatting. TipTap/StarterKit keyboard shortcuts remain active.
- A searchable, categorized Add Block panel plus a lightweight `/` trigger. Frequently used controls stay in the main toolbar.
- Internal-link search in the link editor with display text, target, follow/nofollow/sponsored/UGC options. Related Story stores an Article ID; the server verifies and refreshes its canonical path and display metadata when saving.
- Media Library-backed single images with caption, credit, alt text, alignment, small/medium/wide/full width, lightbox, replace and remove controls.
- Media Library-backed two-image, gallery and comparison presentations. All referenced media IDs participate in the existing copyright validation and ArticleMedia usage tracking.
- Safe media blocks for YouTube (privacy-enhanced player), Vimeo, direct video, audio, PDF/document and generic external resources. Raw HTML and third-party social scripts are not accepted.
- Newsroom blocks: pull quote, callout, warning, breaking news, key points, fact box, source/reference and read-more separator.
- Contextual actions for selected atomic blocks: move up/down, duplicate and delete. Custom newsroom blocks are marked draggable by TipTap/ProseMirror.
- Public/preview rendering for every new stored mark and node, with responsive tables/media, safe links, semantic output and no raw HTML rendering.
- Desktop admin workspace height is measured from its actual viewport position. Navigation remains stable; the article and SEO columns have independent scroll regions. Article title stays sticky inside the article scroll. Tablet/mobile retain the stacked flow and avoid forced three-column scrolling.

## Architecture and compatibility

- `src/lib/richText.ts` remains the single strict allow-list and normalizer.
- `server/articleContent.ts` still derives plain text/reading time and now resolves grouped media and canonical related-article metadata.
- `src/components/admin/editor/RichTextEditor.tsx` remains the only Article Body editor.
- `src/components/admin/editor/NewsroomNodes.ts` contains the small reusable TipTap atomic-node definitions.
- `src/components/editorial/RichText.tsx` remains the shared public and staff-preview renderer.
- Existing JSON documents remain valid. New nodes use predictable additive JSON shapes in the existing `Article.body` JSON column.
- No Prisma schema change or migration was required. No database reset, drop, truncate or seed was run.

## Verification

Passed:

- `npm run lint`
- `npm run build`
- `npm run test:phase-a` (13 groups)
- `npm run test:phase-b` (10 groups)
- `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:phase4` (20 groups)
- `npm run test:phase-c` (13 groups)
- `npm run test:phase-d` (9 groups)
- `npm run test:phase-d1` (11 groups)
- `npm run test:phase-d1.1` (8 groups)
- `npm run test:newsroom-editor` (6 groups)
- `npx prisma validate`
- `npx prisma migrate status` (5 migrations, up to date)
- `git diff --check`

The data-aware phase suites confirmed their UUID-scoped fixtures were removed and pre-existing database rows/protected files were unchanged.

Browser verification was attempted through the required in-app browser, but the environment rejected the connection before opening the page because its browser bridge did not provide `sandboxPolicy`. No browser/visual pass is claimed.

## Known limitations

- Social networks that require third-party scripts (Facebook, X, Instagram and TikTok) were deliberately not added; there is no safe existing embed/sanitization architecture for them.
- Image comparison currently uses an accessible responsive before/after side-by-side presentation, not a draggable reveal slider.
- The slash command opens the searchable block panel after `/`; it is not a cursor-anchored floating palette.
- Dragging applies to the custom atomic blocks through ProseMirror. Text blocks use the explicit keyboard-accessible move controls only when represented as selectable blocks; a universal visual drag-handle NodeView was not added.
- Decorative multi-column/tabs/accordion/card layout blocks and a reusable-block database were not introduced because the existing content model has no reusable-content subsystem and these were not necessary for newsroom content.
- The existing CMS loads its scoped article collection once; internal article search filters that already-loaded collection and makes no per-keystroke API calls. A separately paginated search endpoint can be added if the CMS dataset grows substantially.
- No autosave subsystem existed in the audited editor. This change preserves draft/save/preview/publish behavior and does not claim to add autosave.
