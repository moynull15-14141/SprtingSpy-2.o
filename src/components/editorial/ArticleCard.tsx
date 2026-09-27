/**
 * SportingSpy Editorial Article Card
 * Supports lead story tier, standard feature tier, and compact archive tier.
 * Zero-pill discipline: unboxed text kickers and metadata separators.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Article } from '../../types';
import { MetadataRow } from '../ui/MetadataRow';

interface ArticleCardProps {
  article: Article;
  variant?: 'lead' | 'standard' | 'compact';
  className?: string;
}

export const ArticleCard: React.FC<ArticleCardProps> = ({
  article,
  variant = 'standard',
  className = '',
}) => {
  const { navigate, sports, events, authors } = useApp();
  const [imageError, setImageError] = useState(false);

  const sport = sports.find((s) => s.slug === article.sportSlug);
  const event = article.eventSlug ? events.find((e) => e.slug === article.eventSlug) : null;
  const author = authors.find((a) => a.id === article.authorId);

  // Compute canonical hierarchical URL
  const targetUrl =
    article.eventSlug && article.editionYear
      ? `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}`
      : `/${article.sportSlug}/${article.slug}`;

  const formattedDate = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  if (variant === 'compact') {
    return (
      <article
        onClick={() => navigate(targetUrl)}
        className={`group py-3 border-b border-stone-200 dark:border-stone-800/80 cursor-pointer hover:bg-stone-50/50 dark:hover:bg-stone-900/40 transition-colors ${className}`}
      >
        <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-500 font-semibold mb-1">
          <span>{sport?.name || article.sportSlug}</span>
          {event && (
            <>
              <span className="text-stone-300 dark:text-stone-700">/</span>
              <span>{event.shortName}</span>
            </>
          )}
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <span className="text-stone-500 dark:text-stone-400 font-normal">{article.articleType}</span>
        </div>
        <h4 className="text-sm md:text-base font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug">
          {article.title}
        </h4>
        <div className="mt-1.5">
          <MetadataRow
            items={[author?.name, formattedDate, `${article.readingTimeMinutes} min read`]}
            size="xs"
          />
        </div>
      </article>
    );
  }

  if (variant === 'lead') {
    return (
      <article
        onClick={() => navigate(targetUrl)}
        className={`group grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 rounded-2xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800/90 shadow-sm hover:shadow-md transition-all cursor-pointer ${className}`}
      >
        <div className="lg:col-span-7 overflow-hidden rounded-xl bg-stone-100 dark:bg-stone-900 aspect-video relative">
          {!imageError && article.featuredImage ? (
            <img
              src={article.featuredImage}
              alt={article.title}
              onError={() => setImageError(true)}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500 ease-out"
              loading="eager"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-stone-800 to-stone-950 text-stone-300 p-8 text-center font-display text-lg">
              {sport?.name} Editorial Lead
            </div>
          )}
        </div>

        <div className="lg:col-span-5 flex flex-col justify-between py-1">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider mb-2">
              <span>{sport?.name}</span>
              {article.editionYear && <span>{article.editionYear}</span>}
              <span className="text-stone-300 dark:text-stone-700">·</span>
              <span className="text-stone-500 dark:text-stone-400 font-normal normal-case">{article.articleType}</span>
            </div>
            <h2 className="font-serif text-2xl lg:text-3xl font-bold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-tight">
              {article.title}
            </h2>
            <p className="mt-3 text-sm text-stone-600 dark:text-stone-400 line-clamp-3 leading-relaxed">
              {article.excerpt}
            </p>
          </div>

          <div className="mt-6 pt-4 border-t border-stone-100 dark:border-stone-800/80">
            <MetadataRow
              items={[
                author?.name,
                formattedDate,
                `${article.readingTimeMinutes} min read`,
              ]}
              size="xs"
            />
          </div>
        </div>
      </article>
    );
  }

  // Standard Card
  return (
    <article
      onClick={() => navigate(targetUrl)}
      className={`group flex flex-col rounded-xl bg-white dark:bg-[#121417] border border-stone-200 dark:border-stone-800/80 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-pointer ${className}`}
    >
      <div className="aspect-[4/3] bg-stone-100 dark:bg-stone-900 overflow-hidden relative">
        {!imageError && article.featuredImage ? (
          <img
            src={article.featuredImage}
            alt={article.title}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ease-out"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stone-800 text-stone-400 text-xs uppercase tracking-wider">
            {sport?.name || 'SportingSpy'}
          </div>
        )}
      </div>

      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-500 font-semibold mb-1.5">
            <span>{sport?.name}</span>
            {event && (
              <>
                <span className="text-stone-300 dark:text-stone-700">/</span>
                <span>{event.shortName}</span>
              </>
            )}
            <span className="text-stone-300 dark:text-stone-700">·</span>
            <span className="text-stone-500 dark:text-stone-400 font-normal">{article.articleType}</span>
          </div>

          <h3 className="font-serif text-lg font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors leading-snug line-clamp-2">
            {article.title}
          </h3>

          <p className="mt-2 text-xs text-stone-600 dark:text-stone-400 line-clamp-2 leading-relaxed">
            {article.excerpt}
          </p>
        </div>

        <div className="mt-4 pt-3 border-t border-stone-100 dark:border-stone-800/80">
          <MetadataRow
            items={[author?.name, formattedDate, `${article.readingTimeMinutes} min read`]}
            size="xs"
          />
        </div>
      </div>
    </article>
  );
};
