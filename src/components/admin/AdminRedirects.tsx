/**
 * SportingSpy URL Redirect Rules Manager
 * Supports Section 11 & 30:
 * - 301 Permanent / 302 Temporary redirects
 * - Real-time client intercept & Apache / Nginx / Cloudflare export foundation
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';

export const AdminRedirects: React.FC = () => {
  const { redirectRules, addRedirectRule, toggleRedirectRule, deleteRedirectRule } = useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [statusCode, setStatusCode] = useState<301 | 302>(301);
  const [notes, setNotes] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceUrl.trim() || !targetUrl.trim()) return;

    let src = sourceUrl.trim();
    if (!src.startsWith('/')) src = '/' + src;
    let dst = targetUrl.trim();
    if (!dst.startsWith('/') && !dst.startsWith('http')) dst = '/' + dst;

    // The server rejects duplicates, loops and self-redirects and flattens chains.
    const ok = await addRedirectRule({
      sourceUrl: src,
      targetUrl: dst,
      statusCode,
      isActive: true,
      notes: notes.trim() || null,
    });
    if (!ok) return;

    setNotes('');
    setFeedback(`Redirect ${src} -> ${dst} (${statusCode}) active.`);
    setSourceUrl('');
    setTargetUrl('');
    setIsCreating(false);
    setTimeout(() => setFeedback(null), 4000);
  };

  const generateNginxConf = () => {
    return redirectRules
      .filter((r) => r.isActive)
      .map(
        (r) =>
          `rewrite ^${r.sourceUrl.replace(/\//g, '\\/')}/?$ ${r.targetUrl} ${
            r.statusCode === 301 ? 'permanent' : 'redirect'
          };`
      )
      .join('\n');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            URL Redirects Engine ({redirectRules.length})
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Section 11: 301 Permanent and 302 Temporary redirects for URL migrations, event renaming, and canonical stability.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a href="/api/redirects/export" className="text-xs font-semibold text-amber-700 underline dark:text-amber-400">Export all (CSV backup)</a>
          {!isCreating && (
            <Button onClick={() => setIsCreating(true)} size="sm">
              + New Redirect Rule
            </Button>
          )}
        </div>
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleSave} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
          <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
            Define Redirect Rule
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Source Path (Old URL) *</label>
              <input
                type="text"
                required
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="/tennis/roland-garros"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Target Destination (New URL) *</label>
              <input
                type="text"
                required
                value={targetUrl}
                onChange={(e) => setTargetUrl(e.target.value)}
                placeholder="/tennis/french-open"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">HTTP Status Code</label>
              <select
                value={statusCode}
                onChange={(e) => setStatusCode(Number(e.target.value) as 301 | 302)}
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-semibold"
              >
                <option value={301}>301 (Moved Permanently - Recommended for SEO)</option>
                <option value={302}>302 (Found / Temporary)</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <label className="block text-xs">
              <span className="block font-semibold mb-1">Notes (why this redirect exists)</span>
              <input
                type="text"
                value={notes}
                maxLength={1000}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Activate Redirect
            </Button>
          </div>
        </form>
      )}

      {/* RULES TABLE */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Source URL</th>
              <th className="p-3">Target URL</th>
              <th className="p-3">Status</th>
              <th className="p-3">State</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800 font-mono">
            {redirectRules.map((rule) => (
              <tr key={rule.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                <td className="p-3 text-stone-900 dark:text-stone-100 font-semibold">
                  {rule.sourceUrl}
                  <div className="font-sans font-normal text-[10px] text-stone-500 mt-0.5 dark:text-stone-400">
                    {rule.origin === 'article-slug' ? 'Automatic: article URL changed' : rule.origin === 'page-slug' ? 'Automatic: page URL changed' : 'Manual'}
                    {rule.updatedAt ? ` · updated ${new Date(rule.updatedAt).toLocaleDateString('en-GB')}` : ''}
                  </div>
                  {rule.notes && <div className="font-sans font-normal text-[10px] text-stone-500 whitespace-pre-line dark:text-stone-400">{rule.notes}</div>}
                </td>
                <td className="p-3 text-amber-700 dark:text-amber-400">
                  &rarr; {rule.targetUrl}
                </td>
                <td className="p-3">
                  <span className="px-2 py-0.5 rounded bg-stone-100 dark:bg-stone-800 text-stone-700 dark:text-stone-300 font-bold">
                    {rule.statusCode}
                  </span>
                </td>
                <td className="p-3 font-sans">
                  <button
                    onClick={() => toggleRedirectRule(rule.id)}
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded cursor-pointer ${
                      rule.isActive
                        ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                        : 'bg-stone-200 dark:bg-stone-800 text-stone-600'
                    }`}
                  >
                    {rule.isActive ? 'Active' : 'Disabled'}
                  </button>
                </td>
                <td className="p-3 text-right font-sans">
                  <button
                    onClick={() => {
                      if (confirm(`Remove redirect rule for ${rule.sourceUrl}?`)) {
                        deleteRedirectRule(rule.id);
                      }
                    }}
                    className="text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Production Nginx / Reverse Proxy Config snippet */}
      <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-900/80 border border-stone-200 dark:border-stone-800 text-xs space-y-2">
        <h4 className="font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wider text-[11px]">
          VPS / Nginx Configuration Export
        </h4>
        <p className="text-stone-500 dark:text-stone-400">
          For edge performance on Ubuntu VPS deployments, copy these directives directly into your Nginx <code>/etc/nginx/sites-available/sportingspy</code> configuration block:
        </p>
        <pre className="p-3 rounded-lg bg-stone-950 text-amber-400 font-mono text-[11px] overflow-x-auto">
          {generateNginxConf() || '# No active redirect rules'}
        </pre>
      </div>
    </div>
  );
};
