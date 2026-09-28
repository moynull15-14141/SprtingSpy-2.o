import React from 'react';

/**
 * A person's round avatar. With no image URL it shows their initials instead
 * of rendering <img src="">, which browsers treat as a request for the page.
 */
export function Avatar({ src, name, className = '' }: { src?: string | null; name: string; className?: string }) {
  if (src) return <img src={src} alt={name} className={className} />;
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
  return (
    <span role="img" aria-label={name} className={`${className} inline-flex select-none items-center justify-center bg-stone-200 text-[10px] font-semibold leading-none text-stone-700 dark:bg-stone-700 dark:text-stone-100`}>
      {initials}
    </span>
  );
}
