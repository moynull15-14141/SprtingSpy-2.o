'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { Button } from '../../ui/Button';
import { ADMIN_ONLY_PUBLISH, SITE_AREAS, inWindow, type SiteArea, type SiteExperienceDocs } from '../../../lib/siteExperience/types';
import { DEFAULT_SITE_EXPERIENCE } from '../../../lib/siteExperience/defaults';
import { checkDocument } from '../../../lib/siteExperience/validate';
import { sameDocument } from '../../../lib/siteExperience/compare';
import type { AreaState } from '../../../../server/siteExperience';
import { AnnouncementsEditor, BlocksEditor, FooterEditor, HomepageEditor, NavigationEditor } from './editors';
import { DateTimeField, Pill } from './fields';

const names: Record<SiteArea, string> = { homepage: 'Homepage', navigation: 'Header & Navigation', footer: 'Footer', blocks: 'Global Blocks', announcements: 'Announcements' };
type Tab = 'overview' | SiteArea | 'publish';
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never';

export function AdminSiteExperience() {
  const { apiCall, currentUser, showNotification } = useApp();
  const api = useRef(apiCall);
  api.current = apiCall;
  const [areas, setAreas] = useState<AreaState[]>([]);
  const [documents, setDocuments] = useState<SiteExperienceDocs>(structuredClone(DEFAULT_SITE_EXPERIENCE));
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scheduleAt, setScheduleAt] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const allowed = ['Admin', 'Editor'].includes(currentUser.role);
  const dirtyAreas = areas.filter((a) => !sameDocument(documents[a.area], a.draft));
  const dirty = dirtyAreas.length > 0;

  const accept = useCallback((next: AreaState[]) => {
    setAreas(next);
    setDocuments(Object.fromEntries(next.map((a) => [a.area, checkDocument(a.area, a.draft).value ?? DEFAULT_SITE_EXPERIENCE[a.area]])) as unknown as SiteExperienceDocs);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.current<{ areas: AreaState[] }>('/api/site-experience');
    if (res.data) { accept(res.data.areas); setError(''); }
    else setError(res.error ?? 'Unable to load site configuration.');
    setLoading(false);
  }, [accept]);
  useEffect(() => { if (allowed) void load(); }, [allowed, currentUser.id, load]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const guard = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('a,button');
      if (!target || target.closest('[data-site-experience]')) return;
      if ((target.tagName === 'A' || target.closest('[data-admin-shell] nav')) && !window.confirm('You have unsaved Site Experience changes. Leave without saving?')) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guard, true); };
  }, [dirty]);

  if (!allowed) return <p>Site Experience is available to Admins and Editors.</p>;
  const canPublish = (area: SiteArea) => currentUser.role === 'Admin' || !ADMIN_ONLY_PUBLISH.includes(area);
  const change = <A extends SiteArea>(area: A, doc: SiteExperienceDocs[A]) => setDocuments((d) => ({ ...d, [area]: doc }));
  const action = async (area: SiteArea, kind: 'draft' | 'publish' | 'schedule' | 'discard' | 'cancel') => {
    if (kind !== 'draft' && dirty) { setError('Save your unsaved changes before publishing, scheduling or discarding.'); return; }
    setBusy(true); setError('');
    const res = await apiCall<{ areas: AreaState[] }>(`/api/site-experience/${area}/${kind === 'cancel' ? 'schedule' : kind}`, {
      method: kind === 'draft' ? 'PUT' : kind === 'cancel' ? 'DELETE' : 'POST',
      ...(kind === 'draft' ? { body: { document: documents[area] } } : kind === 'schedule' ? { body: { at: scheduleAt } } : {}),
    });
    if (res.data) {
      // Saving one area must preserve local edits in the other areas.
      const keep = dirtyAreas.filter((a) => a.area !== area).map((a) => a.area);
      setAreas(res.data.areas);
      setDocuments((d) => ({ ...d, ...Object.fromEntries(res.data!.areas.filter((a) => !keep.includes(a.area)).map((a) => [a.area, checkDocument(a.area, a.draft).value ?? DEFAULT_SITE_EXPERIENCE[a.area]])) }));
      showNotification(kind === 'draft' ? 'Draft saved. Ready to preview.' : kind === 'publish' ? 'Published. Visitors see this version on their next page load.' : kind === 'schedule' ? 'Publication scheduled.' : kind === 'cancel' ? 'Schedule cancelled.' : 'Draft changes discarded.', 'success');
    } else setError(res.error ?? 'The action failed. Your edits are preserved.');
    setBusy(false);
  };
  const togglePreview = async (enabled: boolean) => {
    if (dirty) { setError('Save your changes before previewing.'); return; }
    setBusy(true); setError('');
    const res = await apiCall<{ preview: boolean }>('/api/site-experience/preview', { method: 'POST', body: { enabled } });
    if (res.data) setPreview(res.data.preview); else setError(res.error ?? 'Unable to change preview mode.');
    setBusy(false);
  };
  const active = areas.find((a) => a.area === tab);
  const blockState = areas.find((a) => a.area === 'blocks');
  const liveBlocks = checkDocument('blocks', blockState?.scheduledFor && Date.parse(blockState.scheduledFor) <= Date.now() ? blockState.scheduled : blockState?.published ?? DEFAULT_SITE_EXPERIENCE.blocks).value ?? DEFAULT_SITE_EXPERIENCE.blocks;
  const validation = active ? checkDocument(active.area, documents[active.area]) : null;
  const publishControls = (a: AreaState) => <div className="mt-3 flex flex-wrap items-center gap-2">
    <Button size="sm" disabled={busy || dirty || !canPublish(a.area)} onClick={() => void action(a.area, 'publish')}>Publish {names[a.area]}</Button>
    <Button size="sm" variant="outline" disabled={busy || dirty || !scheduleAt || !canPublish(a.area)} onClick={() => void action(a.area, 'schedule')}>Schedule {names[a.area]}</Button>
    {a.scheduledFor && <Button size="sm" variant="outline" disabled={busy || dirty || !canPublish(a.area)} onClick={() => void action(a.area, 'cancel')}>Cancel schedule</Button>}
    {a.hasDraftChanges && <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void action(a.area, 'discard')}>Discard saved draft</Button>}
    {!canPublish(a.area) && <p className="text-xs text-stone-500 dark:text-stone-400">An Admin publishes header/navigation and footer changes.</p>}
  </div>;

  return <section data-site-experience className="min-w-0 space-y-5">
    <div><h2 className="font-serif text-2xl font-bold">Site Experience</h2><p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Control the public site. Save a draft, preview it, then publish or schedule each area.</p></div>
    <nav aria-label="Site Experience areas" className="flex flex-wrap gap-2">
      {(['overview', ...SITE_AREAS, 'publish'] as Tab[]).map((t) => <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); setError(''); }} className={`rounded-lg border px-3 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${tab === t ? 'border-amber-700 bg-amber-700 text-white' : 'border-stone-300 dark:border-stone-700'}`}>{t === 'overview' ? 'Overview' : t === 'publish' ? 'Preview / Publish' : names[t]}</button>)}
    </nav>
    {error && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}{!areas.length && <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>}</div>}
    {loading ? <p role="status">Loading site configuration…</p> : !areas.length ? <p>No configuration loaded.</p> : <>
      {dirty && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-300">Unsaved changes in {dirtyAreas.map((a) => names[a.area]).join(', ')}. Saving keeps changes private.</p>}
      {tab === 'overview' && <>
        <div className="grid gap-3 sm:grid-cols-3">{[['Draft changes', areas.filter((a) => a.hasDraftChanges).length], ['Scheduled changes', areas.filter((a) => a.scheduledFor).length], ['Active global blocks', liveBlocks.items.filter((b) => b.enabled && inWindow(b)).length]].map(([label, count]) => <div key={label} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><p className="text-xs">{label}</p><p className="mt-2 text-2xl font-bold">{count}</p></div>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">{areas.map((a) => <div key={a.area} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><h3 className="mb-2 font-bold">{names[a.area]}</h3><div className="flex flex-wrap gap-2"><Pill tone={a.usingDefaults ? 'stone' : 'emerald'}>{a.usingDefaults ? 'Default configuration' : `Published v${a.version}`}</Pill>{a.hasDraftChanges && <Pill tone="amber">Draft</Pill>}{a.scheduledFor && <Pill tone="violet">Scheduled</Pill>}</div><p className="mt-2 text-xs">Last published: {formatTime(a.publishedAt)} · {a.publishedBy ?? '—'}</p><p className="mt-1 text-xs">Draft updated: {formatTime(a.draftUpdatedAt)} · {a.draftUpdatedBy ?? '—'}</p>{a.scheduledFor && <p className="mt-1 text-xs">Scheduled: {formatTime(a.scheduledFor)}</p>}<button type="button" onClick={() => setTab(a.area)} className="mt-3 text-xs font-bold text-amber-800 dark:text-amber-400">Edit {names[a.area]} →</button></div>)}</div>
      </>}
      {active && <>
        <h3 className="font-serif text-xl font-bold">{names[active.area]}</h3>
        {active.area === 'homepage' && <HomepageEditor value={documents.homepage} onChange={(d) => change('homepage', d)} blocks={documents.blocks.items} />}
        {active.area === 'navigation' && <NavigationEditor value={documents.navigation} onChange={(d) => change('navigation', d)} />}
        {active.area === 'footer' && <FooterEditor value={documents.footer} onChange={(d) => change('footer', d)} />}
        {active.area === 'announcements' && <AnnouncementsEditor value={documents.announcements} onChange={(d) => change('announcements', d)} />}
        {active.area === 'blocks' && <BlocksEditor value={documents.blocks} onChange={(d) => change('blocks', d)} />}
        {validation && !validation.ok && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{validation.error}</p>}
        <div className="flex flex-wrap gap-2"><Button size="sm" isLoading={busy} disabled={!validation?.ok || !dirtyAreas.some((a) => a.area === active.area)} onClick={() => void action(active.area, 'draft')}>Save draft</Button><Button size="sm" variant="outline" disabled={busy || !dirtyAreas.some((a) => a.area === active.area)} onClick={() => change(active.area, active.draft as SiteExperienceDocs[typeof active.area])}>Undo unsaved changes</Button><Button size="sm" variant="outline" onClick={() => setTab('publish')}>Preview / Publish</Button></div>
      </>}
      {tab === 'publish' && <div className="space-y-4">
        <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><h3 className="font-bold">Preview saved drafts</h3><p className="my-2 text-xs">Draft preview applies to your staff session for one hour. Check desktop and mobile sizes; visitors continue to see published content.</p><div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={busy || dirty} onClick={() => void togglePreview(true)}>Enable draft preview</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void togglePreview(false)}>Exit draft preview</Button><a href="/" target="_blank" rel="noopener" className="text-xs font-bold text-amber-800 dark:text-amber-400">Open website preview ↗</a></div>{preview && <p role="status" className="mt-2 text-xs">Draft preview enabled. Open the website to see your saved changes.</p>}</div>
        <div className="max-w-sm"><DateTimeField label="Publish at (your local time)" value={scheduleAt} onChange={setScheduleAt} /></div>
        {areas.map((a) => <div key={a.area} className="rounded-xl border border-stone-200 p-4 dark:border-stone-800"><h3 className="font-bold">{names[a.area]} <Pill>{a.hasDraftChanges ? 'Draft changes' : `Version ${a.version}`}</Pill></h3><p className="mt-2 text-xs">Published: {formatTime(a.publishedAt)} · {a.publishedBy ?? '—'}{a.scheduledFor ? ` · Scheduled: ${formatTime(a.scheduledFor)}` : ''}</p>{publishControls(a)}</div>)}
      </div>}
    </>}
  </section>;
}
