/**
 * SportingSpy Author Dossier Page
 * URL: /author/{slug}
 * Author biography, credentials, beat coverage, and published articles archive.
 */

import React from 'react';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { JsonLd } from '../components/seo/JsonLd';
import { absoluteUrl, authorPath } from '../lib/paths';
import type { getAuthorPage } from '../../server/services/public/content';
import { Avatar } from '../components/ui/Avatar';

type AuthorPageData = NonNullable<Awaited<ReturnType<typeof getAuthorPage>>>;

export const AuthorPage: React.FC<{ data: AuthorPageData }> = ({ data }) => {
  const { author, articles: authorArticles } = data;

  // Spec §15: ProfilePage with the author as its main entity.
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: absoluteUrl(authorPath(author.slug)),
    mainEntity: {
      '@type': 'Person',
      name: author.name,
      jobTitle: author.roleTitle,
      description: author.bio,
      url: absoluteUrl(authorPath(author.slug)),
    },
  };

  return (
    <div className="space-y-10">
      <JsonLd data={structuredData} />

      <Breadcrumbs items={[{ label: 'Editorial Staff' }, { label: author.name }]} />

      {/* Author Profile Header */}
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-8 lg:p-10 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <Avatar src={author.avatar} name={author.name} className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover ring-2 ring-stone-200 dark:ring-stone-800 shrink-0" />

          <div className="flex-1 text-center sm:text-left">
            <span className="text-xs uppercase font-bold tracking-wider text-amber-700 dark:text-amber-500">
              Editorial Staff
            </span>
            <h1 className="font-serif text-3xl sm:text-4xl font-bold text-stone-900 dark:text-stone-100 mt-1">
              {author.name}
            </h1>
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mt-0.5">
              {author.roleTitle}
            </p>
            <p className="mt-3 text-sm sm:text-base text-stone-700 dark:text-stone-300 leading-relaxed max-w-2xl font-sans">
              {author.bio}
            </p>

            <div className="mt-4 pt-4 border-t border-stone-100 dark:border-stone-800/80 flex flex-wrap items-center justify-center sm:justify-start gap-4 text-xs text-stone-500 dark:text-stone-400">
              {author.twitter && (
                <span className="text-stone-700 dark:text-stone-300 font-medium">
                  {author.twitter}
                </span>
              )}
              {author.email && (
                <span className="text-stone-500 dark:text-stone-400">
                  {author.email}
                </span>
              )}
              <span className="tabular-nums">
                {authorArticles.length} Published Articles
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Articles by this Author */}
      <section aria-labelledby="author-articles-heading">
        <div className="flex items-center justify-between mb-6 pb-2 border-b border-stone-200 dark:border-stone-800">
          <h2 id="author-articles-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Published Articles by {author.name}
          </h2>
          <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
            {authorArticles.length} Articles
          </span>
        </div>

        {authorArticles.length === 0 ? (
          <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">No published articles yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {authorArticles.map((art) => (
              <ArticleCard key={art.id} article={art} variant="standard" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
