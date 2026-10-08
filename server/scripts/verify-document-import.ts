import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { extractPdf } from '../documentImport/extractPdf';
import { extractDocx, inspectDocx } from '../documentImport/extractDocx';
import { extractDocxInWorker, extractPdfInWorker } from '../documentImport/extractDocxWorker';
import { buildProposal, normalizeText } from '../documentImport/normalize';
import { documentImportRouter, validateUploadedDocument } from '../documentImport/routes';
import { DocumentImportError, type RawExtraction } from '../documentImport/types';

let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
async function rejectsCode(action: () => unknown | Promise<unknown>, code: string) {
  await assert.rejects(async () => action(), (error: unknown) => error instanceof DocumentImportError && error.code === code);
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const filename = Buffer.from(name), data = Buffer.from(contents), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
    locals.push(local, filename, data);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    central.push(entry, filename); offset += local.length + filename.length + data.length;
  }
  const centralBytes = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(centralBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

function docx(body: string) {
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}
const p = (text: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t>${text}</w:t></w:r></w:p>`;

function pdf(text?: string, streamOverride?: string): Buffer {
  const stream = streamOverride ?? (text ? `BT /F1 12 Tf 72 720 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : '');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources ${text ? '<< /Font << /F1 5 0 R >> >>' : '<< >>'} /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ...(text ? ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'] : []),
  ];
  let out = '%PDF-1.4\n', cursor = Buffer.byteLength(out), offsets = [0];
  for (let i = 0; i < objects.length; i++) { offsets.push(cursor); const obj = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; out += obj; cursor += Buffer.byteLength(obj); }
  const xref = cursor; out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((value) => String(value).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out);
}

assert.equal(normalizeText(' Café\u00a0  déjà\r\n\r\n\r\nvu '), 'Café déjà\n\nvu'); pass('Unicode and whitespace normalize without rewriting words');

const structured: RawExtraction = { sourceType: 'docx', warnings: [], sections: [
  { kind: 'paragraph', paragraph: 1, text: 'TITLE: 2027 French Open Schedule' },
  { kind: 'paragraph', paragraph: 2, text: 'SPORT: Tennis' },
  { kind: 'paragraph', paragraph: 3, text: 'YEAR: 2027' },
  { kind: 'paragraph', paragraph: 4, text: 'CONTENT:\nFirst paragraph.\nSecond paragraph.' },
] };
const proposal = buildProposal(structured);
assert.equal(proposal.fields.title.value, '2027 French Open Schedule'); assert.equal(proposal.fields.title.confidence, 'HIGH'); assert.equal(proposal.fields.editionYear.value, 2027); assert.equal(proposal.fields.body.value, 'First paragraph.\nSecond paragraph.'); assert.equal(proposal.fields.sport.evidence[0].paragraph, 2); pass('structured labels, multiline content, confidence, and evidence');

const duplicate = buildProposal({ sourceType: 'pdf', warnings: [], sections: [{ kind: 'paragraph', page: 1, text: 'SPORT: Tennis\nSPORT: Golf' }] });
assert.equal(duplicate.fields.sport.confidence, 'UNRESOLVED'); assert(duplicate.warnings.some((warning) => warning.includes('Conflicting sport'))); pass('conflicting labels remain unresolved with a warning');
const duplicateSame = buildProposal({ sourceType: 'pdf', warnings: [], sections: [{ kind: 'paragraph', page: 1, text: 'VENUE: Centre Court\nVENUE: Centre Court' }] });
assert.equal(duplicateSame.fields.venue.value, 'Centre Court'); assert(duplicateSame.warnings.some((warning) => warning.includes('Duplicate venue'))); pass('duplicate identical labels are reported');

const freeform = buildProposal({ sourceType: 'docx', warnings: [], sections: [{ kind: 'heading', paragraph: 1, level: 1, text: 'A normal article' }, { kind: 'heading', paragraph: 2, level: 2, text: 'Opening' }, { kind: 'paragraph', paragraph: 3, text: 'Article paragraph.' }] });
assert.equal(freeform.fields.title.value, 'A normal article'); assert.equal(freeform.fields.title.confidence, 'MEDIUM'); assert.match(String(freeform.fields.body.value), /Opening[\s\S]*Article paragraph/); pass('free-form heading and body candidates');

const tableXml = '<w:tbl><w:tr><w:tc>' + p('Player') + '</w:tc><w:tc>' + p('Seed') + '</w:tc></w:tr><w:tr><w:tc>' + p('Élodie') + '</w:tc><w:tc>' + p('1') + '</w:tc></w:tr></w:tbl>';
const validDocx = docx(p('Tournament preview', 'Heading1') + p('Normal paragraph.') + tableXml);
const docxResult = await extractDocx(validDocx); assert.equal(docxResult.sections[0].kind, 'heading'); assert.deepEqual(docxResult.sections.find((section) => section.kind === 'table')?.rows?.[1], ['Élodie', '1']); pass('DOCX headings, paragraphs, Unicode, and bounded tables');
const labelsTable = '<w:tbl>' + [
  ['TITLE', 'Bangladesh wins'], ['SPORT', 'Cricket'], ['EVENT', 'Asia Cup'], ['CONTENT', 'First line.<w:br/>Second line.'],
].map(([label, value]) => `<w:tr><w:tc>${p(label)}</w:tc><w:tc>${p(value)}</w:tc></w:tr>`).join('') + '</w:tbl>';
const tableOnlyProposal = buildProposal(await extractDocx(docx(labelsTable)));
assert.equal(tableOnlyProposal.fields.title.value, 'Bangladesh wins'); assert.equal(tableOnlyProposal.fields.sport.value, 'Cricket'); assert.equal(tableOnlyProposal.fields.body.value, 'First line.\nSecond line.'); assert.equal(tableOnlyProposal.fields.title.evidence[0].table, 1); assert.equal(tableOnlyProposal.fields.title.evidence[0].row, 1); pass('table-only DOCX maps unambiguous labeled rows with table evidence and multiline cells');
const mixedTable = '<w:tbl><w:tr><w:tc>' + p('Player') + '</w:tc><w:tc>' + p('Seed') + '</w:tc></w:tr></w:tbl>';
const mixedProposal = buildProposal(await extractDocx(docx(p('Article title', 'Heading1') + p('Opening paragraph.') + mixedTable)));
assert.match(String(mixedProposal.fields.body.value), /Opening paragraph[\s\S]*Player \| Seed/); assert.equal((String(mixedProposal.fields.body.value).match(/Player \| Seed/g) ?? []).length, 1); pass('paragraphs and unknown table content remain reviewable without duplication');
const tableConflict = buildProposal(await extractDocx(docx('<w:tbl><w:tr><w:tc>' + p('SPORT') + '</w:tc><w:tc>' + p('Cricket') + '</w:tc></w:tr><w:tr><w:tc>' + p('SPORT') + '</w:tc><w:tc>' + p('Football') + '</w:tc></w:tr></w:tbl>')));
assert.equal(tableConflict.fields.sport.confidence, 'UNRESOLVED'); assert(tableConflict.warnings.some((warning) => warning.includes('Conflicting sport'))); pass('duplicate and conflicting table labels use existing warning behavior');
await rejectsCode(() => extractDocx(docx('<w:tbl></w:tbl>')), 'document_empty'); pass('empty table DOCX is rejected clearly');
const tooManyRows = '<w:tbl>' + (`<w:tr><w:tc>${p('x')}</w:tc></w:tr>`).repeat(501) + '</w:tbl>';
await rejectsCode(() => extractDocx(docx(tooManyRows)), 'document_limit'); pass('DOCX table row limits remain enforced');
const workerResult = await extractDocxInWorker(validDocx); assert.equal(workerResult.sourceType, 'docx'); pass('DOCX extraction worker preserves extraction output');
// The worker is reused (already started), so the deadline covers parsing only: use a document that takes real work.
const slowDocx = docx(p('Long paragraph of extraction work. '.repeat(40)).repeat(9000));
await rejectsCode(() => extractDocxInWorker(slowDocx, 5), 'document_timeout'); pass('DOCX worker is terminated at a hard deadline');
assert.equal((await extractDocxInWorker(validDocx)).sourceType, 'docx'); pass('a new worker replaces the terminated one for the next document');
await rejectsCode(() => extractDocx(docx(p(''))), 'document_empty'); pass('empty DOCX rejected clearly');
await rejectsCode(() => extractDocx(Buffer.from('PK\x03\x04broken')), 'type_mismatch'); pass('malformed DOCX rejected safely');

const pdfResult = await extractPdf(pdf('TITLE: A readable PDF')); assert.equal(pdfResult.sections[0].page, 1); assert.match(pdfResult.sections[0].text, /TITLE: A readable PDF/); pass('PDF text and page evidence extracted');
const headingPdf = pdf('layout', 'BT /F1 24 Tf 72 730 Td (Obvious Heading) Tj /F1 12 Tf 0 -60 Td (A normal paragraph follows here.) Tj ET');
const headingProposal = buildProposal(await extractPdf(headingPdf)); assert.equal(headingProposal.fields.title.value, 'Obvious Heading'); assert.equal(headingProposal.fields.title.confidence, 'MEDIUM'); pass('obvious large top-of-page PDF heading becomes a review candidate');
const normalPdf = await extractPdf(pdf('layout', 'BT /F1 12 Tf 72 730 Td (First normal line) Tj 0 -30 Td (Second normal line) Tj ET')); assert(!normalPdf.sections.some((section) => section.kind === 'heading')); pass('normal and ambiguous PDF text does not invent a heading');
const multiplePdf = await extractPdf(pdf('layout', 'BT /F1 24 Tf 72 730 Td (Primary Heading) Tj /F1 18 Tf 0 -40 Td (Secondary Heading) Tj /F1 12 Tf 0 -50 Td (Body copy.) Tj ET')); assert.equal(multiplePdf.sections.filter((section) => section.kind === 'heading').length, 2); pass('multiple clear PDF headings remain ordered candidates');
const labeledOverride = buildProposal(await extractPdf(pdf('layout', 'BT /F1 24 Tf 72 730 Td (Visual Heading) Tj /F1 12 Tf 0 -50 Td (TITLE: Explicit Title) Tj ET'))); assert.equal(labeledOverride.fields.title.value, 'Explicit Title'); assert.equal(labeledOverride.fields.title.confidence, 'HIGH'); pass('explicit PDF TITLE overrides a visual heading candidate');
await rejectsCode(() => extractPdf(pdf()), 'ocr_required'); pass('image-only/blank PDF reports OCR required');
await rejectsCode(() => extractPdf(Buffer.from('%PDF-broken')), 'document_unreadable'); pass('malformed PDF rejected safely');

// The HTTP thread stays responsive while PDFs are parsed (a blocked event loop showed up on Render as 502s).
const busyPdf = pdf('layout', `BT /F1 10 Tf 72 780 Td ${Array.from({ length: 1500 }, (_, i) => `(Line ${i} of a long extraction test document with plenty of words) Tj 0 -0.5 Td`).join(' ')} ET`);
let maxGap = 0, last = Date.now();
const ticker = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
const busyResult = await extractPdfInWorker(busyPdf);
clearInterval(ticker);
assert.equal(busyResult.sourceType, 'pdf'); assert(busyResult.sections.some((section) => section.text.includes('Line 1499')));
assert(maxGap < 250, `event loop was blocked for ${maxGap} ms during PDF extraction`);
pass(`PDF extraction runs in the worker; the HTTP thread stayed responsive (longest pause ${maxGap} ms)`);
const parallel = await Promise.all([extractPdfInWorker(pdf('TITLE: One')), extractDocxInWorker(validDocx), extractPdfInWorker(pdf('TITLE: Two'))]);
assert.deepEqual(parallel.map((r) => r.sourceType), ['pdf', 'docx', 'pdf']);
pass('concurrent PDF and DOCX uploads are queued through one worker and all succeed');
const flood = await Promise.allSettled(Array.from({ length: 8 }, () => extractPdfInWorker(pdf('TITLE: Flood'))));
assert(flood.some((r) => r.status === 'fulfilled'));
assert(flood.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason?.code === 'extractor_busy'));
pass('beyond a short queue, extra uploads get a clear "busy" answer instead of piling up');

const fake = (buffer: Buffer, name: string, mimetype: string) => ({ buffer, originalname: name, mimetype } as Express.Multer.File);
assert.equal(validateUploadedDocument(fake(pdf('x'), 'article.pdf', 'application/pdf')), 'pdf');
await rejectsCode(() => validateUploadedDocument(fake(Buffer.from('hello'), 'article.txt', 'text/plain')), 'unsupported_type');
await rejectsCode(() => validateUploadedDocument(fake(validDocx, 'article.pdf', 'application/pdf')), 'type_mismatch'); pass('extension, MIME, and signature validation');

const oversizedClaim = Buffer.from(validDocx); const central = oversizedClaim.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); oversizedClaim.writeUInt32LE(51 * 1024 * 1024, central + 24);
await rejectsCode(() => inspectDocx(oversizedClaim), 'document_limit'); pass('expanded DOCX size claim is bounded');

const app = express();
app.use((req, _res, next) => {
  const role = req.get('x-test-role');
  req.authContext = role ? { authenticated: true, userId: `test-${role}`, userName: role, role: role as 'Admin' | 'Editor' | 'Author', source: 'session' } : { authenticated: false, userId: 'anonymous', userName: 'Anonymous', role: 'Reader', source: 'anonymous' };
  next();
});
app.use('/api/document-import', documentImportRouter(() => ({ resolveSession: async () => null, resolveBypassUser: async () => null })));
const http = createServer(app); http.listen(0, '127.0.0.1'); await once(http, 'listening');
const endpoint = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/document-import/extract`;
const uploadAs = async (role?: string, document = pdf('Authorized extraction'), name = 'article.pdf', type = 'application/pdf') => { const form = new FormData(); form.append('file', new Blob([new Uint8Array(document)], { type }), name); return fetch(endpoint, { method: 'POST', headers: role ? { 'x-test-role': role } : {}, body: form }); };
try {
  assert.equal((await uploadAs('Admin')).status, 200); assert.equal((await uploadAs('Editor')).status, 200); pass('Admin and Editor can use the extraction endpoint');
  assert.equal((await uploadAs('Editor', validDocx, 'article.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).status, 200); pass('DOCX endpoint uses the isolated worker without changing its API contract');
  assert.equal((await uploadAs('Author')).status, 403); assert.equal((await uploadAs()).status, 401); pass('Author and anonymous extraction requests are rejected');
  let limited = 0;
  for (let index = 0; index < 20; index++) { const response = await fetch(endpoint, { method: 'POST', headers: { 'x-test-role': 'Admin' } }); if (response.status === 429) limited++; }
  assert(limited >= 1); pass('shared source extraction limiter returns 429 after the per-user allowance');
} finally { await new Promise<void>((resolve) => http.close(() => resolve())); }

console.log(`Document import verification passed: ${checks} checks.`);
