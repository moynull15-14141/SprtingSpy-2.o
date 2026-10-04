/**
 * SportingSpy Search (PHASE E).
 *
 * Server-rendered from the URL (?q, sport, type, author, date, from, to,
 * sort, page), so every search state is shareable and works without
 * JavaScript. Results come from the PostgreSQL full-text search service and
 * include only publicly visible articles. Search URLs are noindex (Phase D).
 *
 * PHASE M: unified Article + Event search. `kind` tabs (All / Articles /
 * Events) switch the result type; "All" shows the top-ranked Events as a
 * group above the Article list on page 1. Events link to the permanent Event
 * page; a matched Edition (e.g. a year in the query) is shown as a detail.
 */

import React from 'react';
import Link from 'next/link';
import { CalendarDays, MapPin } from 'lucide-react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { FilterSelect } from '../components/ui/FilterSelect';
import { CardImage } from '../components/editorial/CardImage';
import { SearchBox } from '../components/search/SearchBox';
import { FilterDrawer } from '../components/search/FilterDrawer';
import { Highlight } from '../components/search/Highlight';
import { SearchAnalytics } from '../components/search/SearchAnalytics';
import type { EventResult, PublicSearchData } from '../../server/services/public/search';

export interface SearchState {
  q: string; kind: string; sport: string; type: string; author: string; date: string; from: string; to: string; sort: string; page: number;
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

/** One Event search result: links to the permanent Event page; facts shown only when stored. */
const EventResultRow: React.FC<{ event: EventResult; q: string; position: number }> = ({ event, q, position }) => {
  const place = [event.defaultVenue, event.defaultLocation].filter(Boolean).join(', ');
  return (
    <li className="group relative py-4 first:pt-0" data-result-kind="event">
      <p className="text-xs font-semibold text-amber-700 dark:text-amber-500">{event.sportName} <span className="font-normal text-stone-500 dark:text-stone-400">· Event</span></p>
      <h3 className="mt-1 break-words font-serif text-lg font-bold leading-snug text-stone-900 group-hover:text-amber-700 dark:text-stone-100 dark:group-hover:text-amber-400">
        <Link href={event.url} data-result-position={position} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <Highlight text={event.name} query={q} />
        </Link>
      </h3>
      {event.description && <p className="mt-1 line-clamp-2 text-sm text-stone-600 dark:text-stone-400"><Highlight text={event.description} query={q} /></p>}
      {(place || event.matchedEdition) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
          {place && <span className="inline-flex min-w-0 items-center gap-1"><MapPin size={13} aria-hidden="true" className="shrink-0" /><span className="break-words">{place}</span></span>}
          {event.matchedEdition && (
            // Above the card-wide link so the Edition stays separately reachable.
            <Link href={event.matchedEdition.url} className="relative z-10 inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline dark:text-amber-400">
              <CalendarDays size={13} aria-hidden="true" /> {event.matchedEdition.title}
            </Link>
          )}
        </div>
      )}
    </li>
  );
};

const formatDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const SearchPage: React.FC<{ results: PublicSearchData; state: SearchState }> = ({ results, state }) => {
  const q = results.query;
  const kind = results.kind;
  const eventsView = kind === 'event';
  // Category, author and dates describe Articles only; the Events view hides them.
  const filters = eventsView
    ? { sport: state.sport, type: '', author: '', date: '', from: '', to: '' }
    : { sport: state.sport, type: state.type, author: state.author, date: state.date, from: state.from, to: state.to };
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const firstIndex = (results.page - 1) * results.pageSize;
  const pagedTotal = eventsView ? results.eventTotal : results.articleTotal;
  const outOfRange = pagedTotal > 0 && (eventsView ? results.events.length : results.articles.length) === 0;
  const showEventGroup = kind === '' && results.events.length > 0;
  const fuzzy = eventsView ? results.mode === 'fuzzy' : results.mode === 'fuzzy' || (showEventGroup && results.eventMode === 'fuzzy');
  const tabs: [string, string, number | null][] = [
    ['', 'All', q && results.eventsSearched ? results.articleTotal + results.eventTotal : null],
    ['article', 'Articles', q ? results.articleTotal : null],
    ['event', 'Events', q && results.eventsSearched ? results.eventTotal : null],
  ];
  // Switching to Events drops Article-only filters, which do not apply there.
  const tabHref = (value: string) => searchHref(state, value === 'event' ? { kind: value, type: '', author: '', date: '', from: '', to: '', sort: '', page: 1 } : { kind: value, page: 1 });

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Search' }]} />

      <header className="space-y-4">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Search</h1>
        <SearchBox defaultQuery={q} hidden={{ ...filters, kind, sort: state.sort === 'relevance' ? '' : state.sort }} autoFocus={!q} />
        <nav aria-label="Result type" className="flex flex-wrap gap-2">
          {tabs.map(([value, label, count]) => (
            <Link key={label} href={tabHref(value)} aria-current={kind === value ? 'page' : undefined}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${kind === value ? 'bg-amber-700 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'}`}>
              {label}{count !== null ? ` (${count.toLocaleString('en-GB')})` : ''}
            </Link>
          ))}
        </nav>
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
              {eventsView ? (
                <p className="text-xs text-stone-500 dark:text-stone-400">Category, author and date filters apply to articles. <Link href={tabHref('')} className="font-semibold text-amber-700 underline dark:text-amber-400">Search everything</Link></p>
              ) : <>
              <label className={labelClass}>Category
                <FilterSelect param="type" value={state.type} className={selectClass}>
                  <option value="">All categories</option>
                  {results.filterTypes.map((t) => <option key={t} value={t}>{t}</option>)}
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
              </>}
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
              {eventsView ? (
                q ? <><strong className="text-stone-900 dark:text-stone-100">{results.eventTotal.toLocaleString('en-GB')}</strong> {results.eventTotal === 1 ? 'event' : 'events'} for <strong className="text-stone-900 dark:text-stone-100">“{q}”</strong></>
                  : <>All events{activeFilters ? ' matching your filters' : ''}</>
              ) : q ? (
                <><strong className="text-stone-900 dark:text-stone-100">{results.articleTotal.toLocaleString('en-GB')}</strong> {showEventGroup ? (results.articleTotal === 1 ? 'article' : 'articles') : (results.articleTotal === 1 ? 'result' : 'results')}{showEventGroup && <> and <strong className="text-stone-900 dark:text-stone-100">{results.eventTotal.toLocaleString('en-GB')}</strong> {results.eventTotal === 1 ? 'event' : 'events'}</>} for <strong className="text-stone-900 dark:text-stone-100">“{q}”</strong></>
              ) : (
                <>Latest articles{activeFilters ? ' matching your filters' : ''}</>
              )}
            </h2>
            {!eventsView && <label className="flex items-center gap-2 text-xs text-stone-500 dark:text-stone-400">Sort
              <FilterSelect param="sort" value={state.sort === 'relevance' || (!q && state.sort === 'newest') ? '' : state.sort} className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-xs dark:border-stone-700 dark:bg-stone-950">
                <option value="">{q ? 'Relevance' : 'Newest'}</option>
                {q && <option value="newest">Newest</option>}
                <option value="oldest">Oldest</option>
              </FilterSelect>
            </label>}
          </div>

          {!q && (
            <p className="rounded-xl bg-stone-100/70 p-4 text-sm text-stone-600 dark:bg-stone-900/40 dark:text-stone-400">
              Search by tournament, player, sport or topic. Use quotes for an exact phrase (<code>&quot;order of play&quot;</code>) and a minus sign to exclude a word (<code>french -money</code>).
            </p>
          )}

          {fuzzy && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
              No exact matches for “{q}”. Showing close matches instead.
            </p>
          )}

          {results.sports.length > 0 && (
            <div className="flex flex-wrap gap-2" aria-label="Matching sports">
              {results.sports.map((s) => (
                <Link key={s.id} href={`/${s.slug}/`} className="rounded-full border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700 hover:border-amber-500 hover:text-amber-700 dark:border-stone-700 dark:text-stone-300">
                  Sport · {s.name}
                </Link>
              ))}
            </div>
          )}

          {showEventGroup && (
            <section aria-labelledby="event-results-heading" className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 id="event-results-heading" className="text-xs font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Events</h3>
                {results.eventTotal > results.events.length && (
                  <Link href={tabHref('event')} className="text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">See all {results.eventTotal} events <span aria-hidden="true">→</span></Link>
                )}
              </div>
              <ol className="divide-y divide-stone-200 dark:divide-stone-800">
                {results.events.map((e, i) => <EventResultRow key={e.id} event={e} q={q} position={i + 1} />)}
              </ol>
            </section>
          )}

          <SearchAnalytics query={q} total={pagedTotal} page={results.page} filters={filters} sort={state.sort}>
            {eventsView ? (
              results.events.length === 0 ? (
                <div className="rounded-xl border border-stone-200 p-8 text-center dark:border-stone-800">
                  {outOfRange ? (
                    <p className="text-sm text-stone-600 dark:text-stone-400">This page is past the end of the results. <Link className="font-semibold text-amber-700 underline dark:text-amber-500" href={searchHref(state, { page: 1 })}>Go to the first page</Link>.</p>
                  ) : (
                    <>
                      <p className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{q ? <>No events found for “{q}”</> : 'No events match these filters'}</p>
                      <ul className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm text-stone-600 dark:text-stone-400">
                        {q && <li>• Check the spelling</li>}
                        <li>• <Link className="font-semibold text-amber-700 underline dark:text-amber-500" href={tabHref('')}>Search articles and events</Link></li>
                        <li>• <Link className="font-semibold text-amber-700 underline dark:text-amber-500" href="/events/">Browse the events index</Link></li>
                      </ul>
                    </>
                  )}
                </div>
              ) : (
                <ol className="divide-y divide-stone-200 dark:divide-stone-800">
                  {results.events.map((e, i) => <EventResultRow key={e.id} event={e} q={q} position={firstIndex + i + 1} />)}
                </ol>
              )
            ) : results.articles.length === 0 ? (
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
