import type { Metadata } from 'next';
import { PrivacyPolicyPage } from '../../views/PrivacyPolicyPage';
import { pageMetadata } from '../../lib/seo';
import { trackingConfig } from '../../../server/trackingConfig';

export const generateMetadata = (): Metadata =>
  pageMetadata({
  title: 'Privacy Policy | SportingSpy',
  description: 'What SportingSpy collects, why, the cookies and storage it uses, and how to change your privacy choices.',
  path: '/privacy-policy/',
});

export default async function Page() {
  // PHASE F: the policy states which optional providers are actually active.
  return <PrivacyPolicyPage config={await trackingConfig()} />;
}
