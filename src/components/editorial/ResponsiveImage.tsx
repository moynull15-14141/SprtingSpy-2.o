/**
 * Responsive image delivery (PHASE C). Renders <picture> with AVIF/WebP
 * srcsets and a universally supported fallback <img>. Width/height are set
 * from the stored dimensions so the browser reserves space (no layout shift).
 * Pure markup: works in server components and with JavaScript disabled.
 */

import React from 'react';
import type { MediaAsset } from '../../lib/media';

export function ResponsiveImage({
  asset,
  alt,
  sizes,
  className,
  loading = 'lazy',
  priority = false,
}: {
  asset: MediaAsset;
  alt?: string;
  sizes: string;
  className?: string;
  loading?: 'eager' | 'lazy';
  priority?: boolean;
}) {
  return (
    <picture>
      {asset.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img
        src={asset.url}
        alt={alt ?? asset.alt}
        width={asset.width ?? undefined}
        height={asset.height ?? undefined}
        loading={priority ? 'eager' : loading}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : {})}
        className={className}
      />
    </picture>
  );
}
