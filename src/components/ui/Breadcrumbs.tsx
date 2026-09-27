/**
 * SportingSpy Breadcrumbs
 * Implements editorial breadcrumb hierarchy and Schema.org BreadcrumbList structured data.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';

export interface BreadcrumbItem {
  label: string;
  url?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  const { navigate } = useApp();

  const allItems: BreadcrumbItem[] = [{ label: 'Home', url: '/' }, ...items];

  // Schema.org BreadcrumbList JSON-LD
  const schemaBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: allItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.url ? `https://sportingspy.com${item.url}` : undefined,
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className={`text-xs text-stone-500 dark:text-stone-400 py-2 ${className}`}>
      <script
        type="application/ld+json"
        // PHASE 0.1 XSS FIX: see SeoHead.tsx — escape "<" to prevent a
        // breadcrumb label (derived from editor-controlled titles) from
        // breaking out of this inline <script> tag.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schemaBreadcrumbs).replace(/</g, '\\u003c') }}
      />
      <ol className="flex items-center flex-wrap gap-1.5">
        {allItems.map((item, idx) => {
          const isLast = idx === allItems.length - 1;

          return (
            <li key={idx} className="inline-flex items-center gap-1.5">
              {idx > 0 && <span className="text-stone-300 dark:text-stone-700">/</span>}
              {isLast || !item.url ? (
                <span className="text-stone-800 dark:text-stone-200 font-medium truncate max-w-[200px] md:max-w-xs" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => navigate(item.url!)}
                  className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer"
                >
                  {item.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
