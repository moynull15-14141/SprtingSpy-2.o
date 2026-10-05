'use client';

/**
 * Search input with autocomplete (PHASE E). It is a real GET form, so search
 * works before/without JavaScript; with JavaScript it adds debounced,
 * server-side suggestions (GET /api/search/suggestions) as an ARIA combobox:
 * ↑/↓ to move, Enter to open the highlighted suggestion (or search), Escape
 * to close.
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { SEARCH_MAX_QUERY } from '../../lib/searchText';
import { trackSearchEvent } from '../../lib/searchEvents';
import { Highlight } from './Highlight';

type Suggestion = { kind: 'article' | 'sport' | 'event'; label: string; url: string; meta: string };
const DEBOUNCE_MS = 200;

export function SearchBox({ defaultQuery, hidden, autoFocus = false }: {
  defaultQuery: string;
  /** Active filters kept when a new query is submitted. */
  hidden: Record<string, string>;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const listId = useId();
  const [value, setValue] = useState(defaultQuery);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const typed = useRef(false);

  useEffect(() => setValue(defaultQuery), [defaultQuery]);

  useEffect(() => {
    const q = value.trim();
    if (!typed.current || q.length < 2) { setItems([]); setLoading(false); return; }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { articles: { title: string; url: string; sportName: string; articleType: string }[]; sports: { name: string; url: string }[]; events?: { name: string; url: string; sportName: string }[] };
        setItems([
          ...data.sports.map((s) => ({ kind: 'sport' as const, label: s.name, url: s.url, meta: 'Sport' })),
          ...(data.events ?? []).map((e) => ({ kind: 'event' as const, label: e.name, url: e.url, meta: `${e.sportName} · Event` })),
          ...data.articles.map((a) => ({ kind: 'article' as const, label: a.title, url: a.url, meta: `${a.sportName} · ${a.articleType}` })),
        ]);
        setActive(-1);
        setOpen(true);
      } catch (error) {
        // Suggestions are optional: a failure just shows none.
        if ((error as Error).name !== 'AbortError') setItems([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [value]);

  const choose = (item: Suggestion) => {
    trackSearchEvent({ type: 'search_suggestion_click', query: value.trim(), url: item.url });
    setOpen(false);
    router.push(item.url);
  };

  const showList = open && items.length > 0;

  return (
    <form action="/search/" method="get" role="search" className="relative flex min-h-16 min-w-0 items-center gap-2 rounded-2xl border border-stone-300 bg-white p-2 shadow-[0_4px_18px_-12px_rgba(28,25,23,0.4)] transition-[border-color,box-shadow] focus-within:border-amber-600 focus-within:ring-4 focus-within:ring-amber-500/15 dark:border-stone-700 dark:bg-stone-900 dark:shadow-[0_4px_20px_-12px_rgba(0,0,0,0.8)] dark:focus-within:border-amber-500" onSubmit={() => setOpen(false)}>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <label htmlFor={`${listId}-input`} className="sr-only">Search SportingSpy</label>
      <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
        <Search size={20} strokeWidth={2} />
      </span>
      <input
        id={`${listId}-input`}
        type="search"
        name="q"
        value={value}
        maxLength={SEARCH_MAX_QUERY}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={`${listId}-list`}
        aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
        placeholder="Search articles, events, sports… e.g. French Open schedule"
        onChange={(e) => { typed.current = true; setValue(e.target.value); }}
        onFocus={() => items.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { if (showList) { e.preventDefault(); setOpen(false); } return; }
          if (!items.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (i + 1) % items.length); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (i <= 0 ? items.length - 1 : i - 1)); }
          else if (e.key === 'Enter' && showList && active >= 0) { e.preventDefault(); choose(items[active]); }
        }}
        className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2.5 text-base text-stone-900 outline-none placeholder:text-stone-500 focus:outline-none dark:text-stone-100 dark:placeholder:text-stone-400 sm:px-2 sm:text-lg"
      />
      <div className="flex shrink-0 items-center gap-1">
        {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-amber-600" aria-hidden="true" />}
        {value && (
          <button type="button" aria-label="Clear search" onClick={() => { typed.current = false; setValue(''); setItems([]); }} className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200">
            <X size={16} />
          </button>
        )}
        <button type="submit" className="min-h-11 rounded-xl bg-amber-700 px-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900 sm:px-5">
          Search
        </button>
      </div>

      <ul
        id={`${listId}-list`}
        role="listbox"
        aria-label="Search suggestions"
        hidden={!showList}
        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-xl border border-stone-200 bg-white py-1 shadow-xl dark:border-stone-800 dark:bg-[#121417]"
      >
        {items.map((item, i) => (
          <li
            key={`${item.kind}-${item.url}`}
            id={`${listId}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => { e.preventDefault(); choose(item); }}
            onMouseEnter={() => setActive(i)}
            className={`flex cursor-pointer items-baseline justify-between gap-3 px-4 py-2 text-sm ${i === active ? 'bg-amber-50 dark:bg-amber-950/40' : ''}`}
          >
            <span className="min-w-0 truncate text-stone-900 dark:text-stone-100"><Highlight text={item.label} query={value} /></span>
            <span className="shrink-0 text-[11px] text-stone-500 dark:text-stone-400">{item.meta}</span>
          </li>
        ))}
      </ul>
      <p className="sr-only" aria-live="polite">{showList ? `${items.length} suggestions available.` : ''}</p>
    </form>
  );
}
