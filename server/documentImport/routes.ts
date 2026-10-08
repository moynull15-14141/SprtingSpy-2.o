import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'node:path';
import { requireRole, type AuthLookup } from '../auth';
import { createRateLimiter } from '../rateLimit';
import { extractPdf } from './extractPdf';
import { inspectDocx } from './extractDocx';
import { extractDocxInWorker } from './extractDocxWorker';
import { buildProposal } from './normalize';
import { extractManualText } from './extractText';
import { DocumentImportError, type DocumentSourceType } from './types';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const PDF_MIMES = new Set(['application/pdf']);
const DOCX_MIMES = new Set(['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/octet-stream']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0, parts: 2 } });
const limiter = createRateLimiter(60_000, 20);

async function withExtractionTimeout<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new DocumentImportError('Document extraction timed out.', 422, 'document_timeout')), 15_000); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function validateUploadedDocument(file: Express.Multer.File): DocumentSourceType {
  const ext = path.extname(path.basename(file.originalname)).toLowerCase();
  if (ext === '.pdf') {
    if (!PDF_MIMES.has(file.mimetype.toLowerCase()) || file.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new DocumentImportError('The PDF extension, MIME type, and signature must agree.', 415, 'type_mismatch');
    return 'pdf';
  }
  if (ext === '.docx') {
    if (!DOCX_MIMES.has(file.mimetype.toLowerCase())) throw new DocumentImportError('The DOCX extension and MIME type must agree.', 415, 'type_mismatch');
    inspectDocx(file.buffer);
    return 'docx';
  }
  throw new DocumentImportError('Only PDF and DOCX documents are supported.', 415, 'unsupported_type');
}

export function documentImportRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  router.post('/extract', requireRole(getLookup, ['Admin', 'Editor']), (req, res, next) => {
    const rate = limiter.check(req.authContext!.userId);
    if (rate.limited) { res.setHeader('Retry-After', String(rate.retryAfterSeconds)); return res.status(429).json({ error: 'Too many extraction requests. Try again shortly.' }); }
    limiter.record(req.authContext!.userId);
    upload.single('file')(req, res, (uploadError: unknown) => {
      if (uploadError instanceof multer.MulterError) return res.status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: uploadError.code === 'LIMIT_FILE_SIZE' ? `The document is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.` : 'Invalid document upload.' });
      if (uploadError) return next(uploadError);
      void (async () => {
        if (!req.file) throw new DocumentImportError('Choose a PDF or DOCX document.', 400, 'file_required');
        if (!req.file.buffer.length) throw new DocumentImportError('The document is empty.', 422, 'document_empty');
        const type = validateUploadedDocument(req.file);
        const extraction = type === 'pdf'
          ? await withExtractionTimeout(extractPdf(req.file.buffer))
          : await extractDocxInWorker(req.file.buffer);
        return res.json(buildProposal(extraction));
      })().catch((error) => error instanceof DocumentImportError ? res.status(error.status).json({ error: error.message, code: error.code }) : next(error));
    });
  });
  router.post('/extract-text', requireRole(getLookup, ['Admin', 'Editor']), (req, res) => {
    const rate = limiter.check(req.authContext!.userId);
    if (rate.limited) { res.setHeader('Retry-After', String(rate.retryAfterSeconds)); return res.status(429).json({ error: 'Too many extraction requests. Try again shortly.' }); }
    limiter.record(req.authContext!.userId);
    try {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).some((key) => key !== 'text')) throw new DocumentImportError('Send manual source text as { text }.', 400, 'text_invalid');
      return res.json(buildProposal(extractManualText((req.body as { text?: unknown }).text)));
    } catch (error) {
      if (error instanceof DocumentImportError) return res.status(error.status).json({ error: error.message, code: error.code });
      throw error;
    }
  });
  return router;
}
