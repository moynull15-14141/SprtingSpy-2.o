import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SearchPage, type SearchState } from '../../views/SearchPage';
import Loading from './loading';
import { search } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import type { SearchParams } from '../../lib/params';
import { parseSearchQuery } from '../../../server/services/search/params';
import { SEARCH_PAGE_SIZE, type PublicSearchInput } from '../../../server/services/public/search';
import { recordSearch } from '../../../server/searchAnalytics';
import { headers } from 'next/headers';
import { RumPageType } from '../../components/analytics/RumPageType';

export function generateMetadata(): Promise<Metadata> {
  return pageMetadata({
    title: 'Search Sports Intelligence, Events & Schedules | SportingSpy',
    description:
      'Search across our comprehensive database of sports, grand slam events, yearly editions, schedules, prize money, and rules.',
    path: '/search/',
    // Search result URLs must never become indexable pages (Spec §17).
    noindex: true,
  });
}

const day = (d?: Date, inclusiveEnd = false) => (d ? new Date(d.getTime() - (inclusiveEnd ? 86400000 : 0)).toISOString().slice(0, 10) : '');

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  // Lenient: invalid values are dropped (never an error page); `limit` is not user-controllable here.
  const { limit: _ignored, ...params } = raw;
  const parsed = parseSearchQuery(params, { strict: false, defaultLimit: SEARCH_PAGE_SIZE });
  const p = parsed.value!;
  const custom = typeof raw.from === 'string' || typeof raw.to === 'string';
  const state: SearchState = {
    q: p.q, kind: p.kind, sport: p.sport, type: p.type, author: p.author, date: custom ? '' : p.date,
    from: custom ? day(p.from) : '', to: custom ? day(p.to, true) : '', sort: p.sort, page: p.page,
  };
  // loading.tsx only covers arriving from another route. Keying the boundary
  // on the search state also shows the skeleton when a query, filter, sort or
  // page changes on /search itself, instead of leaving stale results up.
  return (
    <Suspense key={JSON.stringify(state)} fallback={<Loading />}>
      <Results input={{ q: p.q, kind: p.kind, sport: p.sport, type: p.type, author: p.author, from: p.from, to: p.to, sort: p.sort, page: p.page }} state={state} />
    </Suspense>
  );
}

async function Results({ input, state }: { input: PublicSearchInput; state: SearchState }) {
  const results = await search(input);
  // PHASE R: aggregate search analytics (popular / no-result queries). First page only; no personal data.
  if (input.q && (input.page ?? 1) === 1) {
    const userAgent = (await headers()).get('user-agent');
    void recordSearch(input.q, results.articleTotal + results.eventTotal + results.sports.length, userAgent);
  }
  return <><RumPageType type="search" /><SearchPage results={results} state={state} /></>;
}
