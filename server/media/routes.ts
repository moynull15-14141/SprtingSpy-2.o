/**
 * Media Library API (PHASE C). Mounted at /api/media behind the global
 * security, CORS and CSRF middleware; every route also requires a staff role.
 *
 *   POST   /api/media/upload   multipart upload (Admin, Editor, Author)
 *   POST   /api/media          register an external/URL image (Admin, Editor, Author)
 *   PUT    /api/media/:id      edit metadata / copyright review (Admin, Editor)
 *   DELETE /api/media/:id      delete if unused (Admin)
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { prisma } from '../db';
import { requireRole, type AuthLookup } from '../auth';
import { firstError, validateOneOf, validateSafeUrl, validateText } from '../validation';
import { MAX_UPLOAD_BYTES, UploadRejected } from './processing';
import { COPYRIGHT_REVIEW_STATES, createMediaFromUpload, deleteMedia } from './service';

export const MEDIA_CREATION_TYPES = ['Original', 'AI-created', 'AI-assisted', 'Licensed', 'Official Source', 'Creative Commons', 'Other'] as const;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 20, fieldSize: 5000, parts: 25 },
});

function metadataErrors(body: Record<string, unknown>, requireTitle: boolean) {
  return firstError(
    validateText(body.title, 'title', 200, requireTitle),
    validateText(body.altText, 'altText', 300, false),
    validateText(body.caption, 'caption', 500, false),
    validateText(body.credit, 'credit', 200, false),
    validateText(body.source, 'source', 200, false),
    validateText(body.license, 'license', 500, false),
    validateOneOf(body.creationType, 'creationType', MEDIA_CREATION_TYPES),
    validateText(body.aiTool, 'aiTool', 120, false),
    validateText(body.humanEditing, 'humanEditing', 1000, false)
  );
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined);

export function mediaRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
  const audit = (req: Request, action: string, entityId: string, details: string) =>
    prisma.auditLog.create({
      data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action, entityType: 'Setting', entityId, timestamp: new Date(), details },
    });

  router.post('/upload', requireRole(getLookup, ['Admin', 'Editor', 'Author']), (req, res, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).json({ error: status === 413 ? `The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` : 'Invalid upload request.' });
      }
      if (err) return next(err);
      wrap(async () => {
        if (!req.file) return res.status(400).json({ error: 'Choose an image file to upload.' });
        const body = req.body as Record<string, unknown>;
        const error = metadataErrors(body, true);
        if (error) return res.status(400).json({ error });
        try {
          const item = await createMediaFromUpload(req.file, {
            title: str(body.title)!,
            altText: str(body.altText),
            caption: str(body.caption),
            credit: str(body.credit),
            source: str(body.source),
            license: str(body.license),
            creationType: str(body.creationType),
            aiTool: str(body.aiTool),
            humanEditing: str(body.humanEditing),
          });
          await audit(req, 'Uploaded Media Asset', item.id, `Uploaded ${item.mimeType} ${item.width}x${item.height} "${item.title}".`);
          return res.status(201).json(item);
        } catch (e) {
          if (e instanceof UploadRejected) return res.status(e.status).json({ error: e.message });
          throw e;
        }
      })(req, res, next);
    });
  });

  // Registers an image by URL (external/official sources, legacy entries).
  router.post('/', requireRole(getLookup, ['Admin', 'Editor', 'Author']), wrap(async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const error = metadataErrors(body, true) || firstError(validateSafeUrl(body.url, 'url'));
    if (error) return res.status(400).json({ error });
    const item = await prisma.mediaItem.create({
      data: {
        id: `media-${crypto.randomUUID()}`,
        title: str(body.title)!,
        url: str(body.url)!,
        altText: str(body.altText) || '',
        caption: str(body.caption) || null,
        credit: str(body.credit) || null,
        source: str(body.source) || null,
        license: str(body.license) || null,
        creationType: str(body.creationType) || 'Original',
        aiTool: str(body.aiTool) || null,
        humanEditing: str(body.humanEditing) || null,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await audit(req, 'Registered Media Asset', item.id, `Registered media by URL: ${item.title}.`);
    return res.status(201).json(item);
  }));

  router.put('/:id', requireRole(getLookup, ['Admin', 'Editor']), wrap(async (req, res) => {
    const existing = await prisma.mediaItem.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Media item not found.' });
    const body = req.body as Record<string, unknown>;
    const error =
      metadataErrors(body, false) ||
      firstError(
        body.copyrightReview !== undefined ? validateOneOf(body.copyrightReview, 'copyrightReview', COPYRIGHT_REVIEW_STATES, true) : { valid: true },
        // A stored file's URL is derived from its storage key; only URL-only items may change it.
        body.url !== undefined ? (existing.storageKey ? { valid: false, error: 'The URL of an uploaded file cannot be changed.' } : validateSafeUrl(body.url, 'url')) : { valid: true }
      );
    if (error) return res.status(400).json({ error });
    const editable = ['title', 'url', 'altText', 'caption', 'credit', 'source', 'license', 'creationType', 'aiTool', 'humanEditing', 'copyrightReview'] as const;
    const data: Record<string, string | null> = {};
    for (const field of editable) if (body[field] !== undefined) data[field] = str(body[field]) || (field === 'altText' ? '' : field === 'title' ? existing.title : null);
    // A save that changes nothing leaves the row (and its updatedAt) untouched.
    const changedFields = Object.keys(data).filter((field) => data[field] !== (existing as Record<string, unknown>)[field]);
    if (!changedFields.length) return res.json(existing);
    for (const field of Object.keys(data)) if (!changedFields.includes(field)) delete data[field];
    const updated = await prisma.mediaItem.update({ where: { id: existing.id }, data: { ...data, updatedAt: new Date() } });
    const reviewNote = data.copyrightReview && data.copyrightReview !== existing.copyrightReview ? ` Copyright review: ${existing.copyrightReview} -> ${data.copyrightReview}.` : '';
    await audit(req, 'Updated Media Metadata', updated.id, `Updated media item: ${updated.title}.${reviewNote}`);
    return res.json(updated);
  }));

  router.delete('/:id', requireRole(getLookup, ['Admin']), wrap(async (req, res) => {
    const result = await deleteMedia(req.params.id);
    if (!result.ok) { const failure = result as { status: number; error: string }; return res.status(failure.status).json({ error: failure.error }); }
    await audit(req, 'Deleted Media Asset', req.params.id, `Deleted media item ${req.params.id} and its stored files.`);
    return res.json({ success: true, id: req.params.id });
  }));

  return router;
}
