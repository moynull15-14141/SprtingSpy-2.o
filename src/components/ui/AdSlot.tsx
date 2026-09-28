/**
 * SportingSpy AdSlot Architecture
 * Supports reserved layout slots to prevent Cumulative Layout Shift (CLS).
 * Respects initial default: ADS = OFF. Server-rendered from the ad slot config.
 *
 * PHASE F: a slot is filled by a provider, never by editorial components:
 *   house    the slot's own sponsor/partner banner (text + safe link). No third
 *            party, no tracking beyond the site's own consented analytics.
 *   adsense  a Google AdSense unit, rendered only when AdSense is configured
 *            AND the visitor allowed advertising. The consent cookie is read
 *            here on the server, so a slot never appears and then collapses.
 * Every filled slot is labelled as advertising/sponsorship. Set
 * SHOW_AD_PLACEHOLDERS=true to see disabled slots as outlines during layout work.
 */

import React from 'react';
import { cookies } from 'next/headers';
import { AdSlotId } from '../../types';
import { getAdSlots } from '../../lib/data';
import { CONSENT_COOKIE, allowed, parseConsent } from '../../lib/consent';
import { trackingConfig } from '../../../server/trackingConfig';
import { AdsenseUnit } from './AdsenseUnit';
import { AdCreativeDisplay } from './AdCreativeDisplay';

interface AdSlotProps {
  id: AdSlotId;
  className?: string;
}

const heightFor = (id: AdSlotId) => (id === 'SIDEBAR_MIDDLE' ? 'min-h-[300px]' : id.startsWith('SIDEBAR') ? 'min-h-[250px]' : 'min-h-[90px]');
const label = 'text-[10px] tracking-widest uppercase text-stone-500 dark:text-stone-400 mb-1.5 font-sans';

export async function AdSlot({ id, className = '' }: AdSlotProps) {
  const config = (await getAdSlots()).find((slot) => slot.id === id);
  const minHeight = heightFor(id);

  // If slot not found or disabled, don't occupy space (optionally outline it while developing).
  if (!config || !config.enabled) {
    if ((process.env.SHOW_AD_PLACEHOLDERS || '').trim().toLowerCase() !== 'true' || !config) return null;
    return (
      <div aria-hidden="true" data-ad-placeholder={id} className={`my-6 flex items-center justify-center rounded-lg border-2 border-dashed border-stone-300 text-[11px] text-stone-500 dark:border-stone-700 ${minHeight} ${className}`}>
        Ad slot {id} · {config.dimensions} · disabled
      </div>
    );
  }

  if (config.provider === 'adsense') {
    const [tracking, cookieStore] = await Promise.all([trackingConfig(), cookies()]);
    const consent = parseConsent(cookieStore.get(CONSENT_COOKIE)?.value);
    if (!tracking.adsenseClient || !config.providerSlotId || !allowed('advertising', consent, tracking)) return null;
    return (
      <aside aria-label="Advertisement" data-ad-slot-id={id} data-ad-provider="adsense" className={`my-6 flex flex-col items-center ${minHeight} ${className}`}>
        <div className={label}>Advertisement</div>
        <AdsenseUnit client={tracking.adsenseClient} slot={config.providerSlotId} />
      </aside>
    );
  }

  return (
    <aside
      aria-label="Sponsored"
      data-ad-slot-id={id}
      data-ad-provider="house"
      className={`my-6 flex flex-col items-center justify-center p-3 bg-stone-100/70 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800 rounded-lg text-center ${minHeight} ${className}`}
    >
      <div className={label}>
        {config.sponsorName ? `Sponsored · Presented in partnership with ${config.sponsorName}` : 'Sponsored'}
      </div>
      {config.creative && <AdCreativeDisplay creative={config.creative} alt={config.creativeAlt || config.sponsorName || 'Sponsor advertisement'} fit={config.creativeFit} dimensions={config.dimensions} linkUrl={config.linkUrl} placement={id}/>}
      <div className="max-w-xl text-xs text-stone-700 dark:text-stone-300 font-medium">
        {config.bannerText || (!config.creative && 'Official Partner of SportingSpy Championship Editorial Coverage.')}
      </div>
      {config.linkUrl && (
        <a
          href={config.linkUrl}
          target="_blank"
          rel="noopener noreferrer sponsored"
          data-ad-placement={id}
          data-ad-provider="house"
          data-ad-sponsor={config.sponsorName || undefined}
          className="mt-2 text-xs text-amber-700 dark:text-amber-400 font-semibold hover:underline"
        >
          Learn More &rarr;
        </a>
      )}
    </aside>
  );
}
