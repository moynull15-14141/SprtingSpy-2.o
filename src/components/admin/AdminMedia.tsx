/**
 * SportingSpy Media Library (PHASE C, Spec v1.1 §16).
 * Upload (validated + processed on the server), search/filter, metadata and
 * copyright review, stored-file details and usage history. Deleting is only
 * possible for unused images; nothing is ever deleted automatically.
 *
 * Folder system: images can be organized into folders. Admin and Editor can
 * create/rename/delete folders and move images between them.
 */

import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { CopyrightReview, MediaCreationType, MediaFolder, MediaItem } from '../../types';
import { Button } from '../ui/Button';
import { Copyright, FolderPlus, FolderOpen, Link2, Shapes, ChevronRight, Pencil, Trash2, X } from 'lucide-react';
import { IconFilterMenu } from './IconFilterMenu';
import { CREATION_TYPES, MediaUploadForm, REVIEW_STATES, ReviewBadge, inputClass, thumbnailUrl } from './media/MediaShared';

const USAGE_LABEL = { featured: 'featured image', body: 'in article body', image: 'image' } as const;

export const AdminMedia: React.FC = () => {
  const { mediaItems, mediaUsage, mediaFolders, currentUser, addMediaItem, updateMediaItem, deleteMediaItem, createMediaFolder, updateMediaFolder, deleteMediaFolder, moveMediaToFolder } = useApp();
  const canEdit = currentUser.role === 'Admin' || currentUser.role === 'Editor';
  const canDelete = currentUser.role === 'Admin';

  const [mode, setMode] = useState<'none' | 'upload' | 'url'>('none');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [reviewFilter, setReviewFilter] = useState('');
  const [usageFilter, setUsageFilter] = useState<'' | 'used' | 'unused'>('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null); // null = all, '' = unfiled, id = folder
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState<string | null>(null);
  const [showMoveDialog, setShowMoveDialog] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mediaItems.filter((m) => {
      if (activeFolder === '') { if (m.folderId) return false; }
      else if (activeFolder) { if (m.folderId !== activeFolder) return false; }
      const uses = mediaUsage[m.id]?.length || 0;
      if (q && ![m.title, m.altText, m.filename, m.credit, m.source, m.caption].some((v) => v?.toLowerCase().includes(q))) return false;
      if (typeFilter && m.creationType !== typeFilter) return false;
      if (reviewFilter && m.copyrightReview !== reviewFilter) return false;
      if (usageFilter === 'used' && !uses) return false;
      if (usageFilter === 'unused' && uses) return false;
      return true;
    });
  }, [mediaItems, mediaUsage, query, typeFilter, reviewFilter, usageFilter, activeFolder]);

  const unusedCount = mediaItems.filter((m) => !(mediaUsage[m.id]?.length)).length;
  const unfiledCount = mediaItems.filter((m) => !m.folderId).length;
  const selected = mediaItems.find((m) => m.id === selectedId) || null;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleMove = async () => {
    if (!selectedIds.size) return;
    await moveMediaToFolder([...selectedIds], moveTarget);
    setSelectedIds(new Set());
    setShowMoveDialog(false);
    setMoveTarget(null);
  };

  // Build folder tree (supports one level of nesting)
  const rootFolders = mediaFolders.filter((f) => !f.parentId);
  const childFolders = (parentId: string) => mediaFolders.filter((f) => f.parentId === parentId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Media Library</h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            {mediaItems.length} images · {unusedCount} unused. Uploads are validated and converted to responsive sizes on the server.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setMode(mode === 'upload' ? 'none' : 'upload')}>{mode === 'upload' ? 'Close upload' : '+ Upload image'}</Button>
          <Button size="sm" variant="outline" onClick={() => setMode(mode === 'url' ? 'none' : 'url')}>Register by URL</Button>
        </div>
      </div>

      {mode === 'upload' && <MediaUploadForm onUploaded={(item) => { setMode('none'); setSelectedId(item.id); }} onCancel={() => setMode('none')} />}
      {mode === 'url' && <RegisterByUrl onDone={() => setMode('none')} addMediaItem={addMediaItem} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input className={`${inputClass} max-w-xs`} placeholder="Search title, alt, filename, credit…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search media" />
        <div className="flex items-center gap-2" role="group" aria-label="Media filters">
          <IconFilterMenu icon={Shapes} label="Creation type" value={typeFilter} onChange={setTypeFilter}
            options={[{ value: '', label: 'All creation types' }, ...CREATION_TYPES.map((t) => ({ value: t, label: t }))]} />
          <IconFilterMenu icon={Copyright} label="Copyright review" value={reviewFilter} onChange={setReviewFilter}
            options={[{ value: '', label: 'Any copyright review' }, ...REVIEW_STATES.map((s) => ({ value: s, label: s }))]} />
          <IconFilterMenu icon={Link2} label="Usage" value={usageFilter} onChange={(v) => setUsageFilter(v as '' | 'used' | 'unused')}
            options={[{ value: '', label: 'Used and unused' }, { value: 'used', label: 'Used' }, { value: 'unused', label: 'Unused' }]} />
          {(typeFilter || reviewFilter || usageFilter) && (
            <button type="button" onClick={() => { setTypeFilter(''); setReviewFilter(''); setUsageFilter(''); }} className="ml-1 text-xs font-semibold text-amber-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-400">
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Selection actions bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2.5 text-xs">
          <span className="font-semibold text-amber-800 dark:text-amber-300">{selectedIds.size} selected</span>
          {canEdit && <Button size="sm" onClick={() => { setMoveTarget(null); setShowMoveDialog(true); }}>Move to folder</Button>}
          <button type="button" onClick={() => setSelectedIds(new Set())} className="ml-auto text-stone-500 hover:text-stone-700 dark:text-stone-400 text-xs font-semibold">Clear selection</button>
        </div>
      )}

      {/* Move dialog */}
      {showMoveDialog && (
        <div className="rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Move {selectedIds.size} image(s) to…</h3>
            <button type="button" onClick={() => setShowMoveDialog(false)} className="text-stone-500 hover:text-stone-700 dark:text-stone-400"><X size={16} /></button>
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto">
            <button type="button" onClick={() => setMoveTarget(null)}
              className={`w-full text-left px-3 py-1.5 rounded-lg ${moveTarget === null ? 'bg-amber-100 dark:bg-amber-900/40 font-semibold' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}>
              Unfiled (no folder)
            </button>
            {rootFolders.map((f) => (
              <div key={f.id}>
                <button type="button" onClick={() => setMoveTarget(f.id)}
                  className={`w-full text-left px-3 py-1.5 rounded-lg ${moveTarget === f.id ? 'bg-amber-100 dark:bg-amber-900/40 font-semibold' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}>
                  <FolderOpen size={14} className="inline mr-1.5 -mt-0.5" />{f.name}
                </button>
                {childFolders(f.id).map((c) => (
                  <button key={c.id} type="button" onClick={() => setMoveTarget(c.id)}
                    className={`w-full text-left pl-8 pr-3 py-1.5 rounded-lg ${moveTarget === c.id ? 'bg-amber-100 dark:bg-amber-900/40 font-semibold' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}>
                    {c.name}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowMoveDialog(false)}>Cancel</Button>
            <Button size="sm" onClick={handleMove}>Move here</Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Folder sidebar */}
        <aside className="lg:col-span-2 space-y-1 text-xs" aria-label="Media folders">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-stone-700 dark:text-stone-300 uppercase text-[10px] tracking-wider">Folders</h3>
            {canEdit && <NewFolderButton onCreate={createMediaFolder} />}
          </div>
          <button type="button" onClick={() => { setActiveFolder(null); setSelectedIds(new Set()); }}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors ${activeFolder === null ? 'bg-amber-100 dark:bg-amber-900/40 font-semibold text-amber-900 dark:text-amber-200' : 'hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'}`}>
            All images <span className="text-stone-400 dark:text-stone-500 ml-1">{mediaItems.length}</span>
          </button>
          <button type="button" onClick={() => { setActiveFolder(''); setSelectedIds(new Set()); }}
            className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors ${activeFolder === '' ? 'bg-amber-100 dark:bg-amber-900/40 font-semibold text-amber-900 dark:text-amber-200' : 'hover:bg-stone-50 dark:hover:bg-stone-800 text-stone-700 dark:text-stone-300'}`}>
            Unfiled <span className="text-stone-400 dark:text-stone-500 ml-1">{unfiledCount}</span>
          </button>
          <div className="border-t border-stone-200 dark:border-stone-700 my-2" />
          {rootFolders.map((f) => (
            <FolderRow key={f.id} folder={f} depth={0} activeFolder={activeFolder} onSelect={(id) => { setActiveFolder(id); setSelectedIds(new Set()); }}
              childFolders={childFolders(f.id)} canEdit={canEdit} canDelete={canDelete}
              onRename={updateMediaFolder} onDelete={deleteMediaFolder} onCreate={createMediaFolder} />
          ))}
          {!rootFolders.length && <p className="text-stone-400 dark:text-stone-500 px-2.5 py-2 italic">No folders yet.</p>}
        </aside>

        {/* Media grid */}
        <div className={`${selected ? 'lg:col-span-5' : 'lg:col-span-10'} grid grid-cols-2 sm:grid-cols-3 ${selected ? '' : 'lg:grid-cols-5'} gap-3 content-start`}>
          {filtered.map((m) => {
            const uses = mediaUsage[m.id]?.length || 0;
            const isSelected = selectedIds.has(m.id);
            return (
              <div key={m.id} className={`relative text-left rounded-xl border overflow-hidden bg-white dark:bg-[#121417] transition-colors ${selectedId === m.id ? 'border-amber-500 ring-1 ring-amber-500' : isSelected ? 'border-sky-500 ring-1 ring-sky-500' : 'border-stone-200 dark:border-stone-800 hover:border-amber-400'}`}>
                {canEdit && (
                  <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(m.id)}
                    className="absolute top-2 left-2 z-10 w-4 h-4 accent-amber-600 cursor-pointer rounded" aria-label={`Select ${m.title}`} />
                )}
                <button type="button" onClick={() => setSelectedId(m.id)} className="w-full text-left">
                  <img src={thumbnailUrl(m)} alt={m.altText} className="w-full aspect-video object-cover bg-stone-100 dark:bg-stone-800" loading="lazy" />
                  <div className="p-2.5 space-y-1">
                    <div className="text-xs font-semibold text-stone-900 dark:text-stone-100 truncate">{m.title}</div>
                    <div className="flex items-center justify-between gap-1 text-[10px] text-stone-500 dark:text-stone-400">
                      <span>{m.width && m.height ? `${m.width}×${m.height}` : m.dimensions || '—'}</span>
                      <span className={uses ? '' : 'text-amber-700 dark:text-amber-400 font-semibold'}>{uses ? `Used ${uses}×` : 'Unused'}</span>
                    </div>
                    <ReviewBadge state={m.copyrightReview} />
                  </div>
                </button>
              </div>
            );
          })}
          {!filtered.length && <p className="col-span-full text-xs text-stone-500 py-6 dark:text-stone-400">No media matches these filters.</p>}
        </div>

        {selected && (
          <MediaDetail
            key={selected.id}
            item={selected}
            usage={mediaUsage[selected.id] || []}
            folders={mediaFolders}
            canEdit={canEdit}
            canDelete={canDelete}
            onClose={() => setSelectedId(null)}
            onSave={(updates) => updateMediaItem(selected.id, updates)}
            onMove={(folderId) => moveMediaToFolder([selected.id], folderId)}
            onDelete={async () => {
              if (await deleteMediaItem(selected.id)) setSelectedId(null);
            }}
          />
        )}
      </div>
    </div>
  );
};

function FolderRow({ folder, depth, activeFolder, onSelect, childFolders, canEdit, canDelete, onRename, onDelete, onCreate }: {
  folder: MediaFolder; depth: number; activeFolder: string | null;
  onSelect: (id: string) => void;
  childFolders: MediaFolder[];
  canEdit: boolean; canDelete: boolean;
  onRename: (id: string, updates: { name?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onCreate: (name: string, parentId?: string | null) => Promise<MediaFolder | null>;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const isActive = activeFolder === folder.id;

  const handleRename = async () => {
    if (editName.trim() && editName.trim() !== folder.name) await onRename(folder.id, { name: editName.trim() });
    setEditing(false);
  };

  return (
    <div>
      <div className={`group flex items-center gap-1 rounded-lg transition-colors ${isActive ? 'bg-amber-100 dark:bg-amber-900/40' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}>
        {childFolders.length > 0 && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="p-0.5 text-stone-400 dark:text-stone-500">
            <ChevronRight size={12} className={`transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
        {!childFolders.length && <span className="w-4" />}
        {editing ? (
          <input className={`${inputClass} flex-1 text-xs`} value={editName} onChange={(e) => setEditName(e.target.value)} onBlur={handleRename}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setEditing(false); }} autoFocus />
        ) : (
          <button type="button" onClick={() => onSelect(folder.id)}
            className={`flex-1 text-left py-1.5 pr-1 truncate ${isActive ? 'font-semibold text-amber-900 dark:text-amber-200' : 'text-stone-700 dark:text-stone-300'}`}>
            <FolderOpen size={13} className="inline mr-1 -mt-0.5 text-amber-600 dark:text-amber-500" />
            {folder.name} <span className="text-stone-400 dark:text-stone-500 ml-0.5">{folder.itemCount}</span>
          </button>
        )}
        {canEdit && !editing && (
          <span className="hidden group-hover:flex items-center gap-0.5 pr-1">
            <button type="button" onClick={() => { setEditName(folder.name); setEditing(true); }} className="p-0.5 text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" title="Rename"><Pencil size={11} /></button>
            {canDelete && <button type="button" onClick={async () => { if (confirm(`Delete folder "${folder.name}"? Images will be moved to unfiled.`)) await onDelete(folder.id); }}
              className="p-0.5 text-stone-400 hover:text-rose-600 dark:hover:text-rose-400" title="Delete"><Trash2 size={11} /></button>}
          </span>
        )}
      </div>
      {expanded && childFolders.map((c) => (
        <FolderRow key={c.id} folder={c} depth={depth + 1} activeFolder={activeFolder} onSelect={onSelect}
          childFolders={[]} canEdit={canEdit} canDelete={canDelete}
          onRename={onRename} onDelete={onDelete} onCreate={onCreate} />
      ))}
    </div>
  );
}

function NewFolderButton({ onCreate }: { onCreate: (name: string, parentId?: string | null) => Promise<MediaFolder | null> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return (
    <button type="button" onClick={() => setOpen(true)} className="text-amber-700 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-300" title="New folder">
      <FolderPlus size={15} />
    </button>
  );
  const submit = async () => {
    if (name.trim()) { await onCreate(name.trim()); setName(''); setOpen(false); }
  };
  return (
    <div className="flex items-center gap-1">
      <input className={`${inputClass} text-xs w-28`} placeholder="Folder name" value={name} onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false); }} autoFocus maxLength={100} />
      <Button size="sm" onClick={submit}>Add</Button>
      <button type="button" onClick={() => setOpen(false)} className="text-stone-400"><X size={14} /></button>
    </div>
  );
}

function MediaDetail({ item, usage, folders, canEdit, canDelete, onClose, onSave, onMove, onDelete }: {
  item: MediaItem;
  usage: { kind: string; id: string; title: string; role: keyof typeof USAGE_LABEL }[];
  folders: MediaFolder[];
  canEdit: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSave: (updates: Partial<MediaItem>) => Promise<boolean>;
  onMove: (folderId: string | null) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({
    title: item.title,
    altText: item.altText,
    caption: item.caption || '',
    credit: item.credit || '',
    source: item.source || '',
    license: item.license || '',
    creationType: item.creationType,
    aiTool: item.aiTool || '',
    humanEditing: item.humanEditing || '',
    copyrightReview: item.copyrightReview,
  });
  const set = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const fmtBytes = (n?: number | null) => (n ? (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`) : '—');
  const currentFolder = folders.find((f) => f.id === item.folderId);

  return (
    <aside className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-4 space-y-4 text-xs self-start" aria-label="Media details">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-serif text-base font-bold">{item.title}</h3>
        <button type="button" onClick={onClose} className="text-stone-500 hover:text-stone-700 dark:text-stone-400" aria-label="Close details">✕</button>
      </div>
      <img src={item.url} alt={item.altText} className="w-full rounded-lg bg-stone-100 dark:bg-stone-800" />

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-stone-500 dark:text-stone-400">File</dt><dd className="truncate">{item.filename || (item.storageKey ? '—' : 'URL-only (not stored)')}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Type</dt><dd>{item.mimeType || '—'}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Dimensions</dt><dd>{item.width && item.height ? `${item.width}×${item.height}` : item.dimensions || '—'}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Stored size</dt><dd>{fmtBytes(item.sizeBytes)}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Responsive sizes</dt><dd>{item.variants?.length ? [...new Set(item.variants.map((v) => v.width))].join(', ') + 'px · ' + [...new Set(item.variants.map((v) => (v.format === 'avif' ? 'AVIF' : 'WebP')))].sort().join(' + ') : 'none'}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Uploaded</dt><dd>{new Date(item.uploadedAt).toLocaleString('en-GB')}</dd>
        <dt className="text-stone-500 dark:text-stone-400">Updated</dt><dd>{item.updatedAt ? new Date(item.updatedAt).toLocaleString('en-GB') : '—'}</dd>
      </dl>

      {/* Folder */}
      {canEdit && (
        <div className="flex items-center gap-2">
          <span className="text-stone-500 dark:text-stone-400">Folder:</span>
          <select className={inputClass} value={item.folderId || ''} onChange={(e) => onMove(e.target.value || null)}>
            <option value="">Unfiled</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.parentId ? '  └ ' : ''}{f.name}</option>)}
          </select>
          {currentFolder && <span className="text-stone-400 dark:text-stone-500">({currentFolder.name})</span>}
        </div>
      )}
      {!canEdit && currentFolder && <p className="text-stone-500 dark:text-stone-400">Folder: {currentFolder.name}</p>}

      <section aria-label="Usage history">
        <h4 className="font-semibold mb-1">Used in ({usage.length})</h4>
        {usage.length ? (
          <ul className="space-y-0.5">
            {usage.map((u, i) => (
              <li key={i}><span className="uppercase text-[10px] text-stone-500 dark:text-stone-400">{u.kind}</span> {u.title} <span className="text-stone-500 dark:text-stone-400">— {USAGE_LABEL[u.role]}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-amber-700 dark:text-amber-400">Not used anywhere (unused media). It is kept until someone deletes it.</p>
        )}
      </section>

      <fieldset disabled={!canEdit} className="space-y-2">
        <legend className="font-semibold mb-1">Metadata {canEdit ? '' : '(read-only for your role)'}</legend>
        <label className="block">Title<input className={inputClass} maxLength={200} value={draft.title} onChange={set('title')} /></label>
        <label className="block">Alt text<input className={inputClass} maxLength={300} value={draft.altText} onChange={set('altText')} /></label>
        <label className="block">Caption<input className={inputClass} maxLength={500} value={draft.caption} onChange={set('caption')} /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block">Credit<input className={inputClass} maxLength={200} value={draft.credit} onChange={set('credit')} /></label>
          <label className="block">Source<input className={inputClass} maxLength={200} value={draft.source} onChange={set('source')} /></label>
          <label className="block">Creation type
            <select className={inputClass} value={draft.creationType} onChange={set('creationType')}>{CREATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
          </label>
          <label className="block">AI tool<input className={inputClass} maxLength={120} value={draft.aiTool} onChange={set('aiTool')} /></label>
        </div>
        <label className="block">Human editing<input className={inputClass} maxLength={1000} value={draft.humanEditing} onChange={set('humanEditing')} /></label>
        <label className="block">License / usage notes<textarea className={inputClass} rows={2} maxLength={500} value={draft.license} onChange={set('license')} /></label>
        <label className="block">Copyright / usage review
          <select className={inputClass} value={draft.copyrightReview} onChange={set('copyrightReview')} aria-label="Copyright review">
            {REVIEW_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <p className="text-[11px] text-stone-500 dark:text-stone-400">"Restricted" images cannot be inserted into articles. "Reviewed" records that an editor checked the rights; it is not a legal clearance.</p>
        {canEdit && (
          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={() => onSave({ ...draft, creationType: draft.creationType as MediaCreationType, copyrightReview: draft.copyrightReview as CopyrightReview })}>Save metadata</Button>
          </div>
        )}
      </fieldset>

      {canDelete && (
        <div className="pt-3 border-t border-stone-200 dark:border-stone-800 flex items-center justify-between gap-2">
          <span className="text-[11px] text-stone-500 dark:text-stone-400">{usage.length ? 'In use: remove it from that content before deleting.' : 'Deletes the record and its stored files.'}</span>
          <Button type="button" size="sm" variant="danger" disabled={usage.length > 0} onClick={() => { if (confirm(`Delete "${item.title}" permanently?`)) onDelete(); }}>Delete</Button>
        </div>
      )}
    </aside>
  );
}

function RegisterByUrl({ onDone, addMediaItem }: { onDone: () => void; addMediaItem: ReturnType<typeof useApp>['addMediaItem'] }) {
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [altText, setAltText] = useState('');
  const [credit, setCredit] = useState('');
  const [source, setSource] = useState('');
  const [license, setLicense] = useState('');
  const [creationType, setCreationType] = useState<MediaCreationType>('Official Source');
  return (
    <form
      className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await addMediaItem({ title, url, altText, credit, source, license, creationType })) onDone();
      }}
    >
      <p className="sm:col-span-2 text-[11px] text-stone-500 dark:text-stone-400">For images hosted elsewhere (e.g. an official source). They are not processed or stored, so they have no responsive sizes.</p>
      <label className="block">Title *<input className={inputClass} required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="block">Image URL * (https://…)<input className={inputClass} required type="url" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
      <label className="block">Alt text *<input className={inputClass} required value={altText} onChange={(e) => setAltText(e.target.value)} /></label>
      <label className="block">Credit<input className={inputClass} value={credit} onChange={(e) => setCredit(e.target.value)} /></label>
      <label className="block">Source<input className={inputClass} value={source} onChange={(e) => setSource(e.target.value)} /></label>
      <label className="block">Creation type
        <select className={inputClass} value={creationType} onChange={(e) => setCreationType(e.target.value as MediaCreationType)}>{CREATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </label>
      <label className="block sm:col-span-2">License / usage notes<input className={inputClass} value={license} onChange={(e) => setLicense(e.target.value)} /></label>
      <div className="sm:col-span-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onDone}>Cancel</Button>
        <Button type="submit" size="sm">Register image</Button>
      </div>
    </form>
  );
}
