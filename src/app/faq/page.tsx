import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FaqPage } from '../../views/FaqPage';
import { getFaqs, getGlobalFaqSettings } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';
import { RumPageType } from '../../components/analytics/RumPageType';

// PHASE R (v2.2): FAQ is contextual (articles, editions, events, sport guides).
// The site-wide /faq/ page exists only when Admin → Settings → FAQ enables it;
// otherwise it is a real 404 and stays out of the sitemap.

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getGlobalFaqSettings();
  if (!settings.pageEnabled) return {};
  const faqs = await getFaqs();
  return pageMetadata({
    title: 'Frequently Asked Questions | SportingSpy',
    description: 'Answers to common questions about SportingSpy: sports and events covered, schedules and results, viewing guides, corrections and contact.',
    path: '/faq/',
    // An empty FAQ is a thin page: keep it out of the index until questions are published.
    noindex: faqs.length === 0,
  });
}

export default async function Page() {
  const settings = await getGlobalFaqSettings();
  if (!settings.pageEnabled) notFound();
  return <><RumPageType type="faq" /><FaqPage faqs={await getFaqs()} schemaEnabled={settings.schemaEnabled} /></>;
}
