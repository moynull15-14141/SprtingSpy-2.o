/**
 * SportingSpy Breadcrumbs
 * Implements editorial breadcrumb hierarchy and Schema.org BreadcrumbList
 * structured data, rendered on the server.
 */

import React from 'react';
import Link from 'next/link';
import { canonicalPagePath } from '../../config/urls';
import { absoluteUrl } from '../../lib/paths';
import { JsonLd } from '../seo/JsonLd';

export interface BreadcrumbItem {
  label: string;
  url?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, className = '' }) => {
  const allItems: BreadcrumbItem[] = [{ label: 'Home', url: '/' }, ...items];

  const schemaBreadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: allItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: item.url ? absoluteUrl(canonicalPagePath(item.url)) : undefined,
    })),
  };

  return (
    <nav aria-label="Breadcrumb" className={`text-xs text-stone-500 dark:text-stone-400 py-2 ${className}`}>
      <JsonLd data={schemaBreadcrumbs} />
      <ol className="flex items-center flex-wrap gap-1.5">
        {allItems.map((item, idx) => {
          const isLast = idx === allItems.length - 1;

          return (
            <li key={idx} className="inline-flex items-center gap-1.5">
              {idx > 0 && <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">/</span>}
              {isLast || !item.url ? (
                <span className="text-stone-800 dark:text-stone-200 font-medium truncate max-w-[200px] md:max-w-xs" aria-current="page">
                  {item.label}
                </span>
              ) : (
                <Link href={canonicalPagePath(item.url)} className="hover:text-amber-600 dark:hover:text-amber-400 transition-colors cursor-pointer">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
