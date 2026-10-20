import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailForm } from '../../views/VerifyEmailForm';
import { pageMetadata } from '../../lib/seo';

// PHASE U: reader e-mail verification landing page. Private utility page
// (noindex, never in the sitemap).
export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
    title: 'Confirm your e-mail | SportingSpy',
    description: 'Confirm your SportingSpy reader account e-mail address.',
    path: '/verify-email/',
    private: true,
  });

export default function Page() {
  return <Suspense fallback={null}><VerifyEmailForm /></Suspense>;
}
