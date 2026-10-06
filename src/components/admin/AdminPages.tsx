'use client';

/**
 * Pages desk (PHASE PAGES): informational pages served at /{slug}/ — About,
 * Contact, Privacy Policy, Terms, DMCA and any page an editor adds.
 *
 * Admin and Editor manage pages (the API enforces this; Authors never see
 * the desk). New pages start as drafts; publishing, unpublishing and deleting
 * are explicit actions. The body uses the article editor and the same
 * allow-listed document format. System pages keep their URL and stay
 * published. A page linked from the live header/footer cannot be unpublished
 * or deleted until that link is removed (the API explains which link).
 */

import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { ExternalLink, Eye, ImageIcon, Lock, Plus, Search, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { MediaPicker } from './media/MediaShared';
import { PAGE_LIMITS, PAGE_SLUG_PATTERN, pagePath, slugifyPageTitle, type AdminPage, type PageStatus } from '../../lib/pages';
import type { RichDoc } from '../../lib/richText';

const RichTextEditor = dynamic(() => import('./editor/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[320px] rounded-lg border border-stone-300 p-4 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">Loading editor…</div>,
});

const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
const field = 'w-full rounded-lg border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950';
const label = 'block text-xs font-semibold text-stone-700 dark:text-stone-300';
const STATUS_BADGE: Record<PageStatus, string> = {
  published: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  draft: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300',
};
const TEMPLATE_NOTE: Record<string, string> = {
  contact: 'The contact form is shown below this text automatically.',
  privacy: 'The cookie table, analytics/advertising disclosures and privacy-choices button are generated from the live configuration and shown below this text automatically.',
};

type ListPage = Omit<AdminPage, 'body' | 'content'>;
type Form = { title: string; slug: string; shortTitle: string; summary: string; seoTitle: string; seoDescription: string; noIndex: boolean; ogMediaId: string | null; body: RichDoc };

const toForm = (p: AdminPage): Form => ({
  title: p.title, slug: p.slug, shortTitle: p.shortTitle || '', summary: p.summary || '', seoTitle: p.seoTitle || '',
  seoDescription: p.seoDescription || '', noIndex: p.noIndex, ogMediaId: p.ogMediaId, body: p.body?.content?.length ? p.body : EMPTY_DOC,
});
const EMPTY_FORM: Form = { title: '', slug: '', shortTitle: '', summary: '', seoTitle: '', seoDescription: '', noIndex: false, ogMediaId: null, body: EMPTY_DOC };
const date = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export function AdminPages() {
  const { apiCall, currentUser, mediaItems } = useApp();
  const [pages, setPages] = useState<ListPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | PageStatus>('');
  // Editor state: `editing` is the saved page (null while creating a new one).
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPage | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [saved, setSaved] = useState<Form>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (query.trim()) params.set('q', query.trim());
    const res = await apiCall<{ pages: ListPage[] }>(`/api/pages${params.size ? `?${params}` : ''}`);
    setLoading(false);
    if (res.data) { setPages(res.data.pages); setLoadError(''); } else setLoadError(res.error || 'Could not load pages.');
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [query, statusFilter]);

  // Fold the CMS navigation while writing, as the article editor does.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sportingspy:cms-editor', { detail: { active: open } }));
    return () => { window.dispatchEvent(new CustomEvent('sportingspy:cms-editor', { detail: { active: false } })); };
  }, [open]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(saved), [form, saved]);
  const system = !!editing?.system;
  const published = editing?.status === 'published';
  const ogMedia = form.ogMediaId ? mediaItems.find((m) => m.id === form.ogMediaId) : undefined;
  const slugError = form.slug && !PAGE_SLUG_PATTERN.test(form.slug) ? 'Use lower-case letters, numbers and single hyphens.' : '';

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const begin = (action: string) => { setBusy(action); setError(''); setNotice(''); };

  const openPage = async (id: string | null) => {
    setError(''); setNotice('');
    if (!id) {
      setEditing(null); setForm(EMPTY_FORM); setSaved(EMPTY_FORM); setSlugTouched(false); setEditorKey((k) => k + 1); setOpen(true);
      return;
    }
    begin('open');
    const res = await apiCall<AdminPage>(`/api/pages/${id}`);
    setBusy('');
    if (!res.data) { setError(res.error || 'Could not open the page.'); return; }
    const f = toForm(res.data);
    setEditing(res.data); setForm(f); setSaved(f); setSlugTouched(true); setEditorKey((k) => k + 1); setOpen(true);
  };
  const close = () => {
    if (dirty && !confirm('Discard unsaved changes to this page?')) return;
    setOpen(false); setEditing(null); void load();
  };

  const accept = (page: AdminPage, message: string) => {
    const f = toForm(page);
    setEditing(page); setForm(f); setSaved(f); setNotice(message);
  };

  /** Saves the form; returns the saved page (or null on error). */
  const save = async (): Promise<AdminPage | null> => {
    if (published && !confirm(`"${form.title}" is live. Saving updates the public page at ${pagePath(form.slug)} immediately. Continue?`)) return null;
    if (published && editing && form.slug !== editing.slug && !confirm(`Change the public URL from ${pagePath(editing.slug)} to ${pagePath(form.slug)}? The old URL will redirect (301) to the new one.`)) return null;
    const body: Record<string, unknown> = {
      title: form.title, shortTitle: form.shortTitle || null, summary: form.summary || null, body: form.body,
      seoTitle: form.seoTitle || null, seoDescription: form.seoDescription || null, noIndex: form.noIndex, ogMediaId: form.ogMediaId,
      ...(system ? {} : { slug: form.slug }),
    };
    const res = editing
      ? await apiCall<AdminPage>(`/api/pages/${editing.id}`, { method: 'PUT', body })
      : await apiCall<AdminPage>('/api/pages', { method: 'POST', body });
    if (!res.data) { setError(res.error || 'Could not save the page.'); return null; }
    return res.data;
  };

  const onSave = async () => {
    begin('save');
    const page = await save();
    setBusy('');
    if (page) accept(page, page.status === 'published' ? 'Saved. The public page is updated.' : 'Draft saved. It is not public.');
  };
  const onPreview = async () => {
    // The preview renders what is stored, so save pending changes first.
    let page = editing;
    if (!page || dirty) {
      begin('preview');
      page = await save();
      setBusy('');
      if (!page) return;
      accept(page, page.status === 'published' ? 'Saved. The public page is updated.' : 'Draft saved for preview. It is not public.');
    }
    window.open(`/admin/preview/page/${page.id}/`, '_blank', 'noopener');
  };
  const onPublish = async () => {
    if (!confirm(`Publish "${form.title}" at ${pagePath(form.slug)}? It becomes public and indexable${form.noIndex ? ' (noindex is set, so search engines will not index it)' : ''}.`)) return;
    begin('publish');
    let page = editing;
    if (!page || dirty) page = await save();
    if (!page) { setBusy(''); return; }
    const res = await apiCall<AdminPage>(`/api/pages/${page.id}/publish`, { method: 'POST', body: {} });
    setBusy('');
    if (!res.data) { setError(res.error || 'Could not publish the page.'); accept(page, ''); return; }
    accept(res.data, `Published at ${pagePath(res.data.slug)}.`);
  };
  const onUnpublish = async () => {
    if (!editing || !confirm(`Unpublish "${editing.title}"? ${pagePath(editing.slug)} will return "page not found" until it is published again.`)) return;
    begin('unpublish');
    const res = await apiCall<AdminPage>(`/api/pages/${editing.id}/unpublish`, { method: 'POST', body: {} });
    setBusy('');
    if (!res.data) { setError(res.error || 'Could not unpublish the page.'); return; }
    accept(res.data, 'Unpublished. The page is a draft again and no longer public.');
  };
  const onDelete = async () => {
    if (!editing || !confirm(`Permanently delete "${editing.title}"? This cannot be undone.`)) return;
    begin('delete');
    const res = await apiCall<{ success: boolean }>(`/api/pages/${editing.id}`, { method: 'DELETE' });
    setBusy('');
    if (!res.data) { setError(res.error || 'Could not delete the page.'); return; }
    setOpen(false); setEditing(null); setNotice(`Deleted "${editing.title}".`); void load();
  };

  const messages = <>
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">{notice}</div>}
    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}
  </>;

  if (open) {
    const counter = (value: string, max: number) => <span className={`text-[10px] ${value.length > max ? 'text-rose-600' : 'text-stone-400'}`}>{value.length}/{max}</span>;
    return (
      <div className="space-y-4" data-testid="page-editor">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
          <div className="min-w-0">
            <button type="button" onClick={close} className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">← All pages</button>
            <h2 className="mt-1 truncate font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">{editing ? editing.title : 'New page'}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-stone-500 dark:text-stone-400">
              <span className={`rounded px-2 py-0.5 font-bold uppercase ${STATUS_BADGE[editing?.status || 'draft']}`}>{editing?.status || 'draft'}</span>
              {system && <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-300"><Lock size={11} /> Required site page</span>}
              {dirty && <span className="font-semibold text-amber-700 dark:text-amber-400">Unsaved changes</span>}
              {editing && <span>Updated {date(editing.updatedAt)} by {editing.updatedBy} · Published {date(editing.publishedAt)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {published && <a href={pagePath(editing!.slug)} target="_blank" rel="noopener" className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-2 text-xs font-semibold dark:border-stone-700"><ExternalLink size={13} /> View live</a>}
            <Button type="button" variant="secondary" onClick={onPreview} isLoading={busy === 'preview'} disabled={!!busy || !form.title || !form.slug}><Eye size={13} /> Preview</Button>
            <Button type="button" variant="secondary" onClick={onSave} isLoading={busy === 'save'} disabled={!!busy || (!dirty && !!editing)}>{published ? 'Save changes' : 'Save draft'}</Button>
            {!published && <Button type="button" onClick={onPublish} isLoading={busy === 'publish'} disabled={!!busy}>Publish</Button>}
            {published && !system && <Button type="button" variant="secondary" onClick={onUnpublish} isLoading={busy === 'unpublish'} disabled={!!busy}>Unpublish</Button>}
            {editing && !system && !published && currentUser.role === 'Admin' && <Button type="button" variant="danger" onClick={onDelete} isLoading={busy === 'delete'} disabled={!!busy}>Delete</Button>}
          </div>
        </div>
        {messages}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <label className={label}>Title
              <input className={`${field} mt-1 font-serif text-lg`} maxLength={PAGE_LIMITS.title} value={form.title} required
                onChange={(e) => { const title = e.target.value; setForm((f) => ({ ...f, title, ...(!slugTouched && !system ? { slug: slugifyPageTitle(title) } : {}) })); }} />
            </label>
            <label className={label}>Subtitle <span className="font-normal text-stone-500">(optional, shown under the title)</span>
              <input className={`${field} mt-1`} maxLength={PAGE_LIMITS.summary} value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="e.g. Last revised: October 2026" />
            </label>
            <div>
              <span className={label}>Page content</span>
              {editing && TEMPLATE_NOTE[editing.template] && <p className="mb-2 mt-1 rounded-lg bg-stone-100 p-2 text-[11px] text-stone-600 dark:bg-stone-900 dark:text-stone-300">{TEMPLATE_NOTE[editing.template]}</p>}
              <div className="mt-1"><RichTextEditor key={editorKey} initialDoc={form.body} onChange={(doc) => set('body', doc)} /></div>
            </div>
          </div>

          <aside className="space-y-4">
            <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-[#121417]">
              <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">URL</h3>
              <label className={label}>Slug
                <div className="mt-1 flex items-center rounded-lg border border-stone-300 bg-stone-50 text-sm dark:border-stone-700 dark:bg-stone-900">
                  <span className="pl-2 text-stone-500">/</span>
                  <input className="w-full bg-transparent p-2 font-mono text-xs focus:outline-none disabled:opacity-60" value={form.slug} disabled={system} maxLength={PAGE_LIMITS.slug}
                    onChange={(e) => { setSlugTouched(true); set('slug', e.target.value.toLowerCase()); }} aria-invalid={!!slugError} />
                  <span className="pr-2 text-stone-500">/</span>
                </div>
              </label>
              {slugError && <p className="text-[11px] text-rose-600">{slugError}</p>}
              <p className="text-[11px] text-stone-500 dark:text-stone-400">
                {system ? 'This required page keeps its URL.' : published ? 'Changing the slug of a published page adds a 301 redirect from the old URL.' : 'Public at this URL once published.'}
              </p>
              <label className={label}>Short title <span className="font-normal text-stone-500">(breadcrumb / footer label)</span>
                <input className={`${field} mt-1`} maxLength={PAGE_LIMITS.shortTitle} value={form.shortTitle} onChange={(e) => set('shortTitle', e.target.value)} placeholder={form.title} />
              </label>
            </section>

            <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-[#121417]">
              <h3 className="text-sm font-bold text-stone-900 dark:text-stone-100">Search &amp; social</h3>
              <label className={label}><span className="flex justify-between">SEO title {counter(form.seoTitle, PAGE_LIMITS.seoTitle)}</span>
                <input className={`${field} mt-1`} maxLength={PAGE_LIMITS.seoTitle} value={form.seoTitle} onChange={(e) => set('seoTitle', e.target.value)} placeholder={`${form.title || 'Title'} | SportingSpy`} />
              </label>
              <label className={label}><span className="flex justify-between">SEO description {counter(form.seoDescription, PAGE_LIMITS.seoDescription)}</span>
                <textarea className={`${field} mt-1`} rows={3} maxLength={PAGE_LIMITS.seoDescription} value={form.seoDescription} onChange={(e) => set('seoDescription', e.target.value)} placeholder="Defaults to the subtitle or the first words of the page." />
              </label>
              <div>
                <span className={label}>Social image (Open Graph)</span>
                {ogMedia ? (
                  <div className="mt-1 flex items-center gap-2">
                    <img src={ogMedia.url} alt={ogMedia.altText} className="h-12 w-20 rounded object-cover" />
                    <span className="min-w-0 flex-1 truncate text-[11px]">{ogMedia.title}</span>
                    <button type="button" aria-label="Remove social image" onClick={() => set('ogMediaId', null)} className="rounded p-1 hover:bg-stone-100 dark:hover:bg-stone-800"><X size={14} /></button>
                  </div>
                ) : form.ogMediaId ? <p className="mt-1 text-[11px] text-stone-500">Media item {form.ogMediaId}</p> : null}
                <button type="button" onClick={() => setPickerOpen(true)} className="mt-1 inline-flex items-center gap-1 rounded-lg border border-stone-300 px-2 py-1.5 text-xs dark:border-stone-700"><ImageIcon size={13} /> {form.ogMediaId ? 'Change image' : 'Choose from Media Library'}</button>
                <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Without one, the site&apos;s default social image is used.</p>
              </div>
              <label className="flex items-start gap-2 text-xs text-stone-700 dark:text-stone-300">
                <input type="checkbox" className="mt-0.5" checked={form.noIndex} onChange={(e) => set('noIndex', e.target.checked)} />
                <span>Hide from search engines (noindex; left out of the sitemap)</span>
              </label>
            </section>
          </aside>
        </div>
        {pickerOpen && <MediaPicker onSelect={(item) => { set('ogMediaId', item.id); setPickerOpen(false); }} onClose={() => setPickerOpen(false)} />}
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="pages-desk">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 pb-4 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Pages</h2>
          <p className="mt-1 max-w-3xl text-xs text-stone-500 dark:text-stone-400">
            Informational pages at <code>/your-slug/</code>. New pages start as drafts; only <strong>published</strong> pages are public. Link a page from the footer in Site Experience → Footer.
          </p>
        </div>
        <Button type="button" onClick={() => openPage(null)}><Plus size={14} /> New page</Button>
      </div>
      {messages}
      <div className="flex flex-wrap gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">Search pages</span>
          <Search size={14} className="absolute left-2 top-2.5 text-stone-400" />
          <input className={`${field} pl-7`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, URL or text" />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select className={field} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | PageStatus)}>
            <option value="">All statuses</option>
            <option value="published">Published</option>
            <option value="draft">Draft</option>
          </select>
        </label>
      </div>
      {loadError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{loadError}</p>}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 text-[11px] uppercase tracking-wide text-stone-500 dark:bg-stone-900 dark:text-stone-400">
            <tr><th className="p-3">Title</th><th className="p-3">URL</th><th className="p-3">Status</th><th className="p-3">Updated</th><th className="p-3">Published</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {pages.map((p) => (
              <tr key={p.id} className="cursor-pointer hover:bg-stone-50 dark:hover:bg-stone-900/60" onClick={() => openPage(p.id)}>
                <td className="p-3 font-semibold text-stone-900 dark:text-stone-100">
                  <button type="button" className="text-left hover:underline" onClick={(e) => { e.stopPropagation(); void openPage(p.id); }}>{p.title}</button>
                  {p.system && <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-300"><Lock size={10} /> Required</span>}
                </td>
                <td className="p-3 font-mono text-[11px] text-stone-600 dark:text-stone-300">{pagePath(p.slug)}</td>
                <td className="p-3"><span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[p.status]}`}>{p.status}</span>{p.noIndex && <span className="ml-1 text-[10px] text-stone-500">noindex</span>}</td>
                <td className="p-3 text-stone-500 dark:text-stone-400">{date(p.updatedAt)}</td>
                <td className="p-3 text-stone-500 dark:text-stone-400">{date(p.publishedAt)}</td>
              </tr>
            ))}
            {!loading && !pages.length && <tr><td colSpan={5} className="p-6 text-center text-stone-500">No pages match.</td></tr>}
            {loading && !pages.length && <tr><td colSpan={5} className="p-6 text-center text-stone-500">Loading pages…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
