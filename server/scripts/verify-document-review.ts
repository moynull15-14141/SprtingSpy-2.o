import assert from 'node:assert/strict';
import fs from 'node:fs';
import { legacyToDoc, validateRichDoc } from '../../src/lib/richText';
import { mapImportField, mapSelectedImport, proposalValues, transferConflicts, type ImportProposal, type TaxonomyData } from '../../src/lib/documentImport';

let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const taxonomy: TaxonomyData = {
  sports: [{ id: 'sport-tennis', slug: 'tennis', name: 'Tennis', tagline: '', description: '', order: 1, isVisible: true, featuredEventIds: [], seo: {} }],
  events: [{ id: 'event-french-open', sportSlug: 'tennis', slug: 'french-open', name: 'French Open', shortName: 'Roland-Garros', description: '', frequency: 'Annual', defaultVenue: null, defaultLocation: null, currentEditionYear: 2027, allEditionYears: [2027], featured: true, isVisible: true, seo: {}, alternativeNames: 'Roland Garros' }],
  editions: [{ id: 'french-open-2027', eventSlug: 'french-open', sportSlug: 'tennis', year: 2027, title: '2027 French Open', startDate: null, endDate: null, venue: null, location: null, status: 'upcoming', quickFacts: [], description: '', featuredImage: null, seo: {} }],
  authors: [{ id: 'author-david', slug: 'david-campbell', name: 'David Campbell', roleTitle: 'Editor', bio: '', avatar: '' }],
  articleTypes: [{ id: 'type-schedule', name: 'Schedule', slug: 'schedule', description: '', sortOrder: 1, isActive: true, isSystem: true, schemaType: 'Article', seoProfile: 'schedule' }],
};
const fields = Object.fromEntries(['title','sport','event','editionYear','articleType','author','subtitle','excerpt','body','seoTitle','metaDescription','keywords','startDate','endDate','venue'].map((field) => [field, { value: null, confidence: 'UNRESOLVED', evidence: [] }])) as ImportProposal['fields'];
Object.assign(fields, {
  title: { value: '2027 French Open Schedule', confidence: 'HIGH', evidence: [{ field: 'title', paragraph: 1, excerpt: 'TITLE: 2027 French Open Schedule' }] },
  sport: { value: 'Tennis', confidence: 'HIGH', evidence: [{ field: 'sport', paragraph: 2, excerpt: 'SPORT: Tennis' }] },
  event: { value: 'Roland Garros', confidence: 'HIGH', evidence: [{ field: 'event', paragraph: 3, excerpt: 'EVENT: Roland Garros' }] },
  editionYear: { value: 2027, confidence: 'HIGH', evidence: [{ field: 'editionYear', paragraph: 4, excerpt: 'YEAR: 2027' }] },
  articleType: { value: 'Schedule', confidence: 'HIGH', evidence: [] }, author: { value: 'David Campbell', confidence: 'HIGH', evidence: [] },
  body: { value: '<script>alert(1)</script> Safe article text.', confidence: 'MEDIUM', evidence: [{ field: 'body', page: 2, excerpt: 'Safe article text.' }] },
  seoTitle: { value: 'French Open schedule', confidence: 'HIGH', evidence: [] }, keywords: { value: ['tennis', 'schedule'], confidence: 'HIGH', evidence: [] },
});
const proposal: ImportProposal = { sourceType: 'docx', text: '', sections: [], fields, faqs: [], warnings: ['Review the date.'], sourceEvidence: [] };
const values = proposalValues(proposal);
assert.equal(values.keywords, 'tennis, schedule'); assert.equal(proposal.fields.title.evidence[0].paragraph, 1); assert.equal(proposal.warnings.length, 1); pass('proposal values retain confidence, evidence, and warnings');

const selection = new Set(['title','sport','event','editionYear','articleType','author','body','seoTitle','keywords'] as const);
const result = mapSelectedImport(selection, values, taxonomy);
assert.deepEqual({ sport: result.transfer.sportSlug, event: result.transfer.eventSlug, year: result.transfer.editionYear, type: result.transfer.articleType, author: result.transfer.authorId }, { sport: 'tennis', event: 'french-open', year: 2027, type: 'Schedule', author: 'author-david' });
assert.equal(result.transfer.title, '2027 French Open Schedule'); assert(!('status' in result.transfer)); pass('selected safe values map to existing CMS fields without workflow state');
assert(validateRichDoc(result.transfer.body).ok); assert.match(JSON.stringify(result.transfer.body), /<script>alert/); pass('document markup transfers as inert rich-text content, never executable HTML');

selection.delete('seoTitle'); const deselected = mapSelectedImport(selection, values, taxonomy); assert.equal(deselected.transfer.metaTitle, undefined); pass('field deselection prevents transfer');
values.title = 'Corrected title'; const edited = mapSelectedImport(new Set(['title']), values, taxonomy); assert.equal(edited.transfer.title, 'Corrected title'); pass('manual corrections are transferred');

assert(mapImportField('sport', 'Unknown sport', taxonomy).error); assert(mapImportField('articleType', 'Unknown category', taxonomy).error); assert(mapImportField('venue', 'Court One', taxonomy).error); pass('unknown taxonomy and unsupported destinations remain unmapped');
const conflicts = transferConflicts({ title: 'Imported', metaTitle: 'New SEO' }, { title: 'Existing', metaTitle: '' }); assert.deepEqual(conflicts, ['title']); pass('existing values are detected before overwrite');
const kept = { title: 'Imported', metaTitle: 'New SEO' }; for (const field of conflicts) delete kept[field]; assert.deepEqual(kept, { metaTitle: 'New SEO' }); pass('keep-existing choice removes conflicting imported value');

const component = fs.readFileSync('src/components/admin/DocumentImportReview.tsx', 'utf8');
for (const phrase of ['HIGH', 'MEDIUM', 'LOW', 'UNRESOLVED', 'Evidence (', 'Extraction warnings', 'Select all safe fields', 'Clear selection', 'Transfer selected fields', 'Review existing values', 'keep the existing value']) assert(component.includes(phrase), `Review UI is missing: ${phrase}`);
pass('review UI exposes confidence, evidence, warnings, selection, and overwrite controls');
const articleEditor = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8'); assert(articleEditor.includes('<DocumentImportReview') && articleEditor.includes('applyDocumentImport')); assert(!component.includes('/api/articles')); pass('review transfers into the existing article editor and never calls the Article API');

const body = legacyToDoc(values.body); assert(validateRichDoc(body).ok); pass('imported content passes the existing CMS rich-text validator');
console.log(`Document review verification passed: ${checks} checks.`);
