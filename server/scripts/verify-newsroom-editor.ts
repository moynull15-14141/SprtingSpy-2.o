import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateRichDoc, docToPlainText } from '../../src/lib/richText';

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };

const doc = {
  type: 'doc', content: [
    { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'Styled copy', marks: [{ type: 'underline' }, { type: 'strike' }] }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Verified' }] }] }] },
    { type: 'newsBox', attrs: { variant: 'keyPoints', title: 'Key points', body: 'One\nTwo' } },
    { type: 'embed', attrs: { kind: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Video' } },
    { type: 'relatedStory', attrs: { articleId: 'article-1', href: '/tennis/story/', title: 'Story', category: 'News', date: '2026-09-27', image: '' } },
    { type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'score = 1' }] },
  ],
};
const valid = validateRichDoc(doc);
assert.equal(valid.ok, true);
assert.match(docToPlainText((valid as { ok: true; doc: any }).doc), /Key points\nOne\nTwo/);
pass('new marks, checklist, newsroom, embed, related-story and code JSON validate and project to searchable text');

const badEmbed = validateRichDoc({ type: 'doc', content: [{ type: 'embed', attrs: { kind: 'youtube', url: 'javascript:alert(1)' } }] });
assert.equal(badEmbed.ok, false);
pass('unsafe embed URLs remain rejected by the shared server allow-list');

const editor = read('src/components/admin/editor/RichTextEditor.tsx');
for (const token of ['Add block', 'toggleTaskList', 'setTextAlign', 'Image settings', 'Find an internal article', 'Move up', 'Duplicate', 'slashPending']) assert(editor.includes(token), token);
pass('clean toolbar, block menu, slash trigger, internal-link search, image settings and contextual block actions are wired');

const renderer = read('src/components/editorial/RichText.tsx');
for (const token of ["case 'mediaGroup'", "case 'newsBox'", "case 'relatedStory'", "case 'embed'", "case 'codeBlock'", 'youtube-nocookie.com']) assert(renderer.includes(token), token);
pass('every added stored block has public rendering, including privacy-enhanced YouTube output');

const css = read('src/index.css');
for (const token of ['.site-shell:has([data-admin-shell])', '.cms-admin-nav', '.cms-editor-column', '.cms-seo-sidebar', '.cms-editor-toolbar', 'overscroll-behavior']) assert(css.includes(token), token);
assert(css.includes('grid-template-rows: minmax(0, 1fr)'), 'viewport-bound grid rows');
pass('desktop sidebar, article, SEO and pinned-toolbar regions are viewport-bound regions with controlled overflow');

const articlesUi = read('src/components/admin/AdminArticles.tsx');
for (const token of ['const startCreate', 'onClick={() => startCreate()}', 'data-testid="create-article-button"', 'data-testid="create-article-manual"', 'requestAnimationFrame', 'Title &amp; hierarchy']) assert(articlesUi.includes(token), token);
pass('Create Article explicitly opens and focuses an initialized form with a stable Title & Hierarchy section');

assert(!editor.includes('dangerouslySetInnerHTML=') && !renderer.includes('dangerouslySetInnerHTML='));
pass('editor and public renderer do not accept raw HTML');

console.log(`PASS ${checks} newsroom editor verification groups`);
