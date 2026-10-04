'use client';

/** Area editors for the Site Experience Control Center (PHASE F.1). Each edits one draft document. */

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { IntroAppearanceEditor } from './IntroAppearanceEditor';
import {
  BLOCK_PLACEMENTS, SOCIAL_PLATFORMS,
  type AnnouncementsConfig, type ArticleSource, type AutoSource, type BlocksConfig, type FooterConfig, type GlobalBlock,
  type HomeSection, type HomepageConfig, type NavigationConfig, type SocialPlatform,
} from '../../../lib/siteExperience/types';
import { ArticlePicker, DateTimeField, LinkFields, Pill, RowControls, Select, Text, Toggle, inputClass, labelClass, move, newId } from './fields';

const card = 'rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950';
const addBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone-400 px-3 py-2 text-xs font-semibold text-stone-700 hover:border-amber-500 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-600 dark:text-stone-200';

// ── Homepage ──
const SECTION_LABEL: Record<HomeSection['type'], string> = {
  intro: 'Intro banner', featured: 'Hero / top stories', articles: 'Article list', featuredEvents: 'Featured events',
  sportsGrid: 'Explore by sport', upcomingEditions: 'Upcoming editions', block: 'Global block', adSlot: 'Ad placement',
};
const autoLabel = (a: AutoSource) => (a.kind === 'latest' ? 'Latest articles' : `${a.kind === 'type' ? 'Category' : a.kind === 'sport' ? 'Sport' : 'Event'}: ${a.value}`);

function newSection(type: HomeSection['type']): HomeSection {
  const id = newId(type.toLowerCase());
  const source: ArticleSource = { mode: 'auto', auto: { kind: 'latest' }, articleIds: [] };
  switch (type) {
    case 'intro': return { id, type, enabled: true, eyebrow: '', title: 'New intro', text: '', primaryCta: null, secondaryCta: null };
    case 'featured': return { id, type, enabled: true, label: 'Top stories', layout: 'lead-grid', source: { ...source, mode: 'manual' }, count: 4 };
    case 'articles': return { id, type, enabled: true, eyebrow: '', title: 'New section', layout: 'grid', source, count: 4, moreLink: null };
    case 'featuredEvents': return { id, type, enabled: true, eyebrow: '', title: 'Featured events', count: 4 };
    case 'sportsGrid': return { id, type, enabled: true, eyebrow: '', title: 'Explore by sport' };
    case 'upcomingEditions': return { id, type, enabled: true, eyebrow: '', title: 'Upcoming editions', count: 3 };
    case 'block': return { id, type, enabled: true, blockId: '' };
    case 'adSlot': return { id, type, enabled: true, slot: 'HOMEPAGE_MIDDLE' };
  }
}

function SourceEditor({ value, onChange, max }: { value: ArticleSource; onChange: (v: ArticleSource) => void; max: number }) {
  const { sports, events, articleTypes } = useApp();
  const auto = value.auto;
  // PHASE R: categories come from the database-backed Article Types.
  const ARTICLE_TYPES = articleTypes.filter((t) => t.isActive || (auto.kind === 'type' && t.name === auto.value)).map((t) => t.name);
  const setAuto = (kind: AutoSource['kind']) => onChange({ ...value, auto: kind === 'latest' ? { kind } : { kind, value: kind === 'type' ? ARTICLE_TYPES[0] : kind === 'sport' ? sports[0]?.slug ?? '' : events[0] ? `${events[0].sportSlug}/${events[0].slug}` : '' } as AutoSource });
  return (
    <div className="space-y-3 rounded-lg bg-stone-50 p-3 dark:bg-stone-900/60">
      <Select label="Content source" value={value.mode} onChange={(mode) => onChange({ ...value, mode })} options={[['auto', 'Automatic'], ['manual', 'Manual — chosen articles only'], ['mixed', 'Mixed — chosen first, then automatic']]} />
      {value.mode !== 'auto' && <ArticlePicker label="Chosen articles" value={value.articleIds} max={max} onChange={(articleIds) => onChange({ ...value, articleIds })} />}
      <div className="grid gap-2 sm:grid-cols-2">
        <Select label={value.mode === 'manual' ? 'Fallback if a chosen article is unavailable' : 'Automatic source'} value={auto.kind} onChange={setAuto} options={[['latest', 'Latest articles'], ['sport', 'Latest from a sport'], ['event', 'Latest from an event'], ['type', 'Latest in a category']]} />
        {auto.kind === 'sport' && <Select label="Sport" value={auto.value} onChange={(v) => onChange({ ...value, auto: { kind: 'sport', value: v } })} options={sports.map((s) => [s.slug, s.name])} />}
        {auto.kind === 'event' && <Select label="Event" value={auto.value} onChange={(v) => onChange({ ...value, auto: { kind: 'event', value: v } })} options={events.map((e) => [`${e.sportSlug}/${e.slug}`, e.name])} />}
        {auto.kind === 'type' && <Select label="Category" value={auto.value} onChange={(v) => onChange({ ...value, auto: { kind: 'type', value: v } })} options={ARTICLE_TYPES.map((t) => [t, t])} />}
      </div>
    </div>
  );
}

function Count({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return <label className={labelClass}>{label}<input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))} className={`${inputClass} w-24`} /></label>;
}

function SectionFields({ s, set, blocks }: { s: HomeSection; set: (s: HomeSection) => void; blocks: GlobalBlock[] }) {
  switch (s.type) {
    case 'intro': return (
      <div className="grid gap-3">
        <Text label="Eyebrow (use ' · ' to split into two parts)" value={s.eyebrow} max={120} onChange={(eyebrow) => set({ ...s, eyebrow })} />
        <Text label="Headline" value={s.title} max={200} onChange={(title) => set({ ...s, title })} />
        <Text label="Text" value={s.text} max={600} multiline onChange={(text) => set({ ...s, text })} />
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkFields label="Primary button" optional value={s.primaryCta} onChange={(primaryCta) => set({ ...s, primaryCta })} />
          <LinkFields label="Secondary button" optional value={s.secondaryCta} onChange={(secondaryCta) => set({ ...s, secondaryCta })} />
        </div>
        <IntroAppearanceEditor section={s} onChange={set} />
      </div>
    );
    case 'featured': return (
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><Text label="Label (optional)" value={s.label} max={60} onChange={(label) => set({ ...s, label })} /><Count label="Stories (1 main + up to 3)" value={s.count} min={1} max={4} onChange={(count) => set({ ...s, count })} /></div>
        <Select label="Hero layout" value={s.layout ?? 'lead-grid'} onChange={(layout) => set({ ...s, layout })} options={[['lead-grid', 'Lead story with secondary stories'], ['grid', 'Equal story cards']]} />
        <SourceEditor value={s.source} max={4} onChange={(source) => set({ ...s, source })} />
      </div>
    );
    case 'articles': return (
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2"><Text label="Eyebrow" value={s.eyebrow} max={80} onChange={(eyebrow) => set({ ...s, eyebrow })} /><Text label="Title" value={s.title} max={120} onChange={(title) => set({ ...s, title })} /></div>
        <div className="flex flex-wrap gap-3">
          <Select label="Layout" value={s.layout} onChange={(layout) => set({ ...s, layout })} options={[['lead-grid', 'Lead story + grid + list'], ['grid', 'Card grid'], ['list', 'Compact list']]} />
          <Count label="Articles" value={s.count} min={1} max={12} onChange={(count) => set({ ...s, count })} />
        </div>
        <SourceEditor value={s.source} max={12} onChange={(source) => set({ ...s, source })} />
        <LinkFields label="'View all' link" optional value={s.moreLink} onChange={(moreLink) => set({ ...s, moreLink })} />
      </div>
    );
    case 'featuredEvents': case 'upcomingEditions': return (
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Text label="Eyebrow" value={s.eyebrow} max={80} onChange={(eyebrow) => set({ ...s, eyebrow })} />
        <Text label="Title" value={s.title} max={120} onChange={(title) => set({ ...s, title })} />
        <Count label="Items" value={s.count} min={1} max={12} onChange={(count) => set({ ...s, count } as HomeSection)} />
      </div>
    );
    case 'sportsGrid': return (
      <div className="grid gap-3 sm:grid-cols-2"><Text label="Eyebrow" value={s.eyebrow} max={80} onChange={(eyebrow) => set({ ...s, eyebrow })} /><Text label="Title" value={s.title} max={120} onChange={(title) => set({ ...s, title })} /></div>
    );
    case 'block': return (
      <div>
        <Select label="Block (only blocks placed on the homepage appear)" value={s.blockId} onChange={(blockId) => set({ ...s, blockId })} options={[['', '— choose —'], ...blocks.map((b): [string, string] => [b.id, `${b.name}${b.placements.includes('homepage') ? '' : ' (not placed on homepage)'}`])]} />
      </div>
    );
    case 'adSlot': return (
      <div className="space-y-2">
        <Select label="Ad placement" value={s.slot} onChange={(slot) => set({ ...s, slot })} options={[['HOMEPAGE_TOP', 'Homepage top'], ['HOMEPAGE_MIDDLE', 'Homepage middle']]} />
        <p className="text-[11px] text-stone-500 dark:text-stone-400">Only the position is set here. What the slot shows (sponsor or AdSense) and whether it is on is managed in Ad Placements, with its labelling and consent rules.</p>
      </div>
    );
  }
}

function sectionSummary(s: HomeSection): string {
  if ('source' in s) return `${s.source.mode} · ${autoLabel(s.source.auto)}${s.source.articleIds.length ? ` · ${s.source.articleIds.length} chosen` : ''} · ${s.count}`;
  if (s.type === 'adSlot') return s.slot;
  if (s.type === 'block') return s.blockId || 'no block chosen';
  return 'title' in s ? s.title : '';
}

export function HomepageEditor({ value, onChange, blocks }: { value: HomepageConfig; onChange: (v: HomepageConfig) => void; blocks: GlobalBlock[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<HomeSection['type']>('articles');
  const setAt = (i: number, s: HomeSection) => onChange({ sections: value.sections.map((x, j) => (j === i ? s : x)) });
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {value.sections.map((s, i) => (
          <li key={s.id} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const from = value.sections.findIndex((x) => x.id === e.dataTransfer.getData('text/site-section')); if (from >= 0 && from !== i) onChange({ sections: move(value.sections, from, i) }); }} className={`${card} ${s.enabled ? '' : 'opacity-70'}`}>
            <div className="flex flex-wrap items-center gap-3">
              <span draggable onDragStart={(e) => { e.dataTransfer.setData('text/site-section', s.id); e.dataTransfer.effectAllowed = 'move'; }} title="Drag to reorder; move buttons also support keyboard ordering" className="w-6 cursor-grab text-center text-xs font-bold text-stone-500 dark:text-stone-400">☰ {i + 1}</span>
              <button type="button" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)} className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded">
                <span className="block text-sm font-semibold">{SECTION_LABEL[s.type]}{'title' in s && s.title ? ` — ${s.title}` : ''}</span>
                <span className="block truncate text-[11px] text-stone-500 dark:text-stone-400">{sectionSummary(s)}</span>
              </button>
              <Toggle label={s.enabled ? 'Visible' : 'Hidden'} checked={s.enabled} onChange={(enabled) => setAt(i, { ...s, enabled })} />
              <RowControls index={i} count={value.sections.length} label={SECTION_LABEL[s.type]} onMove={(to) => onChange({ sections: move(value.sections, i, to) })} onRemove={() => onChange({ sections: value.sections.filter((_, j) => j !== i) })} />
            </div>
            {open === s.id && <div className="mt-4 border-t border-stone-200 pt-4 dark:border-stone-800"><SectionFields s={s} blocks={blocks} set={(n) => setAt(i, n)} /></div>}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-2">
        <Select<HomeSection['type']> label="Add a section" value={adding} onChange={setAdding} options={(Object.keys(SECTION_LABEL) as HomeSection['type'][]).map((t) => [t, SECTION_LABEL[t]])} />
        <button type="button" className={addBtn} onClick={() => { const s = newSection(adding); onChange({ sections: [...value.sections, s] }); setOpen(s.id); }}><Plus size={14} /> Add</button>
      </div>
    </div>
  );
}

// ── Navigation ──
export function NavigationEditor({ value, onChange }: { value: NavigationConfig; onChange: (v: NavigationConfig) => void }) {
  const setAt = (i: number, patch: Partial<NavigationConfig['items'][number]>) => onChange({ items: value.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {value.items.map((item, i) => (
          <li key={item.id} className={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">{item.label || '(no label)'} {item.kind === 'sportsMenu' && <Pill tone="sky">Sports menu</Pill>}</span>
              <RowControls index={i} count={value.items.length} label={item.label} onMove={(to) => onChange({ items: move(value.items, i, to) })} onRemove={() => onChange({ items: value.items.filter((_, j) => j !== i) })} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Text label="Label" value={item.label} max={40} onChange={(label) => setAt(i, { label })} />
              <Text label="Mobile label (optional)" value={item.mobileLabel} max={60} onChange={(mobileLabel) => setAt(i, { mobileLabel })} />
              <Text label={item.kind === 'sportsMenu' ? '“View directory” link' : 'Link (/path or https://…)'} value={item.href} max={500} onChange={(href) => setAt(i, { href })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-4">
              <Toggle label="Desktop" checked={item.desktop} onChange={(desktop) => setAt(i, { desktop })} />
              <Toggle label="Mobile" checked={item.mobile} onChange={(mobile) => setAt(i, { mobile })} />
              {item.kind === 'link' && <Toggle label="Search icon" checked={item.icon === 'search'} onChange={(on) => setAt(i, { icon: on ? 'search' : 'none' })} />}
              {item.kind === 'link' && /^https:\/\//.test(item.href) && <Toggle label="Open in new tab" checked={item.newTab} onChange={(newTab) => setAt(i, { newTab })} />}
            </div>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={addBtn} onClick={() => onChange({ items: [...value.items, { id: newId('link'), kind: 'link', label: 'New link', mobileLabel: '', href: '/', icon: 'none', desktop: true, mobile: true, newTab: false }] })}><Plus size={14} /> Add link</button>
        {!value.items.some((i) => i.kind === 'sportsMenu') && <button type="button" className={addBtn} onClick={() => onChange({ items: [{ id: 'sports', kind: 'sportsMenu', label: 'Sports', mobileLabel: 'All Sports Directory', href: '/sports/', icon: 'none', desktop: true, mobile: true, newTab: false }, ...value.items] })}><Plus size={14} /> Add sports menu</button>}
      </div>
    </div>
  );
}

// ── Footer ──
const PLATFORM_LABEL: Record<SocialPlatform, string> = { x: 'X (Twitter)', facebook: 'Facebook', instagram: 'Instagram', youtube: 'YouTube', linkedin: 'LinkedIn', bluesky: 'Bluesky', tiktok: 'TikTok' };

export function FooterEditor({ value, onChange }: { value: FooterConfig; onChange: (v: FooterConfig) => void }) {
  const setCol = (i: number, patch: Partial<FooterConfig['columns'][number]>) => onChange({ ...value, columns: value.columns.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const missing = SOCIAL_PLATFORMS.filter((p) => !value.social.some((s) => s.platform === p));
  return (
    <div className="space-y-4">
      <div className={`${card} grid gap-3`}>
        <h3 className="text-sm font-bold">Identity</h3>
        <Text label="Tagline" value={value.tagline} max={400} multiline onChange={(tagline) => onChange({ ...value, tagline })} />
        {value.notes.map((n, i) => <Text key={i} label={`Note ${i + 1}`} value={n} max={160} onChange={(t) => onChange({ ...value, notes: value.notes.map((x, j) => (j === i ? t : x)) })} />)}
        <div className="flex gap-2">
          {value.notes.length < 3 && <button type="button" className={addBtn} onClick={() => onChange({ ...value, notes: [...value.notes, ''] })}><Plus size={14} /> Add note</button>}
          {value.notes.length > 0 && <button type="button" className={addBtn} onClick={() => onChange({ ...value, notes: value.notes.slice(0, -1) })}>Remove last note</button>}
        </div>
        <Text label="Copyright line" value={value.copyright} max={300} onChange={(copyright) => onChange({ ...value, copyright })} />
        <Text label="Status text (empty hides it)" value={value.statusText} max={60} onChange={(statusText) => onChange({ ...value, statusText })} />
      </div>

      {value.columns.map((col, i) => (
        <div key={col.id} className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-bold">{col.title} {col.kind === 'sports' && <Pill tone="sky">Lists sports</Pill>}</span>
            <div className="flex items-center gap-3">
              <Toggle label={col.enabled ? 'Visible' : 'Hidden'} checked={col.enabled} onChange={(enabled) => { if (!enabled && col.links.some((l) => l.system && l.enabled) && !confirm(`“${col.title}” contains required site links (e.g. Privacy Policy). Hide the whole column anyway? The pages themselves stay online.`)) return; setCol(i, { enabled }); }} />
              <RowControls index={i} count={value.columns.length} label={col.title} onMove={(to) => onChange({ ...value, columns: move(value.columns, i, to) })} onRemove={col.links.some((l) => l.system) ? undefined : () => onChange({ ...value, columns: value.columns.filter((_, j) => j !== i) })} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Text label="Column title" value={col.title} max={60} onChange={(title) => setCol(i, { title })} />
            {col.kind === 'sports' && <label className={labelClass}>Sports shown<input type="number" min={1} max={20} value={col.sportsCount} onChange={(e) => setCol(i, { sportsCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} className={`${inputClass} w-24`} /></label>}
          </div>
          <ul className="mt-3 space-y-2">
            {col.links.map((l, j) => (
              <li key={l.id} className="grid items-end gap-2 rounded-lg bg-stone-50 p-2 sm:grid-cols-[1fr_1fr_auto_auto] dark:bg-stone-900/60">
                <Text label="Label" value={l.label} max={60} onChange={(label) => setCol(i, { links: col.links.map((x, k) => (k === j ? { ...x, label } : x)) })} />
                {l.kind === 'privacyChoices' ? <p className="pb-2 text-[11px] text-stone-500 dark:text-stone-400">Opens the privacy preferences (no link).</p> : <Text label="Link" value={l.href} max={500} onChange={(href) => setCol(i, { links: col.links.map((x, k) => (k === j ? { ...x, href } : x)) })} />}
                <Toggle label={l.system ? 'Visible (required)' : 'Visible'} checked={l.enabled} onChange={(enabled) => { if (!enabled && l.system && !confirm(`“${l.label}” is a required site link. Hiding it removes it from the footer only — the page stays online. Hide it?`)) return; setCol(i, { links: col.links.map((x, k) => (k === j ? { ...x, enabled } : x)) }); }} />
                <RowControls index={j} count={col.links.length} label={l.label} onMove={(to) => setCol(i, { links: move(col.links, j, to) })} onRemove={l.system ? undefined : () => setCol(i, { links: col.links.filter((_, k) => k !== j) })} />
              </li>
            ))}
          </ul>
          <button type="button" className={`${addBtn} mt-2`} onClick={() => setCol(i, { links: [...col.links, { id: newId('link'), label: 'New link', href: '/', enabled: true, kind: 'link', system: false }] })}><Plus size={14} /> Add link</button>
        </div>
      ))}
      {value.columns.length < 6 && <button type="button" className={addBtn} onClick={() => onChange({ ...value, columns: [...value.columns, { id: newId('column'), title: 'New column', enabled: true, kind: 'links', sportsCount: 0, links: [] }] })}><Plus size={14} /> Add column</button>}

      <div className={card}>
        <h3 className="mb-3 text-sm font-bold">Social profiles</h3>
        <ul className="space-y-2">
          {value.social.map((s, i) => (
            <li key={s.platform} className="grid items-end gap-2 sm:grid-cols-[10rem_1fr_auto_auto]">
              <span className="pb-2 text-xs font-semibold">{PLATFORM_LABEL[s.platform]}</span>
              <Text label="Profile URL (https://)" value={s.url} max={500} onChange={(url) => onChange({ ...value, social: value.social.map((x, j) => (j === i ? { ...x, url } : x)) })} />
              <Toggle label="Show" checked={s.enabled} onChange={(enabled) => onChange({ ...value, social: value.social.map((x, j) => (j === i ? { ...x, enabled } : x)) })} />
              <RowControls index={i} count={value.social.length} label={PLATFORM_LABEL[s.platform]} onMove={(to) => onChange({ ...value, social: move(value.social, i, to) })} onRemove={() => onChange({ ...value, social: value.social.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        {missing.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {missing.map((p) => <button key={p} type="button" className={addBtn} onClick={() => onChange({ ...value, social: [...value.social, { platform: p, url: 'https://', enabled: false }] })}><Plus size={14} /> {PLATFORM_LABEL[p]}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Announcements ──
export function AnnouncementsEditor({ value, onChange }: { value: AnnouncementsConfig; onChange: (v: AnnouncementsConfig) => void }) {
  const setAt = (i: number, patch: Partial<AnnouncementsConfig['items'][number]>) => onChange({ items: value.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-600 dark:text-stone-400">Shown in a bar under the header on every public page: the two highest-priority announcements that are on and inside their start/end window. Expired announcements disappear automatically.</p>
      {value.items.map((a, i) => (
        <div key={a.id} className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-semibold">{a.variant === 'breaking' ? <Pill tone="amber">Breaking</Pill> : <Pill>Info</Pill>} {a.text || '(no text)'}</span>
            <div className="flex items-center gap-3"><Toggle label={a.enabled ? 'On' : 'Off'} checked={a.enabled} onChange={(enabled) => setAt(i, { enabled })} /><RowControls index={i} count={value.items.length} label="announcement" onMove={(to) => onChange({ items: move(value.items, i, to) })} onRemove={() => onChange({ items: value.items.filter((_, j) => j !== i) })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem_6rem]">
            <Text label="Text" value={a.text} max={200} onChange={(text) => setAt(i, { text })} />
            <Select label="Style" value={a.variant} onChange={(variant) => setAt(i, { variant })} options={[['breaking', 'Breaking news'], ['info', 'Information']]} />
            <label className={labelClass}>Priority<input type="number" min={0} max={100} value={a.priority} onChange={(e) => setAt(i, { priority: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={inputClass} /></label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <ArticlePicker label="Link to an article (optional)" value={a.articleId ? [a.articleId] : []} max={1} onChange={(ids) => setAt(i, { articleId: ids[0] ?? '', href: ids[0] ? '' : a.href })} />
            {!a.articleId && <Text label="…or a link (/path or https://…, optional)" value={a.href} max={500} onChange={(href) => setAt(i, { href })} />}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DateTimeField label="Start (empty = now)" value={a.startAt} onChange={(startAt) => setAt(i, { startAt })} />
            <DateTimeField label="End (empty = until turned off)" value={a.endAt} onChange={(endAt) => setAt(i, { endAt })} />
          </div>
        </div>
      ))}
      <button type="button" className={addBtn} onClick={() => onChange({ items: [...value.items, { id: newId('announcement'), enabled: true, variant: 'info', text: '', href: '', articleId: '', priority: 50, startAt: null, endAt: null }] })}><Plus size={14} /> Add announcement</button>
    </div>
  );
}

// ── Global blocks ──
const PLACEMENT_LABEL: Record<(typeof BLOCK_PLACEMENTS)[number], string> = { homepage: 'Homepage (add a “Global block” section)', article_end: 'End of every article', sport_top: 'Top of sport pages', footer_top: 'Above the footer (all pages)' };

export function BlocksEditor({ value, onChange }: { value: BlocksConfig; onChange: (v: BlocksConfig) => void }) {
  const setAt = (i: number, patch: Partial<GlobalBlock>) => onChange({ items: value.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-3">
      <p className="text-xs text-stone-600 dark:text-stone-400">Reusable editorial blocks: plain text and links only. Advertising belongs in Ad Placements.</p>
      {value.items.map((b, i) => (
        <div key={b.id} className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold">{b.name || '(unnamed)'} <Pill>{b.type}</Pill></span>
            <div className="flex items-center gap-3"><Toggle label={b.enabled ? 'On' : 'Off'} checked={b.enabled} onChange={(enabled) => setAt(i, { enabled })} /><RowControls index={i} count={value.items.length} label={b.name} onMove={(to) => onChange({ items: move(value.items, i, to) })} onRemove={() => onChange({ items: value.items.filter((_, j) => j !== i) })} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Text label="Internal name" value={b.name} max={80} onChange={(name) => setAt(i, { name })} />
            <Select label="Type" value={b.type} onChange={(type) => setAt(i, { type, cta: type === 'cta' ? b.cta ?? { label: 'Learn more', href: '/' } : null, articleId: type === 'featuredStory' ? b.articleId : '' })} options={[['message', 'Editorial message'], ['cta', 'Call to action (button)'], ['featuredStory', 'Featured story']]} />
            <Text label={b.type === 'featuredStory' ? 'Label (optional)' : 'Title'} value={b.title} max={120} onChange={(title) => setAt(i, { title })} />
            {b.type !== 'featuredStory' && <Text label="Text" value={b.text} max={500} multiline onChange={(text) => setAt(i, { text })} />}
          </div>
          {b.type === 'cta' && <div className="mt-3"><LinkFields label="Button" value={b.cta} onChange={(cta) => setAt(i, { cta })} /></div>}
          {b.type === 'featuredStory' && <div className="mt-3"><ArticlePicker label="Featured article" value={b.articleId ? [b.articleId] : []} max={1} onChange={(ids) => setAt(i, { articleId: ids[0] ?? '' })} /></div>}
          <fieldset className="mt-3">
            <legend className={labelClass}>Placements</legend>
            <div className="mt-1 flex flex-wrap gap-4">
              {BLOCK_PLACEMENTS.map((p) => <Toggle key={p} label={PLACEMENT_LABEL[p]} checked={b.placements.includes(p)} onChange={(on) => setAt(i, { placements: on ? [...b.placements, p] : b.placements.filter((x) => x !== p) })} />)}
            </div>
          </fieldset>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <DateTimeField label="Start (empty = now)" value={b.startAt} onChange={(startAt) => setAt(i, { startAt })} />
            <DateTimeField label="End (empty = no end)" value={b.endAt} onChange={(endAt) => setAt(i, { endAt })} />
          </div>
        </div>
      ))}
      <button type="button" className={addBtn} onClick={() => onChange({ items: [...value.items, { id: newId('block'), name: 'New block', type: 'message', enabled: true, title: '', text: '', cta: null, articleId: '', placements: [], startAt: null, endAt: null }] })}><Plus size={14} /> Add block</button>
    </div>
  );
}
