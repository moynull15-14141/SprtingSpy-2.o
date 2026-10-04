'use client';

/**
 * One Google AdSense unit (PHASE F). Rendered by AdSlot only when AdSense is
 * configured and advertising consent was given; it re-checks consent in the
 * browser so a withdrawn choice takes effect before the page re-renders.
 * The AdSense script is loaded lazily, once, and only from here.
 */

import React, { useEffect, useRef, useState } from 'react';
import { allowed } from '../../lib/consent';
import { loadScriptOnce } from '../../lib/scriptLoader';
import { usePrivacy } from '../privacy/PrivacyProvider';

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

/** The AdSense tag, loaded once per page (also carries Google's CMP message and Auto ads when enabled in AdSense). */
export function loadAdsenseScript(client: string) {
  loadScriptOnce('adsense-loader', `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`, { crossorigin: 'anonymous' });
}

/**
 * PHASE R: loads the AdSense tag on every page when Auto ads are enabled, or
 * when Google's certified CMP is the consent interface (its consent message is
 * delivered by the AdSense tag). Without either, the tag loads only where a
 * controlled slot renders.
 */
export function AdsensePageTag() {
  const { consent, config } = usePrivacy();
  const client = config.adsenseClient;
  const wanted = !!client && (config.adsenseAutoAds || config.consentMode === 'google-cmp') && allowed('advertising', consent, config);
  useEffect(() => { if (wanted && client) loadAdsenseScript(client); }, [wanted, client]);
  return null;
}

export function AdsenseUnit({ client, slot }: { client: string; slot: string }) {
  const { consent, config } = usePrivacy();
  const ok = allowed('advertising', consent, config) && config.adsenseClient === client;
  const requested = useRef(false);
  const ins = useRef<HTMLModElement>(null);
  const [unfilled, setUnfilled] = useState(false);

  useEffect(() => {
    if (!ok || requested.current) return;
    requested.current = true;
    loadAdsenseScript(client);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* the slot simply stays empty */ }
  }, [ok, client]);

  // PHASE R (Spec §22.6): when AdSense has no ad for this slot it marks the
  // <ins> data-ad-status="unfilled"; the whole slot (label and reserved space)
  // collapses instead of leaving an empty box.
  useEffect(() => {
    const el = ins.current;
    if (!ok || !el) return;
    const check = () => {
      if (el.getAttribute('data-ad-status') !== 'unfilled') return;
      // Collapse the whole slot (label + reserved space) while the <ins> is still in the DOM.
      const slot = el.closest<HTMLElement>('[data-ad-slot-id]');
      if (slot) { slot.hidden = true; slot.dataset.adCollapsed = 'unfilled'; }
      setUnfilled(true);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(el, { attributes: true, attributeFilter: ['data-ad-status'] });
    return () => observer.disconnect();
  }, [ok]);

  if (!ok || unfilled) return null;
  return (
    <ins
      ref={ins}
      className="adsbygoogle block w-full"
      style={{ display: 'block' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
