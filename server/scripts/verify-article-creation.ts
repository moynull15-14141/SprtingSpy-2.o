/**
 * PHASE 5 — unified Article creation (static + unit checks; no database).
 * Browser acceptance against the LOCAL database: verify-article-creation-browser.ts.
 *
 *   npm run test:article-creation
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_DOCUMENT_BYTES } from '../documentImport/routes';
import { PDF_LIMITS } from '../documentImport/extractPdf';
import { MAX_MANUAL_TEXT_CHARACTERS } from '../documentImport/extractText';
import { SOURCE_LIMITS, TRANSFER_FIELD_LABELS, mapSelectedImport, sourceErrorMessage, type CmsTransfer } from '../../src/lib/documentImport';

let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const articles = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8');
const review = fs.readFileSync('src/components/admin/DocumentImportReview.tsx', 'utf8');

// Exactly two top-level creation options, both ending in the one existing editor.
assert.equal((articles.match(/data-testid="create-article-(manual|source)"/g) ?? []).length, 2);
assert.equal((articles.match(/data-testid="create-article-button"/g) ?? []).length, 1);
assert.match(articles, /onClick=\{\(\) => \(isAuthor \? startCreate\(\) : setCreateChoice/, 'Authors go straight to the manual editor');
assert.equal((articles.match(/<form onSubmit=\{handleSave\}/g) ?? []).length, 1, 'one Article editor');
pass('Create Article offers exactly Create manually / Create from source, and both use the single existing editor');

assert.match(articles, /!isCreating && !isAuthor && createChoice === 'choose'/);
assert.match(articles, /!isCreating && !isAuthor && createChoice === 'source'/);
assert.match(articles, /isCreating && !isAuthor && \(\s*<DocumentImportReview\s+variant="editor"/);
assert.equal((articles.match(/<DocumentImportReview/g) ?? []).length, 2);
pass('source import is never rendered for Authors (choice, source step and in-editor import)');

assert.match(articles, /if \(!isCreating\) startCreate\(\{ unsynced: true \}\)/);
assert.match(articles, /autosave\.start\(\{ entityId: null, baseVersion: null, unsynced: options\.unsynced \}\)/);
pass('a source transfer that opens a new editor marks the working copy unsynced so autosave keeps it');

assert.match(review, /if \(request !== generation\.current\) return;/);
assert.match(review, /const resetResult = \(\) => \{ generation\.current\+\+;/);
assert.match(review, /const switchMethod = [^\n]*resetResult\(\)/);
assert.match(review, /\(sourceMethod === 'manual-text'\) !== \(proposal\.sourceType === 'manual-text'\)\) return;/);
pass('switching source method discards results and ignores late responses; only the active method\'s proposal can transfer');

assert(!/\/api\/articles|\/api\/faq|status:|reviewStatus|scheduledFor|publish\(/.test(review), 'review must not save, publish or change workflow');
const transferKeys = Object.keys(TRANSFER_FIELD_LABELS).sort();
assert.deepEqual(transferKeys, ['articleType', 'authorId', 'body', 'editionYear', 'eventSlug', 'excerpt', 'faqs', 'keywords', 'metaDescription', 'metaTitle', 'sportSlug', 'subtitle', 'title']);
pass('the transfer contract carries content and taxonomy only — no status, schedule, review or publish fields');

assert.equal(SOURCE_LIMITS.documentMegabytes * 1024 * 1024, MAX_DOCUMENT_BYTES);
assert.equal(SOURCE_LIMITS.pdfPages, PDF_LIMITS.pages);
assert.equal(SOURCE_LIMITS.manualCharacters, MAX_MANUAL_TEXT_CHARACTERS);
assert(review.includes('SOURCE_LIMITS.documentMegabytes') && review.includes('SOURCE_LIMITS.pdfPages') && review.includes('SOURCE_LIMITS.manualCharacters'));
pass('displayed PDF/DOCX and Manual Source limits match the server-enforced limits');

assert.match(sourceErrorMessage(422, { error: 'No readable PDF text was found. OCR is required for scanned or image-only PDFs.', code: 'ocr_required' }, 'Document extraction failed'), /OCR is not supported here/);
assert.match(sourceErrorMessage(422, { error: 'Document extraction timed out.', code: 'document_timeout' }, 'Document extraction failed'), /Try again/);
assert.equal(sourceErrorMessage(500, { error: 'Error: at Object.<anonymous> (/srv/app/server.ts:1:1)' }, 'Document extraction failed'), 'Document extraction failed. Try again in a moment.');
assert.equal(sourceErrorMessage(502, {}, 'Text processing failed'), 'Text processing failed. Try again in a moment.');
assert.equal(sourceErrorMessage(415, { error: 'Only PDF and DOCX documents are supported.' }, 'Document extraction failed'), 'Only PDF and DOCX documents are supported.');
assert.match(review, /The server could not be reached\. Your source and the Article editor are unchanged/);
pass('OCR, timeout, server and network failures produce safe, actionable messages without server details');

const taxonomy = { sports: [], events: [], editions: [], authors: [], articleTypes: [] };
const values = { title: 'Kept', subtitle: 'Deselected', excerpt: '', body: '', sport: 'Unknown sport', event: '', editionYear: '', articleType: '', author: '', seoTitle: '', metaDescription: '', keywords: '', startDate: '', endDate: '', venue: '' };
const mapped = mapSelectedImport(new Set(['title', 'sport']), values, taxonomy);
assert.deepEqual(mapped.transfer, { title: 'Kept' } satisfies CmsTransfer);
assert(mapped.mapped.some((item) => item.field === 'sport' && item.error));
pass('deselected fields stay out of the transfer and unknown taxonomy is reported instead of created');

assert.match(articles, /pendingFaqs/);
assert.match(articles, /\/api\/faq\/import/);
assert.match(articles, /meaningful: [^\n]*!!pendingFaqs\.length/);
pass('selected source FAQ travels in the autosaved working copy and is saved through the existing FAQ API');

console.log(`Article creation verification passed: ${checks} checks.`);
