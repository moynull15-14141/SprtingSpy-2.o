'use client';

/**
 * One Google AdSense unit (PHASE F). Rendered by AdSlot only when AdSense is
 * configured and advertising consent was given; it re-checks consent in the
 * browser so a withdrawn choice takes effect before the page re-renders.
 * The AdSense script is loaded lazily, once, and only from here.
 */

import React, { useEffect, useRef } from 'react';
import { allowed } from '../../lib/consent';
import { loadScriptOnce } from '../../lib/scriptLoader';
import { usePrivacy } from '../privacy/PrivacyProvider';

declare global {
  interface Window { adsbygoogle?: unknown[] }
}

export function AdsenseUnit({ client, slot }: { client: string; slot: string }) {
  const { consent, config } = usePrivacy();
  const ok = allowed('advertising', consent, config) && config.adsenseClient === client;
  const requested = useRef(false);

  useEffect(() => {
    if (!ok || requested.current) return;
    requested.current = true;
    loadScriptOnce('adsense-loader', `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`, { crossorigin: 'anonymous' });
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* the slot simply stays empty */ }
  }, [ok, client]);

  if (!ok) return null;
  return (
    <ins
      className="adsbygoogle block w-full"
      style={{ display: 'block' }}
      data-ad-client={client}
      data-ad-slot={slot}
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  );
}
