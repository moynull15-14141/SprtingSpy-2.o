import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '../../views/ResetPasswordForm';
import { pageMetadata } from '../../lib/seo';

// PHASE R: staff password reset. Private utility page (noindex, never in the sitemap; robots disallows it).
export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
    title: 'Reset password | SportingSpy',
    description: 'Reset the password of a SportingSpy staff account.',
    path: '/reset-password/',
    private: true,
  });

export default function Page() {
  return <Suspense fallback={null}><ResetPasswordForm /></Suspense>;
}
