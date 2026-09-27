/**
 * SportingSpy AdSlot Architecture
 * Supports reserved layout slots to prevent Cumulative Layout Shift (CLS).
 * Supports sponsor branding, direct partner tags, and clean zero-clutter states.
 * Respects initial default: ADS = OFF.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { AdSlotId } from '../../types';

interface AdSlotProps {
  id: AdSlotId;
  className?: string;
}

export const AdSlot: React.FC<AdSlotProps> = ({ id, className = '' }) => {
  const { adSlots } = useApp();
  const config = adSlots.find((slot) => slot.id === id);

  // If slot not found or disabled, don't occupy space (or collapse cleanly without CLS)
  if (!config || !config.enabled) {
    return null;
  }

  // Dimension heights to prevent Cumulative Layout Shift
  const isSidebar = id.startsWith('SIDEBAR');
  const minHeight = isSidebar ? (id === 'SIDEBAR_MIDDLE' ? 'min-h-[300px]' : 'min-h-[250px]') : 'min-h-[90px]';

  return (
    <aside
      aria-label="Advertisement / Partner Spotlight"
      className={`my-6 flex flex-col items-center justify-center p-3 bg-stone-100/70 dark:bg-stone-900/60 border border-stone-200/60 dark:border-stone-800 rounded-lg text-center ${minHeight} ${className}`}
    >
      <div className="text-[10px] tracking-widest uppercase text-stone-400 dark:text-stone-500 mb-1.5 font-sans">
        {config.sponsorName ? `Presented in Partnership with ${config.sponsorName}` : 'Sponsor'}
      </div>
      <div className="max-w-xl text-xs text-stone-700 dark:text-stone-300 font-medium">
        {config.bannerText || 'Official Partner of SportingSpy Championship Editorial Coverage.'}
      </div>
      {config.linkUrl && (
        <a
          href={config.linkUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-semibold hover:underline"
        >
          Learn More &rarr;
        </a>
      )}
    </aside>
  );
};
