'use client';

/** Presentation only: registry definitions, partial PUT and server validation remain authoritative. */
import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, Circle, CircleAlert, Globe2, LockKeyhole, Save, Undo2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { SettingsHelp } from './settings/SettingsHelp';
import { CATEGORY_PRESENTATION, FIELD_PRESENTATION } from './settings/presentation';
import styles from './settings/Settings.module.css';

interface Definition { key: string; group: string; label: string; public: boolean }
type SettingsResponse = { values: Record<string, string>; definitions: Definition[] };

export const AdminSettings: React.FC = () => {
  const { apiCall, showNotification, currentUser } = useApp();
  const api = useRef(apiCall); api.current = apiCall;
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<'saved' | 'error' | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [leaving, setLeaving] = useState<HTMLElement | null>(null);
  const root = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const actionBar = useRef<HTMLDivElement>(null);
  const allowLeave = useRef(false);
  const saveInFlight = useRef(false);
  const loadGeneration = useRef(0);
  const prefix = useId();
  const allowed = currentUser.role === 'Admin';
  const changed = definitions.filter((d) => (values[d.key] || '') !== (saved[d.key] || ''));
  const dirty = changed.length > 0;
  const groups = [...new Set(definitions.map((d) => d.group))];
  const configured = definitions.filter((d) => saved[d.key]?.trim()).length;

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setLoadError(false);
    const res = await api.current<SettingsResponse>('/api/settings');
    if (generation !== loadGeneration.current) return;
    if (res.data) { setDefinitions(res.data.definitions); setValues(res.data.values); setSaved(res.data.values); }
    else setLoadError(true);
    setLoading(false);
  }, []);
  useEffect(() => { if (allowed) void load(); return () => { loadGeneration.current++; }; }, [allowed, currentUser.id, load]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (e: BeforeUnloadEvent) => { if (!allowLeave.current) { e.preventDefault(); e.returnValue = ''; } };
    const guard = (e: MouseEvent) => {
      if (allowLeave.current || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target.closest<HTMLElement>('a,button') : null;
      if (!target || root.current?.contains(target)) return;
      const anchor = target instanceof HTMLAnchorElement && target.target !== '_blank' && !target.hasAttribute('download') && target.href !== window.location.href;
      const desk = target.closest('[aria-label="CMS navigation"]') && target.getAttribute('aria-current') !== 'page';
      const action = /^(My account|← View Public Website|Log out|Sign out)$/i.test(target.textContent?.trim() ?? '');
      if (!anchor && !desk && !action) return;
      e.preventDefault(); e.stopPropagation(); setLeaving(target);
    };
    window.addEventListener('beforeunload', unload); document.addEventListener('click', guard, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', guard, true); };
  }, [dirty]);
  useEffect(() => {
    if (!leaving || !dialog.current) return;
    const target = leaving;
    dialog.current.showModal();
    return () => { dialog.current?.close(); if (target.isConnected) target.focus(); };
  }, [leaving]);
  useEffect(() => {
    if (!dirty || !actionBar.current) return;
    const scroller = window.innerWidth >= 1024 ? root.current?.closest<HTMLElement>('.cms-main') : document.documentElement;
    if (!scroller) return;
    const previous = scroller.style.scrollPaddingBottom;
    const reserveSpace = () => { scroller.style.scrollPaddingBottom = `${(actionBar.current?.offsetHeight ?? 0) + 16}px`; };
    reserveSpace();
    const observer = new ResizeObserver(reserveSpace); observer.observe(actionBar.current);
    return () => { observer.disconnect(); scroller.style.scrollPaddingBottom = previous; };
  }, [dirty]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed.length || saveInFlight.current) return;
    saveInFlight.current = true; setSaving(true); setFeedback(null); setFieldErrors({});
    try {
      const body = Object.fromEntries(changed.map((d) => [d.key, values[d.key] || '']));
      const res = await api.current<{ values: Record<string, string> }>('/api/settings', { method: 'PUT', body });
      if (res.data) {
        setSaved(res.data.values); setValues(res.data.values); setFeedback('saved');
        showNotification('Settings saved.', 'success');
      } else {
        setFeedback('error');
        if (res.status === 400) {
          const definition = definitions.find((d) => res.error?.includes(d.key)
            || (d.key === 'googleSiteVerification' && res.error?.includes('google-site-verification'))
            || (d.key === 'bingSiteVerification' && res.error?.includes('msvalidate.01')));
          if (definition) setFieldErrors({ [definition.key]: `Check this value. ${FIELD_PRESENTATION[definition.key]?.helper ?? 'Use a valid value for this setting.'}` });
        }
      }
    } finally { saveInFlight.current = false; setSaving(false); }
  };
  const reset = () => { setValues({ ...saved }); setFieldErrors({}); setFeedback(null); };
  if (!allowed) return <p className="text-sm text-stone-600 dark:text-stone-400">Settings are available to Admins only.</p>;

  return <form ref={root} onSubmit={save} className={styles.page} aria-label="Site settings" aria-busy={loading}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 pb-5 dark:border-stone-800">
      <div className="min-w-0"><p className="mb-1 text-[10px] font-bold uppercase tracking-[.15em] text-amber-800 dark:text-amber-400">Site-wide configuration</p>
        <h2 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Settings</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-600 dark:text-stone-400">Manage identity, social defaults, search verification, analytics, advertising and indexing.</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 px-2.5 py-1.5 text-[11px] font-semibold text-stone-600 dark:border-stone-700 dark:text-stone-300"><LockKeyhole size={13} aria-hidden="true" />Admin only</span>
    </header>
    {loading ? <div role="status"><p className="mb-4 text-sm text-stone-600 dark:text-stone-400">Loading settings…</p><div className={styles.grid} aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className={`${styles.card} h-56 p-5`}><div className="mb-5 h-5 w-1/2 rounded bg-stone-100 dark:bg-stone-800" /><div className="mb-3 h-11 rounded bg-stone-100 dark:bg-stone-800" /><div className="h-11 rounded bg-stone-100 dark:bg-stone-800" /></div>)}</div></div>
      : loadError ? <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><p className="mb-3">Could not load settings. Please try again.</p><Button type="button" variant="outline" onClick={() => void load()}>Retry loading</Button></div>
      : <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-stone-600 dark:text-stone-400">{definitions.length} settings <span aria-hidden="true">·</span> {configured} configured <span className="text-stone-500 dark:text-stone-400">(saved values)</span></p>
          {!dirty && <span className="inline-flex items-center gap-1.5 text-xs font-medium text-stone-600 dark:text-stone-300"><Check size={14} aria-hidden="true" />No unsaved changes</span>}
        </div>
        <nav aria-label="Settings categories" className="mb-5 flex flex-wrap gap-1.5">{groups.map((group, i) => <button key={group} type="button" onClick={() => document.getElementById(`${prefix}-category-${i}`)?.scrollIntoView({ block: 'start' })}
          className="min-h-11 rounded-lg border border-stone-200 px-3 text-xs font-semibold text-stone-600 hover:border-amber-600 hover:text-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:text-stone-300 dark:hover:text-amber-400">{CATEGORY_PRESENTATION[group]?.short ?? group}</button>)}</nav>
        {feedback === 'saved' && <p role="status" className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"><Check size={16} aria-hidden="true" />Settings saved successfully.</p>}
        {feedback === 'error' && <p role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />Could not save settings. Check your values and try again.</p>}
        <div className={styles.grid}>{groups.map((group, index) => {
          const presentation = CATEGORY_PRESENTATION[group]; const Icon = presentation?.icon ?? Globe2;
          const fields = definitions.filter((d) => d.group === group);
          const count = fields.filter((d) => saved[d.key]?.trim()).length;
          return <section id={`${prefix}-category-${index}`} key={group} className={`${styles.card} ${fields.length === 1 ? styles.wideCard : ''}`} aria-labelledby={`${prefix}-heading-${index}`}>
            <div className="flex items-start gap-3 border-b border-stone-100 p-4 dark:border-stone-800">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"><Icon size={19} strokeWidth={1.8} aria-hidden="true" /></span>
              <div className="min-w-0 flex-1"><h3 id={`${prefix}-heading-${index}`} className="text-sm font-bold text-stone-900 dark:text-stone-100">{presentation?.title ?? group}</h3><p className="mt-1 text-xs leading-relaxed text-stone-600 dark:text-stone-400">{presentation?.description ?? 'Manage saved configuration values.'}</p></div>
              <span aria-label={`${count} of ${fields.length} configured`} className="rounded-md bg-stone-100 px-2 py-1 text-[10px] font-semibold tabular-nums text-stone-600 dark:bg-stone-800 dark:text-stone-300">{count}/{fields.length}</span>
            </div>
            <div className={`space-y-4 p-4 ${fields.length === 1 ? styles.wideFields : ''}`}>
              <div className={styles.fieldList}>{fields.map((d) => {
                const field = FIELD_PRESENTATION[d.key]; const inputId = `${prefix}-${d.key}`;
                const updated = (values[d.key] || '') !== (saved[d.key] || '');
                const inputProps = {
                  id: inputId, name: d.key, value: values[d.key] || '', disabled: saving, autoComplete: 'off',
                  spellCheck: !field?.technical, placeholder: field?.placeholder,
                  className: `${styles.input} ${field?.technical ? 'font-mono' : ''}`,
                  'aria-describedby': `${inputId}-helper${fieldErrors[d.key] ? ` ${inputId}-error` : ''}`,
                  'aria-invalid': Boolean(fieldErrors[d.key]),
                  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
                    const bar = actionBar.current?.getBoundingClientRect(); const field = e.currentTarget.getBoundingClientRect();
                    if (bar && field.bottom > bar.top && field.top < bar.bottom) e.currentTarget.scrollIntoView({ block: 'center' });
                  },
                  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setValues((v) => ({ ...v, [d.key]: e.target.value })); setFeedback(null); setFieldErrors((v) => { const next = { ...v }; delete next[d.key]; return next; }); },
                };
                return <div key={d.key} className="min-w-0">
                  <div className="flex items-center gap-2"><label htmlFor={inputId} className="min-w-0 flex-1 text-xs font-semibold text-stone-800 dark:text-stone-200">{field?.label ?? d.label}{field?.detail && <span className="mt-0.5 block text-[11px] font-normal text-stone-600 dark:text-stone-400">{field.detail}</span>}</label>
                    {field && <SettingsHelp label={field.label}>{field.help}</SettingsHelp>}
                  </div>
                  <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold">
                    <span className={`inline-flex items-center gap-1 ${saved[d.key]?.trim() ? 'text-emerald-800 dark:text-emerald-300' : 'text-stone-600 dark:text-stone-400'}`}>{saved[d.key]?.trim() ? <Check size={12} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}{saved[d.key]?.trim() ? 'Configured' : 'Not configured'}</span>
                    {updated && <span className="text-amber-800 dark:text-amber-300">Unsaved edit</span>}
                  </div>
                  {field?.multiline ? <textarea {...inputProps} rows={3} className={`${inputProps.className} resize-y`} /> : <input {...inputProps} type="text" />}
                  <p id={`${inputId}-helper`} className="mt-2 text-[11px] leading-relaxed text-stone-600 dark:text-stone-400">{field?.helper ?? (d.public ? 'Published in page HTML when saved.' : 'Saved in site configuration.')}</p>
                  {fieldErrors[d.key] && <p id={`${inputId}-error`} className="mt-1 text-xs font-medium text-rose-800 dark:text-rose-300">{fieldErrors[d.key]}</p>}
                </div>;
              })}</div>
              {presentation?.note && <p className="rounded-lg border-l-2 border-stone-300 bg-stone-50 p-3 text-[11px] leading-relaxed text-stone-600 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-400">{presentation.note}</p>}
            </div>
          </section>;
        })}</div>
        <div ref={actionBar} className={styles.actionBar} data-dirty={dirty} role="region" aria-label={dirty ? 'Unsaved settings changes' : 'Save settings'}><div className="min-w-0"><p className="text-xs font-bold text-stone-900 dark:text-stone-100">{dirty ? 'Unsaved changes' : 'No unsaved changes'}</p><p className="mt-1 text-[11px] text-stone-600 dark:text-stone-400">{dirty ? `${changed.length} ${changed.length === 1 ? 'setting has' : 'settings have'} changed. Save to apply.` : 'Edit a value to enable saving.'}</p></div>
          <div className="flex flex-wrap gap-2">{dirty && <Button type="button" variant="outline" disabled={saving} onClick={reset} className="min-h-11"><Undo2 size={14} aria-hidden="true" />Cancel</Button>}<Button type="submit" disabled={saving || !dirty} isLoading={saving} className="min-h-11"><Save size={15} aria-hidden="true" />{saving ? 'Saving…' : 'Save changes'}</Button></div>
        </div>
      </>}
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${prefix}-leave-title`} onCancel={(e) => { e.preventDefault(); setLeaving(null); }}>
      <h3 id={`${prefix}-leave-title`} className="text-lg font-bold">You have unsaved changes.</h3><p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">Leave Settings and discard these edits, or stay to save them.</p>
      <div className="mt-5 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setLeaving(null)} autoFocus className="min-h-11">Stay</Button><Button type="button" disabled={saving} onClick={() => { const target = leaving; allowLeave.current = true; setLeaving(null); if (target?.isConnected) target.click(); else allowLeave.current = false; }} className="min-h-11">Leave</Button></div>
    </dialog>
  </form>;
};
