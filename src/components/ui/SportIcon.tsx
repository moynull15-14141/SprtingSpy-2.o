import React from 'react';
import { resolveSportIcon } from '../../config/sportIcons';

/**
 * A sport's icon in a small, fixed-size rounded badge (decorative; the sport
 * name is always shown next to it). Uses the icon chosen in the CMS, or the
 * best suggestion for the sport's name.
 */
export function SportIcon({ slug, name, icon, size = 'md' }: { slug: string; name?: string; icon?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-lg text-[13px]' : size === 'lg' ? 'h-10 w-10 rounded-xl text-[22px]' : 'h-7 w-7 rounded-lg text-[15px]';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center bg-stone-100 leading-none ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700 ${box}`}>
      {resolveSportIcon({ slug, name, icon })}
    </span>
  );
}
