# PHASE D.1.1 — CMS WIDTH, ARTICLE EDITOR LAYOUT & RESPONSIVE UI HARDENING

## PHASE D.1.1 STATUS

COMPLETE locally. The shared CMS width constraint and nested Article Editor sizing have been corrected without changing Phase D SEO behavior, the public-site content width, the database, or workflow authorization.

Automated layout contracts, TypeScript, production build and all regression suites pass. Real visual browser inspection was attempted, but the available browser bridge failed before navigation because its environment omitted `sandboxPolicy`; no visual/browser pass is claimed.

## Root cause

The shared root page `<main>` applied `max-w-7xl` to public and Admin routes alike. Inside that restricted area, the Admin layout assigned 25% to navigation (`3/12`) and 75% to the CMS main area (`9/12`). The Article Editor then used a viewport-triggered fixed 360px SEO column. At ordinary desktop sizes those nested constraints left the writing surface too narrow.

## Layout changes

### CMS width

- Public routes retain the existing `max-w-7xl` shell.
- The presence of the Admin shell raises only the CMS maximum to `96rem` (1536px), with the existing responsive page gutters.
- The Content Management System header, actions and all management pages now share this wider shell.

### Shared Admin workspace

- Replaced the percentage-based 3/12 + 9/12 layout with:
  - navigation: 220px at normal desktop, 240px at larger desktop;
  - main workspace: `minmax(0, 1fr)`.
- Reduced the oversized inter-column gap and CMS-main padding without making cards cramped.
- Publishing Desk labels use `min-w-0`, natural wrapping and compact line height; long labels are no longer dependent on clipping.
- Every Admin page benefits because the correction lives in the shared `AdminLayout`.

### Article Editor grid

- The CMS main area is now a named CSS size container.
- The Article Editor switches to two columns only when its actual available CMS width reaches 1000px.
- Two-column mode uses:
  - main writing column: `minmax(38rem, 1fr)`;
  - SEO sidebar: `minmax(22rem, 24rem)`;
  - 1.5rem gap.
- Below that available width it stacks instead of squeezing both columns.
- The article body therefore remains the dominant desktop workspace while the SEO sidebar stays between approximately 352–384px.

### SEO sidebar

- Sticky positioning applies only in the container-query two-column state.
- `min-w-0` and `break-words` allow descriptions and findings to wrap naturally.
- Passed/Blocking/Warnings/Info remains a consistent readable 2×2 grid.
- SEO metadata fields continue to use full sidebar width.
- Search-preview URL uses safe wrapping rather than truncating meaningful text; title and description wrap with readable line height.

### Article body and toolbar

- Default editor minimum height increased from 320px to 420px for stacked/tablet layouts.
- Wide two-column newsroom mode provides a 640px initial writing height.
- The Phase D.1 Lucide icon toolbar, tooltips, ARIA labels, focus/active states and 36px targets are preserved.
- Toolbar remains flex-wrapped for genuinely narrow widths; no clipping or blanket overflow hiding was introduced.

### Forms and overflow

- Article Setup, Event/Edition, Article Type/Author and Subtitle/Slug grids use responsive single-column → two-column behavior.
- Grid children and shared CMS columns use `min-w-0` at the correct structural boundaries.
- No `overflow-x: hidden`, negative-margin shell hack, absolute positioning, fixed page width, hidden label or tiny-font workaround was added.

## Responsive behavior

The verified CSS/layout contracts produce:

- **1440px desktop:** wide Admin shell; 220–240px navigation; fluid CMS main. Article split activates when the resulting workspace is at least 1000px, preserving at least 608px for writing and 352px for SEO.
- **1366px desktop:** same sizing rule; two-column mode activates only if the post-gutter/post-navigation content really fits. Otherwise it stacks rather than compressing.
- **1280px desktop:** shared CMS uses substantially more width than before; Article Editor may intentionally stack when the actual workspace falls below the 1000px safety threshold.
- **Tablet:** Admin content and Article Editor stack; form pairs collapse before selects/labels become cramped.
- **Mobile:** single-column CMS/editor order; toolbar wraps; SEO, freshness and publishing remain in document flow.

These are implementation and compiled-layout results, not claimed screenshots. The requested visual width inspection could not execute because the browser bridge failed before page load.

## Regression

Passed:

- `npm run lint`
- `npm run build`
- `npm run test:phase-a` — 13 groups
- `npm run test:phase-b` — 10 groups
- `npm run test:phase-c` — 13 groups
- `ENABLE_READER_ACCOUNTS=true ENABLE_COMMENTS=true npm run test:phase4` — 20 groups
- `npm run test:phase-d` — 9 groups
- `npm run test:phase-d1` — 11 groups
- `npm run test:phase-d1.1` — 8 layout groups
- `npx prisma validate`
- `npx prisma migrate status` — five migrations, database up to date
- `git diff --check`

The new D.1.1 verifier checks the Admin-only wide shell, unchanged public constraint, compact navigation, fluid CMS main, container-responsive article grid, minimum writing/sidebar widths, editor height, form wrapping, search/status readability, toolbar preservation and absence of a blanket overflow hack.

## Database

No schema or data change was required. No migration was added. No database reset, drop, truncation, destructive seed or content deletion was performed. Database-aware regression suites confirmed fixture cleanup and unchanged pre-existing row hashes.

## Browser verification

Attempted through the provided in-app browser workflow. It failed before opening `http://127.0.0.1:3000/admin/` because the browser environment did not supply the required `sandboxPolicy` metadata.

Therefore none of the following is falsely claimed as visually verified: 1280, 1366, 1440, tablet/mobile screenshots, tooltip placement or sticky behavior. These remain the only verification gap.

## Remaining issue

- Rerun visual inspection at the requested widths once a functional browser/Playwright bridge is available.

No Git commit or push was created.
