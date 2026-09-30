import type { Metadata } from 'next';
import { AboutPage } from '../../views/StaticPages';
import { pageMetadata } from '../../lib/seo';

export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
  title: 'About SportingSpy – Multi-Sport Editorial Standards',
  description: 'The founding principles, editorial mission, and verification methodology of SportingSpy.com.',
  path: '/about/',
});

export default function Page() {
  return <AboutPage />;
}
