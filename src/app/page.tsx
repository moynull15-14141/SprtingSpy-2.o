import type { Metadata } from 'next';
import { HomePage } from '../views/HomePage';
import { getHomepage, getSiteIdentity } from '../lib/data';
import { pageMetadata } from '../lib/seo';
import { RumPageType } from '../components/analytics/RumPageType';

// Spec v1.1 §7.1: recommended homepage SEO title and multi-sport description.
export async function generateMetadata(): Promise<Metadata> {
  const identity = await getSiteIdentity();
  return pageMetadata({
    title: 'SportingSpy – Latest Sports News, Events, Schedules & Updates',
    description:
      'Latest sports news, event guides, schedules, results and how-to-watch information across tennis, motorsport, golf, rugby, football and more.',
    path: '/',
    // Saved site copy controls the homepage description and social summaries.
    // Without a saved value the established homepage specification remains the default.
    seo: identity.configuredDescription ? { metaDescription: identity.configuredDescription } : undefined,
  });
}

export default async function Page() {
  // PHASE F.1: sections come from the Site Experience (published, or draft in preview).
  const [sections, identity] = await Promise.all([getHomepage(), getSiteIdentity()]);
  return <><RumPageType type="home" /><HomePage sections={sections} identity={identity} /></>;
}
