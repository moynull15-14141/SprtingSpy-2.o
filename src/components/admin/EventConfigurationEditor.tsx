import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { SportEventConfiguration, SportEventFieldDefinition, SportEventFieldType, SportEventTerminologyKey } from '../../types';
import { GENERIC_EVENT_CONFIGURATION, parseSportEventConfiguration } from '../../../server/sportEventConfiguration';

const terms: SportEventTerminologyKey[] = ['event', 'participant', 'competition', 'venue', 'round'];
const types: SportEventFieldType[] = ['text', 'textarea', 'number', 'boolean', 'date', 'select', 'url'];
const inputClass = 'w-full min-w-0 rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-950';
type Response = { configuration: SportEventConfiguration | null; resolved: { configured: boolean; terminology: typeof GENERIC_EVENT_CONFIGURATION.terminology; fields: SportEventFieldDefinition[] }; error?: string };

export function EventConfigurationEditor({ sportSlug, onClose }: { sportSlug: string; onClose: () => void }) {
  const { apiCall, currentUser } = useApp();
  const [saved, setSaved] = useState<SportEventConfiguration | null>(null);
  const [draft, setDraft] = useState<SportEventConfiguration>({ terminology: {}, fields: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [failedLoad, setFailedLoad] = useState(false);
  const [notice, setNotice] = useState('');
  const apiCallRef = useRef(apiCall);
  apiCallRef.current = apiCall;
  const loadGeneration = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? { terminology: {}, fields: [] });
  const canEdit = currentUser.role === 'Admin';

  const load = async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(''); setNotice(''); setFailedLoad(false);
    const result = await apiCallRef.current<Response>(`/api/sports/${encodeURIComponent(sportSlug)}/event-configuration`);
    if (generation !== loadGeneration.current) return;
    if (result.data) {
      setSaved(result.data.configuration);
      setDraft(result.data.configuration ?? { terminology: {}, fields: [] });
      if (result.data.error) setError("This Sport's Event configuration needs administrator attention. Generic fallback is active.");
    } else { setError(result.error ?? 'Could not load configuration.'); setFailedLoad(true); }
    setLoading(false);
  };
  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [sportSlug]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const button = target?.closest('button[data-cms-navigation]');
      if (!button || button.getAttribute('aria-current') === 'page') return;
      if (!window.confirm('Discard unsaved Event configuration changes?')) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [dirty]);
  const close = () => { if (!dirty || window.confirm('Discard unsaved Event configuration changes?')) onClose(); };
  const updateField = (index: number, update: Partial<SportEventFieldDefinition>) => { setError(''); setDraft((old) => ({ ...old, fields: old.fields.map((field, i) => i === index ? { ...field, ...update } : field) })); };
  const reorder = (index: number, direction: number) => setDraft((old) => {
    const fields = [...old.fields]; const target = index + direction;
    if (target < 0 || target >= fields.length) return old;
    [fields[index], fields[target]] = [fields[target], fields[index]];
    return { ...old, fields: fields.map((field, i) => ({ ...field, order: i })) };
  });
  const save = async (configuration: SportEventConfiguration | null) => {
    if (!canEdit || saving) return;
    setError(''); setNotice('');
    if (configuration) {
      configuration = { ...configuration, terminology: Object.fromEntries(Object.entries(configuration.terminology).filter(([, value]) => value.trim())) as SportEventConfiguration['terminology'] };
      const parsed = parseSportEventConfiguration(configuration);
      if ('error' in parsed) { setError(parsed.error); return; }
      configuration = parsed.value;
    }
    const generation = loadGeneration.current;
    setSaving(true);
    const result = await apiCall<Response>(`/api/sports/${encodeURIComponent(sportSlug)}/event-configuration`, { method: 'PUT', body: { configuration } });
    setSaving(false);
    if (generation !== loadGeneration.current) return;
    if (!result.data) { setError(result.error ?? 'Could not save configuration. Your changes are still here.'); return; }
    setSaved(result.data.configuration);
    setDraft(result.data.configuration ?? { terminology: {}, fields: [] });
    setNotice(configuration ? 'Event configuration saved.' : 'Configuration cleared. Generic fallback is active.');
  };

  return <section className="min-w-0 space-y-5 rounded-xl border border-amber-700/40 bg-stone-50 p-4 dark:bg-stone-900/60 sm:p-5" aria-label="Sport Event Configuration">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-serif text-lg font-bold">Event Configuration: {sportSlug}</h3><p className="text-xs text-stone-500 dark:text-stone-400">Define terminology and custom Event fields for this Sport.</p></div><button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={close}>Close configuration</button></div>
    {loading ? <p role="status">Loading Event configuration…</p> : failedLoad ? <div role="alert" className="space-y-2 text-sm text-rose-700 dark:text-rose-300">{error}<div><button type="button" className="rounded border px-3 py-1" onClick={() => void load()}>Retry</button></div></div> : <>
      {error && <p role="alert" className="rounded bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
      {!saved && <p className="text-xs text-stone-600 dark:text-stone-300">Generic Configuration is active. No custom fields are defined.</p>}
      <fieldset disabled={!canEdit || saving} className="space-y-5 disabled:opacity-75">
        <div><h4 className="mb-2 font-semibold">Terminology</h4><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{terms.map((key) => <label key={key} className="min-w-0 text-xs font-semibold capitalize">{key}<input className={`${inputClass} mt-1`} maxLength={80} value={draft.terminology[key] ?? ''} placeholder={GENERIC_EVENT_CONFIGURATION.terminology[key]} onChange={(e) => { setError(''); setDraft((old) => ({ ...old, terminology: { ...old.terminology, [key]: e.target.value } })); }} /></label>)}</div><p className="mt-1 text-xs text-stone-500">Blank fields use the generic label.</p></div>
        <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Custom fields</h4>{canEdit && <button type="button" className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => setDraft((old) => ({ ...old, fields: [...old.fields, { key: '', label: '', type: 'text', required: false, order: old.fields.length, adminVisible: true, publicVisible: false }] }))}>+ Add field</button>}</div>
          {draft.fields.length === 0 && <p className="text-xs text-stone-500">No custom fields.</p>}
          {draft.fields.map((field, index) => <div key={index} data-testid={`config-field-${index}`} className="min-w-0 space-y-3 rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-700 dark:bg-stone-950">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="break-words text-sm">{index + 1}. {field.label || 'New field'}</strong>{canEdit && <div className="flex gap-1"><button type="button" aria-label={`Move ${field.label || 'field'} up`} disabled={index === 0} className="rounded border px-2 py-1 text-xs" onClick={() => reorder(index, -1)}>↑</button><button type="button" aria-label={`Move ${field.label || 'field'} down`} disabled={index === draft.fields.length - 1} className="rounded border px-2 py-1 text-xs" onClick={() => reorder(index, 1)}>↓</button><button type="button" aria-label={`Remove ${field.label || 'field'}`} className="rounded border px-2 py-1 text-xs text-rose-700" onClick={() => { if (window.confirm('Remove this field definition? Existing Event values may prevent saving.')) setDraft((old) => ({ ...old, fields: old.fields.filter((_, i) => i !== index).map((f, i) => ({ ...f, order: i })) })); }}>Remove</button></div>}</div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><label className="min-w-0 text-xs">Key *<input className={`${inputClass} mt-1 font-mono`} value={field.key} onChange={(e) => updateField(index, { key: e.target.value })} placeholder="e.g. surface_type" /></label><label className="min-w-0 text-xs">Label *<input className={`${inputClass} mt-1`} value={field.label} onChange={(e) => updateField(index, { label: e.target.value })} /></label><label className="min-w-0 text-xs">Type<select className={`${inputClass} mt-1`} value={field.type} onChange={(e) => updateField(index, { type: e.target.value as SportEventFieldType, options: e.target.value === 'select' ? (field.options?.length ? field.options : ['Option 1']) : undefined })}>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label></div>
            <label className="block text-xs">Help text<input className={`${inputClass} mt-1`} maxLength={300} value={field.helpText ?? ''} onChange={(e) => updateField(index, { helpText: e.target.value })} /></label>
            {field.type === 'select' && <label className="block text-xs">Options (one per line, 1–30)<textarea className={`${inputClass} mt-1`} rows={Math.min(6, Math.max(2, field.options?.length ?? 2))} value={(field.options ?? []).join('\n')} onChange={(e) => updateField(index, { options: e.target.value.split('\n') })} /></label>}
            {error && (error.includes(field.key || `Field ${index + 1}`) || error.includes(`Field ${index + 1}`)) && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
            <div className="flex flex-wrap gap-4 text-xs"><label><input type="checkbox" checked={field.required} onChange={(e) => updateField(index, { required: e.target.checked })} /> Required</label><label><input type="checkbox" checked={field.adminVisible} onChange={(e) => updateField(index, { adminVisible: e.target.checked })} /> Admin visible</label><label><input type="checkbox" checked={field.publicVisible} onChange={(e) => updateField(index, { publicVisible: e.target.checked })} /> Public visible</label></div>
          </div>)}
        </div>
      </fieldset>
      <div className="space-y-2 rounded-lg border border-dashed border-stone-300 p-3 dark:border-stone-700"><h4 className="font-semibold">Preview</h4><p className="text-xs text-stone-500">{draft.terminology.event || 'Event'} editor · {draft.fields.length} custom fields</p><div className="grid gap-2 sm:grid-cols-2">{draft.fields.filter((field) => field.adminVisible).map((field) => <label key={field.key} className="min-w-0 break-words text-xs">{field.label || 'Unnamed field'}{field.required ? ' *' : ''}{field.type === 'select' || field.type === 'boolean' ? <select className={`${inputClass} mt-1`} disabled><option>Choose…</option>{(field.type === 'boolean' ? ['Yes', 'No'] : field.options ?? []).map((option) => <option key={option}>{option}</option>)}</select> : field.type === 'textarea' ? <textarea className={`${inputClass} mt-1`} disabled rows={2} /> : <input className={`${inputClass} mt-1`} disabled type={field.type === 'number' || field.type === 'date' || field.type === 'url' ? field.type : 'text'} />}{field.helpText && <span className="mt-1 block break-words text-stone-500">{field.helpText}</span>}</label>)}</div></div>
      {canEdit && <div className="flex flex-wrap gap-2"><button type="button" disabled={saving || !dirty} className="rounded bg-amber-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" onClick={() => void save(draft)}>Save configuration</button><button type="button" disabled={saving || !saved} className="rounded border px-3 py-2 text-xs disabled:opacity-50" onClick={() => { if (window.confirm('Clear this Sport configuration? Existing Event values may prevent clearing.')) void save(null); }}>Clear configuration</button><button type="button" disabled={saving || !dirty} className="rounded border px-3 py-2 text-xs disabled:opacity-50" onClick={() => setDraft(saved ?? { terminology: {}, fields: [] })}>Discard changes</button></div>}
    </>}
  </section>;
}
