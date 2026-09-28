'use client';

/**
 * Privacy / consent layer (PHASE F). Holds the visitor's choice, shows the
 * banner and preferences, and is the only place optional providers are
 * switched on or off:
 *
 *   consent (cookie)  ->  PrivacyProvider  ->  analytics provider (GA4)
 *                                           ->  advertising slots (server re-render)
 *
 * The banner appears only when an optional technology is actually configured
 * and the visitor has not chosen yet; reading, search and navigation never
 * depend on it. Staff/account areas are never measured and show no banner.
 */

import React, { createContext, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, allowed, answerAll, needsChoice, optionalCategories, serializeConsent,
  type ConsentChoice, type ConsentState, type PrivacyConfig, type ConsentCategory,
} from '../../lib/consent';
import { analytics } from '../../lib/analytics';
import { ga4Provider, stopGa4 } from '../../lib/analytics/ga4';
import { isPrivatePath } from '../../lib/analytics/sanitize';
import { ConsentBanner, PreferencesDialog } from './ConsentUI';

interface PrivacyContextValue {
  consent: ConsentState;
  config: PrivacyConfig;
  categories: ConsentCategory[];
  save: (choice: ConsentChoice) => void;
  openPreferences: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function usePrivacy(): PrivacyContextValue {
  const ctx = useContext(PrivacyContext);
  if (!ctx) throw new Error('usePrivacy must be used inside PrivacyProvider');
  return ctx;
}

function writeConsentCookie(choice: ConsentChoice) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(choice)}; Path=/; Max-Age=${CONSENT_MAX_AGE_DAYS * 86400}; SameSite=Lax${secure}`;
}

/** Reports one page_view per navigation (path or allow-listed query change). */
function PageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const url = `${pathname}${searchParams?.toString() ? `?${searchParams}` : ''}`;
  const last = useRef<string | null>(null);
  useEffect(() => {
    // Guards against effect re-runs (e.g. React strict mode) for the same URL.
    if (last.current === url) return;
    last.current = url;
    analytics.page(url);
  }, [url]);
  return null;
}

export function PrivacyProvider({ config, initialConsent, children }: { config: PrivacyConfig; initialConsent: ConsentState; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const [consent, setConsent] = useState<ConsentState>(initialConsent);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const categories = useMemo(() => optionalCategories(config), [config]);
  const opener = useRef<HTMLElement | null>(null);

  // Analytics follows consent: load and send only while allowed.
  // Staff/account areas never load a provider, whatever the consent.
  const analyticsOn = allowed('analytics', consent, config) && !isPrivatePath(pathname);
  useEffect(() => {
    if (analyticsOn && config.ga4MeasurementId) analytics.enable(ga4Provider(config.ga4MeasurementId));
    else {
      analytics.disable();
      if (config.ga4MeasurementId && consent) stopGa4(config.ga4MeasurementId);
    }
  }, [analyticsOn, config.ga4MeasurementId, consent]);

  // Sponsored/house links report ad_click (no per-slot client code needed).
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.<HTMLAnchorElement>('a[data-ad-placement]');
      if (link) analytics.track('ad_click', { ad_placement: link.dataset.adPlacement, ad_provider: link.dataset.adProvider, sponsor: link.dataset.adSponsor });
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const save = useCallback((choice: ConsentChoice) => {
    const advertisingChanged = !!config.adsenseClient && (consent?.advertising === true) !== (choice.advertising === true);
    writeConsentCookie(choice);
    setConsent(choice);
    setPreferencesOpen(false);
    // Ad slots are rendered on the server from the consent cookie.
    if (advertisingChanged) router.refresh();
  }, [config.adsenseClient, consent, router]);

  const openPreferences = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setPreferencesOpen(true);
  }, []);
  const closePreferences = useCallback(() => {
    setPreferencesOpen(false);
    opener.current?.focus?.();
  }, []);

  const value = useMemo(() => ({ consent, config, categories, save, openPreferences }), [consent, config, categories, save, openPreferences]);
  const showBanner = needsChoice(consent, categories) && !isPrivatePath(pathname) && !preferencesOpen;

  return (
    <PrivacyContext.Provider value={value}>
      {children}
      <Suspense fallback={null}><PageViewTracker /></Suspense>
      {showBanner && <ConsentBanner onAcceptAll={() => save(answerAll(categories, true))} onRejectOptional={() => save(answerAll(categories, false))} onManage={openPreferences} />}
      {preferencesOpen && <PreferencesDialog consent={consent} categories={categories} onSave={save} onClose={closePreferences} />}
    </PrivacyContext.Provider>
  );
}

/** Footer link-style button that reopens the privacy preferences. */
export function PrivacyChoicesButton({ className, label = 'Privacy choices' }: { className?: string; label?: string }) {
  const { openPreferences } = usePrivacy();
  return (
    <button type="button" onClick={openPreferences} className={className}>
      {label}
    </button>
  );
}
