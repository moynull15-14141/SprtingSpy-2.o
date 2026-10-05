/**
 * Site migration (PHASE R, Spec §27). The migration sheet:
 *   Old URL | Old Category | Old Title | Decision | New Category | New Title | New URL | 301
 *
 * The old-site inventory is owner input (a crawl or export of the current
 * site, pasted or uploaded as CSV). Every row is checked against the live new
 * site: KEEP / REWRITE / MERGE need a live New URL and get a direct 301;
 * RETIRE rows get no redirect (a real 404); homepage dumping, chains, loops and
 * hidden live pages are refused. Applying is a dry run first.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';

const DECISIONS = ['UNDECIDED', 'KEEP', 'REWRITE', 'MERGE', 'RETIRE'] as const;
interface Item { id: string; oldUrl: string; oldCategory: string; oldTitle: string; decision: string; newCategory: string; newTitle: string; newUrl: string; checkStatus: string; validation: { problems?: string[]; action?: string; applied?: boolean; appliedTo?: string | null } | null; notes: string }
// PHASE N: the dry run reports every row's outcome and any write-time conflict.
interface Plan {
  redirects: { from: string; to: string; change: 'create' | 'update' }[];
  blockedRows: number;
  summary: { create: number; update: number; alreadyApplied: number; unchanged: number; retire: number; undecided: number; errors: number };
  errors: { from: string; problems: string[] }[];
  retire: string[];
  conflicts: { from: string; error: string }[];
}
interface ListResponse { rows: Item[]; total: number; page: number; pageSize: number; counts: { decision: Record<string, number>; status: Record<string, number> }; columns: string[] }
const field = 'w-full rounded border border-stone-300 bg-white p-1.5 text-xs dark:border-stone-700 dark:bg-stone-950';
const STATUS: Record<string, string> = { ok: 'text-emerald-700 dark:text-emerald-400', error: 'text-rose-700 dark:text-rose-400', pending: 'text-stone-500' };

export const AdminMigration: React.FC = () => {
  const { apiCall, currentUser, showNotification } = useApp();
  const isAdmin = currentUser.role === 'Admin';
  const [data, setData] = useState<ListResponse | null>(null);
  const [decision, setDecision] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [csv, setCsv] = useState('');
  const [importErrors, setImportErrors] = useState<{ row: number; error: string }[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const qs = new URLSearchParams({ page: String(page), ...(decision ? { decision } : {}), ...(status ? { status } : {}) });
    const res = await apiCall<ListResponse>(`/api/migration?${qs}`);
    if (res.data) setData(res.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [decision, status, page]);

  const importCsv = async () => {
    setBusy(true);
    setImportErrors([]);
    const res = await apiCall<{ imported: number }>('/api/migration/import', { method: 'POST', body: { csv } });
    setBusy(false);
    if (res.data) { showNotification(`${res.data.imported} row(s) imported and checked.`, 'success'); setCsv(''); setPlan(null); await load(); }
    else if (Array.isArray(res.details?.errors)) setImportErrors(res.details!.errors as { row: number; error: string }[]);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5_000_000) { showNotification('The CSV is larger than 5 MB. Split it into smaller files.', 'error'); return; }
    setCsv(await file.text());
  };

  const validate = async () => {
    setBusy(true);
    await apiCall('/api/migration/validate', { method: 'POST', body: {} });
    setBusy(false);
    await load();
  };

  const dryRun = async () => {
    setBusy(true);
    const res = await apiCall<Plan>('/api/migration/apply', { method: 'POST', body: { dryRun: true } });
    setBusy(false);
    if (res.data) setPlan(res.data);
  };

  const apply = async () => {
    if (!plan || !confirm(`Create ${plan.summary.create} and update ${plan.summary.update} permanent (301) redirect(s)? Rows with problems are skipped. Export the current redirects (URL Redirects → Export) first so this step can be undone.`)) return;
    setBusy(true);
    const res = await apiCall<{ created: number; updated: number }>('/api/migration/apply', { method: 'POST', body: { dryRun: false } });
    setBusy(false);
    if (res.data) { showNotification(`${res.data.created} redirect(s) created, ${res.data.updated} updated.`, 'success'); setPlan(null); await load(); }
    else if (res.details?.conflicts) setPlan(res.details as unknown as Plan);
  };

  const saveRow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    const res = await apiCall<Item>(`/api/migration/${editing.id}`, { method: 'PUT', body: { decision: editing.decision, newCategory: editing.newCategory, newTitle: editing.newTitle, newUrl: editing.newUrl, notes: editing.notes } });
    setBusy(false);
    if (res.data) { setEditing(null); setPlan(null); await load(); }
  };

  const removeRow = async (item: Item) => {
    if (!confirm(`Remove ${item.oldUrl} from the sheet? An applied redirect is kept.`)) return;
    const res = await apiCall(`/api/migration/${item.id}`, { method: 'DELETE' });
    if (res.data) await load();
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Site migration</h2>
        <p className="mt-1 max-w-3xl text-xs text-stone-500 dark:text-stone-400">
          The migration sheet maps every URL of the current site to its decision and new URL. The inventory comes from the owner (a crawl or export of the current site).
          KEEP, REWRITE and MERGE rows get a direct 301 to a live new page; RETIRE rows return a real 404. Redirecting unrelated pages to the homepage is refused.
        </p>
      </div>

      {isAdmin && (
        <section className="space-y-2 rounded-xl border border-stone-200 p-4 dark:border-stone-800" aria-labelledby="mig-import">
          <h3 id="mig-import" className="text-sm font-semibold">Import or update rows (CSV)</h3>
          <p className="text-[11px] text-stone-500 dark:text-stone-400">First row must be the header: <code>Old URL, Old Category, Old Title, Decision, New Category, New Title, New URL</code> (optional <code>Notes</code>). Existing Old URLs are updated.</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} className="text-xs" />
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} className={`${field} font-mono`} placeholder={'Old URL,Old Category,Old Title,Decision,New Category,New Title,New URL\n/old-french-open-guide,Tennis,French Open Guide,REWRITE,Tennis,French Open 2028 Event Guide,/tennis/french-open/2028/event-guide/'} />
          <Button size="sm" disabled={busy || !csv.trim()} onClick={() => void importCsv()}>Import &amp; check</Button>
          {importErrors.length > 0 && <ul className="max-h-40 overflow-auto text-xs text-rose-700 dark:text-rose-300">{importErrors.map((e) => <li key={e.row}>Row {e.row}: {e.error}</li>)}</ul>}
        </section>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span>{data.total} row(s)</span>
          {Object.entries(data.counts.decision).map(([k, v]) => <span key={k} className="rounded bg-stone-100 px-2 py-0.5 dark:bg-stone-800">{k}: {v}</span>)}
          {Object.entries(data.counts.status).map(([k, v]) => <span key={k} className={`font-semibold ${STATUS[k] ?? ''}`}>{k}: {v}</span>)}
          <a href="/api/migration/export" className="ml-auto font-semibold text-amber-700 underline dark:text-amber-400">Export sheet (CSV)</a>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label>Decision <select value={decision} onChange={(e) => { setDecision(e.target.value); setPage(1); }} className={field}><option value="">All</option>{DECISIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>Check <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={field}><option value="">All</option><option value="ok">OK</option><option value="error">Problems</option><option value="pending">Undecided</option></select></label>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void validate()}>Re-check all rows</Button>
        {isAdmin && <Button size="sm" variant="outline" disabled={busy} onClick={() => void dryRun()}>Preview redirects (dry run)</Button>}
      </div>

      {plan && (
        <section className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 text-xs dark:border-amber-900 dark:bg-amber-950/20" aria-labelledby="mig-plan">
          <h3 id="mig-plan" className="font-semibold">Dry run (nothing was changed): {plan.summary.create} redirect(s) to create, {plan.summary.update} to update.</h3>
          <p className="mt-1" data-migration-summary>
            Already applied {plan.summary.alreadyApplied} · same URL {plan.summary.unchanged} · retire (404) {plan.summary.retire} · undecided {plan.summary.undecided} · with problems {plan.summary.errors}
          </p>
          {plan.conflicts.length > 0 && (
            <div className="mt-2 text-rose-700 dark:text-rose-300">
              <p className="font-semibold">{plan.conflicts.length} redirect(s) conflict with existing rules. Nothing can be applied until they are fixed:</p>
              <ul className="max-h-32 overflow-auto font-mono text-[11px]">{plan.conflicts.map((c) => <li key={c.from}>{c.from}/: {c.error}</li>)}</ul>
            </div>
          )}
          <ul className="mt-2 max-h-48 overflow-auto font-mono text-[11px]">{plan.redirects.slice(0, 500).map((r) => <li key={r.from}>{r.change === 'update' ? '(update) ' : ''}{r.from}/ → {r.to}/</li>)}</ul>
          {plan.errors.length > 0 && <p className="mt-2 text-rose-700 dark:text-rose-300">Rows with problems are skipped; filter by Check → Problems to fix them.</p>}
          {plan.redirects.length > 0 && plan.conflicts.length === 0 && <Button size="sm" className="mt-2" disabled={busy} onClick={() => void apply()}>Apply these redirects</Button>}
        </section>
      )}

      {editing && (
        <form onSubmit={saveRow} className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-4 text-xs dark:border-stone-800 dark:bg-stone-900/60 sm:grid-cols-2" aria-label={`Edit ${editing.oldUrl}`}>
          <p className="sm:col-span-2 font-mono font-semibold">{editing.oldUrl}</p>
          <label>Decision <select value={editing.decision} onChange={(e) => setEditing({ ...editing, decision: e.target.value })} className={field}>{DECISIONS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label>New URL <input value={editing.newUrl} onChange={(e) => setEditing({ ...editing, newUrl: e.target.value })} className={`${field} font-mono`} placeholder="/tennis/french-open/" /></label>
          <label>New category <input value={editing.newCategory} onChange={(e) => setEditing({ ...editing, newCategory: e.target.value })} className={field} /></label>
          <label>New title <input value={editing.newTitle} onChange={(e) => setEditing({ ...editing, newTitle: e.target.value })} className={field} /></label>
          <label className="sm:col-span-2">Notes <input value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} className={field} /></label>
          <div className="flex gap-2"><Button type="submit" size="sm" isLoading={busy}>Save &amp; check</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
        </form>
      )}

      {data && (data.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 dark:border-stone-700">{data.total ? 'No rows match this filter.' : 'The migration sheet is empty. Import the old-site URL inventory to start.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500 dark:bg-stone-900"><tr>{['Old URL', 'Old Category', 'Old Title', 'Decision', 'New Category', 'New Title', 'New URL', '301', 'Check', ''].map((h) => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
              {data.rows.map((r) => (
                <tr key={r.id} data-migration-row={r.oldUrl}>
                  <td className="px-2 py-1 font-mono">{r.oldUrl}</td>
                  <td className="px-2 py-1">{r.oldCategory}</td>
                  <td className="px-2 py-1">{r.oldTitle}</td>
                  <td className="px-2 py-1 font-semibold">{r.decision}</td>
                  <td className="px-2 py-1">{r.newCategory}</td>
                  <td className="px-2 py-1">{r.newTitle}</td>
                  <td className="px-2 py-1 font-mono">{r.newUrl}</td>
                  <td className="px-2 py-1">{r.validation?.applied ? 'yes' : r.validation?.action === 'redirect' ? (r.validation?.appliedTo ? `points to ${r.validation.appliedTo}` : 'not yet') : r.validation?.appliedTo ? `still → ${r.validation.appliedTo}` : '—'}</td>
                  <td className={`px-2 py-1 ${STATUS[r.checkStatus] ?? ''}`}>{r.checkStatus}{r.validation?.problems?.length ? <ul className="mt-1 list-disc pl-4 text-[11px]">{r.validation.problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}</td>
                  <td className="whitespace-nowrap px-2 py-1"><button type="button" onClick={() => setEditing(r)} className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Edit</button>{isAdmin && <button type="button" onClick={() => void removeRow(r)} className="ml-2 text-rose-600 hover:underline">Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {data && data.total > data.pageSize && (
        <div className="flex gap-2 text-xs"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>Page {page} of {Math.ceil(data.total / data.pageSize)}</span><Button size="sm" variant="outline" disabled={page >= Math.ceil(data.total / data.pageSize)} onClick={() => setPage(page + 1)}>Next</Button></div>
      )}
    </div>
  );
};
