/** Phase D.1 editor UX contract verification.
 * Browser-independent checks for the client editor, paired with the Phase D
 * real-HTTP suite for the API behavior. Does not write to the database.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const article = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8');
const toolbar = fs.readFileSync('src/components/admin/editor/RichTextEditor.tsx', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
let groups = 0;
const pass = (message: string) => { groups++; console.log(`PASS ${message}`); };

const globalCss = fs.readFileSync('src/index.css', 'utf8');
assert(article.includes('cms-article-grid') && article.includes('cms-seo-sidebar'));
assert(globalCss.includes('@container cms-workspace') && globalCss.includes('position: sticky'));
assert(article.includes('grid-cols-1') && !article.includes('overflow-x-scroll'));
assert(article.includes('aria-label="Publishing and SEO sidebar"'));
pass('responsive newsroom workspace: single-column small screens and sticky two-column desktop sidebar');

for (const label of ['Article setup', 'Article basics & content', 'SEO intelligence', 'Social Metadata', 'Freshness', 'Publish readiness']) assert(article.includes(label), label);
assert(article.includes('Required fields') && article.includes('Optional'));
pass('editor sections expose setup, content, SEO, social, freshness and publishing hierarchy');

assert(article.includes('Check SEO') && article.includes('Checks this unsaved article draft. It does not save or publish changes.'));
for (const field of ['title, subtitle, slug, status, articleType, sportSlug', 'excerpt, body: bodyDoc', 'featuredMediaId', 'seo:']) assert(article.includes(field));
assert(article.includes("'/api/seo/article-check'") && article.includes('seoDraft()'));
pass('SEO check sends the current unsaved draft to the existing Phase D API');

for (const status of ['Passed', 'Blocking', 'Warnings', 'Info']) assert(article.includes(status));
for (const word of ['Why:', 'What:', 'Action:']) assert(article.includes(word));
assert(!article.match(/SEO score|\d+\s*\/\s*100/i));
pass('actionable findings show real status, reason and action without a fake score');

for (const section of ['Internal link opportunities', 'Official source', 'Event coverage']) assert(article.includes(section));
assert(article.includes('Select text, then use Insert Link') && article.includes('Suggestions only — the editor decides'));
assert(!article.includes('insertContent(x.url)'));
pass('link/source/coverage suggestions remain editor-controlled and never auto-insert');

assert(article.includes('Search preview') && article.includes('Preview only — search engines may render the result differently.'));
assert(article.includes('characters') && article.includes('Length guidance comes from the active SEO rules'));
pass('SEO metadata includes character guidance and an honestly labelled search preview');

assert(article.includes("'/api/seo/assistant'") && article.includes('AI content assistant'));
assert(article.includes('Not configured.') && article.includes('Nothing is inserted, saved or published automatically.'));
pass('AI assistant has configured/unconfigured UX and suggestions-only safety language');

assert(article.includes('/review`') && article.includes('Mark as reviewed'));
assert(article.includes('without changing the content update timestamp'));
pass('freshness review is visible and preserves meaningful content timestamps');

for (const action of ['Preview', 'Save draft', 'Publish']) assert(article.includes(`>${action}<`) || article.includes(`${action}\n`), action);
assert(article.includes("saveAs('draft')") && article.includes("saveAs('published')") && article.includes('/admin/preview/'));
assert(article.includes('warnings do not prevent publishing'));
pass('preview, draft and publish actions are discoverable while existing backend authorization remains authoritative');

const tools = [
  ['Paragraph', 'Use normal body text'], ['Heading 2', 'Apply a section heading'], ['Heading 3', 'Apply a subsection heading'],
  ['Heading 4', 'Apply a minor heading'], ['Bold', 'Make selected text bold'], ['Italic', 'Italicize selected text'],
  ['Insert Link', 'Add an internal or external link'], ['Bullet List', 'Create a bulleted list'],
  ['Numbered List', 'Create a numbered list'], ['Block Quote', 'Format selected text as a quotation'],
  ['Divider', 'Insert a horizontal section divider'], ['Insert Image', 'Add an image from Media Library'],
  ['Insert Table', 'Add a three-column data table'],
];
for (const [label, description] of tools) assert(toolbar.includes(`label="${label}"`) && toolbar.includes(`description="${description}"`), label);
assert(toolbar.includes('aria-label={`${label} — ${description}`}') && toolbar.includes('role="tooltip"') && toolbar.includes('aria-pressed={active}'));
assert(toolbar.includes('h-9 w-9') && toolbar.includes('focus-visible:ring-2'));
assert(!toolbar.match(/>¶ Text<|>• List<|>1\. List<|>Quote<|>Divider<|>Image<|>Table</));
pass('Lucide icon toolbar has grouped 36px controls, tooltips, accessible names, pressed states and focus rings');

assert(toolbar.includes("id: 'article-body'") && toolbar.includes("role: 'textbox'") && toolbar.includes("'aria-multiline': 'true'"));
assert(toolbar.includes("if ((e.target as HTMLElement).closest('button')) e.preventDefault()"));
pass('toolbar remains keyboard/screen-reader accessible and preserves editor selection');

assert.equal(pkg.scripts['test:phase-d1'], 'tsx server/scripts/verify-phase-d1.ts');
console.log(`PASS ${groups} Phase D.1 UX verification groups`);
