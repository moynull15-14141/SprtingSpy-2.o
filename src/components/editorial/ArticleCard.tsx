/**
 * SportingSpy Editorial Article Card
 * Supports lead story tier, standard feature tier, and compact archive tier.
 * Zero-pill discipline: unboxed text kickers and metadata separators.
 *
 * PHASE B: server-rendered. The whole card is clickable through a real
 * link (stretched over the card), so it works before JavaScript loads.
 */

import React from 'react';
import Link from 'next/link';
import type { ArticleSummary } from '../../../server/services/public/content';
import { MetadataRow } from '../ui/MetadataRow';
import { CardImage } from './CardImage';
import { ResponsiveImage } from './ResponsiveImage';

interface ArticleCardProps {
  article: ArticleSummary;
  variant?: 'lead' | 'standard' | 'compact';
  className?: string;
}

const stretched = 'after:absolute after:inset-0 after:content-[""] focus:outline-none';

export const ArticleCard: React.FC<ArticleCardProps> = ({ article, variant = 'standard', className = '' }) => {
  const formattedDate = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (variant === 'compact') {
    return (
      <article
        className={`group relative py-3 border-b border-stone-200 dark:border-stone-800/80 cursor-pointer hover:bg-stone-50/50 dark:hover:bg-stone-900/40 transition-colors ${className}`}
      >
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-500 font-semibold mb-1">
          <span>{article.sportName}</span>
          {article.eventShortName && (
            <>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">/</span>
              <span>{article.eventShortName}</span>
            </>
          )}
          <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
          <span className="text-stone-500 dark:text-stone-400 font-normal">{article.articleType}</span>
        </div>
        <h4 className="text-sm md:text-base font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug">
          <Link href={article.url} className={stretched}>{article.title}</Link>
        </h4>
        <div className="mt-1.5">
          <MetadataRow items={[article.authorName, formattedDate, `${article.readingTimeMinutes} min read`]} size="xs" />
        </div>
      </article>
    );
  }

  if (variant === 'lead') {
    return (
      <article
        className={`group relative grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 rounded-2xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800/90 shadow-sm hover:shadow-md transition-all cursor-pointer ${className}`}
      >
        <div className="lg:col-span-7 overflow-hidden rounded-xl bg-stone-100 dark:bg-stone-900 aspect-video relative">
          {article.image ? (
            <ResponsiveImage
              asset={article.image}
              alt={article.image.alt || article.title}
              sizes="(min-width: 1024px) 700px, 100vw"
              priority
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
            />
          ) : (
          <CardImage
            src={article.featuredImage}
            alt={article.title}
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
            loading="eager"
            fallback={
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950 text-stone-300 p-8 text-center font-display text-lg">
                {article.sportName} Editorial Lead
              </div>
            }
          />
          )}
        </div>

        <div className="lg:col-span-5 flex flex-col justify-between py-1">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider mb-2">
              <span>{article.sportName}</span>
              {article.editionYear && <span>{article.editionYear}</span>}
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
              <span className="text-stone-500 dark:text-stone-400 font-normal normal-case">{article.articleType}</span>
            </div>
            <h2 className="font-serif text-2xl lg:text-3xl font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-tight">
              <Link href={article.url} className={stretched}>{article.title}</Link>
            </h2>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400 line-clamp-3 leading-relaxed">{article.excerpt}</p>
          </div>

          <div className="mt-6 pt-4 border-t border-stone-100 dark:border-stone-800/80">
            <MetadataRow items={[article.authorName, formattedDate, `${article.readingTimeMinutes} min read`]} size="xs" />
          </div>
        </div>
      </article>
    );
  }

  // Standard Card
  return (
    <article
      className={`group relative flex flex-col rounded-xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800/80 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer ${className}`}
    >
      <div className="aspect-[4/3] bg-stone-100 dark:bg-stone-900 overflow-hidden relative">
        {article.image ? (
          <ResponsiveImage
            asset={article.image}
            alt={article.image.alt || article.title}
            sizes="(min-width: 1024px) 400px, (min-width: 640px) 50vw, 100vw"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
          />
        ) : (
        <CardImage
          src={article.featuredImage}
          alt={article.title}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
          loading="lazy"
          fallback={
            <div className="w-full h-full flex items-center justify-center bg-stone-800 text-stone-500 text-xs uppercase tracking-wider dark:text-stone-400">
              {article.sportName || 'SportingSpy'}
            </div>
          }
        />
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500 font-semibold mb-1.5">
            <span>{article.sportName}</span>
            {article.eventShortName && (
              <>
                <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">/</span>
                <span>{article.eventShortName}</span>
              </>
            )}
            <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
            <span className="text-stone-500 dark:text-stone-400 font-normal">{article.articleType}</span>
          </div>

          <h3 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug line-clamp-2">
            <Link href={article.url} className={stretched}>{article.title}</Link>
          </h3>

          <p className="mt-2 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">{article.excerpt}</p>
        </div>

        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80">
          <MetadataRow items={[article.authorName, formattedDate, `${article.readingTimeMinutes} min read`]} size="xs" />
        </div>
      </div>
    </article>
  );
};
