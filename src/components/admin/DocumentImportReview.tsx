'use client';

import React, { useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, FileText, Keyboard, Upload } from 'lucide-react';
import { Button } from '../ui/Button';
import {
  IMPORT_FIELD_LABELS, IMPORT_FIELD_ORDER, SOURCE_LIMITS, TRANSFER_FIELD_LABELS, mapImportField, mapSelectedImport, proposalValues, sourceErrorMessage, transferConflicts,
  type CmsTransfer, type ImportConfidence, type ImportFieldName, type ImportProposal, type ReviewValues, type TaxonomyData,
} from '../../lib/documentImport';

/**
 * `create`: step two of Create Article → Create from source (opens expanded; Back returns to the choice).
 * `editor`: collapsed "Import from source" inside the open Article editor, with overwrite review.
 */
interface Props { variant: 'create' | 'editor'; taxonomy: TaxonomyData; current: CmsTransfer; onTransfer: (transfer: CmsTransfer) => void; onClose?: () => void }
const confidenceStyle: Record<ImportConfidence, string> = {
  HIGH: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  MEDIUM: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  LOW: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  UNRESOLVED: 'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300',
};
const evidenceLocation = (e: { page?: number; paragraph?: number; table?: number; row?: number; line?: number; sectionKind?: string; sourceType?: string }) => [e.sourceType === 'manual-text' && 'Manual Text', e.page && `Page ${e.page}`, e.line && `Line ${e.line}`, e.paragraph && `Paragraph ${e.paragraph}`, e.table && `Table ${e.table}`, e.row && `Row ${e.row}`, e.sectionKind === 'heading' && 'Heading'].filter(Boolean).join(' · ') || 'Location unavailable';
const csrf = () => document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];

export function DocumentImportReview({ variant, taxonomy, current, onTransfer, onClose }: Props) {
  const [open, setOpen] = useState(variant === 'create');
  const [sourceMethod, setSourceMethod] = useState<'document' | 'manual-text'>('document');
  const [file, setFile] = useState<File | null>(null);
  const [manualText, setManualText] = useState('');
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [values, setValues] = useState<ReviewValues | null>(null);
  const [selected, setSelected] = useState<Set<ImportFieldName>>(new Set());
  const [corrected, setCorrected] = useState<Set<ImportFieldName>>(new Set());
  const [faqValues, setFaqValues] = useState<{ id: string; question: string; answer: string; confidence: ImportConfidence; evidence: ImportProposal['faqs'][number]['evidence'] }[]>([]);
  const [selectedFaqs, setSelectedFaqs] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mappingErrors, setMappingErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<{ transfer: CmsTransfer; conflicts: (keyof CmsTransfer)[] } | null>(null);
  const [replace, setReplace] = useState<Set<keyof CmsTransfer>>(new Set());
  const input = useRef<HTMLInputElement>(null);
  // Each extraction request and each reset gets a new generation; a response from an older one is ignored,
  // so a slow PDF/DOCX result can never land in the review after switching to Manual Source Text (or back).
  const generation = useRef(0);

  const mappedByField = useMemo(() => {
    if (!values) return {} as Record<string, ReturnType<typeof mapImportField>>;
    const sport = mapImportField('sport', values.sport, taxonomy);
    const sportSlug = sport.destination ? String(sport.value) : current.sportSlug;
    const event = mapImportField('event', values.event, taxonomy, { sportSlug });
    const eventSlug = event.destination ? String(event.value) : current.eventSlug;
    return Object.fromEntries(IMPORT_FIELD_ORDER.map((field) => [field, field === 'sport' ? sport : field === 'event' ? event : mapImportField(field, values[field], taxonomy, { sportSlug, eventSlug })]));
  }, [values, taxonomy, current.sportSlug, current.eventSlug]);

  const acceptProposal = (next: ImportProposal) => {
    const nextValues = proposalValues(next); setProposal(next); setValues(nextValues); setCorrected(new Set());
    const candidates = new Set(IMPORT_FIELD_ORDER.filter((field) => next.fields[field].value != null && ['HIGH', 'MEDIUM'].includes(next.fields[field].confidence)));
    const checked = mapSelectedImport(candidates, nextValues, taxonomy, current);
    const unsafe = new Set(checked.mapped.filter((item) => item.error).map((item) => item.field));
    setSelected(new Set([...candidates].filter((field) => !unsafe.has(field))));
    const nextFaqs = (next.faqs ?? []).map((faq, index) => ({ ...faq, id: `faq-${index}` }));
    setFaqValues(nextFaqs); setSelectedFaqs(new Set(nextFaqs.map((faq) => faq.id)));
  };
  const resetResult = () => { generation.current++; setLoading(false); setProposal(null); setValues(null); setSelected(new Set()); setCorrected(new Set()); setFaqValues([]); setSelectedFaqs(new Set()); setError(null); setMappingErrors({}); setPending(null); };

  const requestProposal = async (url: string, init: RequestInit, method: 'document' | 'manual-text', fallback: string) => {
    resetResult();
    const request = generation.current;
    setLoading(true);
    try {
      const token = csrf();
      const response = await fetch(url, { ...init, method: 'POST', credentials: 'include', cache: 'no-store', headers: { ...(init.headers as Record<string, string>), ...(token ? { 'x-csrf-token': decodeURIComponent(token) } : {}) } });
      const result = await response.json().catch(() => ({}));
      if (request !== generation.current) return;
      if (!response.ok) { setError(sourceErrorMessage(response.status, result, fallback)); return; }
      const next = result as ImportProposal;
      if ((method === 'manual-text') !== (next.sourceType === 'manual-text')) { setError(`${fallback}. Try again.`); return; }
      acceptProposal(next);
    } catch {
      if (request === generation.current) setError('The server could not be reached. Your source and the Article editor are unchanged; try again.');
    } finally {
      if (request === generation.current) setLoading(false);
    }
  };
  const extract = async () => {
    if (!file || loading) return;
    const form = new FormData(); form.append('file', file);
    await requestProposal('/api/document-import/extract', { body: form }, 'document', 'Document extraction failed');
  };
  const processManualText = async () => {
    if (loading) return;
    if (!manualText.trim()) { setError('Paste source text before processing.'); return; }
    await requestProposal('/api/document-import/extract-text', { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: manualText }) }, 'manual-text', 'Text processing failed');
  };
  const switchMethod = (method: 'document' | 'manual-text') => { if (method !== sourceMethod) { setSourceMethod(method); resetResult(); } };
  const close = () => { resetResult(); if (onClose) onClose(); else setOpen(false); };

  const transfer = () => {
    // Only a proposal produced by the currently selected source method can be transferred.
    if (!values || !proposal || (sourceMethod === 'manual-text') !== (proposal.sourceType === 'manual-text')) return;
    const result = mapSelectedImport(selected, values, taxonomy, current);
    const faqs = faqValues.filter((faq) => selectedFaqs.has(faq.id)).map((faq) => ({ question: faq.question.trim().replace(/\s+/g, ' '), answer: faq.answer.trim().replace(/\r\n?/g, '\n') }));
    const invalidFaq = faqs.find((faq) => faq.question.length < 5 || faq.question.length > 300 || faq.answer.length < 2 || faq.answer.length > 5000);
    if (invalidFaq) { setError('Selected FAQ items need a 5–300 character question and a 2–5,000 character answer.'); return; }
    if (faqs.length) result.transfer.faqs = faqs;
    const errors = Object.fromEntries(result.mapped.filter((item) => item.error).map((item) => [item.field, item.error!]));
    setMappingErrors(errors);
    if (!Object.keys(result.transfer).length) { setError('No selected fields can be transferred safely. Review the field messages.'); return; }
    const conflicts = transferConflicts(result.transfer, current);
    if (conflicts.length) { setPending({ transfer: result.transfer, conflicts }); setReplace(new Set()); return; }
    onTransfer(result.transfer); setOpen(false); resetResult();
  };
  const confirmTransfer = () => {
    if (!pending) return;
    const approved = { ...pending.transfer } as CmsTransfer;
    for (const conflict of pending.conflicts) if (!replace.has(conflict)) delete approved[conflict];
    if (Object.keys(approved).length) onTransfer(approved);
    setOpen(false); resetResult();
  };

  if (!open) return <div><Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid="import-from-source"><Upload size={14} aria-hidden="true" /> Import from source</Button></div>;
  return (
    <section className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm dark:border-amber-800 dark:bg-stone-950 sm:p-5" aria-labelledby="document-import-heading" data-testid="source-import-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {variant === 'create' && <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-stone-500 dark:text-stone-400">Create article · Step 2 of 3</p>}
          <h3 id="document-import-heading" className="font-serif text-lg font-bold">{variant === 'create' ? 'Create from source' : 'Import from source'}</h3>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{variant === 'create'
            ? 'Choose a source method, review what was found, then continue in the Article editor. Nothing is saved or published automatically.'
            : 'Fill this working copy from a source. Fields that already have content are only replaced if you confirm it.'}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={close}>{variant === 'create' ? <><ArrowLeft size={14} aria-hidden="true" /> Back to options</> : 'Close'}</Button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Source method">
        <button type="button" aria-pressed={sourceMethod === 'document'} onClick={() => switchMethod('document')} data-testid="source-method-document" className={`rounded-lg border-2 p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${sourceMethod === 'document' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700'}`}><span className="flex items-center justify-between gap-2"><FileText size={18} aria-hidden="true" />{sourceMethod === 'document' && <CheckCircle2 size={16} className="text-amber-600" aria-hidden="true" />}</span><strong className="mt-2 block">PDF / DOCX import</strong><span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">Upload a text-based document; headings, fields and FAQ pairs are extracted for review.</span></button>
        <button type="button" aria-pressed={sourceMethod === 'manual-text'} onClick={() => switchMethod('manual-text')} data-testid="source-method-manual" className={`rounded-lg border-2 p-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${sourceMethod === 'manual-text' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20' : 'border-stone-200 hover:border-stone-300 dark:border-stone-800 dark:hover:border-stone-700'}`}><span className="flex items-center justify-between gap-2"><Keyboard size={18} aria-hidden="true" />{sourceMethod === 'manual-text' && <CheckCircle2 size={16} className="text-amber-600" aria-hidden="true" />}</span><strong className="mt-2 block">Manual source text</strong><span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">Paste raw source content (for example press notes or labelled fields) for the same review.</span></button>
      </div>
      {sourceMethod === 'document' ? <div className="mt-4 rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
        <input ref={input} className="sr-only" id="document-import-file" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => { setFile(event.target.files?.[0] ?? null); resetResult(); event.target.value = ''; }} />
        <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" onClick={() => input.current?.click()}><FileText size={16} aria-hidden="true" /> Choose PDF or DOCX</Button>{file ? <div className="min-w-0 text-xs"><strong className="block truncate">{file.name}</strong><span className="text-stone-500">{(file.size / 1024).toFixed(1)} KB · {file.type || 'Type unavailable'}</span></div> : <span className="text-xs text-stone-500">No document selected.</span>}<Button type="button" disabled={!file} isLoading={loading} onClick={() => void extract()}>{loading ? 'Extracting document…' : proposal || error ? 'Extract again' : 'Extract document'}</Button></div>
        <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">PDF or DOCX, up to {SOURCE_LIMITS.documentMegabytes} MB · PDFs up to {SOURCE_LIMITS.pdfPages} pages · text-based PDFs only (scanned or image-only PDFs need OCR, which is not supported).</p>
      </div> : <div className="mt-4 rounded-lg border border-stone-200 p-4 dark:border-stone-800"><label htmlFor="manual-source-text" className="text-sm font-semibold">Manual source text</label><p className="mt-1 text-xs text-stone-500">Paste raw source content here. It must pass through review before reaching the Article editor.</p><textarea id="manual-source-text" rows={14} maxLength={SOURCE_LIMITS.manualCharacters} value={manualText} onChange={(event) => { setManualText(event.target.value); if (proposal || loading || error) resetResult(); }} placeholder="Paste the source content here…" className="mt-3 w-full rounded-lg border border-stone-300 bg-white p-3 text-sm leading-relaxed dark:border-stone-700 dark:bg-stone-900" /><div className="mt-2 flex flex-wrap items-center justify-between gap-2"><span className={`text-xs tabular-nums ${manualText.length >= SOURCE_LIMITS.manualCharacters ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-stone-500'}`}>Characters: {manualText.length.toLocaleString()} / {SOURCE_LIMITS.manualCharacters.toLocaleString()}</span><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" disabled={!manualText} onClick={() => { setManualText(''); resetResult(); }}>Clear</Button><Button type="button" size="sm" disabled={!manualText.trim()} isLoading={loading} onClick={() => void processManualText()}>{loading ? 'Processing text…' : proposal || error ? 'Process again' : 'Process text'}</Button></div></div></div>}
      {error && <div role="alert" className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"><AlertTriangle size={16} className="shrink-0" aria-hidden="true" /><span>{error}</span></div>}
      {proposal && values && <>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Extraction summary"><Summary label="Source" value={proposal.sourceType === 'manual-text' ? 'Manual Text' : proposal.sourceType.toUpperCase()} /><Summary label="Status" value="Ready for review" /><Summary label="Selected" value={`${selected.size} fields · ${selectedFaqs.size} FAQs`} /><Summary label="Warnings" value={String(proposal.warnings.length)} /></div>
        {proposal.warnings.length > 0 && <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"><strong className="flex items-center gap-1"><AlertTriangle size={14} aria-hidden="true" /> Extraction warnings</strong><ul className="mt-2 list-disc space-y-1 pl-5">{proposal.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
        <div className="mt-4 flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelected(new Set(IMPORT_FIELD_ORDER.filter((field) => proposal.fields[field].value != null && ['HIGH', 'MEDIUM'].includes(proposal.fields[field].confidence) && !mappedByField[field]?.error)))}>Select all safe fields</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button></div>
        <div className="mt-3 space-y-3">{IMPORT_FIELD_ORDER.map((field) => {
          const detected = proposal.fields[field], hasValue = values[field].trim().length > 0, mappingError = mappingErrors[field] || mappedByField[field]?.error;
          return <article key={field} className={`rounded-lg border p-3 ${selected.has(field) ? 'border-amber-400 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/10' : 'border-stone-200 dark:border-stone-800'}`}>
            <div className="flex flex-wrap items-center gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selected.has(field)} disabled={!hasValue || !!mappedByField[field]?.error} onChange={(event) => setSelected((before) => { const next = new Set(before); event.target.checked ? next.add(field) : next.delete(field); return next; })} /><span>{IMPORT_FIELD_LABELS[field]}</span></label><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${confidenceStyle[detected.confidence]}`}>{detected.confidence}</span>{corrected.has(field) && <span className="rounded border border-violet-300 bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300">MANUALLY CORRECTED</span>}</div>
            {field === 'body' || field === 'metaDescription' || field === 'excerpt' ? <textarea rows={field === 'body' ? 8 : 3} value={values[field]} onChange={(event) => { setValues({ ...values, [field]: event.target.value }); setCorrected((before) => new Set(before).add(field)); }} className="mt-2 w-full rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-900" placeholder="No value extracted" /> : <input value={values[field]} onChange={(event) => { setValues({ ...values, [field]: event.target.value }); setCorrected((before) => new Set(before).add(field)); }} className="mt-2 w-full rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-900" placeholder="No value extracted" />}
            {!hasValue && <p className="mt-1 text-xs text-stone-500">Missing or unresolved.</p>}{mappingError && <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-300">{mappingError}</p>}
            <details className="mt-2 text-xs"><summary className="flex cursor-pointer items-center gap-1 font-semibold text-stone-600 dark:text-stone-300"><ChevronDown size={13} aria-hidden="true" /> Evidence ({detected.evidence.length})</summary>{detected.evidence.length ? <ul className="mt-2 space-y-2">{detected.evidence.map((evidence, index) => <li key={index} className="rounded bg-stone-100 p-2 dark:bg-stone-900"><span className="block font-semibold">{evidenceLocation(evidence)}</span><q className="mt-1 block break-words text-stone-600 dark:text-stone-400">{evidence.excerpt}</q></li>)}</ul> : <p className="mt-2 text-stone-500">Source evidence is unavailable for this field.</p>}</details>
          </article>;
        })}</div>
        {!!faqValues.length && <section className="mt-5 border-t border-stone-200 pt-4 dark:border-stone-800" aria-labelledby="source-faq-heading"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 id="source-faq-heading" className="font-serif font-bold">FAQ</h4><p className="mt-1 text-xs text-stone-500">Selected questions become ordinary draft entries in the existing FAQ system after the Article is saved.</p></div><div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setSelectedFaqs(new Set(faqValues.map((faq) => faq.id)))}>Select all</Button><Button type="button" size="sm" variant="ghost" onClick={() => setSelectedFaqs(new Set())}>Clear</Button></div></div><div className="mt-3 space-y-3">{faqValues.map((faq, index) => <article key={faq.id} className={`rounded-lg border p-3 ${selectedFaqs.has(faq.id) ? 'border-amber-400 bg-amber-50/40 dark:border-amber-700 dark:bg-amber-950/10' : 'border-stone-200 dark:border-stone-800'}`}><div className="flex flex-wrap items-center gap-2"><label className="flex flex-1 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={selectedFaqs.has(faq.id)} onChange={(event) => setSelectedFaqs((before) => { const next = new Set(before); event.target.checked ? next.add(faq.id) : next.delete(faq.id); return next; })} /> FAQ {index + 1}</label><span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${confidenceStyle[faq.confidence]}`}>{faq.confidence}</span><Button type="button" size="sm" variant="ghost" onClick={() => { setFaqValues((items) => items.filter((item) => item.id !== faq.id)); setSelectedFaqs((before) => { const next = new Set(before); next.delete(faq.id); return next; }); }}>Remove</Button></div><label className="mt-2 block text-xs font-semibold">Question<input value={faq.question} maxLength={300} onChange={(event) => setFaqValues((items) => items.map((item) => item.id === faq.id ? { ...item, question: event.target.value } : item))} className="mt-1 w-full rounded border border-stone-300 bg-white p-2 font-normal dark:border-stone-700 dark:bg-stone-900" /></label><label className="mt-2 block text-xs font-semibold">Answer<textarea rows={4} value={faq.answer} maxLength={5000} onChange={(event) => setFaqValues((items) => items.map((item) => item.id === faq.id ? { ...item, answer: event.target.value } : item))} className="mt-1 w-full rounded border border-stone-300 bg-white p-2 font-normal dark:border-stone-700 dark:bg-stone-900" /></label><details className="mt-2 text-xs"><summary className="flex cursor-pointer items-center gap-1 font-semibold text-stone-600 dark:text-stone-300"><ChevronDown size={13} aria-hidden="true" /> Evidence ({faq.evidence.length})</summary><ul className="mt-2 space-y-2">{faq.evidence.map((evidence, evidenceIndex) => <li key={evidenceIndex} className="rounded bg-stone-100 p-2 dark:bg-stone-900"><span className="block font-semibold">{evidenceLocation(evidence)}</span><q className="mt-1 block break-words text-stone-600 dark:text-stone-400">{evidence.excerpt}</q></li>)}</ul></details></article>)}</div></section>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 dark:border-stone-800"><p className="text-xs text-stone-500">{variant === 'create' ? 'Step 3: the selected values open in the Article editor as an unsaved working copy. Nothing is published.' : 'Transfer fills this working copy and starts no save or publish action.'}</p><Button type="button" disabled={!selected.size && !selectedFaqs.size} onClick={transfer} data-testid="source-transfer"><CheckCircle2 size={15} aria-hidden="true" /> {variant === 'create' ? 'Continue in Article editor' : 'Transfer selected fields'}</Button></div>
      </>}
      {pending && <div role="dialog" aria-modal="true" aria-labelledby="import-overwrite-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[85vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-950"><h3 id="import-overwrite-heading" className="font-serif text-lg font-bold">Review existing values</h3><p className="mt-1 text-xs text-stone-500">Choose which existing fields to replace. Unchecked fields keep their current values.</p><div className="mt-4 space-y-2">{pending.conflicts.map((field) => <label key={field} className="flex items-start gap-2 rounded border border-stone-200 p-3 text-sm dark:border-stone-800"><input type="checkbox" checked={replace.has(field)} onChange={(event) => setReplace((before) => { const next = new Set(before); event.target.checked ? next.add(field) : next.delete(field); return next; })} /><span><strong>Replace {TRANSFER_FIELD_LABELS[field]}</strong><span className="mt-1 block text-xs text-stone-500">This field already contains content. Leave unchecked to keep the existing value.</span></span></label>)}</div><div className="mt-5 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setPending(null)}>Cancel</Button><Button type="button" onClick={confirmTransfer}>Continue transfer</Button></div></div></div>}
    </section>
  );
}

const Summary = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg border border-stone-200 p-2 dark:border-stone-800"><span className="block text-[10px] font-bold uppercase tracking-wide text-stone-500">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>;
