/**
 * Article Types (PHASE R, Spec v2.0 §9.3 "editable and expandable").
 *
 * Admins add types, rename unused custom types, reorder, set the
 * structured-data type and the SEO profile (which type-aware checks a type
 * inherits), and deactivate types that should no longer be used for new
 * articles. A type that articles use can never be renamed or deleted, so
 * existing content keeps its exact type. Editors and Authors can view the list.
 * "How to Watch" and "Sports Viewing Guide" are both seeded specification types.
 */

import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { ARTICLE_SCHEMA_TYPES, ARTICLE_TYPE_SEO_PROFILES, type ArticleTypeDefinition } from '../../types';

const input = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900';
const PROFILE_HELP: Record<string, string> = {
  viewing: 'broadcasters, official streams, regions, viewing times',
  schedule: 'sessions/fixtures, time zones',
  results: 'outcomes, scores',
  'prize-money': 'currency amounts, breakdown',
  'event-guide': 'dates, venue, format',
  general: 'general content checks only',
};

export const AdminArticleTypes: React.FC = () => {
  const { apiCall, currentUser, refreshData, showNotification } = useApp();
  const isAdmin = currentUser?.role === 'Admin';
  const [types, setTypes] = useState<ArticleTypeDefinition[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ArticleTypeDefinition | null>(null);
  const [draft, setDraft] = useState({ name: '', description: '', schemaType: 'Article', seoProfile: 'general', sortOrder: '' });

  const load = async () => {
    const res = await apiCall<ArticleTypeDefinition[]>('/api/article-types');
    if (res.data) { setTypes(res.data); setError(null); } else setError(res.error || 'Article Types could not be loaded.');
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const startEdit = (t: ArticleTypeDefinition | null) => {
    setEditing(t);
    setDraft(t ? { name: t.name, description: t.description, schemaType: t.schemaType, seoProfile: t.seoProfile, sortOrder: String(t.sortOrder) } : { name: '', description: '', schemaType: 'Article', seoProfile: 'general', sortOrder: '' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, unknown> = { description: draft.description, schemaType: draft.schemaType, seoProfile: draft.seoProfile };
    if (!editing || draft.name !== editing.name) body.name = draft.name;
    if (draft.sortOrder.trim()) body.sortOrder = Number(draft.sortOrder);
    const res = editing
      ? await apiCall<ArticleTypeDefinition>(`/api/article-types/${editing.id}`, { method: 'PUT', body })
      : await apiCall<ArticleTypeDefinition>('/api/article-types', { method: 'POST', body });
    setBusy(false);
    if (res.data) {
      showNotification(editing ? `Article Type "${res.data.name}" saved.` : `Article Type "${res.data.name}" created.`, 'success');
      startEdit(null);
      await load();
      void refreshData();
    }
  };

  const toggleActive = async (t: ArticleTypeDefinition) => {
    if (t.isActive && !confirm(`Deactivate "${t.name}"? Existing articles keep this type; it will no longer be offered for new articles.`)) return;
    const res = await apiCall<ArticleTypeDefinition>(`/api/article-types/${t.id}`, { method: 'PUT', body: { isActive: !t.isActive } });
    if (res.data) { showNotification(`"${t.name}" ${res.data.isActive ? 'activated' : 'deactivated'}.`, 'success'); await load(); void refreshData(); }
  };

  const move = async (t: ArticleTypeDefinition, dir: -1 | 1) => {
    const idx = types.findIndex((x) => x.id === t.id);
    const other = types[idx + dir];
    if (!other) return;
    setBusy(true);
    await apiCall(`/api/article-types/${t.id}`, { method: 'PUT', body: { sortOrder: other.sortOrder } });
    await apiCall(`/api/article-types/${other.id}`, { method: 'PUT', body: { sortOrder: t.sortOrder } });
    setBusy(false);
    await load();
    void refreshData();
  };

  const remove = async (t: ArticleTypeDefinition) => {
    if (!confirm(`Delete the unused Article Type "${t.name}"? This cannot be undone.`)) return;
    const res = await apiCall(`/api/article-types/${t.id}`, { method: 'DELETE' });
    if (res.data) { showNotification(`"${t.name}" deleted.`, 'success'); await load(); void refreshData(); }
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Article Types</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-600 dark:text-stone-400">
          The types offered in the article editor. Every type uses the same editor, workflow, SEO system, media, search and publishing.
          A type in use can be deactivated but not renamed or deleted, so existing articles keep their type.
          {!isAdmin && ' Only Admins can change this list.'}
        </p>
      </div>

      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      {isAdmin && (
        <form onSubmit={save} className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-900/60 sm:grid-cols-2 lg:grid-cols-5" aria-label={editing ? `Edit ${editing.name}` : 'Add Article Type'}>
          <label className="text-xs font-semibold lg:col-span-2">Name
            <input className={input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required maxLength={60} disabled={!!editing && (editing.isSystem || (editing.articleCount ?? 0) > 0)} />
            {editing && (editing.isSystem || (editing.articleCount ?? 0) > 0) && <span className="mt-1 block text-[11px] font-normal text-stone-500">Locked: {editing.isSystem ? 'specification type' : `used by ${editing.articleCount} article(s)`}.</span>}
          </label>
          <label className="text-xs font-semibold">Structured data
            <select className={input} value={draft.schemaType} onChange={(e) => setDraft({ ...draft, schemaType: e.target.value })}>
              {ARTICLE_SCHEMA_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">SEO profile
            <select className={input} value={draft.seoProfile} onChange={(e) => setDraft({ ...draft, seoProfile: e.target.value })}>
              {ARTICLE_TYPE_SEO_PROFILES.map((p) => <option key={p} value={p}>{p}{PROFILE_HELP[p] ? ` — ${PROFILE_HELP[p]}` : ''}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold">Order
            <input className={input} type="number" min={0} max={100000} value={draft.sortOrder} onChange={(e) => setDraft({ ...draft, sortOrder: e.target.value })} placeholder="auto" />
          </label>
          <label className="text-xs font-semibold sm:col-span-2 lg:col-span-4">Description (for editors)
            <input className={input} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={300} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" isLoading={busy}>{editing ? 'Save type' : 'Add type'}</Button>
            {editing && <Button type="button" size="sm" variant="ghost" onClick={() => startEdit(null)}>Cancel</Button>}
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wider text-stone-500 dark:bg-stone-900 dark:text-stone-400">
            <tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Articles</th><th className="px-3 py-2">Structured data</th><th className="px-3 py-2">SEO profile</th>{isAdmin && <th className="px-3 py-2 text-right">Actions</th>}</tr>
          </thead>
          <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
            {types.map((t, i) => (
              <tr key={t.id} data-article-type={t.name} className={t.isActive ? '' : 'opacity-60'}>
                <td className="px-3 py-2"><div className="font-semibold">{t.name}</div>{t.description && <div className="text-xs text-stone-500 dark:text-stone-400">{t.description}</div>}{t.isSystem && <span className="mt-1 inline-block rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-600 dark:bg-stone-800 dark:text-stone-300">Specification</span>}</td>
                <td className="px-3 py-2 text-xs">{t.isActive ? 'Active' : 'Inactive'}</td>
                <td className="px-3 py-2 tabular-nums">{t.articleCount ?? 0}</td>
                <td className="px-3 py-2 text-xs">{t.schemaType}</td>
                <td className="px-3 py-2 text-xs">{t.seoProfile}</td>
                {isAdmin && <td className="px-3 py-2">
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button size="sm" variant="ghost" disabled={busy || i === 0} onClick={() => move(t, -1)} aria-label={`Move ${t.name} up`}>↑</Button>
                    <Button size="sm" variant="ghost" disabled={busy || i === types.length - 1} onClick={() => move(t, 1)} aria-label={`Move ${t.name} down`}>↓</Button>
                    <Button size="sm" variant="outline" onClick={() => startEdit(t)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => toggleActive(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>
                    {!t.isSystem && !(t.articleCount ?? 0) && <Button size="sm" variant="danger" onClick={() => remove(t)}>Delete</Button>}
                  </div>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
