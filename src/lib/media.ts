/**
 * Media delivery helpers (PHASE C), shared by the server and renderers.
 * Stored files are addressed by an opaque storage key; the public URL is
 * derived here so a CDN/bucket base can be introduced via configuration
 * (MEDIA_PUBLIC_BASE_URL) without rewriting stored data.
 */

export type MediaFormat = 'avif' | 'webp' | 'jpeg' | 'png';

export interface MediaVariant {
  width: number;
  height: number;
  format: MediaFormat;
  key: string;
  bytes: number;
}

/** What a renderer needs to deliver one image responsively. */
export interface MediaAsset {
  id: string;
  /** Fallback URL (processed original, or the legacy URL). */
  url: string;
  width: number | null;
  height: number | null;
  alt: string;
  caption?: string | null;
  credit?: string | null;
  /** Responsive sources, grouped by modern format. */
  sources: { type: 'image/avif' | 'image/webp'; srcSet: string }[];
}

export const MEDIA_ROUTE_PREFIX = '/media/';

export function mediaUrl(key: string): string {
  const base = (process.env.MEDIA_PUBLIC_BASE_URL || '/media').replace(/\/+$/, '');
  return `${base}/${key}`;
}

/** Builds a deliverable asset from a MediaItem row (processed or legacy). */
export function toMediaAsset(row: {
  id: string;
  url: string;
  storageKey?: string | null;
  width?: number | null;
  height?: number | null;
  altText: string;
  caption?: string | null;
  credit?: string | null;
  variants?: unknown;
}): MediaAsset {
  const variants = Array.isArray(row.variants) ? (row.variants as MediaVariant[]) : [];
  const sources = (['avif', 'webp'] as const)
    .map((format) => ({
      type: `image/${format}` as const,
      srcSet: variants
        .filter((v) => v.format === format)
        .sort((a, b) => a.width - b.width)
        .map((v) => `${mediaUrl(v.key)} ${v.width}w`)
        .join(', '),
    }))
    .filter((s) => s.srcSet);
  return {
    id: row.id,
    url: row.storageKey ? mediaUrl(row.storageKey) : row.url,
    width: row.width ?? null,
    height: row.height ?? null,
    alt: row.altText,
    caption: row.caption,
    credit: row.credit,
    sources,
  };
}
