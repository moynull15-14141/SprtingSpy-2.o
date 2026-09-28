# PHASE D.1 — SEO EDITOR UX & WORKFLOW

## PHASE D.1 STATUS

COMPLETE locally. The requested editor UX has been implemented without changing the Phase D SEO engine or database schema. Automated component contracts, TypeScript, production build and all available regression suites pass. Real browser verification was attempted but the available browser bridge failed before opening a page because its environment omitted `sandboxPolicy`; no browser pass is claimed.

## UX implemented

- Responsive newsroom workspace: the writing surface is the main column and publishing/SEO tools form a 360px sticky sidebar on wide screens. Tablet/mobile use a single natural reading order with no forced horizontal scroller.
- Clear editorial hierarchy: Article Setup, Article Basics & Content, Featured Image, SEO Intelligence, Social Metadata, Freshness and Publish Readiness.
- Required-field guidance, concise labels and less numbered/developer-oriented copy.
- Featured-image card shows preview, title, filename/URL, alt text and copyright-review state, reusing the existing Media Library.
- Separate Social Metadata panel with the existing fallback behavior.
- Bottom/sidebar publishing controls expose Preview, Save Draft, Publish, Discard and the selected-state save path.

## SEO workflow

1. The editor selects Sport/Event/Edition, article type and author, then writes the title, deck, slug, excerpt and rich body.
2. SEO metadata stays visible in the sidebar with live character counts and a clearly labelled search preview.
3. **Check SEO** sends the current unsaved draft to the existing Phase D `/api/seo/article-check` endpoint. It does not save or publish.
4. Results show Passed, Blocking, Warning and Info counts plus each rule's What, Why and Action copy. No rule ID or numerical SEO score is shown.
5. Safe direct actions focus SEO title/meta fields or open the existing Media Library picker. No content or facts are silently changed.
6. Existing internal-link, official-source and event-coverage suggestions appear in contextual cards. Links are never auto-inserted; the UI explains that the editor must select body text and use Insert Link.
7. AI suggestions remain optional and configuration-aware. Missing configuration produces no fake output.
8. Freshness shows reviewed/not-reviewed state and records an explicit review without changing the content-update timestamp.
9. Publish Readiness summarizes required fields, image, metadata and rule-based blocking/warning state. Warnings do not prevent publishing; backend authorization remains authoritative.

## Toolbar

The TipTap toolbar now uses the existing `lucide-react` library:

- Paragraph, Heading 2/3/4
- Bold, Italic, Insert Link
- Bullet List, Numbered List, Block Quote, Divider
- Insert Image, Insert Table
- Contextual add/delete row, add/delete column and delete-table controls

Every icon-only control has:

- a 36×36 click target;
- an accessible `aria-label` containing the tool and action;
- hover and keyboard-focus tooltip;
- visible focus ring;
- `aria-pressed` active state;
- disabled-state styling where applicable.

Toolbar mouse handling continues to preserve the editor selection. The editor remains an ARIA multiline textbox.

## Responsive behavior

- Small screens: single-column form and sidebar order, wrapped toolbar, two-column compact readiness actions.
- Desktop/laptop: `minmax(0,1fr) + 360px` workspace with the sidebar sticky at a safe top offset.
- Containers use `min-w-0`, wrapping and responsive grids to prevent intentional horizontal overflow.

These behaviors passed source/component contract and production compilation checks. Visual verification at 1440/1280/tablet/mobile widths could not run because the browser bridge failed before navigation; this limitation is not presented as a pass.

## Tests

Passed:

- `npm run test:phase-d1` — 11 UX/accessibility contract groups
- `npm run lint`
- `npm run build`
- `npx prisma validate`
- `npx prisma migrate status` — five migrations, database up to date
- `git diff --check`

Phase D.1 checks cover layout, visible SEO workflow, current unsaved-draft payload, findings/status presentation, internal/official/event suggestions, search preview, AI safety states, freshness, preview/save/publish controls, toolbar actions/tooltips/ARIA/focus targets and selection preservation.

## Regression

- Phase A: 13 groups passed
- Phase B: 10 groups passed
- Phase C: 13 groups passed
- Phase 4: 20 groups passed with the preserved Reader/Comments features enabled; Phase A separately verifies their launch flags OFF
- Phase D: 9 groups passed

All database-aware regression suites reported fixture cleanup and unchanged pre-existing row hashes.

## Backend changes

No Phase D SEO evaluator, sitemap, robots, canonical, structured-data, redirect, IndexNow, integration or AI backend was rewritten. No schema change or migration was necessary.

The editor only integrates more clearly with the existing Phase D endpoints and existing freshness endpoint.

## Remaining limitations

- Gemini output remains configuration-dependent on `GEMINI_API_KEY`.
- Search Console/Bing performance APIs remain disconnected as documented in Phase D.
- Internal-link insertion remains intentionally manual because the editor must choose appropriate anchor text.
- Real browser visual/keyboard verification must be rerun when the in-app browser provides the required sandbox metadata or a usable Playwright bridge is installed.
- No Git commit or push was created.

## Re-run

```powershell
npm run test:phase-d1
npm run lint
npm run build
npm run test:phase-d
npx prisma validate
npx prisma migrate status
```
