/**
 * Upload validation + image processing (PHASE C), using sharp.
 *
 * Validation never trusts the browser: the declared MIME type, the file
 * extension and the file's magic bytes must all agree with the format sharp
 * actually decodes. Only raster JPEG/PNG/WebP/AVIF are accepted (no SVG, no
 * animated images), within size and pixel limits.
 *
 * Output per upload (all metadata such as EXIF/GPS stripped, orientation applied):
 *   original  — same format, long edge capped at 2560px (the fallback <img>)
 *   variants  — 400 / 800 / 1600px wide (never upscaled) in AVIF and WebP
 */

import sharp, { type Metadata, type Sharp } from 'sharp';
import type { MediaFormat } from '../../src/lib/media';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_DIMENSION = 12000;
export const MIN_DIMENSION = 16;
const MAX_PIXELS = 50_000_000;
const ORIGINAL_MAX_EDGE = 2560;
export const VARIANT_WIDTHS = [400, 800, 1600];

type InputFormat = 'jpeg' | 'png' | 'webp' | 'avif';

const FORMAT_RULES: Record<InputFormat, { mimes: string[]; exts: string[]; ext: string; mime: string }> = {
  jpeg: { mimes: ['image/jpeg', 'image/jpg', 'image/pjpeg'], exts: ['jpg', 'jpeg'], ext: 'jpg', mime: 'image/jpeg' },
  png: { mimes: ['image/png'], exts: ['png'], ext: 'png', mime: 'image/png' },
  webp: { mimes: ['image/webp'], exts: ['webp'], ext: 'webp', mime: 'image/webp' },
  avif: { mimes: ['image/avif'], exts: ['avif'], ext: 'avif', mime: 'image/avif' },
};

export class UploadRejected extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Format from the file's leading bytes (magic numbers), independent of name/MIME. */
export function sniffFormat(buf: Buffer): InputFormat | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(buf.toString('ascii', 8, 12))) return 'avif';
  return null;
}

export interface ProcessedImage {
  format: InputFormat;
  mime: string;
  ext: string;
  width: number;
  height: number;
  original: Buffer;
  variants: { width: number; height: number; format: MediaFormat; ext: string; data: Buffer }[];
}

export async function processUpload(data: Buffer, originalName: string, declaredMime: string): Promise<ProcessedImage> {
  if (!data.length) throw new UploadRejected('The file is empty.');
  if (data.length > MAX_UPLOAD_BYTES) throw new UploadRejected(`The file is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`, 413);

  const format = sniffFormat(data);
  if (!format) throw new UploadRejected('Unsupported file type. Upload a JPEG, PNG, WebP or AVIF image.', 415);
  const rules = FORMAT_RULES[format];
  const ext = (originalName.match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase();
  if (!rules.exts.includes(ext)) throw new UploadRejected(`The file extension ".${ext || '?'}" does not match its ${format.toUpperCase()} content.`, 415);
  if (!rules.mimes.includes((declaredMime || '').toLowerCase())) throw new UploadRejected(`The declared type "${declaredMime}" does not match its ${format.toUpperCase()} content.`, 415);

  let meta: Metadata;
  try {
    meta = await sharp(data, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).metadata();
  } catch {
    throw new UploadRejected('The image could not be decoded (corrupt or unsupported).', 415);
  }
  const decoded = meta.format === 'heif' ? (meta.compression === 'av1' ? 'avif' : null) : meta.format;
  if (decoded !== format) throw new UploadRejected('The image content does not match its declared format.', 415);
  if ((meta.pages || 1) > 1) throw new UploadRejected('Animated images are not supported.', 415);

  // Orientation-corrected dimensions.
  const rotated = (meta.orientation || 1) >= 5;
  const width = rotated ? meta.height! : meta.width!;
  const height = rotated ? meta.width! : meta.height!;
  if (!width || !height || width < MIN_DIMENSION || height < MIN_DIMENSION) throw new UploadRejected(`The image must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`);
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) throw new UploadRejected(`The image must be at most ${MAX_DIMENSION}×${MAX_DIMENSION} pixels.`);

  const base = () => sharp(data, { limitInputPixels: MAX_PIXELS, failOn: 'error' }).rotate();
  const encode = (img: Sharp, f: InputFormat | 'webp' | 'avif') => {
    if (f === 'jpeg') return img.jpeg({ quality: 82, mozjpeg: true });
    if (f === 'png') return img.png({ compressionLevel: 9 });
    if (f === 'webp') return img.webp({ quality: 78 });
    return img.avif({ quality: 50, effort: 4 });
  };

  const originalResult = await encode(base().resize({ width: ORIGINAL_MAX_EDGE, height: ORIGINAL_MAX_EDGE, fit: 'inside', withoutEnlargement: true }), format).toBuffer({ resolveWithObject: true });

  const widths = VARIANT_WIDTHS.filter((w) => w < originalResult.info.width);
  if (!widths.length || widths[widths.length - 1] < originalResult.info.width) widths.push(originalResult.info.width);
  const variants: ProcessedImage['variants'] = [];
  for (const w of [...new Set(widths)].slice(0, 4)) {
    for (const f of ['avif', 'webp'] as const) {
      const out = await encode(base().resize({ width: w, withoutEnlargement: true }), f).toBuffer({ resolveWithObject: true });
      variants.push({ width: out.info.width, height: out.info.height, format: f, ext: f, data: out.data });
    }
  }

  return {
    format,
    mime: rules.mime,
    ext: rules.ext,
    width: originalResult.info.width,
    height: originalResult.info.height,
    original: originalResult.data,
    variants,
  };
}
