'use client';

/**
 * Chooses a Sport, or one Group of a sport, from one tree-shaped dropdown:
 *
 *   American Football   ▾
 *     └ NFL2
 *   Athletics           ▸
 *
 * A sport's groups open beneath it when the pointer moves onto it, or with the
 * ▸ toggle (touch) / → key. Choosing a sport gives (sport, ''); choosing a
 * group gives (its sport, group). Groups follow the same selectable rule as
 * the rest of the CMS (active ones, plus the current one even if retired).
 * Keyboard: ↑/↓ move, →/← open/close a sport, Enter selects, Escape closes.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Lock } from 'lucide-react';
import type { Discipline } from '../../types';
import { selectableDisciplines } from './DisciplineManager';

type Item =
  | { kind: 'empty'; key: string }
  | { kind: 'sport'; key: string; sportSlug: string; name: string; groups: Discipline[] }
  | { kind: 'group'; key: string; sportSlug: string; group: Discipline; locked: boolean };

export function SportGroupPicker({ id, label, sports, groups, sportSlug, groupSlug, onChange, emptyLabel, lockedGroupSlug, className = '' }: {
  id?: string;
  /** Accessible name, e.g. "Sport and group". */
  label: string;
  sports: { id: string; slug: string; name: string }[];
  groups: Discipline[];
  sportSlug: string;
  groupSlug: string;
  onChange: (sportSlug: string, groupSlug: string) => void;
  /** When set, an extra first entry with this label means "no sport" (filters). */
  emptyLabel?: string;
  /** The group comes from elsewhere (the article's event): the sport's other groups cannot be chosen. */
  lockedGroupSlug?: string;
  className?: string;
}) {
  const autoId = useId();
  const baseId = id ?? autoId;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const groupsOf = (slug: string) => selectableDisciplines(groups, slug, slug === sportSlug ? groupSlug || lockedGroupSlug : undefined);
  const items: Item[] = [];
  if (emptyLabel !== undefined) items.push({ kind: 'empty', key: '__empty' });
  for (const s of sports) {
    const own = groupsOf(s.slug);
    items.push({ kind: 'sport', key: s.slug, sportSlug: s.slug, name: s.name, groups: own });
    if (own.length && expanded.has(s.slug)) {
      for (const g of own) items.push({ kind: 'group', key: `${s.slug}/${g.slug}`, sportSlug: s.slug, group: g, locked: !!lockedGroupSlug && s.slug === sportSlug && g.slug !== lockedGroupSlug });
    }
  }

  const currentSport = sports.find((s) => s.slug === sportSlug);
  const currentGroup = groupSlug ? groups.find((g) => g.sportSlug === sportSlug && g.slug === groupSlug) : undefined;
  const selectedKey = !sportSlug ? '__empty' : groupSlug ? `${sportSlug}/${groupSlug}` : sportSlug;
  const display = !sportSlug ? (emptyLabel ?? 'Choose a sport') : `${currentSport?.name ?? sportSlug}${groupSlug ? ` › ${currentGroup?.name ?? groupSlug}` : ''}`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openMenu = () => {
    // The chosen sport starts open so its groups are visible at once.
    const start = new Set<string>(sportSlug && groupsOf(sportSlug).length ? [sportSlug] : []);
    setExpanded(start);
    setOpen(true);
    // Index of the selection in the list as it will render with `start` open.
    let i = emptyLabel !== undefined ? 1 : 0;
    let found = emptyLabel !== undefined && !sportSlug ? 0 : -1;
    for (const s of sports) {
      if (found < 0 && s.slug === sportSlug && !groupSlug) found = i;
      i++;
      if (start.has(s.slug)) for (const g of groupsOf(s.slug)) { if (found < 0 && s.slug === sportSlug && g.slug === groupSlug) found = i; i++; }
    }
    setActive(Math.max(0, found));
  };
  const close = () => { setOpen(false); button.current?.focus(); };
  const toggle = (slug: string, force?: boolean) => setExpanded((prev) => {
    const next = new Set(prev);
    if (force ?? !next.has(slug)) next.add(slug); else next.delete(slug);
    return next;
  });
  const choose = (item: Item) => {
    if (item.kind === 'group' && item.locked) return;
    if (item.key === selectedKey) { close(); return; }
    if (item.kind === 'empty') onChange('', '');
    else if (item.kind === 'sport') onChange(item.sportSlug, '');
    else onChange(item.sportSlug, item.group.slug);
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
      return;
    }
    const item = items[active];
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') setOpen(false);
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(items.length - 1); }
    else if (e.key === 'ArrowRight' && item?.kind === 'sport' && item.groups.length) {
      e.preventDefault();
      if (expanded.has(item.sportSlug)) setActive(active + 1); else toggle(item.sportSlug, true);
    } else if (e.key === 'ArrowLeft' && item) {
      e.preventDefault();
      if (item.kind === 'group') setActive(items.findIndex((it) => it.kind === 'sport' && it.sportSlug === item.sportSlug));
      else if (item.kind === 'sport') toggle(item.sportSlug, false);
    } else if ((e.key === 'Enter' || e.key === ' ') && item) { e.preventDefault(); choose(item); }
  };

  return (
    <div ref={root} className={`relative min-w-0 ${className}`}>
      <button
        ref={button}
        id={baseId}
        type="button"
        aria-label={`${label}: ${display}`}
        aria-haspopup="tree"
        aria-expanded={open}
        aria-controls={`${baseId}-tree`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-stone-300 bg-white p-2 text-left text-xs dark:border-stone-700 dark:bg-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
        data-testid="sport-group-picker"
        data-value={selectedKey === '__empty' ? '' : selectedKey}
      >
        <span className="truncate">{display}</span>
        {open ? <ChevronUp size={14} aria-hidden="true" className="shrink-0" /> : <ChevronDown size={14} aria-hidden="true" className="shrink-0" />}
      </button>

      {open && (
        <ul
          ref={list}
          id={`${baseId}-tree`}
          role="tree"
          aria-label={label}
          aria-activedescendant={`${baseId}-item-${active}`}
          className="absolute left-0 top-full z-40 mt-1 max-h-80 w-full min-w-56 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 text-xs shadow-xl dark:border-stone-700 dark:bg-[#121417]"
        >
          {items.map((item, i) => {
            const selected = item.key === selectedKey;
            const isActive = i === active;
            const rowClass = `flex items-center gap-2 py-1.5 pr-3 ${isActive ? 'bg-stone-100 dark:bg-stone-800' : ''} ${selected ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-stone-700 dark:text-stone-200'}`;
            if (item.kind === 'empty') {
              return (
                <li key={item.key} id={`${baseId}-item-${i}`} data-index={i} data-value="" role="treeitem" aria-level={1} aria-selected={selected}
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }} onMouseMove={() => { if (!isActive) setActive(i); }}
                  className={`${rowClass} cursor-pointer pl-3`}>
                  <span className="flex-1">{emptyLabel}</span>
                  {selected && <Check size={14} aria-hidden="true" />}
                </li>
              );
            }
            if (item.kind === 'sport') {
              const hasGroups = item.groups.length > 0;
              const isOpen = expanded.has(item.sportSlug);
              return (
                <li key={item.key} id={`${baseId}-item-${i}`} data-index={i} data-value={item.key} role="treeitem" aria-level={1} aria-selected={selected}
                  aria-expanded={hasGroups ? isOpen : undefined}
                  onMouseDown={(e) => { e.preventDefault(); choose(item); }}
                  onMouseMove={() => { if (!isActive) setActive(i); if (hasGroups && !isOpen) toggle(item.sportSlug, true); }}
                  className={`${rowClass} cursor-pointer pl-3`}>
                  <span className="flex-1 truncate">{item.name}</span>
                  {hasGroups && (
                    <button type="button" tabIndex={-1} aria-hidden="true"
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); toggle(item.sportSlug); }}
                      className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-stone-500 hover:bg-stone-200 dark:text-stone-400 dark:hover:bg-stone-700">
                      {item.groups.length}
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                  )}
                  {selected && <Check size={14} aria-hidden="true" />}
                </li>
              );
            }
            return (
              <li key={item.key} id={`${baseId}-item-${i}`} data-index={i} data-value={item.key} role="treeitem" aria-level={2} aria-selected={selected}
                aria-disabled={item.locked || undefined}
                title={item.locked ? 'The group follows the selected event.' : undefined}
                onMouseDown={(e) => { e.preventDefault(); choose(item); }} onMouseMove={() => { if (!isActive) setActive(i); }}
                className={`${rowClass} pl-7 ${item.locked ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                <span aria-hidden="true" className="text-stone-400 dark:text-stone-500">└</span>
                <span className="flex-1 truncate">{item.group.name}{item.group.isActive ? '' : ' (retired)'}</span>
                {item.locked && <Lock size={12} aria-hidden="true" />}
                {selected && <Check size={14} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
