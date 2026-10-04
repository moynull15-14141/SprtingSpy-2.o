import type { Metadata } from 'next';
import { TermsPage } from '../../views/StaticPages';
import { pageMetadata } from '../../lib/seo';
import { RumPageType } from '../../components/analytics/RumPageType';

export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
  title: 'Terms of Service | SportingSpy',
  description: 'Terms of service and reader agreement for SportingSpy.com.',
  path: '/terms-and-conditions/',
});

export default function Page() {
  return <><RumPageType type="static" /><TermsPage /></>;
}
