import type { Metadata } from 'next';
import { AccountPage } from '../../views/AccountPage';
import { pageMetadata } from '../../lib/seo';

// Private, per-user area: rendered in the browser from the session.
export const generateMetadata = (): Metadata =>
  pageMetadata({
  title: 'My Account | SportingSpy',
  description: 'SportingSpy staff account settings.',
  path: '/account/',
  private: true,
});

export default function Page() {
  return <AccountPage />;
}
