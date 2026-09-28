'use client';

/**
 * Search filters: a sidebar on desktop, a bottom sheet on small screens.
 * The filter controls themselves are server-rendered children.
 */

import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';

export function FilterDrawer({ activeCount, children }: { activeCount: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  // Keyboard users land in the sheet when it opens and back on the Filters
  // button when it closes.
  useEffect(() => {
    if (open) closeButton.current?.focus();
    else if (wasOpen.current) trigger.current?.focus();
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-controls="search-filters"
        className="inline-flex items-center gap-2 rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:text-stone-200 lg:hidden"
      >
        <SlidersHorizontal size={16} aria-hidden="true" /> Filters{activeCount ? ` (${activeCount})` : ''}
      </button>
      {open && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" aria-hidden="true" onClick={() => setOpen(false)} />}
      <aside
        id="search-filters"
        aria-label="Search filters"
        role={open ? 'dialog' : undefined}
        aria-modal={open ? true : undefined}
        className={`${open ? 'fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl p-5 shadow-2xl' : 'hidden'} border-stone-200 bg-white dark:border-stone-800 dark:bg-[#121417] lg:static lg:block lg:max-h-none lg:rounded-2xl lg:border lg:p-4 lg:shadow-none`}
      >
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <h2 className="font-serif text-lg font-bold">Filters</h2>
          <button ref={closeButton} type="button" aria-label="Close filters" onClick={() => setOpen(false)} className="rounded-md p-1.5 hover:bg-stone-100 dark:hover:bg-stone-800"><X size={18} /></button>
        </div>
        {children}
      </aside>
    </>
  );
}
