/** Phase D.1.1 CMS width and responsive layout contract verification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = fs.readFileSync('src/app/layout.tsx', 'utf8');
const app = fs.readFileSync('src/components/admin/AdminApp.tsx', 'utf8');
const layout = fs.readFileSync('src/components/admin/AdminLayout.tsx', 'utf8');
const article = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8');
const editor = fs.readFileSync('src/components/admin/editor/RichTextEditor.tsx', 'utf8');
const css = fs.readFileSync('src/index.css', 'utf8');
let groups = 0;
const pass = (message: string) => { groups++; console.log(`PASS ${message}`); };

// The site-wide 120rem width (public pages, header, footer and CMS alike) and
// the viewport-bound CMS shell replaced the earlier 96rem-admin/7xl-public split.
assert(root.includes('site-main') && root.includes('max-w-[98rem]'));
assert(css.includes('.site-main:has([data-admin-shell]) { max-width: 120rem; }'));
assert(app.includes('data-admin-shell'));
assert(css.includes('.site-main:has([data-admin-shell])') && css.includes('.site-shell:has([data-admin-shell])'));
pass('public pages use a 98rem content column, the CMS a 120rem workspace that takes over the viewport on desktop');

assert(layout.includes("lg:grid-cols-[220px_minmax(0,1fr)]"));
assert(layout.includes("xl:grid-cols-[240px_minmax(0,1fr)]"));
assert(layout.includes('cms-main min-w-0'));
assert(!layout.includes('lg:col-span-3') && !layout.includes('lg:col-span-9'));
pass('shared CMS shell uses a compact stable navigation rail and fluid main workspace');

assert(css.includes('container-name: cms-workspace') && css.includes('container-type: inline-size'));
assert(css.includes('@container cms-workspace (min-width: 60rem)'));
assert(css.includes('minmax(0, 1fr) minmax(20rem, 23rem)'));
pass('article split responds to actual CMS workspace width and preserves dominant minimum writing width');

assert(article.includes('cms-article-grid') && article.includes('cms-seo-sidebar'));
assert(css.includes('.cms-seo-sidebar') && css.includes('position: sticky') && css.includes('overflow-y: auto'));
assert(!article.includes('xl:grid-cols-[minmax(0,1fr)_360px]'));
pass('SEO sidebar is stable, sticky only when both columns fit, and no longer viewport-forced');

assert(editor.includes("min-h-[420px]"));
assert(css.includes('min-height: 32rem'));
pass('article body provides adaptive 420px stacked and 512px desktop writing heights');

assert(article.match(/md:grid-cols-2/g)?.length! >= 4);
assert(article.includes('min-w-0') && article.includes('break-words'));
assert(layout.includes('lg:break-words'));
pass('setup/basics grids stack before controls become cramped and long CMS labels wrap naturally');

assert(article.includes('grid grid-cols-2 gap-2 text-center'));
assert(!article.includes('sm:grid-cols-4 xl:grid-cols-2'));
assert(article.includes('break-all text-[11px]') && article.includes('break-words text-base leading-snug'));
pass('SEO status and search preview remain readable without clipping or narrow four-up cards');

assert(editor.includes('flex flex-wrap items-center gap-1'));
assert(editor.includes('cms-editor-toolbar') && css.includes('.cms-editor-toolbar { position: sticky'));
assert(editor.includes('h-9 w-9') && editor.includes('role="tooltip"'));
assert(!css.includes('overflow-x: hidden'));
pass('icon toolbar wraps cleanly and layout does not hide overflow as a quick fix');

assert.equal(JSON.parse(fs.readFileSync('package.json', 'utf8')).scripts['test:phase-d1.1'], 'tsx server/scripts/verify-phase-d11.ts');
console.log(`PASS ${groups} Phase D.1.1 layout verification groups`);
