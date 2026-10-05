import type { Metadata } from 'next';
import { PrivacyPolicyPage } from '../../views/PrivacyPolicyPage';
import { pageMetadata } from '../../lib/seo';
import { trackingConfig } from '../../../server/trackingConfig';
import { RumPageType } from '../../components/analytics/RumPageType';
import { getAnalyticsRetention, getRumEnabled } from '../../lib/data';

export const generateMetadata = (): Promise<Metadata> =>
  pageMetadata({
  title: 'Privacy Policy | SportingSpy',
  description: 'What SportingSpy collects, why, the cookies and storage it uses, and how to change your privacy choices.',
  path: '/privacy-policy/',
});

export default async function Page() {
  // PHASE F: the policy states which optional providers are actually active.
  // PHASE Q: and what the site measures itself (first-party aggregates) and for how long.
  const [config, rumEnabled, retention] = await Promise.all([trackingConfig(), getRumEnabled(), getAnalyticsRetention()]);
  return <><RumPageType type="static" /><PrivacyPolicyPage config={config} measurement={{ rumEnabled, retention }} /></>;
}
