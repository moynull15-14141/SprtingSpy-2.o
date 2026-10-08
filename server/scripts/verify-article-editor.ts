/**
 * PHASE 6 — Article editor hardening (unit + static checks; no database).
 * Browser acceptance against the LOCAL database: verify-article-editor-browser.ts.
 *
 *   npm run test:article-editor
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { leavesPublicState, previewPlan, savedStateLabel, slugFromTitle } from '../../src/lib/articleEditor';
import { mapImportField, sourceTablesToRich } from '../../src/lib/documentImport';
import { legacyToDoc, validateRichDoc, type RichDoc } from '../../src/lib/richText';

let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const taxonomy = { sports: [], events: [], editions: [], authors: [], articleTypes: [] };

// Slug
assert.equal(slugFromTitle('Preview of the 2027 Final!'), 'preview-of-the-2027-final');
assert.equal(slugFromTitle('বাংলাদেশ বনাম ভারত'), '', 'Bangla-only title has no Latin slug');
assert.equal(slugFromTitle('BPL 2027 ফাইনাল'), 'bpl-2027');
const long = slugFromTitle('word '.repeat(60));
assert(long.length <= 120 && !long.endsWith('-'), 'slug stays within the server limit without a trailing hyphen');
// The slug follows each keystroke: every prefix's slug is what the previous keystroke produced.
let slug = '', title = '';
for (const ch of 'Final preview') { const next = title + ch; if (!slug || slug === slugFromTitle(title)) slug = slugFromTitle(next); title = next; }
assert.equal(slug, 'final-preview', 'typed character by character, the slug tracks the whole title');
let custom = 'my-own-slug'; title = 'Final';
for (const ch of ' preview') { const next = title + ch; if (!custom || custom === slugFromTitle(title)) custom = slugFromTitle(next); title = next; }
assert.equal(custom, 'my-own-slug', 'a slug typed by the editor is never overwritten');
const editor = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8');
assert.match(editor, /if \(!editingId && \(!slug \|\| slug === slugFromTitle\(title\)\)\) setSlug\(slugFromTitle\(val\)\)/);
assert.match(editor, /type a short English slug/);
pass('new-article slug follows the full title until edited by hand; Bangla-only titles get a clear slug message');

// Preview never mutates public/scheduled state
const plans: [string | undefined, string, boolean, string][] = [
  [undefined, 'draft', false, 'save'], [undefined, 'preview', false, 'save'], ['draft', 'draft', true, 'save'], ['preview', 'draft', true, 'save'],
  [undefined, 'scheduled', false, 'save-first'], [undefined, 'published', false, 'save-first'], [undefined, 'archived', false, 'save-first'],
  ['draft', 'scheduled', true, 'saved-version'], ['draft', 'published', true, 'saved-version'], ['draft', 'archived', true, 'saved-version'],
  ['published', 'draft', true, 'saved-version'], ['published', 'published', true, 'saved-version'], ['scheduled', 'scheduled', true, 'saved-version'],
  ['scheduled', 'draft', true, 'saved-version'], ['archived', 'draft', true, 'saved-version'],
];
for (const [savedStatus, selectedStatus, hasId, expected] of plans) assert.equal(previewPlan({ savedStatus, selectedStatus, hasId }), expected, `${savedStatus}→${selectedStatus}`);
assert.equal(previewPlan({ savedStatus: 'draft', selectedStatus: 'draft', hasId: true, readOnly: true }), 'saved-version');
assert.match(editor, /if \(plan === 'saved-version'\) \{\s*window\.open\(`\/admin\/preview\/\$\{editingId\}\/`/);
assert(!/willBeLive/.test(editor));
pass('Preview saves only a private article that stays private; live, scheduled and archived articles show the last saved version');

assert.equal(leavesPublicState('published', 'draft'), true);
assert.equal(leavesPublicState('scheduled', 'draft'), true);
assert.equal(leavesPublicState('draft', 'draft'), false);
assert.equal(leavesPublicState(undefined, 'draft'), false);
assert.equal(leavesPublicState('published', 'published'), false);
assert.match(editor, /saveAs\('draft', \{ confirmed: true \}\)\}>Cancel schedule/);
pass('"Save draft" on a live or scheduled article asks for confirmation; the explicit "Cancel schedule" action does not ask twice');

assert.equal(savedStateLabel(undefined).label, 'New · not saved yet');
assert.equal(savedStateLabel({ status: 'published', reviewStatus: 'not_required' }).tone, 'live');
assert.match(savedStateLabel({ status: 'draft', reviewStatus: 'in_review' }).label, /Draft · private · Needs review/);
assert.match(savedStateLabel({ status: 'scheduled', scheduledFor: '2030-01-01T10:00:00Z' }).label, /^Scheduled · /);
assert.match(editor, /data-testid="article-saved-state"/);
pass('the editor header shows what is saved now (new / private / live / scheduled / archived, with review state)');

// Paste: free-URL images are left out (DOM part runs in the browser acceptance)
const rte = fs.readFileSync('src/components/admin/editor/RichTextEditor.tsx', 'utf8');
assert.match(rte, /transformPastedHTML: \(html\) => \{\s*const cleaned = stripNonLibraryImages\(html, allowMedia\);/);
assert.match(rte, /\{allowMedia && <ToolButton label="Insert Image"/, 'media-free editors (edition description) hide the image tool');
assert(!validateRichDoc({ type: 'doc', content: [{ type: 'image', attrs: { src: 'https://example.com/x.jpg' } }] }).ok, 'free-URL images are still rejected by the stored format');
pass('pasted non-library images are removed before they reach the document (the server still rejects them)');

// Source tables
const pipeBody = 'Intro paragraph.\n\nTeam | Played | Won\nDhaka | 10 | 7\nSylhet | 10 | 5\n\nUneven | row\nOnly one | cell | here';
const doc = sourceTablesToRich(legacyToDoc(pipeBody));
assert.deepEqual(doc.content.map((n) => n.type), ['paragraph', 'table', 'paragraph']);
const table = doc.content[1];
assert.equal(table.content!.length, 3); assert.equal(table.content![0].content!.length, 3);
assert.equal(table.content![1].content![0].content![0].content![0].text, 'Dhaka');
assert(validateRichDoc(doc).ok, 'converted table passes the stored-format validator');
const mapped = mapImportField('body', pipeBody, taxonomy);
assert.equal((mapped.value as RichDoc).content[1].type, 'table');
assert.deepEqual(sourceTablesToRich(legacyToDoc('Score | 5\n**bold** | x')).content[0].type, 'paragraph', 'marked-up lines stay text');
assert.deepEqual(sourceTablesToRich(legacyToDoc('single | row')).content[0].type, 'paragraph', 'one line is not a table');
const inline = sourceTablesToRich(legacyToDoc('Standings after round five.\nTeam | Played | Won\nDhaka | 10 | 7\nClosing note.'));
assert.deepEqual(inline.content.map((n) => n.type), ['paragraph', 'table', 'paragraph'], 'a table inside a paragraph (typical PDF) is split out');
assert.equal(inline.content[0].content![0].text, 'Standings after round five.');
assert.equal(inline.content[2].content![0].text, 'Closing note.');
assert(validateRichDoc(inline).ok);
pass('regular "cell | cell" rows from PDF/DOCX/manual sources become real editable tables; irregular rows stay text');

// Bangla / mixed Unicode survive mapping and validation unchanged
const bangla = mapImportField('body', 'বাংলাদেশ দল ঘোষণা।\n\nMixed English ও বাংলা text.', taxonomy);
const banglaDoc = bangla.value as RichDoc;
assert.equal(banglaDoc.content[0].content![0].text, 'বাংলাদেশ দল ঘোষণা।');
assert(validateRichDoc(banglaDoc).ok);
pass('Bangla, English and mixed Unicode content is preserved exactly through import mapping and validation');

console.log(`Article editor verification passed: ${checks} checks.`);
