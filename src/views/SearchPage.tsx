/**
 * SportingSpy Search (PHASE E).
 *
 * Server-rendered from the URL (?q, sport, type, author, date, from, to,
 * sort, page), so every search state is shareable and works without
 * JavaScript. Results come from the PostgreSQL full-text search service and
 * include only publicly visible articles. Search URLs are noindex (Phase D).
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { FilterSelect } from '../components/ui/FilterSelect';
import { CardImage } from '../components/editorial/CardImage';
import { SearchBox } from '../components/search/SearchBox';
import { FilterDrawer } from '../components/search/FilterDrawer';
import { Highlight } from '../components/search/Highlight';
import { SearchAnalytics } from '../components/search/SearchAnalytics';
import { ARTICLE_TYPES } from '../types';
import type { PublicSearchData } from '../../server/services/public/search';

export interface SearchState {
  q: string; sport: string; type: string; author: string; date: string; from: string; to: string; sort: string; page: number;
}

const selectClass =
  'mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-normal normal-case tracking-normal text-stone-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-200';
const labelClass = 'block text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400';

const DATE_OPTIONS: [string, string][] = [['', 'Any time'], ['today', 'Today'], ['week', 'Last 7 days'], ['month', 'Last 30 days'], ['year', 'This year']];

/** Builds a /search/ URL from the current state with `changes` applied (empty values removed). */
function searchHref(state: SearchState, changes: Partial<Record<keyof SearchState, string | number>>): string {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...state, ...changes })) {
    const value = String(v ?? '');
    if (!value || (k === 'page' && value === '1') || (k === 'sort' && value === 'relevance')) continue;
    merged[k] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return `/search/${qs ? `?${qs}` : ''}`;
}

const formatDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const SearchPage: React.FC<{ results: PublicSearchData; state: SearchState }> = ({ results, state }) => {
  const q = results.query;
  const filters = { sport: state.sport, type: state.type, author: state.author, date: state.date, from: state.from, to: state.to };
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const firstIndex = (results.page - 1) * results.pageSize;
  const outOfRange = results.articleTotal > 0 && results.articles.length === 0;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Search' }]} />

      <header className="space-y-4">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Search</h1>
        <SearchBox defaultQuery={q} hidden={{ ...filters, sort: state.sort === 'relevance' ? '' : state.sort }} autoFocus={!q} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="lg:order-1">
          <FilterDrawer activeCount={activeFilters}>
            <div className="space-y-4">
              <label className={labelClass}>Sport
                <FilterSelect param="sport" value={state.sport} className={selectClass}>
                  <option value="">All sports</option>
                  {results.filterSports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
                </FilterSelect>
              </label>
              <label className={labelClass}>Category
                <FilterSelect param="type" value={state.type} className={selectClass}>
                  <option value="">All categories</option>
                  {ARTICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </FilterSelect>
              </label>
              <label className={labelClass}>Date
                <FilterSelect param="date" value={state.date} className={selectClass} clear={['from', 'to']}>
                  {DATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </FilterSelect>
              </label>
              <label className={labelClass}>Author
                <FilterSelect param="author" value={state.author} className={selectClass}>
                  <option value="">All authors</option>
                  {results.filterAuthors.map((a) => <option key={a.slug} value={a.slug}>{a.name}</option>)}
                </FilterSelect>
              </label>
              <details className="group" open={!!(state.from || state.to)}>
                <summary className="cursor-pointer text-xs font-semibold text-stone-600 dark:text-stone-300">Custom date range</summary>
                <form action="/search/" method="get" className="mt-2 space-y-2">
                  {Object.entries({ ...filters, q, sort: state.sort === 'relevance' ? '' : state.sort, date: '', from: '', to: '' }).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
                  <label className={labelClass}>From<input type="date" name="from" defaultValue={state.from} className={selectClass} /></label>
                  <label className={labelClass}>To<input type="date" name="to" defaultValue={state.to} className={selectClass} /></label>
                  <button type="submit" className="w-full rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:hover:bg-stone-800">Apply dates</button>
                </form>
              </details>
              {activeFilters > 0 && (
                <Link href={searchHref(state, { sport: '', type: '', author: '', date: '', from: '', to: '', page: 1 })} className="inline-block text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">
                  Clear all filters
                </Link>
              )}
            </div>
          </FilterDrawer>
        </div>

        <section className="min-w-0 space-y-5 lg:order-2" aria-labelledby="search-results-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-3 dark:border-stone-800">
            <h2 id="search-results-heading" className="text-sm text-stone-600 dark:text-stone-400" aria-live="polite">
              {q ? (
                <><strong className="text-stone-900 dark:text-stone-100">{results.articleTotal.toLocaleString('en-GB')}</strong> {results.articleTotal === 1 ? 'result' : 'results'} for <strong className="text-stone-900 dark:text-stone-100">“{q}”</strong></>
              ) : (
                <>Latest articles{activeFilters ? ' matching your filters' : ''}</>
              )}
            </h2>
            <label className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">Sort
              <FilterSelect param="sort" value={state.sort === 'relevance' || (!q && state.sort === 'newest') ? '' : state.sort} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-stone-700 dark:bg-stone-950">
                <option value="">{q ? 'Relevance' : 'Newest'}</option>
                {q && <option value="newest">Newest</option>}
                <option value="oldest">Oldest</option>
              </FilterSelect>
            </label>
          </div>

          {!q && (
            <p className="rounded-xl bg-stone-100/70 p-4 text-sm text-stone-600 dark:bg-stone-900/40 dark:text-stone-400">
              Search by tournament, player, sport or topic. Use quotes for an exact phrase (<code>&quot;order of play&quot;</code>) and a minus sign to exclude a word (<code>french -money</code>).
            </p>
          )}

          {results.mode === 'fuzzy' && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              No exact matches for “{q}”. Showing close matches instead.
            </p>
          )}

          {(results.sports.length > 0 || results.events.length > 0) && (
            <div className="flex flex-wrap gap-2" aria-label="Matching sports and events">
              {results.sports.map((s) => (
                <Link key={s.id} href={`/${s.slug}/`} className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 hover:border-amber-500 hover:text-amber-700 dark:border-stone-700 dark:text-stone-300">
                  Sport · {s.name}
                </Link>
              ))}
              {results.events.map((e) => (
                <Link key={e.id} href={e.currentEditionUrl || `/${e.sportSlug}/${e.slug}/`} className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 hover:border-amber-500 hover:text-amber-700 dark:border-stone-700 dark:text-stone-300">
                  Event · {e.name}
                </Link>
              ))}
            </div>
          )}

          <SearchAnalytics query={q} total={results.articleTotal} page={results.page} filters={filters} sort={state.sort}>
            {results.articles.length === 0 ? (
              <div className="rounded-xl border border-stone-200 p-8 text-center dark:border-stone-800">
                {outOfRange ? (
                  <p className="text-sm text-stone-600 dark:text-stone-400">This page is past the end of the results. <Link className="font-semibold text-amber-700 underline dark:text-amber-500" href={searchHref(state, { page: 1 })}>Go to the first page</Link>.</p>
                ) : (
                  <>
                    <p className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{q ? <>No results found for “{q}”</> : 'No articles match these filters'}</p>
                    <ul className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm text-stone-600 dark:text-stone-400">
                      {q && <li>• Check the spelling</li>}
                      {q && <li>• Try a broader or shorter keyword</li>}
                      {activeFilters > 0 && <li>• <Link className="font-semibold text-amber-700 underline dark:text-amber-500" href={searchHref(state, { sport: '', type: '', author: '', date: '', from: '', to: '', page: 1 })}>Remove filters</Link></li>}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <ol className="divide-y divide-stone-200 dark:divide-stone-800">
                {results.articles.map((a, i) => (
                  <li key={a.id} className="group relative flex gap-4 py-4 first:pt-0">
                    <div className="hidden w-40 shrink-0 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-900 sm:block">
                      <CardImage src={a.image?.url || a.featuredImage} alt="" loading={i < 3 ? 'eager' : 'lazy'} className="aspect-video h-full w-full object-cover" fallback={<div className="aspect-video" />} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-amber-700 dark:text-amber-500">
                        {a.sportName}{a.eventShortName ? ` · ${a.eventShortName}` : ''} <span className="font-normal text-stone-500 dark:text-stone-400">· {a.articleType}</span>
                      </p>
                      <h3 className="mt-1 font-serif text-lg font-bold leading-snug text-stone-900 group-hover:text-amber-700 dark:text-stone-100 dark:group-hover:text-amber-400">
                        <Link href={a.url} data-result-position={firstIndex + i + 1} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
                          <Highlight text={a.title} query={q} />
                        </Link>
                      </h3>
                      <p className="mt-1 line-clamp-2 text-sm text-stone-600 dark:text-stone-400"><Highlight text={a.excerpt} query={q} /></p>
                      <p className="mt-1.5 text-xs text-stone-500 dark:text-stone-400">
                        <time dateTime={new Date(a.publishedAt).toISOString()}>{formatDate(a.publishedAt)}</time>{a.authorName ? ` · ${a.authorName}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SearchAnalytics>

          {results.totalPages > 1 && (
            <nav aria-label="Search result pages" className="flex items-center justify-between gap-3 border-t border-stone-200 pt-4 text-sm dark:border-stone-800">
              {results.page > 1 ? <Link rel="prev" href={searchHref(state, { page: results.page - 1 })} className="rounded-lg border border-stone-300 px-3 py-1.5 font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">← Previous</Link> : <span />}
              <span className="text-stone-500 dark:text-stone-400">Page {results.page} of {results.totalPages}</span>
              {results.page < results.totalPages ? <Link rel="next" href={searchHref(state, { page: results.page + 1 })} className="rounded-lg border border-stone-300 px-3 py-1.5 font-semibold hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800">Next →</Link> : <span />}
            </nav>
          )}
        </section>
      </div>
    </div>
  );
};
