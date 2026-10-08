'use client';

/**
 * Media Library building blocks shared by the library screen and the
 * article editor's image picker (PHASE C).
 */

import React, { useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Upload } from 'lucide-react';
import { useApp } from '../../../context/AppContext';
import { Button } from '../../ui/Button';
import type { CopyrightReview, MediaCreationType, MediaItem } from '../../../types';
import { mediaUrl } from '../../../lib/media';

export const CREATION_TYPES: MediaCreationType[] = ['SportingSpy Original', 'SportingSpy AI-Created', 'SportingSpy AI-Assisted/Edited', 'Licensed', 'Official Source', 'Creative Commons', 'Other'];
export const REVIEW_STATES: CopyrightReview[] = ['pending', 'reviewed', 'restricted'];
export const ACCEPT = '.jpg,.jpeg,.png,.webp,.avif,image/jpeg,image/png,image/webp,image/avif';

export const inputClass = 'w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 text-xs';

/** Smallest stored variant (fast thumbnail), else the item URL. */
export function thumbnailUrl(item: MediaItem): string {
  const small = (item.variants || []).filter((v) => v.format === 'webp').sort((a, b) => a.width - b.width)[0];
  return small ? mediaUrl(small.key) : item.url;
}

export function ReviewBadge({ state }: { state: CopyrightReview }) {
  const styles: Record<CopyrightReview, string> = {
    pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    reviewed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    restricted: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  };
  const labels: Record<CopyrightReview, string> = { pending: 'Review pending', reviewed: 'Reviewed', restricted: 'Restricted' };
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${styles[state]}`}>{labels[state]}</span>;
}

/** Upload form: file + Spec §16 metadata. Validation is repeated on the server. */
export function MediaUploadForm({ onUploaded, onCancel }: { onUploaded: (item: MediaItem) => void; onCancel?: () => void }) {
  const { uploadMedia } = useApp();
  const fileInput = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [altText, setAltText] = useState('');
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [source, setSource] = useState('');
  const [license, setLicense] = useState('');
  const [creationType, setCreationType] = useState<MediaCreationType>('SportingSpy Original');
  const [aiTool, setAiTool] = useState('');
  const [humanEditing, setHumanEditing] = useState('');
  const [busy, setBusy] = useState(false);
  const aiInvolved = creationType === 'SportingSpy AI-Created' || creationType === 'SportingSpy AI-Assisted/Edited';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // The picker opens inside the Article/Edition editor form; React submit events bubble through
    // the component tree, so without this an upload would also save the surrounding editor.
    e.stopPropagation();
    if (!file || !title.trim() || !altText.trim()) return;
    setBusy(true);
    const item = await uploadMedia(file, { title, altText, caption, credit, source, license, creationType, aiTool: aiInvolved ? aiTool : '', humanEditing });
    setBusy(false);
    if (item) onUploaded(item);
  };

  return (
    <form onSubmit={submit} className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/50 space-y-3 text-xs" aria-label="Upload image">
      <div>
        <label className="block font-semibold mb-2" htmlFor={fileInputId}>Image file * (JPEG, PNG, WebP or AVIF, max 10 MB)</label>
        <input
          ref={fileInput}
          id={fileInputId}
          type="file"
          accept={ACCEPT}
          required
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '));
          }}
          className="hidden"
        />
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={busy}>
            <Upload size={16} aria-hidden="true" />Choose image from computer
          </Button>
          <span role="status" className="min-w-0 break-all text-xs text-stone-600 dark:text-stone-300">{file ? `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)` : 'No image selected'}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block">Title *<input className={inputClass} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="block">Alt text * (describes the image for screen readers and search)<input className={inputClass} required maxLength={300} value={altText} onChange={(e) => setAltText(e.target.value)} /></label>
        <label className="block">Caption<input className={inputClass} maxLength={500} value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        <label className="block">Credit<input className={inputClass} maxLength={200} value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="e.g. SportingSpy / Photographer name" /></label>
        <label className="block">Source<input className={inputClass} maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <label className="block">Creation type
          <select className={inputClass} value={creationType} onChange={(e) => setCreationType(e.target.value as MediaCreationType)}>
            {CREATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {aiInvolved && (
          <label className="block">AI tool<input className={inputClass} maxLength={120} value={aiTool} onChange={(e) => setAiTool(e.target.value)} placeholder="e.g. the image model used" /></label>
        )}
        <label className="block">Human editing<input className={inputClass} maxLength={1000} value={humanEditing} onChange={(e) => setHumanEditing(e.target.value)} placeholder="What a person changed, if anything" /></label>
        <label className="block sm:col-span-2">License / usage notes<textarea className={inputClass} rows={2} maxLength={500} value={license} onChange={(e) => setLicense(e.target.value)} /></label>
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">New images start with copyright review <strong>pending</strong>. Uploading does not clear an image for use; an editor records the review.</p>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" size="sm" isLoading={busy} disabled={!file || !title.trim() || !altText.trim()}>Upload image</Button>
      </div>
    </form>
  );
}

/** Modal to choose an image from the library (or upload one) for an article. */
export function MediaPicker({ onSelect, onClose }: { onSelect: (item: MediaItem) => void; onClose: () => void }) {
  const { mediaItems } = useApp();
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const q = query.trim().toLowerCase();
  const items = mediaItems.filter((m) => !q || [m.title, m.altText, m.filename, m.credit].some((v) => v?.toLowerCase().includes(q)));

  // Rendered at <body>: the picker is opened from inside editor <form>s, and its upload <form>
  // must not be nested in them (a nested form submit reloaded the whole CMS page).
  const dialog = (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose an image">
      <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white dark:bg-stone-900 p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-serif text-lg font-bold">Choose an image</h3>
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setUploading((u) => !u)}>{uploading ? 'Browse library' : 'Upload new'}</Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>Close</Button>
          </div>
        </div>
        {uploading ? (
          <MediaUploadForm onUploaded={(item) => { setUploading(false); onSelect(item); }} onCancel={() => setUploading(false)} />
        ) : (
          <>
            <input className={inputClass} placeholder="Search title, alt text, filename, credit…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search media" />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {items.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  disabled={m.copyrightReview === 'restricted'}
                  onClick={() => onSelect(m)}
                  className="text-left rounded-lg border border-stone-200 dark:border-stone-800 overflow-hidden hover:border-amber-500 disabled:opacity-40 disabled:cursor-not-allowed"
                  title={m.copyrightReview === 'restricted' ? 'Copyright-restricted: cannot be used' : m.title}
                >
                  <img src={thumbnailUrl(m)} alt={m.altText} className="w-full aspect-video object-cover bg-stone-100 dark:bg-stone-800" loading="lazy" />
                  <div className="p-2 space-y-1">
                    <div className="text-[11px] font-semibold truncate">{m.title}</div>
                    <ReviewBadge state={m.copyrightReview} />
                  </div>
                </button>
              ))}
              {!items.length && <p className="col-span-full text-xs text-stone-500 dark:text-stone-400">No images match.</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}
