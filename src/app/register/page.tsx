import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '../../views/RegisterForm';
import { pageMetadata } from '../../lib/seo';

// PHASE U: public reader registration. Private utility page (noindex; the
// account itself is gated behind the reader-accounts feature flag).
export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
    title: 'Create an account | SportingSpy',
    description: 'Create a SportingSpy reader account to join the discussion.',
    path: '/register/',
    private: true,
  });

export default function Page() {
  return <Suspense fallback={null}><RegisterForm /></Suspense>;
}
