import type { Metadata } from 'next';
import { AdminApp } from '../../../components/admin/AdminApp';
import { pageMetadata } from '../../../lib/seo';

// The CMS is a private, client-rendered area isolated in its own route
// bundle; public pages never load it. Server APIs enforce all access.
export const generateMetadata = (): Metadata =>
  pageMetadata({
  title: 'Editorial CMS & Content Manager | SportingSpy',
  description: 'SportingSpy editorial CMS.',
  path: '/admin/',
  private: true,
});

export default function Page() {
  return <AdminApp />;
}
