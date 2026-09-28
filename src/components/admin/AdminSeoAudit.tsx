/**
 * SEO Intelligence (PHASE D, Spec v1.1 §14, §18, §19, §29).
 *
 * Every number here comes from a real scan or the live configuration. There
 * is no aggregate "SEO score". Scans are run on demand and cached; the
 * public site never runs them. Findings say what is wrong, why it matters,
 * where it is and what to change, with a link to the editor.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { ARTICLE_TYPES } from '../../types';
import type { AdminTab } from './AdminLayout';

type Severity = 'blocking' | 'warning' | 'info';
interface Finding {
  id: string; ruleKey: string; ruleName: string; category: string; severity: Severity;
  entityType: string; entityId: string; entityTitle: string; url?: string;
  message: string; why: string; fix: string; edit?: { tab: string; id?: string };
}
interface Summary { total: number; bySeverity: Record<Severity, number>; byCategory: Record<string, Record<Severity, number>>; checked?: Record<string, number>; rulesEnabled?: number; durationMs?: number }
interface Run { id: string; startedAt: string; triggeredBy: string; summary: Summary; findings?: Finding[] }
interface Rule {
  key: string; name: string; why: string; fix: string; category: string; target: string;
  enabled: boolean; severity: Severity; articleTypes: string[]; config: Record<string, unknown>; version: number; updatedAt: string | null;
  defaults: { severity: Severity; articleTypes: string[]; config: Record<string, unknown> };
}

const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technical SEO', 'on-page': 'On-page SEO', content: 'Content & topic coverage', 'internal-links': 'Internal links',
  'external-links': 'External links', 'structured-data': 'Structured data', 'image-seo': 'Image SEO', 'ai-readiness': 'AI search readiness',
  freshness: 'Freshness', 'event-seo': 'Event SEO & coverage', redirects: 'Redirects', 'search-appearance': 'Search appearance',
};
const SEVERITY_STYLE: Record<Severity, string> = {
  blocking: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300',
};
const SEVERITY_LABEL: Record<Severity, string> = { blocking: 'Blocking', warning: 'Warning', info: 'Info' };
const input = 'p-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs';

type Section = 'overview' | 'issues' | 'technical' | 'integrations' | 'rules' | 'reports';

export const AdminSeoAudit: React.FC<{ setActiveTab?: (tab: AdminTab) => void }> = ({ setActiveTab }) => {
  const { apiCall, currentUser, showNotification } = useApp();
  const [section, setSection] = useState<Section>('overview');
  const [latest, setLatest] = useState<Run | null>(null);
  const [previous, setPrevious] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [issueFilter, setIssueFilter] = useState<{ category: string; severity: string; q: string }>({ category: '', severity: '', q: '' });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiCall<{ latest: Run | null; previousSummary: Summary | null }>('/api/seo/overview');
    if (res.data) { setLatest(res.data.latest); setPrevious(res.data.previousSummary); }
    setLoading(false);
  }, [apiCall]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const scan = async () => {
    setScanning(true);
    const res = await apiCall<Run>('/api/seo/scan', { method: 'POST', body: {} });
    setScanning(false);
    if (res.data) { showNotification(`Scan complete: ${res.data.summary.total} findings.`, 'success'); await load(); }
  };

  const openIssues = (category = '', severity = '') => { setIssueFilter({ category, severity, q: '' }); setSection('issues'); };
  const sections: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Overview' }, { id: 'issues', label: 'Issues' }, { id: 'technical', label: 'Sitemap, robots & redirects' },
    { id: 'integrations', label: 'Search Console, Bing & IndexNow' }, { id: 'rules', label: 'Rules' }, { id: 'reports', label: 'Reports' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">SEO Intelligence</h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            {latest ? `Last scan ${new Date(latest.startedAt).toLocaleString('en-GB')} by ${latest.triggeredBy} · ${latest.summary.durationMs ?? '?'} ms` : 'No scan has been run yet.'} Findings are concrete issues, not a score.
          </p>
        </div>
        <Button size="sm" onClick={scan} isLoading={scanning}>Run scan now</Button>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="SEO sections">
        {sections.map((s) => (
          <button key={s.id} type="button" onClick={() => setSection(s.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${section === s.id ? 'bg-amber-700 text-white font-semibold' : 'bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 hover:bg-stone-200'}`}>
            {s.label}
          </button>
        ))}
      </nav>

      {loading ? <p className="text-xs text-stone-500 dark:text-stone-400">Loading…</p> : null}
      {!loading && section === 'overview' && <Overview latest={latest} previous={previous} onOpen={openIssues} onScan={scan} />}
      {!loading && section === 'issues' && <Issues findings={latest?.findings || []} filter={issueFilter} setFilter={setIssueFilter} setActiveTab={setActiveTab} />}
      {section === 'technical' && <Technical findings={latest?.findings || []} />}
      {section === 'integrations' && <Integrations />}
      {section === 'rules' && <Rules canEdit={currentUser.role === 'Admin'} />}
      {section === 'reports' && <Reports />}
    </div>
  );
};

function SeverityBadge({ s }: { s: Severity }) {
  return <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${SEVERITY_STYLE[s]}`}>{SEVERITY_LABEL[s]}</span>;
}

function Overview({ latest, previous, onOpen, onScan }: { latest: Run | null; previous: Summary | null; onOpen: (c?: string, s?: string) => void; onScan: () => void }) {
  if (!latest) {
    return (
      <div className="p-6 rounded-xl border border-dashed border-stone-300 dark:border-stone-700 text-sm text-stone-600 dark:text-stone-400 space-y-3">
        <p>No findings yet: SEO Intelligence has not been run on this site.</p>
        <Button size="sm" onClick={onScan}>Run the first scan</Button>
      </div>
    );
  }
  const s = latest.summary;
  const delta = (sev: Severity) => (previous ? s.bySeverity[sev] - previous.bySeverity[sev] : null);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(['blocking', 'warning', 'info'] as Severity[]).map((sev) => (
          <button key={sev} type="button" onClick={() => onOpen('', sev)} className="text-left p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] hover:border-amber-500">
            <SeverityBadge s={sev} />
            <div className="mt-2 font-serif text-3xl font-bold tabular-nums">{s.bySeverity[sev]}</div>
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              {sev === 'blocking' ? 'Fix first: these break indexing, links or structured data.' : sev === 'warning' ? 'Weaken pages; fix when editing.' : 'Suggestions and opportunities.'}
              {delta(sev) !== null && delta(sev) !== 0 ? ` (${delta(sev)! > 0 ? '+' : ''}${delta(sev)} since previous scan)` : ''}
            </p>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">
        Checked: {Object.entries(s.checked || {}).map(([k, v]) => `${v} ${k}`).join(' · ')} · {s.rulesEnabled} rules enabled.
      </p>
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 dark:text-stone-400">
            <tr><th className="p-3">Area</th><th className="p-3">Blocking</th><th className="p-3">Warning</th><th className="p-3">Info</th></tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {Object.keys(CATEGORY_LABELS).map((cat) => {
              const c = s.byCategory[cat] || { blocking: 0, warning: 0, info: 0 };
              return (
                <tr key={cat} className="hover:bg-stone-50 dark:hover:bg-stone-900/40 cursor-pointer" onClick={() => onOpen(cat)}>
                  <td className="p-3 font-semibold">{CATEGORY_LABELS[cat]}</td>
                  {(['blocking', 'warning', 'info'] as Severity[]).map((sev) => <td key={sev} className={`p-3 tabular-nums ${c[sev] ? '' : 'text-stone-500 dark:text-stone-400'}`}>{c[sev] || '—'}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Issues({ findings, filter, setFilter, setActiveTab }: { findings: Finding[]; filter: { category: string; severity: string; q: string }; setFilter: (f: { category: string; severity: string; q: string }) => void; setActiveTab?: (tab: AdminTab) => void }) {
  const list = findings.filter((f) => (!filter.category || f.category === filter.category) && (!filter.severity || f.severity === filter.severity) && (!filter.q || `${f.entityTitle} ${f.message} ${f.ruleName}`.toLowerCase().includes(filter.q.toLowerCase())));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select className={input} value={filter.category} onChange={(e) => setFilter({ ...filter, category: e.target.value })} aria-label="Filter by area">
          <option value="">All areas</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className={input} value={filter.severity} onChange={(e) => setFilter({ ...filter, severity: e.target.value })} aria-label="Filter by severity">
          <option value="">All severities</option>
          <option value="blocking">Blocking</option><option value="warning">Warning</option><option value="info">Info</option>
        </select>
        <input className={`${input} flex-1 min-w-[180px]`} placeholder="Search page or issue…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search issues" />
        <span className="text-xs text-stone-500 dark:text-stone-400">{list.length} of {findings.length}</span>
      </div>
      {!findings.length && <p className="text-xs text-stone-500 dark:text-stone-400">Run a scan to see findings.</p>}
      <ul className="space-y-2" aria-label="SEO findings">
        {list.map((f) => (
          <li key={f.id} className="p-3 rounded-lg border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] text-xs space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge s={f.severity} />
              <span className="text-[10px] uppercase text-stone-500 dark:text-stone-400">{CATEGORY_LABELS[f.category] || f.category} · {f.ruleName}</span>
            </div>
            <p className="font-semibold text-stone-900 dark:text-stone-100">{f.message}</p>
            <p className="text-stone-600 dark:text-stone-400"><strong>Where:</strong> {f.entityType} “{f.entityTitle}” {f.url && <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-amber-700 underline dark:text-amber-500">{f.url}</a>}</p>
            <p className="text-stone-600 dark:text-stone-400"><strong>Why it matters:</strong> {f.why}</p>
            <p className="text-stone-600 dark:text-stone-400"><strong>What to change:</strong> {f.fix}</p>
            {f.edit && setActiveTab && (
              <button type="button" className="text-amber-700 dark:text-amber-400 font-semibold hover:underline" onClick={() => setActiveTab(f.edit!.tab as AdminTab)}>
                Open {f.edit.tab === 'events' ? 'Events & Editions' : f.edit.tab} →
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface TechnicalData {
  origin: string;
  sitemap: { indexUrl: string; files: string[]; included: { path: string; kind: string }[]; excluded: { path: string; kind: string; title: string; reason: string }[] };
  robots: string;
  searchConsole: { verificationTokenSet: boolean; sitemapUrl: string; apiConnected: boolean; setup: string[] };
  bing: { verificationTokenSet: boolean; sitemapUrl: string; apiConnected: boolean; indexNow: boolean; setup: string[] };
  indexNow: { configured: boolean; active: boolean; keyFileUrl: string | null; endpoint: string; reason: string | null; recent: { id: string; status: string; httpStatus: number | null; detail: string; urls: string[]; createdAt: string }[] };
}

function useTechnical() {
  const { apiCall } = useApp();
  const [data, setData] = useState<TechnicalData | null>(null);
  useEffect(() => { (async () => { const r = await apiCall<TechnicalData>('/api/seo/technical'); if (r.data) setData(r.data); })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  return data;
}

function Technical({ findings }: { findings: Finding[] }) {
  const data = useTechnical();
  const redirectIssues = findings.filter((f) => f.category === 'redirects');
  const linkIssues = findings.filter((f) => ['broken-internal-links', 'internal-link-redirect-hop', 'orphan-article'].includes(f.ruleKey));
  if (!data) return <p className="text-xs text-stone-500 dark:text-stone-400">Loading…</p>;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-xs">
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2" aria-label="Sitemap">
        <h3 className="font-serif text-base font-bold">XML sitemap</h3>
        <p>Index: <a className="text-amber-700 underline dark:text-amber-500" href={data.sitemap.indexUrl} target="_blank" rel="noopener noreferrer">{data.sitemap.indexUrl}</a></p>
        <p>{data.sitemap.files.length} child sitemap(s) · <strong>{data.sitemap.included.length}</strong> indexable URLs listed · <strong>{data.sitemap.excluded.length}</strong> public URLs excluded</p>
        <details>
          <summary className="cursor-pointer font-semibold">Excluded URLs and why</summary>
          <ul className="mt-2 space-y-0.5 max-h-64 overflow-y-auto">
            {data.sitemap.excluded.map((e) => <li key={e.path}><span className="font-mono">{e.path}</span> — {e.reason}</li>)}
          </ul>
        </details>
      </section>
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2" aria-label="robots.txt">
        <h3 className="font-serif text-base font-bold">robots.txt</h3>
        <pre className="p-2 rounded bg-stone-100 dark:bg-stone-900 whitespace-pre-wrap font-mono text-[11px]">{data.robots}</pre>
        <p className="text-stone-500 dark:text-stone-400">Only non-public areas are blocked. Search and filtered listings stay crawlable so their noindex tag is seen.</p>
      </section>
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2 lg:col-span-2" aria-label="Redirect and link health">
        <h3 className="font-serif text-base font-bold">Redirect & link health (last scan)</h3>
        {redirectIssues.length + linkIssues.length === 0 ? <p className="text-stone-500 dark:text-stone-400">No redirect chains, loops, broken targets, broken internal links or redirect hops were found in the last scan{findings.length ? '' : ' (no scan yet)'}.</p> : (
          <ul className="space-y-1">{[...redirectIssues, ...linkIssues].map((f) => <li key={f.id}><SeverityBadge s={f.severity} /> {f.entityTitle}: {f.message}</li>)}</ul>
        )}
      </section>
    </div>
  );
}

function Integrations() {
  const data = useTechnical();
  if (!data) return <p className="text-xs text-stone-500 dark:text-stone-400">Loading…</p>;
  const row = (label: string, ok: boolean, text: string) => (
    <li className="flex gap-2"><span className={ok ? 'text-emerald-600' : 'text-amber-700 dark:text-amber-500'}>{ok ? '✓' : '○'}</span><span><strong>{label}:</strong> {text}</span></li>
  );
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2" aria-label="Google Search Console">
        <h3 className="font-serif text-base font-bold">Google Search Console</h3>
        <ul className="space-y-1">
          {row('Verification tag', data.searchConsole.verificationTokenSet, data.searchConsole.verificationTokenSet ? 'published on every page' : 'not set')}
          {row('Sitemap', true, data.searchConsole.sitemapUrl)}
          {row('Performance data', data.searchConsole.apiConnected, data.searchConsole.apiConnected ? 'connected' : 'Requires Search Console connection — not configured')}
        </ul>
        <ol className="list-decimal pl-4 text-stone-600 dark:text-stone-400 space-y-0.5">{data.searchConsole.setup.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </section>
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2" aria-label="Bing Webmaster Tools">
        <h3 className="font-serif text-base font-bold">Bing Webmaster Tools</h3>
        <ul className="space-y-1">
          {row('Verification tag', data.bing.verificationTokenSet, data.bing.verificationTokenSet ? 'published on every page' : 'not set')}
          {row('Sitemap', true, data.bing.sitemapUrl)}
          {row('IndexNow', data.bing.indexNow, data.bing.indexNow ? 'key configured' : 'not configured')}
          {row('Performance data', data.bing.apiConnected, data.bing.apiConnected ? 'connected' : 'Requires Bing Webmaster API — not configured')}
        </ul>
        <ol className="list-decimal pl-4 text-stone-600 dark:text-stone-400 space-y-0.5">{data.bing.setup.map((s, i) => <li key={i}>{s}</li>)}</ol>
      </section>
      <section className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 space-y-2" aria-label="IndexNow">
        <h3 className="font-serif text-base font-bold">IndexNow</h3>
        <ul className="space-y-1">
          {row('Key', data.indexNow.configured, data.indexNow.configured ? `key file ${data.indexNow.keyFileUrl}` : 'Not configured (Settings → IndexNow)')}
          {row('Submissions', data.indexNow.active, data.indexNow.active ? `on publish / unpublish / URL change / content change → ${data.indexNow.endpoint}` : data.indexNow.reason || 'inactive')}
        </ul>
        <h4 className="font-semibold pt-1">Recent submissions</h4>
        {data.indexNow.recent.length ? (
          <ul className="space-y-1">{data.indexNow.recent.map((l) => <li key={l.id}><span className="font-mono">{new Date(l.createdAt).toLocaleString('en-GB')}</span> · {l.status}{l.httpStatus ? ` (HTTP ${l.httpStatus})` : ''} · {l.detail} · {l.urls.length} URL(s)</li>)}</ul>
        ) : <p className="text-stone-500 dark:text-stone-400">No submissions yet.</p>}
        <p className="text-stone-500 dark:text-stone-400">"Submitted" means the endpoint received the URLs. It does not mean they were indexed.</p>
      </section>
    </div>
  );
}

function Rules({ canEdit }: { canEdit: boolean }) {
  const { apiCall, showNotification } = useApp();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [configText, setConfigText] = useState('');
  const load = useCallback(async () => { const r = await apiCall<Rule[]>('/api/seo/rules'); if (r.data) setRules(r.data); }, [apiCall]);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const save = async (key: string, body: Record<string, unknown>) => {
    const r = await apiCall(`/api/seo/rules/${key}`, { method: 'PUT', body });
    if (r.data) { showNotification('Rule updated. It applies from the next scan or check.', 'success'); await load(); return true; }
    return false;
  };
  const grouped = useMemo(() => {
    const m = new Map<string, Rule[]>();
    for (const r of rules || []) m.set(r.category, [...(m.get(r.category) || []), r]);
    return [...m.entries()];
  }, [rules]);
  if (!rules) return <p className="text-xs text-stone-500 dark:text-stone-400">Loading…</p>;
  return (
    <div className="space-y-4 text-xs">
      <p className="text-stone-500 dark:text-stone-400">Rules are stored in the database: enabling, severity, article types and thresholds/term lists change without a rebuild. {canEdit ? '' : 'Only Admins can change rules.'}</p>
      {grouped.map(([cat, list]) => (
        <section key={cat} className="rounded-xl border border-stone-200 dark:border-stone-800 overflow-hidden" aria-label={CATEGORY_LABELS[cat] || cat}>
          <h3 className="px-3 py-2 bg-stone-50 dark:bg-stone-900/60 font-bold uppercase text-[11px] tracking-wider text-stone-600">{CATEGORY_LABELS[cat] || cat}</h3>
          <ul className="divide-y divide-stone-100 dark:divide-stone-800">
            {list.map((r) => (
              <li key={r.key} className="p-3 space-y-2" data-rule={r.key}>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 font-semibold">
                    <input type="checkbox" checked={r.enabled} disabled={!canEdit} onChange={(e) => save(r.key, { enabled: e.target.checked })} aria-label={`Enable ${r.name}`} />
                    {r.name}
                  </label>
                  <select className={input} value={r.severity} disabled={!canEdit} onChange={(e) => save(r.key, { severity: e.target.value })} aria-label={`Severity for ${r.name}`}>
                    <option value="blocking">Blocking</option><option value="warning">Warning</option><option value="info">Info</option>
                  </select>
                  <span className="text-stone-500 dark:text-stone-400">applies to {r.target === 'article' ? (r.articleTypes.length ? r.articleTypes.join(', ') : 'all article types') : `${r.target}s`} · v{r.version}</span>
                  {canEdit && <button type="button" className="text-amber-700 font-semibold hover:underline dark:text-amber-500" onClick={() => { setEditing(editing === r.key ? null : r.key); setConfigText(JSON.stringify(r.config, null, 2)); }}>{editing === r.key ? 'Close' : 'Configure'}</button>}
                </div>
                <p className="text-stone-500 dark:text-stone-400">{r.why}</p>
                {editing === r.key && (
                  <div className="space-y-2">
                    {r.target === 'article' && (
                      <fieldset className="flex flex-wrap gap-2">
                        <legend className="font-semibold mb-1">Article types (none selected = all)</legend>
                        {ARTICLE_TYPES.map((t) => (
                          <label key={t} className="flex items-center gap-1">
                            <input type="checkbox" checked={r.articleTypes.includes(t)} onChange={(e) => save(r.key, { articleTypes: e.target.checked ? [...r.articleTypes, t] : r.articleTypes.filter((x) => x !== t) })} />{t}
                          </label>
                        ))}
                      </fieldset>
                    )}
                    <label className="block font-semibold">Configuration (JSON)
                      <textarea className={`${input} w-full font-mono`} rows={Math.min(18, configText.split('\n').length + 1)} value={configText} onChange={(e) => setConfigText(e.target.value)} aria-label={`Configuration for ${r.name}`} />
                    </label>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={async () => { let parsed; try { parsed = JSON.parse(configText); } catch { showNotification('Configuration is not valid JSON.', 'error'); return; } await save(r.key, { config: parsed }); }}>Save configuration</Button>
                      <Button size="sm" variant="outline" onClick={() => save(r.key, { config: r.defaults.config, severity: r.defaults.severity, ...(r.target === 'article' ? { articleTypes: r.defaults.articleTypes } : {}) })}>Reset to defaults</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Reports() {
  const { apiCall } = useApp();
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [diff, setDiff] = useState<{ added: Finding[]; resolved: Finding[] } | null>(null);
  useEffect(() => { (async () => { const r = await apiCall<Run[]>('/api/seo/runs'); if (r.data) setRuns(r.data); })(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => {
    if (!runs || runs.length < 2) return;
    (async () => {
      const [a, b] = await Promise.all([apiCall<Run>(`/api/seo/runs/${runs[0].id}`), apiCall<Run>(`/api/seo/runs/${runs[1].id}`)]);
      if (!a.data || !b.data) return;
      const now = new Map((a.data.findings || []).map((f) => [f.id, f]));
      const before = new Map((b.data.findings || []).map((f) => [f.id, f]));
      setDiff({ added: [...now.values()].filter((f) => !before.has(f.id)), resolved: [...before.values()].filter((f) => !now.has(f.id)) });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);
  if (!runs) return <p className="text-xs text-stone-500 dark:text-stone-400">Loading…</p>;
  if (!runs.length) return <p className="text-xs text-stone-500 dark:text-stone-400">No scans yet. Reports appear after the first scan.</p>;
  return (
    <div className="space-y-4 text-xs">
      {diff && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <section className="p-3 rounded-lg border border-stone-200 dark:border-stone-800"><h3 className="font-semibold mb-1">New since previous scan ({diff.added.length})</h3><ul className="space-y-0.5 max-h-48 overflow-y-auto">{diff.added.map((f) => <li key={f.id}>{f.entityTitle}: {f.message}</li>)}</ul></section>
          <section className="p-3 rounded-lg border border-stone-200 dark:border-stone-800"><h3 className="font-semibold mb-1">Resolved since previous scan ({diff.resolved.length})</h3><ul className="space-y-0.5 max-h-48 overflow-y-auto">{diff.resolved.map((f) => <li key={f.id}>{f.entityTitle}: {f.message}</li>)}</ul></section>
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 dark:text-stone-400"><tr><th className="p-2">Scan</th><th className="p-2">By</th><th className="p-2">Blocking</th><th className="p-2">Warning</th><th className="p-2">Info</th><th className="p-2">Pages checked</th></tr></thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {runs.map((r) => (
              <tr key={r.id}><td className="p-2 font-mono">{new Date(r.startedAt).toLocaleString('en-GB')}</td><td className="p-2">{r.triggeredBy}</td><td className="p-2 tabular-nums">{r.summary.bySeverity.blocking}</td><td className="p-2 tabular-nums">{r.summary.bySeverity.warning}</td><td className="p-2 tabular-nums">{r.summary.bySeverity.info}</td><td className="p-2 tabular-nums">{r.summary.checked?.pages ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
