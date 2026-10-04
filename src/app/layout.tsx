/**
 * Root layout (PHASE B): server-rendered shell shared by every page.
 * Replaces index.html + App.tsx. Public pages render on the server; only
 * interactive islands (header menus, filters, CMS) hydrate on the client.
 */

import type { Metadata, Viewport } from 'next';
import React from 'react';
import '../index.css';
import { Header } from '../components/layout/Header';
import { Footer } from '../components/layout/Footer';
import { SiteProvider } from '../context/SiteContext';
import { BRANDING } from '../config/branding';
import { getFeatures, getGlobalFaqSettings, getRumEnabled, getNavSports, getSiteIdentity, getSiteLayoutForRequest } from '../lib/data';
import { AnnouncementBar } from '../components/site/AnnouncementBar';
import { GlobalBlocks } from '../components/site/GlobalBlocks';
import { PreviewBanner } from '../components/site/PreviewBanner';
import { blocksFor } from '../../server/services/public/siteLayout';
import { siteOrigin } from '../lib/paths';
import { cookies, headers } from 'next/headers';
import { PrivacyProvider } from '../components/privacy/PrivacyProvider';
import { CONSENT_COOKIE, parseConsent } from '../lib/consent';
import { trackingConfig } from '../../server/trackingConfig';
import { WebVitalsReporter } from '../components/analytics/WebVitalsReporter';
import { AdsensePageTag } from '../components/ui/AdsenseUnit';

// Every page reads live content (and the CSP nonce) per request.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // PHASE C: CMS settings that are public by design (verification tokens).
  const { publicSettings } = await import('../../server/settingsRegistry');
  const [settings, identity] = await Promise.all([publicSettings().catch(() => ({} as Awaited<ReturnType<typeof publicSettings>>)), getSiteIdentity()]);
  const verification: Metadata['verification'] = {
    ...(settings.googleSiteVerification ? { google: settings.googleSiteVerification } : {}),
    ...(settings.bingSiteVerification ? { other: { 'msvalidate.01': settings.bingSiteVerification } } : {}),
  };
  // PHASE H: site name, description, default social image and X handle from Admin → Settings.
  const images = identity.defaultOgImage ? [new URL(identity.defaultOgImage, siteOrigin()).toString()] : undefined;
  return {
    metadataBase: new URL(siteOrigin()),
    ...(Object.keys(verification).length ? { verification } : {}),
    title: { default: `${identity.name} – Multi-Sport Editorial & Event Guides`, template: '%s' },
    description: identity.description,
    openGraph: { siteName: identity.name, type: 'website', ...(images ? { images } : {}) },
    twitter: { card: 'summary_large_image', ...(identity.twitterHandle ? { site: identity.twitterHandle } : {}), ...(images ? { images } : {}) },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

const THEME_SCRIPT = `try{var t=localStorage.getItem('sportingspy_theme');if(t!=='light'&&t!=='dark')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.classList.toggle('dark',t==='dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [sports, privacyConfig, cookieStore, requestHeaders, site, identity, faqSettings, rumEnabled] = await Promise.all([getNavSports(), trackingConfig(), cookies(), headers(), getSiteLayoutForRequest(), getSiteIdentity(), getGlobalFaqSettings(), getRumEnabled()]);
  // PHASE R (v2.2): while the site-wide /faq/ page is off it is a 404, so no menu links to it.
  const isFaqLink = (href: string) => /^\/faq\/?$/.test(href);
  const navigationItems = faqSettings.pageEnabled ? site.docs.navigation.items : site.docs.navigation.items.filter((item) => !isFaqLink(item.href));
  const footerConfig = faqSettings.pageEnabled ? site.docs.footer : { ...site.docs.footer, columns: site.docs.footer.columns.map((c) => ({ ...c, links: c.links.filter((l) => !isFaqLink(l.href)) })) };
  // The production CSP allows inline scripts only with this request's nonce.
  const nonce = requestHeaders.get('content-security-policy')?.match(/'nonce-([^']+)'/)?.[1];
  // PHASE F: the visitor's privacy choice is known on the server, so the
  // first render already has the right banner/ad state (no flash, no shift).
  const initialConsent = parseConsent(cookieStore.get(CONSENT_COOKIE)?.value);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved (or system) theme before first paint: no light flash in dark mode. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,600&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-stone-50 text-stone-900 antialiased selection:bg-amber-500 selection:text-white dark:bg-[#0c0d0e] dark:text-stone-100">
        <SiteProvider features={getFeatures()}>
          <PrivacyProvider config={privacyConfig} initialConsent={initialConsent}>
          <div className="site-shell min-h-screen flex flex-col bg-stone-50 dark:bg-[#0c0d0e] text-stone-900 dark:text-stone-100 font-sans selection:bg-amber-500 selection:text-white transition-colors relative">
            {site.preview && <PreviewBanner />}
            {/* PHASE R: first-party, aggregate real-user monitoring (no cookies, no identifiers). */}
            <WebVitalsReporter enabled={rumEnabled && !site.preview} />
            <AdsensePageTag />
            <Header sports={sports} navigation={navigationItems} siteName={identity.name} />
            <AnnouncementBar items={site.announcements} />
            <main className="site-main flex-1 max-w-[98rem] w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">{children}</main>
            <GlobalBlocks blocks={blocksFor(site, 'footer_top')} className="site-footer-blocks mx-auto w-full max-w-[98rem] px-4 sm:px-6 lg:px-8" />
            <Footer sports={sports} config={footerConfig} siteName={identity.name} />
          </div>
          </PrivacyProvider>
        </SiteProvider>
      </body>
    </html>
  );
}
