import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffprobe from '@ffprobe-installer/ffprobe';
import { prisma } from './db';
import { requireRole, type AuthLookup } from './auth';
import { mediaStorage } from './media/storage';
import { mediaUrl } from '../src/lib/media';
import { processUpload, UploadRejected } from './media/processing';

export const MAX_AD_BYTES = 25 * 1024 * 1024;
const probe = promisify(execFile);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_AD_BYTES, files: 1, fields: 2, fieldSize: 500, parts: 4 } });

export async function processAdCreative(file: { buffer: Buffer; originalname: string; mimetype: string }) {
  const { buffer: data, originalname, mimetype } = file;
  if (!data.length) throw new UploadRejected('Choose a non-empty file.');
  if (data.length > MAX_AD_BYTES) throw new UploadRejected('Ad media must be 25 MB or smaller.', 413);
  const ext = path.extname(originalname).toLowerCase();
  if (ext === '.gif') {
    if (mimetype !== 'image/gif' || !['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))) throw new UploadRejected('Invalid GIF image.', 415);
    try {
      const image = sharp(data, { animated: true, limitInputPixels: 50_000_000, failOn: 'error' });
      const meta = await image.metadata();
      const width = meta.width || 0, height = meta.pageHeight || meta.height || 0;
      if (width < 16 || height < 16 || width > 4096 || height > 4096 || (meta.pages || 1) > 300 || width * height * (meta.pages || 1) > 50_000_000) throw new UploadRejected('GIF must be 16–4096 px with at most 300 frames and 50 million total pixels.');
      const output = await image.gif().toBuffer();
      return { data: output, ext: 'gif', mimeType: 'image/gif', kind: 'image', width, height, durationSeconds: null };
    } catch (e) { if (e instanceof UploadRejected) throw e; throw new UploadRejected('The GIF could not be decoded.', 415); }
  }
  if (ext === '.mp4' || ext === '.webm') {
    const mp4 = ext === '.mp4';
    if (mimetype !== (mp4 ? 'video/mp4' : 'video/webm') || (mp4 ? data.toString('ascii', 4, 8) !== 'ftyp' : !data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])))) throw new UploadRejected('The video extension, type and content must match.', 415);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sportingspy-ad-'));
    const input = path.join(folder, `input${ext}`);
    try {
      await fs.writeFile(input, data);
      const { stdout } = await probe(ffprobe.path, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-select_streams', 'v:0', '-show_entries', 'format=format_name,duration:stream=codec_name,width,height,duration:packet=pts_time,duration_time', '-show_packets', '-of', 'json', input], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
      const result = JSON.parse(stdout);
      const stream = result.streams?.[0];
      const packets = result.packets || [];
      const end = Math.max(0, ...packets.map((p: { pts_time?: string; duration_time?: string }) => (Number(p.pts_time) || 0) + (Number(p.duration_time) || 0)));
      const durationSeconds = Math.max(Number(result.format?.duration) || 0, Number(stream?.duration) || 0, end);
      const container = String(result.format?.format_name || '');
      if (!stream || !packets.length || !(mp4 ? container.includes('mp4') && stream.codec_name === 'h264' : container.includes('webm') && ['vp8', 'vp9', 'av1'].includes(stream.codec_name))) throw new UploadRejected('Use H.264 MP4 or VP8/VP9/AV1 WebM video.', 415);
      if (durationSeconds <= 0 || durationSeconds > 60.5 || stream.width < 16 || stream.height < 16 || stream.width > 3840 || stream.height > 3840) throw new UploadRejected('Short video must be at most 60 seconds and 3840 px.');
      return { data, ext: mp4 ? 'mp4' : 'webm', mimeType: mp4 ? 'video/mp4' : 'video/webm', kind: 'video', width: stream.width as number, height: stream.height as number, durationSeconds };
    } catch (e) { if (e instanceof UploadRejected) throw e; throw new UploadRejected('The video could not be read. Use a valid MP4 or WebM file.', 415); }
    finally { await fs.unlink(input).catch(() => {}); await fs.rmdir(folder).catch(() => {}); }
  }
  const image = await processUpload(data, originalname, mimetype);
  return { data: image.original, ext: image.ext, mimeType: image.mime, kind: 'image', width: image.width, height: image.height, durationSeconds: null };
}

export function adCreativesRouter(getLookup: () => AuthLookup) {
  const router = express.Router();
  router.use(requireRole(getLookup, ['Admin']));
  const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
  router.get('/', wrap(async (_req, res) => res.json(await prisma.adCreative.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { _count: { select: { slots: true } } } }))));
  router.post('/', (req, res, next) => upload.single('file')(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'Choose one file, at most 25 MB.' });
    if (error) return next(error);
    wrap(async () => {
      if (!req.file) return res.status(400).json({ error: 'Choose an image, GIF or short video.' });
      let key: string | undefined;
      try {
        const creative = await processAdCreative(req.file);
        const now = new Date();
        key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}/ad.${creative.ext}`;
        await mediaStorage().put(key, creative.data, creative.mimeType);
        const title = path.basename(req.file.originalname).replace(/[^\w.\- ()]/g, '_').slice(0, 200) || 'Ad media';
        const item = await prisma.$transaction(async tx => {
          const item = await tx.adCreative.create({ data: { id: `ad-${crypto.randomUUID()}`, title, storageKey: key!, url: mediaUrl(key!), kind: creative.kind, mimeType: creative.mimeType, width: creative.width, height: creative.height, durationSeconds: creative.durationSeconds, sizeBytes: creative.data.length } });
          await tx.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Uploaded Ad Media', entityType: 'Setting', entityId: item.id, timestamp: now, details: `Uploaded ${item.mimeType} ${item.width}x${item.height}.` } });
          return item;
        });
        return res.status(201).json(item);
      } catch (e) { if (key) await mediaStorage().delete(key).catch(() => {}); if (e instanceof UploadRejected) return res.status(e.status).json({ error: e.message }); throw e; }
    })(req, res, next);
  }));
  router.delete('/:id', wrap(async (req, res) => {
    const item = await prisma.adCreative.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: 'Ad media not found.' });
    try { await prisma.adCreative.delete({ where: { id: item.id } }); }
    catch (e) { if ((e as { code?: string }).code === 'P2003') return res.status(409).json({ error: 'Remove this media from its ad slots before deleting it.' }); throw e; }
    await mediaStorage().delete(item.storageKey);
    await prisma.auditLog.create({ data: { id: `log-${crypto.randomUUID()}`, userId: req.authContext!.userId, userName: req.authContext!.userName, action: 'Deleted Ad Media', entityType: 'Setting', entityId: item.id, timestamp: new Date(), details: 'Deleted unused ad media.' } });
    return res.json({ success: true });
  }));
  return router;
}
