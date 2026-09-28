'use client';

import React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * A <select> bound to one URL query parameter. Changing it navigates to the
 * same page with the updated query (pagination resets); the server renders
 * the filtered result.
 */
export function FilterSelect({ param, value, className, children, clear = [], label }: {
  param: string;
  value: string;
  className: string;
  children: React.ReactNode;
  /** Other parameters that no longer apply once this one changes. */
  clear?: string[];
  /** Accessible name when the select has no visible <label>. */
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      name={param}
      aria-label={label}
      value={value}
      className={className}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams?.toString());
        if (e.target.value) next.set(param, e.target.value);
        else next.delete(param);
        next.delete('page');
        clear.forEach((key) => next.delete(key));
        const query = next.toString();
        router.push(`${pathname}${query ? `?${query}` : ''}`);
      }}
    >
      {children}
    </select>
  );
}
