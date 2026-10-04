import type { Metadata } from 'next';
import { ContactPage } from '../../views/StaticPages';
import { pageMetadata } from '../../lib/seo';
import { RumPageType } from '../../components/analytics/RumPageType';

export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
  title: 'Contact Editorial Desk | SportingSpy',
  description: 'Submit corrections, media inquiries, or tournament credentials to the SportingSpy editorial team.',
  path: '/contact/',
});

export default function Page() {
  return <><RumPageType type="static" /><ContactPage /></>;
}
