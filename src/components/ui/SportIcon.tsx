import React from 'react';
import { resolveSportIcon } from '../../config/sportIcons';

/**
 * A sport's icon in a small, fixed-size rounded badge (decorative; the sport
 * name is always shown next to it). Shows the custom icon image when one is set
 * (iconImage), otherwise the icon chosen in the CMS or the best name suggestion.
 */
export function SportIcon({ slug, name, icon, iconImage, size = 'md' }: { slug: string; name?: string; icon?: string | null; iconImage?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'h-6 w-6 rounded-lg text-[13px]' : size === 'lg' ? 'h-10 w-10 rounded-xl text-[22px]' : 'h-7 w-7 rounded-lg text-[15px]';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center overflow-hidden bg-stone-100 leading-none ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700 ${box}`}>
      {iconImage
        ? <img src={iconImage} alt="" className="h-full w-full object-contain" loading="lazy" />
        : resolveSportIcon({ slug, name, icon })}
    </span>
  );
}

/**
 * A group's small inline icon (no badge): a custom image when set, otherwise its
 * chosen emoji, otherwise nothing (groups may have no icon).
 */
export function GroupGlyph({ icon, iconImage, className = '' }: { icon?: string | null; iconImage?: string | null; className?: string }) {
  if (iconImage) return <img src={iconImage} alt="" className={`inline-block h-4 w-4 rounded object-contain align-[-2px] ${className}`} loading="lazy" />;
  if (icon) return <span aria-hidden="true" className={className}>{icon}</span>;
  return null;
}
