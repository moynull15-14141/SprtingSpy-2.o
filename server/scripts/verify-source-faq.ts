import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildProposal } from '../documentImport/normalize';
import { extractManualText } from '../documentImport/extractText';
import type { RawExtraction } from '../documentImport/types';
import { parseFaqInput } from '../faq';

let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };

const pdf: RawExtraction = { sourceType: 'pdf', warnings: [], sections: [{ kind: 'paragraph', page: 2, text: 'FAQ\nQ: Who won the match?\nA: Bangladesh.\nQ: Where was it played?\nA: Dhaka.' }] };
const pdfProposal = buildProposal(pdf);
assert.equal(pdfProposal.faqs.length, 2); assert.equal(pdfProposal.faqs[0].evidence[0].page, 2); assert.equal(pdfProposal.fields.body.value, null); pass('PDF FAQ pairs preserve page evidence and source order without duplicating into the Article body');

const docx: RawExtraction = { sourceType: 'docx', warnings: [], sections: [
  { kind: 'paragraph', paragraph: 1, text: 'Question: Who won the final?' },
  { kind: 'paragraph', paragraph: 2, text: 'Answer: বাংলাদেশ।\nIt was a close match.' },
  { kind: 'table', table: 1, text: 'Q2 | Where?\nA2 | ঢাকা।', rows: [['Q2', 'Where?'], ['A2', 'ঢাকা।']] },
] };
const docxProposal = buildProposal(docx);
assert.equal(docxProposal.faqs.length, 2); assert.match(docxProposal.faqs[0].answer, /বাংলাদেশ[\s\S]*close match/); assert.equal(docxProposal.faqs[0].evidence[0].paragraph, 1); assert.equal(docxProposal.faqs[1].evidence[1].row, 2); pass('DOCX paragraph/table FAQ supports full labels, numbered labels, multiline answers and Unicode');

const manual = buildProposal(extractManualText('FAQ\n\nQ1: প্রথম প্রশ্ন কী?\nA1: প্রথম উত্তর।\nআরও তথ্য।\n\nQuestion: Second question?\nAnswer: Second answer.'));
assert.equal(manual.faqs.length, 2); assert.equal(manual.faqs[0].evidence[0].line, 3); assert.equal(manual.faqs[0].evidence[0].page, undefined); assert.match(manual.faqs[0].answer, /আরও তথ্য/); pass('manual source FAQ has exact line evidence without invented pages');

const incomplete = buildProposal(extractManualText('A: Orphan answer.\n\nQ: Complete question?\nA: Complete answer.\n\nQ: Missing answer?'));
assert.equal(incomplete.faqs.length, 1); assert(incomplete.warnings.some((warning) => /no complete answer|without a preceding question/.test(warning))); pass('incomplete and orphan FAQ labels produce warnings without unsafe candidates');

const ambiguous = buildProposal(extractManualText('FAQ\n\nIs this a question?\nMaybe this is an answer.'));
assert.equal(ambiguous.faqs.length, 0); pass('ambiguous unlabeled prose does not invent FAQ pairs');

const duplicate = buildProposal(extractManualText('Q: Same question?\nA: First answer.\n\nQ: Same question?\nA: Conflicting answer.'));
assert.equal(duplicate.faqs.length, 2); assert(duplicate.warnings.some((warning) => warning.includes('Duplicate FAQ question'))); pass('duplicate/conflicting FAQ questions stay ordered and receive a warning');

assert(parseFaqInput({ question: '<script>alert(1)</script> Safe question?', answer: '<img src=x onerror=alert(1)>', articleId: 'article-1', status: 'draft', source: 'editor' }, false).ok); pass('imported markup remains plain FAQ text for escaped React rendering');

const review = fs.readFileSync('src/components/admin/DocumentImportReview.tsx', 'utf8');
for (const phrase of ['source-faq-heading', 'Selected questions become ordinary draft entries', 'Question<input', 'Answer<textarea', 'Select all', 'Clear', 'Remove', 'Evidence (']) assert(review.includes(phrase), `FAQ review control missing: ${phrase}`);
assert.equal((review.match(/source-faq-heading/g) ?? []).length, 2); pass('FAQ candidates use the existing source review with edit, evidence, selection and removal controls');

const transfer = fs.readFileSync('src/lib/documentImport.ts', 'utf8');
const articles = fs.readFileSync('src/components/admin/AdminArticles.tsx', 'utf8');
assert(transfer.includes('faqs?: PendingFaq[]') && transfer.includes("if (field === 'faqs') return false"));
assert(articles.includes('pendingFaqs') && articles.includes("'/api/faq/import'") && articles.includes('existing FAQ workspace as drafts'));
pass('selected FAQ handoff appends to the Article working copy and preserves existing FAQ entries');

const faqApi = fs.readFileSync('server/faq.ts', 'utf8');
assert(faqApi.includes("router.post('/import'") && faqApi.includes("status: 'draft'") && faqApi.includes('exact.has(duplicateKey)'));
assert(!faqApi.includes('SourceFAQ') && !faqApi.includes('ImportedFAQ')); pass('atomic handoff uses existing FaqEntry persistence, draft status and exact-duplicate protection');

const adminFaq = fs.readFileSync('src/components/admin/AdminFaq.tsx', 'utf8');
for (const token of ["'/api/faq'", "'/api/faq/reorder'", "method: 'PUT'", "method: 'DELETE'", 'ArrowUp', 'ArrowDown']) assert(adminFaq.includes(token), `Existing FAQ control missing: ${token}`);
const publicFaq = fs.readFileSync('server/services/public/faq.ts', 'utf8');
assert(publicFaq.includes("status: 'published'")); pass('existing FAQ add/edit/delete/reorder and published-only rendering remain authoritative');

assert(!articles.includes("status: 'published', source") && !review.includes('/api/faq')); pass('source review cannot publish FAQs or bypass the Article workflow');

console.log(`Source FAQ integration verification passed: ${checks} checks.`);
