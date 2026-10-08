import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { buildProposal } from '../documentImport/normalize';
import { extractManualText, MAX_MANUAL_TEXT_CHARACTERS } from '../documentImport/extractText';
import { documentImportRouter } from '../documentImport/routes';
import { DocumentImportError } from '../documentImport/types';
import { mapSelectedImport, proposalValues, transferConflicts, type ImportProposal, type TaxonomyData } from '../../src/lib/documentImport';

let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const rejectsCode = async (action: () => unknown, code: string) => assert.rejects(async () => action(), (error: unknown) => error instanceof DocumentImportError && error.code === code);

const source = `TITLE: ২০২৭ ফ্রেঞ্চ ওপেন সূচি
SUBTITLE: বাংলা ও English coverage
SPORT: Tennis
EVENT: French Open
EDITION: 2027
ARTICLE TYPE: Schedule
CONTENT:
প্রথম অনুচ্ছেদ।
Second paragraph.`;
const proposal = buildProposal(extractManualText(source));
assert.equal(proposal.sourceType, 'manual-text'); assert.equal(proposal.fields.subtitle.value, 'বাংলা ও English coverage'); assert.equal(proposal.fields.editionYear.value, 2027); assert.match(String(proposal.fields.body.value), /প্রথম অনুচ্ছেদ[\s\S]*Second paragraph/); pass('labeled multiline Bangla/English source produces the shared proposal');
assert.equal(proposal.fields.title.confidence, 'HIGH'); assert.equal(proposal.fields.title.evidence[0].sourceType, 'manual-text'); assert.equal(proposal.fields.title.evidence[0].line, 1); assert.equal(proposal.fields.title.evidence[0].page, undefined); pass('manual confidence and line evidence never fake document pages');

const freeform = buildProposal(extractManualText('A normal source headline\n\nFirst body paragraph.\n\nSecond body paragraph.'));
assert.equal(freeform.fields.title.value, 'A normal source headline'); assert.equal(freeform.fields.title.confidence, 'MEDIUM'); assert.match(String(freeform.fields.body.value), /First body paragraph[\s\S]*Second body paragraph/); pass('normal free-form text gets safe title and body candidates');
await rejectsCode(() => extractManualText('   \n'), 'document_empty'); pass('empty manual text is rejected clearly');
await rejectsCode(() => extractManualText('x'.repeat(MAX_MANUAL_TEXT_CHARACTERS + 1)), 'document_limit'); pass('oversized manual text is rejected safely');

const taxonomy: TaxonomyData = {
  sports: [{ id: 'sport-tennis', slug: 'tennis', name: 'Tennis', tagline: '', description: '', order: 1, isVisible: true, featuredEventIds: [], seo: {} }],
  events: [{ id: 'event-french-open', sportSlug: 'tennis', slug: 'french-open', name: 'French Open', shortName: 'Roland-Garros', description: '', frequency: null, defaultVenue: null, defaultLocation: null, currentEditionYear: 2027, allEditionYears: [2027], featured: true, isVisible: true, seo: {} }],
  editions: [{ id: 'french-open-2027', eventSlug: 'french-open', sportSlug: 'tennis', year: 2027, title: '2027 French Open', startDate: null, endDate: null, venue: null, location: null, status: 'upcoming', quickFacts: [], description: '', featuredImage: null, seo: {} }],
  authors: [], articleTypes: [{ id: 'type-schedule', name: 'Schedule', slug: 'schedule', description: '', sortOrder: 1, isActive: true, isSystem: true, schemaType: 'Article', seoProfile: 'schedule' }],
};
const values = proposalValues(proposal as ImportProposal); const selected = new Set(['title','subtitle','sport','event','editionYear','articleType','body'] as const);
const mapped = mapSelectedImport(selected, values, taxonomy); assert.equal(mapped.transfer.sportSlug, 'tennis'); assert.equal(mapped.transfer.eventSlug, 'french-open'); assert.equal(mapped.transfer.articleType, 'Schedule'); assert(!('status' in mapped.transfer)); pass('manual proposal uses the existing transfer mapper without publication state');
assert.deepEqual(transferConflicts({ title: String(mapped.transfer.title) }, { title: 'Existing title' }), ['title']); pass('existing overwrite protection applies to manual source');

const app = express(); app.use(express.json({ limit: '2mb' }));
app.use((req, _res, next) => { const role = req.get('x-test-role'); req.authContext = role ? { authenticated: true, userId: `manual-${role}`, userName: role, role: role as 'Admin' | 'Editor' | 'Author', source: 'session' } : { authenticated: false, userId: 'anonymous', userName: 'Anonymous', role: 'Reader', source: 'anonymous' }; next(); });
app.use('/api/document-import', documentImportRouter(() => ({ resolveSession: async () => null, resolveBypassUser: async () => null })));
const http = createServer(app); http.listen(0, '127.0.0.1'); await once(http, 'listening'); const endpoint = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/document-import/extract-text`;
const post = (role: string | undefined, text: string) => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: JSON.stringify({ text }) });
try {
  assert.equal((await post('Admin', source)).status, 200); assert.equal((await post('Editor', source)).status, 200); pass('Admin and Editor can process manual source');
  assert.equal((await post('Author', source)).status, 403); assert.equal((await post(undefined, source)).status, 401); pass('Author and anonymous manual-source requests are rejected');
  const empty = await post('Admin', ''); assert.equal(empty.status, 422); assert.match(await empty.text(), /Paste source text/); pass('manual endpoint returns understandable validation errors');
} finally { await new Promise<void>((resolve) => http.close(() => resolve())); }

const review = fs.readFileSync('src/components/admin/DocumentImportReview.tsx', 'utf8');
for (const phrase of ['PDF / DOCX import', 'Manual source text', 'Characters:', 'Process text', 'Select all safe fields', 'Transfer selected fields']) assert(review.includes(phrase), `Missing shared source/review control: ${phrase}`);
assert.equal((review.match(/Transfer selected fields/g) ?? []).length, 1); pass('both source methods converge on one review and transfer UI');
const article = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8'); assert(article.includes('Create manually') && article.includes('Create from source') && article.includes('<DocumentImportReview')); assert(review.includes('Create from source') && !review.includes('/api/articles')); pass('manual and source-assisted creation remain alternatives around the existing editor');

console.log(`Manual source verification passed: ${checks} checks.`);
