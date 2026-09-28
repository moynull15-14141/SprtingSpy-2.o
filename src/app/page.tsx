import type { Metadata } from 'next';
import { HomePage } from '../views/HomePage';
import { getHomepage } from '../lib/data';
import { pageMetadata } from '../lib/seo';

export function generateMetadata(): Metadata {
  return pageMetadata({
    title: 'SportingSpy – The Multi-Sport Intelligence & Editorial Platform',
    description:
      'Authoritative multi-sport information, Grand Slam tournament schedules, Formula 1 circuit telemetry, Golf major purse allocations, and structured sports reference.',
    path: '/',
  });
}

export default async function Page() {
  // PHASE F.1: sections come from the Site Experience (published, or draft in preview).
  return <HomePage sections={await getHomepage()} />;
}
