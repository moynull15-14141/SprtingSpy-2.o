import type { Metadata } from 'next';
import { SportsDirectoryPage } from '../../views/SportsDirectoryPage';
import { getSportsDirectory } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';

export function generateMetadata(): Metadata {
  return pageMetadata({
    title: 'All Sports Covered – Multi-Sport Directory | SportingSpy',
    description: 'Browse the complete catalog of sports covered by SportingSpy, from Tennis and Motorsport to Golf, Rugby, Football, and Athletics.',
    path: '/sports/',
  });
}

export default async function Page() {
  return <SportsDirectoryPage sports={await getSportsDirectory()} />;
}
