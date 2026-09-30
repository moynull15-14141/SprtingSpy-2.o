import type { Metadata } from 'next';
import { FaqPage } from '../../views/FaqPage';
import { getFaqs } from '../../lib/data';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const faqs = await getFaqs();
  return pageMetadata({
    title: 'Frequently Asked Questions | SportingSpy',
    description: 'Answers to common questions about SportingSpy: sports and events covered, schedules and results, how-to-watch guides, corrections and contact.',
    path: '/faq/',
    // An empty FAQ is a thin page: keep it out of the index until questions are published.
    noindex: faqs.length === 0,
  });
}

export default async function Page() {
  return <FaqPage faqs={await getFaqs()} />;
}
