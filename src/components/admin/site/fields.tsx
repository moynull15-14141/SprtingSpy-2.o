'use client';

/** Small form building blocks shared by the Site Experience editors (PHASE F.1). */

import React, { useId, useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, X } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { useArticleSearch } from '../useArticleSearch';
import type { CtaLink } from '../../../lib/siteExperience/types';

export const inputClass = 'mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs font-normal dark:border-stone-700 dark:bg-stone-950';
export const labelClass = 'block text-[11px] font-semibold text-stone-700 dark:text-stone-300';
export const iconBtn = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-stone-300 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-30 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800';

export const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 7)}`;

export function Text({ label, value, onChange, max, placeholder, multiline }: { label: string; value: string; onChange: (v: string) => void; max: number; placeholder?: string; multiline?: boolean }) {
  return (
    <label className={labelClass}>{label}
      {multiline
        ? <textarea rows={3} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        : <input type="text" maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />}
    </label>
  );
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-stone-700 dark:text-stone-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber-600" />
      {label}
    </label>
  );
}

export function Select<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <label className={labelClass}>{label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className={inputClass}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function LinkFields({ label, value, onChange, optional }: { label: string; value: CtaLink | null; onChange: (v: CtaLink | null) => void; optional?: boolean }) {
  return (
    <fieldset className="rounded-lg border border-stone-200 p-2 dark:border-stone-800">
      <legend className="px-1 text-[11px] font-semibold text-stone-600 dark:text-stone-300">{label}</legend>
      {optional && <Toggle label="Show" checked={!!value} onChange={(on) => onChange(on ? { label: '', href: '/' } : null)} />}
      {value && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Text label="Text" value={value.label} max={60} onChange={(l) => onChange({ ...value, label: l })} />
          <Text label="Link (/path or https://…)" value={value.href} max={500} onChange={(h) => onChange({ ...value, href: h })} />
        </div>
      )}
    </fieldset>
  );
}

/** datetime-local <-> ISO (empty = no limit). */
export function DateTimeField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const local = value ? new Date(new Date(value).getTime() - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  return (
    <label className={labelClass}>{label}
      <input type="datetime-local" value={local} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} className={inputClass} />
    </label>
  );
}

/** Move up / move down / remove controls for an item in a list. */
export function RowControls({ index, count, onMove, onRemove, label }: { index: number; count: number; onMove: (to: number) => void; onRemove?: () => void; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" className={iconBtn} disabled={index === 0} onClick={() => onMove(index - 1)} aria-label={`Move ${label} up`} title="Move up"><ChevronUp size={15} /></button>
      <button type="button" className={iconBtn} disabled={index === count - 1} onClick={() => onMove(index + 1)} aria-label={`Move ${label} down`} title="Move down"><ChevronDown size={15} /></button>
      {onRemove && <button type="button" className={iconBtn} onClick={onRemove} aria-label={`Remove ${label}`} title="Remove"><Trash2 size={15} /></button>}
    </div>
  );
}

export const move = <T,>(list: T[], from: number, to: number) => { const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; };

/** Pick published articles through the shared CMS article search (Phase E). */
export function ArticlePicker({ label, value, onChange, max }: { label: string; value: string[]; onChange: (ids: string[]) => void; max: number }) {
  const { articles } = useApp();
  const listId = useId();
  const [q, setQ] = useState('');
  const found = useArticleSearch({ q: q.trim(), status: 'published', publicOnly: true, limit: 6 }, { enabled: q.trim().length > 0 });
  const titleOf = (id: string) => articles.find((a) => a.id === id)?.title ?? id;
  const statusOf = (id: string) => articles.find((a) => a.id === id)?.status;
  return (
    <div className="space-y-2">
      <span className={labelClass}>{label} ({value.length}/{max})</span>
      {value.length > 0 && (
        <ol className="space-y-1">
          {value.map((id, i) => (
            <li key={id} className="flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-2 py-1 text-xs dark:border-stone-800 dark:bg-stone-950">
              <span className="w-4 text-stone-500 dark:text-stone-400">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{titleOf(id)}</span>
              {statusOf(id) && statusOf(id) !== 'published' && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-bold uppercase text-rose-800">{statusOf(id)} — will be skipped</span>}
              <RowControls index={i} count={value.length} label="article" onMove={(to) => onChange(move(value, i, to))} onRemove={() => onChange(value.filter((x) => x !== id))} />
            </li>
          ))}
        </ol>
      )}
      {value.length < max && (
        <div>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search published articles…" aria-label={`Search ${label}`} aria-controls={listId} className={inputClass} />
          {q.trim() && (
            <ul id={listId} className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-stone-200 dark:border-stone-800" aria-busy={found.loading}>
              {(found.data?.items ?? []).filter((a) => !value.includes(a.id)).map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { onChange([...value, a.id]); setQ(''); }} className="w-full px-2 py-1.5 text-left text-xs hover:bg-amber-50 focus-visible:bg-amber-50 focus-visible:outline-none dark:hover:bg-stone-800 dark:focus-visible:bg-stone-800">
                    <strong className="block truncate">{a.title}</strong>
                    <span className="text-[10px] text-stone-500 dark:text-stone-400">{a.sportName} · {a.articleType}</span>
                  </button>
                </li>
              ))}
              {found.data && !found.loading && !found.data.items.length && <li className="px-2 py-1.5 text-xs text-stone-500 dark:text-stone-400">No published article matches.</li>}
            </ul>
          )}
          {found.loading && <p role="status" className="text-xs">Searching published articles…</p>}
          {found.error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{found.error}</p>}
        </div>
      )}
    </div>
  );
}

export function Pill({ children, tone = 'stone' }: { children: React.ReactNode; tone?: 'stone' | 'emerald' | 'amber' | 'sky' | 'violet' }) {
  const tones = { stone: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200', emerald: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', amber: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300', sky: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300', violet: 'bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-300' };
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone]}`}>{children}</span>;
}

export const CloseIcon = X;
