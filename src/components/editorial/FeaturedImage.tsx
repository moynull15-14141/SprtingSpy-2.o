'use client';

import React, { useState } from 'react';

/** Article featured image; the whole figure is removed if the image fails to load. */
export function FeaturedImage({ src, alt, caption = 'SportingSpy Editorial Archive', credit = 'Verified Sports Photography' }: { src: string; alt: string; caption?: string; credit?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900">
      <img src={src} alt={alt} onError={() => setFailed(true)} className="w-full aspect-video object-cover" loading="eager" />
      {(caption || credit) && <figcaption className="p-2.5 text-[11px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-950/80 border-t border-stone-200 dark:border-stone-800 italic flex flex-wrap justify-between gap-2 break-words">
        <span>{caption}</span>
        <span className="font-mono text-[10px]">{credit}</span>
      </figcaption>}
    </figure>
  );
}
