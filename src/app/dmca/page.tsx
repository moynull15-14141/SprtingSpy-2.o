import type { Metadata } from 'next';
import { DmcaPage } from '../../views/StaticPages';
import { pageMetadata } from '../../lib/seo';

export const generateMetadata = (): Metadata =>
  pageMetadata({
  title: 'DMCA Copyright Policy | SportingSpy',
  description: 'DMCA and intellectual property notification process for SportingSpy.com.',
  path: '/dmca/',
});

export default function Page() {
  return <DmcaPage />;
}
