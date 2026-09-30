/**
 * Shared CMS field editors (PHASE H) for Events and Editions.
 *
 * SeoFields — SEO title/description/keywords and social title/description/image.
 *   Lifecycle: a blank field means "use the automatic default", which the
 *   public page computes from the current name/description (shown here as the
 *   placeholder). Anything an editor types is saved as written and is never
 *   regenerated on later saves. SEO keys this form does not edit
 *   (canonicalUrl, noIndex) are preserved by the caller.
 *
 * RecordList — an ordered list of small records (quick facts, champions).
 */

import React from 'react';
import type { SeoMetadata } from '../../types';

const input = 'w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-normal';
const label = 'block text-xs font-semibold text-stone-700 dark:text-stone-300';

export type SeoDraft = { metaTitle: string; metaDescription: string; keywords: string; ogTitle: string; ogDescription: string; ogImage: string };
export const EMPTY_SEO_DRAFT: SeoDraft = { metaTitle: '', metaDescription: '', keywords: '', ogTitle: '', ogDescription: '', ogImage: '' };

/** Stored SEO JSON → form values. */
export const seoToDraft = (seo?: SeoMetadata | null): SeoDraft => ({
  metaTitle: seo?.metaTitle ?? '',
  metaDescription: seo?.metaDescription ?? '',
  keywords: (seo?.keywords ?? []).join(', '),
  ogTitle: seo?.ogTitle ?? '',
  ogDescription: seo?.ogDescription ?? '',
  ogImage: seo?.ogImage ?? '',
});

/** Form values → SEO JSON: blank fields are omitted (automatic default); other stored keys are kept. */
export const draftToSeo = (draft: SeoDraft, existing?: SeoMetadata | null): SeoMetadata => {
  const { metaTitle: _a, metaDescription: _b, keywords: _c, ogTitle: _d, ogDescription: _e, ogImage: _f, ...kept } = existing ?? {};
  const keywords = draft.keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 30);
  return {
    ...kept,
    ...(draft.metaTitle.trim() ? { metaTitle: draft.metaTitle.trim() } : {}),
    ...(draft.metaDescription.trim() ? { metaDescription: draft.metaDescription.trim() } : {}),
    ...(keywords.length ? { keywords } : {}),
    ...(draft.ogTitle.trim() ? { ogTitle: draft.ogTitle.trim() } : {}),
    ...(draft.ogDescription.trim() ? { ogDescription: draft.ogDescription.trim() } : {}),
    ...(draft.ogImage.trim() ? { ogImage: draft.ogImage.trim() } : {}),
  };
};

export const SeoFields: React.FC<{ idPrefix: string; value: SeoDraft; onChange: (v: SeoDraft) => void; defaults: { title: string; description: string } }> = ({ idPrefix, value, onChange, defaults }) => {
  const set = (key: keyof SeoDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...value, [key]: e.target.value });
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <fieldset className="min-w-0 space-y-3 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <legend className="px-1 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">SEO &amp; social metadata</legend>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">Leave a field blank to use the automatic default shown in grey. Anything you type is kept exactly as written and is not regenerated when you save other changes.</p>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 flex justify-between gap-2"><label htmlFor={id('title')} className={label}>SEO title</label><span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{(value.metaTitle || defaults.title).length} chars</span></div>
          <input id={id('title')} type="text" maxLength={300} value={value.metaTitle} onChange={set('metaTitle')} placeholder={defaults.title} className={input} />
        </div>
        <div className="min-w-0">
          <label htmlFor={id('keywords')} className={`${label} mb-1`}>SEO keywords <span className="font-normal text-stone-500 dark:text-stone-400">(comma-separated)</span></label>
          <input id={id('keywords')} type="text" maxLength={3000} value={value.keywords} onChange={set('keywords')} placeholder="e.g. roland garros, clay court" className={input} />
        </div>
      </div>
      <div className="min-w-0">
        <div className="mb-1 flex justify-between gap-2"><label htmlFor={id('description')} className={label}>Meta description</label><span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{(value.metaDescription || defaults.description).length} chars</span></div>
        <textarea id={id('description')} rows={2} maxLength={500} value={value.metaDescription} onChange={set('metaDescription')} placeholder={defaults.description || 'Defaults to the description'} className={input} />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <label htmlFor={id('og-title')} className={`${label} mb-1`}>Social title</label>
          <input id={id('og-title')} type="text" maxLength={200} value={value.ogTitle} onChange={set('ogTitle')} placeholder={value.metaTitle || defaults.title} className={input} />
        </div>
        <div className="min-w-0">
          <label htmlFor={id('og-image')} className={`${label} mb-1`}>Social image URL</label>
          <input id={id('og-image')} type="text" maxLength={2048} value={value.ogImage} onChange={set('ogImage')} placeholder="Defaults to the page image" className={`${input} font-mono`} />
        </div>
      </div>
      <div className="min-w-0">
        <label htmlFor={id('og-description')} className={`${label} mb-1`}>Social description</label>
        <textarea id={id('og-description')} rows={2} maxLength={500} value={value.ogDescription} onChange={set('ogDescription')} placeholder={value.metaDescription || defaults.description || 'Defaults to the meta description'} className={input} />
      </div>
    </fieldset>
  );
};

export interface RecordField { key: string; label: string; placeholder?: string; maxLength: number }

export function RecordList({ legend, help, items, onChange, fields, addLabel, max, emptyText }: {
  legend: string; help?: string; items: Record<string, string>[]; onChange: (items: Record<string, string>[]) => void;
  fields: RecordField[]; addLabel: string; max: number; emptyText: string;
}) {
  const update = (i: number, key: string, v: string) => onChange(items.map((item, j) => (j === i ? { ...item, [key]: v } : item)));
  const move = (i: number, d: -1 | 1) => { const n = [...items]; [n[i + d], n[i]] = [n[i], n[i + d]]; onChange(n); };
  return (
    <fieldset className="min-w-0 space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
      <legend className="px-1 text-xs font-bold uppercase tracking-wider text-stone-700 dark:text-stone-200">{legend}</legend>
      {help && <p className="text-[11px] text-stone-500 dark:text-stone-400">{help}</p>}
      {items.length === 0 ? <p className="rounded border border-dashed border-stone-300 p-2 text-center text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400">{emptyText}</p> : (
        <ol className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="grid min-w-0 grid-cols-1 gap-2 md:grid-cols-[repeat(2,minmax(0,1fr))_auto]">
              {fields.map((f) => (
                <label key={f.key} className="min-w-0 text-[11px] font-semibold text-stone-600 dark:text-stone-300">{f.label} {i + 1}
                  <input type="text" maxLength={f.maxLength} value={item[f.key] ?? ''} placeholder={f.placeholder} onChange={(e) => update(i, f.key, e.target.value)} className={`mt-1 text-xs ${input}`} />
                </label>
              ))}
              <div className="flex items-end gap-1">
                <button type="button" aria-label={`Move ${legend} ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className="h-9 w-9 rounded border border-stone-300 text-xs disabled:opacity-40 dark:border-stone-700">↑</button>
                <button type="button" aria-label={`Move ${legend} ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} className="h-9 w-9 rounded border border-stone-300 text-xs disabled:opacity-40 dark:border-stone-700">↓</button>
                <button type="button" aria-label={`Remove ${legend} ${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))} className="h-9 rounded border border-rose-300 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40">Remove</button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <button type="button" disabled={items.length >= max} onClick={() => onChange([...items, Object.fromEntries(fields.map((f) => [f.key, '']))])} className="rounded border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:border-amber-500 disabled:opacity-40 dark:border-stone-700 dark:text-stone-200">{addLabel}</button>
    </fieldset>
  );
}

/** Rows with every field filled, trimmed; returns an error message when a row is half-filled. */
export function cleanRecords(items: Record<string, string>[], fields: RecordField[], name: string): { ok: true; value: Record<string, string>[] } | { ok: false; error: string } {
  const rows = items.map((it) => Object.fromEntries(fields.map((f) => [f.key, (it[f.key] ?? '').trim()]))).filter((it) => fields.some((f) => it[f.key]));
  const bad = rows.findIndex((it) => fields.some((f) => !it[f.key]));
  if (bad !== -1) return { ok: false, error: `${name} ${bad + 1}: fill in every field or remove the row.` };
  return { ok: true, value: rows };
}
