'use client';

/**
 * A compact filter control for CMS toolbars: an icon button that shows the
 * current filter as a tooltip on hover/focus and opens a list of options on
 * click. An amber dot marks an active (non-default) filter.
 * Keyboard: Enter/Space/ArrowDown opens, ↑/↓ move, Enter selects, Escape closes.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, type LucideIcon } from 'lucide-react';

export interface FilterOption { value: string; label: string }

export function IconFilterMenu({ icon: Icon, label, value, options, onChange }: {
  icon: LucideIcon;
  /** What the filter is, e.g. "Creation type" (used for the accessible name). */
  label: string;
  value: string;
  /** The first option is the default ("all") state. */
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const filtered = value !== options[0]?.value;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openMenu = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const choose = (v: string) => { onChange(v); setOpen(false); button.current?.focus(); };

  return (
    <div ref={root} className="group/filter relative">
      <button
        ref={button}
        type="button"
        aria-label={`${label}: ${current.label}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openMenu(); return; }
          if (!open) return;
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
          else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[active].value); }
        }}
        className={`relative inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          filtered || open
            ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
            : 'border-stone-300 text-stone-600 hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800'
        }`}
      >
        <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
        {filtered && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-[#121417]" />}
      </button>

      {!open && (
        <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md bg-stone-950 px-2 py-1.5 text-[11px] font-medium text-white shadow-lg group-hover/filter:block group-has-[:focus-visible]/filter:block dark:bg-stone-100 dark:text-stone-950">
          {current.label}
        </span>
      )}

      {open && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-opt-${active}`}
          className="absolute left-0 top-full z-40 mt-2 max-h-72 min-w-52 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 text-sm shadow-xl dark:border-stone-700 dark:bg-[#121417]"
        >
          <li className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400" role="presentation">{label}</li>
          {options.map((o, i) => (
            <li
              key={o.value || '__all'}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); choose(o.value); }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 ${i === active ? 'bg-stone-100 dark:bg-stone-800' : ''} ${o.value === value ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-stone-700 dark:text-stone-200'}`}
            >
              {o.label}
              {o.value === value && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
