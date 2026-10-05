/**
 * Privacy Policy (PHASE F). Describes what the site actually does, generated
 * from the live configuration: optional providers are listed as active only
 * when an Admin has configured them. It makes no claim about a legal entity,
 * jurisdiction, regulatory compliance or retention periods that the project
 * has not defined; those belong to a legal review.
 */

import React from 'react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { PrivacyChoicesButton } from '../components/privacy/PrivacyProvider';
import { BRANDING } from '../config/branding';
import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, type PrivacyConfig } from '../lib/consent';

const h2 = 'font-serif text-xl font-bold text-stone-900 dark:text-stone-100 pt-4';
const cell = 'border border-stone-200 p-2 align-top dark:border-stone-800';

type Row = { name: string; kind: string; purpose: string; lasts: string; category: string };

const RETENTION_TEXT: Record<string, string> = { '13-months': '13 months', '25-months': '25 months', '37-months': '37 months', unlimited: 'until we delete them' };

export function PrivacyPolicyPage({ config, measurement = { rumEnabled: true, retention: '25-months' } }: { config: PrivacyConfig; measurement?: { rumEnabled: boolean; retention: string } }) {
  const rows: Row[] = [
    { name: 'sid', kind: 'Cookie (HttpOnly)', purpose: 'Keeps a signed-in staff or reader account signed in.', lasts: '7 days, or until sign-out', category: 'Necessary' },
    { name: 'csrf_token', kind: 'Cookie', purpose: 'Protects forms and account actions against cross-site request forgery.', lasts: 'Browser session', category: 'Necessary' },
    { name: CONSENT_COOKIE, kind: 'Cookie', purpose: 'Remembers your privacy choices (no identifier).', lasts: `${CONSENT_MAX_AGE_DAYS} days`, category: 'Necessary' },
    { name: 'sportingspy_theme', kind: 'Local storage', purpose: 'Remembers light or dark mode when you choose one (not set when following your system setting).', lasts: 'Until you clear site data', category: 'Preference' },
    { name: 'sportingspy_account_language', kind: 'Local storage', purpose: 'Remembers the account-area language, when reader accounts are enabled.', lasts: 'Until you clear site data', category: 'Preference' },
    { name: 'sportingspy_logout', kind: 'Local storage', purpose: 'Signs out other open tabs when you sign out.', lasts: 'Until you clear site data', category: 'Necessary' },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Breadcrumbs items={[{ label: 'Privacy Policy' }]} />
      <header className="border-b border-stone-200 pb-4 dark:border-stone-800">
        <h1 className="font-serif text-3xl font-bold text-stone-900 dark:text-stone-100">Privacy Policy</h1>
        <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Last revised: September 2026</p>
      </header>

      <div className="space-y-4 text-sm leading-relaxed text-stone-700 dark:text-stone-300">
        <p>This page explains what {BRANDING.name} collects when you read the site, why, and the choices you have. It describes how the site is built and configured today.</p>

        <h2 className={h2}>What we collect</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Reading the site:</strong> you can read articles, browse and search without an account. We do not ask for personal details to read.</li>
          <li><strong>Technical requests:</strong> like any website, our server receives your IP address and browser information with each request. We use the IP address briefly, in memory, to limit abusive traffic (for example repeated sign-in or search attempts); it is not stored in our database.</li>
          <li><strong>Accounts:</strong> staff accounts (and reader accounts, when that feature is on) store a name, e-mail address, role and a securely hashed password. Passwords are never stored in readable form.</li>
          <li><strong>Searches:</strong> your search text is used to find results. To learn what readers look for, we keep a daily count per search: the search text, lower-cased and cut to 50 characters (anything that looks like an e-mail address or phone number is replaced), with the number of searches and of searches that found nothing. Nothing about who searched is stored with it. If analytics is active and you allowed it, the same cleaned text may also be reported (see Analytics).</li>
          <li><strong>Contact form:</strong> if you send us a message, we store the name, e-mail address, subject and message you enter, and when it was sent, so the editorial team can read and answer it. We do not store your IP address or browser details with it, and the site does not send automatic e-mails.</li>
        </ul>

        <h2 className={h2}>Site measurement</h2>
        {measurement.rumEnabled ? (
          <p>Our own server counts page views per page and per day, and records how fast pages load and respond (Core Web Vitals) per page type and device class (mobile or desktop). Only these daily totals are stored: no cookies, no IP address, no identifier and no browsing history, so no visit can be traced back to a person. Known search-engine crawlers are not counted. These counts are kept for {RETENTION_TEXT[measurement.retention] ?? '25 months'}.</p>
        ) : (
          <p>Our own page-view and page-speed counting is currently switched off.</p>
        )}

        <h2 className={h2}>Analytics</h2>
        {config.ga4MeasurementId ? (
          <p>We use Google Analytics 4 to understand which pages, articles and searches are useful. It runs <strong>only if you allow analytics</strong> in your privacy choices. We report page paths (never the search text in the address), article and event identifiers and categories, which article or event card and which search result was clicked, and search terms shortened to 50 characters; anything that looks like an e-mail address or phone number is removed first. Google signals and ad personalization are turned off. Google sets its own cookies (such as <code>_ga</code>) when analytics is allowed, and we remove them if you withdraw. How long Google keeps this data is set in our Google Analytics account and in Google&apos;s terms.</p>
        ) : (
          <p>No analytics service is active on {BRANDING.name} at the moment, so nothing about your visit is sent to an analytics provider. If we turn one on, this page will name it and it will run only with your permission.</p>
        )}

        <h2 className={h2}>Advertising and sponsorship</h2>
        <p>Some pages may show sponsorship placements, labelled <strong>Sponsored</strong>. They are simple banners served by us, without third-party code, and do not change our articles, search results or rankings.</p>
        {config.adsenseClient ? (
          <p>We also work with Google AdSense. AdSense placements are labelled <strong>Advertisement</strong> and are shown <strong>only if you allow advertising</strong> in your privacy choices. When allowed, Google may use its own cookies to show and measure ads, under Google&apos;s policies.</p>
        ) : (
          <p>No third-party advertising network is active at the moment.</p>
        )}

        <h2 className={h2} id="cookies">Cookies and storage</h2>
        <p>These are the cookies and browser storage the site itself uses. Necessary and preference items are needed for the site to work and are not used to track you.</p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead><tr><th className={cell}>Name</th><th className={cell}>Type</th><th className={cell}>Purpose</th><th className={cell}>Kept for</th><th className={cell}>Category</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}><td className={`${cell} font-mono`}>{r.name}</td><td className={cell}>{r.kind}</td><td className={cell}>{r.purpose}</td><td className={cell}>{r.lasts}</td><td className={cell}>{r.category}</td></tr>
              ))}
              {config.ga4MeasurementId && <tr><td className={`${cell} font-mono`}>_ga, _ga_*</td><td className={cell}>Cookie (Google)</td><td className={cell}>Google Analytics measurement.</td><td className={cell}>Set by Google</td><td className={cell}>Analytics — only with consent</td></tr>}
              {config.adsenseClient && <tr><td className={`${cell} font-mono`}>Google advertising cookies</td><td className={cell}>Cookies (Google)</td><td className={cell}>Showing and measuring AdSense ads.</td><td className={cell}>Set by Google</td><td className={cell}>Advertising — only with consent</td></tr>}
            </tbody>
          </table>
        </div>
        <p>Staff using the editorial CMS also have a local-storage setting that remembers whether the CMS navigation is collapsed.</p>

        <h2 className={h2}>Your choices</h2>
        <p>Optional analytics and advertising are off until you allow them, and you can read the whole site either way. You can change your choice at any time:</p>
        <p><PrivacyChoicesButton className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:hover:bg-stone-800" /></p>
        <p>You can also block or delete cookies in your browser settings; the site will still work, but you may be signed out and asked for your privacy choices again.</p>

        <h2 className={h2}>Contact</h2>
        <p>Questions about this policy or your data: <a className="font-semibold text-amber-700 underline dark:text-amber-400" href={`mailto:${BRANDING.supportEmail}`}>{BRANDING.supportEmail}</a>.</p>
      </div>
    </div>
  );
}
