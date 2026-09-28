import { useEffect, useId, useRef, useState } from 'react';
import type { AdCreative } from '../../types';
import { useApp } from '../../context/AppContext';
import { AdCreativeDisplay } from '../ui/AdCreativeDisplay';

const input = 'mt-1 w-full rounded border border-stone-300 bg-white p-2 dark:border-stone-700 dark:bg-stone-950';
export function AdMediaEditor({ creative, onSelect, alt, onAlt, fit, onFit, dimensions, onBusy }: {
  creative: AdCreative | null; onSelect: (item: AdCreative | null) => void;
  alt: string; onAlt: (value: string) => void; fit: string; onFit: (value: string) => void; dimensions: string; onBusy: (value: boolean) => void;
}) {
  const { apiCall } = useApp();
  const api = useRef(apiCall); api.current = apiCall;
  const [items, setItems] = useState<AdCreative[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileId = useId();
  const load = async () => {
    setLoading(true); setError('');
    const result = await api.current<AdCreative[]>('/api/ad-creatives');
    setLoading(false);
    if (result.data) { setItems(result.data); setLoaded(true); }
    else { setError(result.error || 'Ad media could not be loaded.'); setLoaded(false); }
  };
  useEffect(() => { void load(); }, []);
  const upload = async () => {
    if (!file || busy) return;
    if (file.size > 25 * 1024 * 1024) { setError('Choose a file no larger than 25 MB. Images must be 10 MB or smaller.'); return; }
    setBusy(true); onBusy(true); setError('');
    try {
      const body = new FormData(); body.append('file', file);
      const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
      const res = await fetch('/api/ad-creatives', { method: 'POST', credentials: 'same-origin', headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}, body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed.');
      const item = data as AdCreative;
      setItems(previous => [item, ...previous]); onSelect(item);
      setFile(null); if (fileInput.current) fileInput.current.value = '';
    } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed. Please try again.'); }
    finally { setBusy(false); onBusy(false); }
  };
  const removeUnused = async (item: AdCreative) => {
    setBusy(true); onBusy(true); setError('');
    try {
      const result = await api.current<{ success: boolean }>(`/api/ad-creatives/${item.id}`, { method: 'DELETE' });
      if (result.data?.success) setItems(previous => previous.filter(row => row.id !== item.id));
      else setError(result.error || 'The media could not be deleted.');
    } finally { setBusy(false); onBusy(false); }
  };
  const choices = creative && !items.some(item => item.id === creative.id) ? [creative, ...items] : items;
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-stone-300 p-3 dark:border-stone-700" disabled={busy}>
    <legend className="px-1 font-semibold">Ad image, GIF or short video</legend>
    <p className="text-stone-500 dark:text-stone-400">Images: JPG/JPEG, PNG, WebP, AVIF (max 10 MB). Animated GIF: max 25 MB. Video: H.264 MP4 or WebM, max 60 seconds / 25 MB.</p>
    <input ref={fileInput} id={fileId} type="file" className="sr-only" aria-label="Ad media file" accept=".jpg,.jpeg,.png,.webp,.avif,.gif,.mp4,.webm" onChange={e => { setFile(e.target.files?.[0] || null); setError(''); }}/>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="rounded border border-stone-300 bg-white px-3 py-2 font-semibold dark:border-stone-700 dark:bg-stone-950" onClick={() => fileInput.current?.click()}>Choose media from computer</button>
      <span className="min-w-0 break-all text-stone-500 dark:text-stone-400" role="status">{file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : 'No file selected'}</span>
      <button type="button" disabled={!file || busy} onClick={upload} className="rounded bg-amber-700 px-3 py-2 font-semibold text-white disabled:opacity-50">{busy ? 'Working…' : 'Upload & select'}</button>
    </div>
    {error && <div role="alert" className="rounded border border-rose-300 p-2 text-rose-700 dark:text-rose-300">{error}{!loaded && <button type="button" className="ml-2 underline" onClick={load}>Retry library</button>}</div>}
    <label className="block font-semibold">Choose uploaded ad media<select aria-label="Choose uploaded ad media" className={input} disabled={loading} value={creative?.id || ''} onChange={e => onSelect(choices.find(item => item.id === e.target.value) || null)}><option value="">Text only — no media</option>{choices.map(item => <option key={item.id} value={item.id}>{item.title} ({item.kind}, {item.width}×{item.height})</option>)}</select></label>
    {creative && <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block font-semibold">Ad media description / alt text<input aria-label="Ad media description / alt text" className={input} required maxLength={300} value={alt} onChange={e => onAlt(e.target.value)}/></label>
        <label className="block font-semibold">Media fit<select aria-label="Media fit" className={input} value={fit} onChange={e => onFit(e.target.value)}><option value="contain">Show whole media (contain)</option><option value="cover">Fill slot (crop edges)</option></select></label>
      </div>
      <div className="space-y-2 rounded-lg border border-stone-200 p-3 dark:border-stone-800"><p className="font-semibold">Sponsored media preview · {dimensions}</p><AdCreativeDisplay creative={creative} alt={alt || 'Ad preview'} fit={fit} dimensions={dimensions}/><p className="text-stone-500 dark:text-stone-400">Save Slot Settings to apply this selection. Enable the slot to display it publicly. Video uses player controls.</p></div>
    </>}
    {choices.length > 0 && <details><summary className="cursor-pointer font-semibold">Manage uploaded ad media</summary><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{choices.map(item => <div key={item.id} className="flex items-center justify-between gap-2 rounded border border-stone-200 p-2 dark:border-stone-800"><span className="min-w-0 break-all">{item.title}</span><button type="button" disabled={creative?.id === item.id || busy} onClick={() => removeUnused(item)} className="shrink-0 text-rose-700 underline disabled:opacity-40 dark:text-rose-300">Delete unused</button></div>)}</div><p className="mt-2 text-stone-500 dark:text-stone-400">Media used by a saved slot cannot be deleted.</p></details>}
  </fieldset>;
}
