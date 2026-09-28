'use client';

import React, { useState } from 'react';

/** An <img> that swaps to a text fallback if the image fails to load. */
export function CardImage({ src, alt, className, loading, fallback }: {
  src?: string;
  alt: string;
  className: string;
  loading: 'eager' | 'lazy';
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <>{fallback}</>;
  return <img src={src} alt={alt} onError={() => setFailed(true)} className={className} loading={loading} />;
}
