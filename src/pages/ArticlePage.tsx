/**
 * SportingSpy Unified Editorial Article Page
 * Reusable template supporting all 18 Article Types:
 * - Schedule, Event Guide, Results, Sports Viewing Guide, Preview, Update, News,
 *   Past Winners, Records, Prize Money, Players, Teams, Venue, Qualification,
 *   Rules & Format, History, Analysis, General Information.
 *
 * Implements:
 * - Museum/Editorial typography and reading cadence
 * - Author byline & biographical footer
 * - Structured data tables with tabular figures
 * - References & external citations
 * - Moderated comments section
 * - Reusable ad slot integrations (ARTICLE_TOP, ARTICLE_MIDDLE, ARTICLE_BOTTOM)
 */

import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { SeoHead } from '../components/layout/SeoHead';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { MetadataRow } from '../components/ui/MetadataRow';
import { StructuredTable } from '../components/ui/StructuredTable';
import { CommentsSection } from '../components/editorial/CommentsSection';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { AdSlot } from '../components/ui/AdSlot';
import { Article } from '../types';

interface ArticlePageProps {
  article: Article;
}

export const ArticlePage: React.FC<ArticlePageProps> = ({ article }) => {
  const { sports, events, editions, authors, articles, navigate } = useApp();
  const [imageError, setImageError] = useState(false);

  const sport = sports.find((s) => s.slug === article.sportSlug);
  const event = article.eventSlug ? events.find((e) => e.slug === article.eventSlug) : null;
  const edition =
    article.eventSlug && article.editionYear
      ? editions.find((ed) => ed.eventSlug === article.eventSlug && ed.year === article.editionYear)
      : null;
  const author = authors.find((a) => a.id === article.authorId);

  // Compute breadcrumbs
  const breadcrumbItems = [];
  if (sport) breadcrumbItems.push({ label: sport.name, url: `/${sport.slug}` });
  if (event) breadcrumbItems.push({ label: event.name, url: `/${sport?.slug}/${event.slug}` });
  if (edition)
    breadcrumbItems.push({
      label: `${edition.year}`,
      url: `/${sport?.slug}/${event?.slug}/${edition.year}`,
    });
  breadcrumbItems.push({ label: article.title });

  // Related articles in same sport or event
  const relatedArticles = articles
    .filter((a) => a.id !== article.id && a.sportSlug === article.sportSlug && a.status === 'published')
    .slice(0, 3);

  const formattedDate = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const formattedUpdate = article.updatedAt
    ? new Date(article.updatedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  // Schema.org Article / NewsArticle structured data
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: article.title,
    description: article.excerpt,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: author
      ? {
          '@type': 'Person',
          name: author.name,
          jobTitle: author.roleTitle,
        }
      : undefined,
    publisher: {
      '@type': 'Organization',
      name: 'SportingSpy',
      url: 'https://sportingspy.com',
    },
    image: article.featuredImage ? [article.featuredImage] : undefined,
    articleSection: sport?.name,
  };

  // Convert plain text markdown blocks to clean paragraphs
  const contentParagraphs = article.content
    .trim()
    .split('\n\n')
    .filter((p) => p.trim().length > 0);

  return (
    <article className="max-w-4xl mx-auto space-y-8">
      <SeoHead
        title={article.seo.metaTitle || `${article.title} | SportingSpy`}
        description={article.seo.metaDescription || article.excerpt}
        canonicalPath={
          article.eventSlug && article.editionYear
            ? `/${article.sportSlug}/${article.eventSlug}/${article.editionYear}/${article.slug}`
            : `/${article.sportSlug}/${article.slug}`
        }
        structuredData={structuredData}
      />

      <Breadcrumbs items={breadcrumbItems} />

      <AdSlot id="ARTICLE_TOP" />

      {/* ARTICLE HEADER & BYLINE */}
      <header className="space-y-4 pt-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider">
          <span>{sport?.name}</span>
          {event && (
            <>
              <span className="text-stone-300 dark:text-stone-700">/</span>
              <span>{event.name}</span>
            </>
          )}
          {edition && (
            <>
              <span className="text-stone-300 dark:text-stone-700">·</span>
              <span className="font-mono">{edition.year}</span>
            </>
          )}
          <span className="text-stone-300 dark:text-stone-700">·</span>
          <span className="text-stone-500 dark:text-stone-400 font-normal normal-case">{article.articleType}</span>
        </div>

        <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-stone-900 dark:text-stone-100 leading-[1.15] text-balance">
          {article.title}
        </h1>

        {article.subtitle && (
          <p className="text-lg sm:text-xl font-serif italic text-stone-600 dark:text-stone-300 leading-snug">
            {article.subtitle}
          </p>
        )}

        {/* Byline Strip */}
        <div className="pt-4 border-t border-b border-stone-200 dark:border-stone-800 py-3 flex flex-wrap items-center justify-between gap-4">
          {author && (
            <div
              onClick={() => navigate(`/author/${author.slug}`)}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <img
                src={author.avatar}
                alt={author.name}
                className="w-10 h-10 rounded-full object-cover ring-1 ring-stone-200 dark:ring-stone-800 group-hover:ring-amber-500 transition-all"
              />
              <div>
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {author.name}
                </p>
                <p className="text-[11px] text-stone-500">{author.roleTitle}</p>
              </div>
            </div>
          )}

          <div className="text-right">
            <MetadataRow
              items={[
                { label: 'Published', value: formattedDate },
                formattedUpdate ? { label: 'Updated', value: formattedUpdate } : null,
                `${article.readingTimeMinutes} min read`,
              ]}
              size="xs"
            />
          </div>
        </div>
      </header>

      {/* FEATURED EDITORIAL IMAGE */}
      {article.featuredImage && !imageError && (
        <figure className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900 aspect-video relative">
          <img
            src={article.featuredImage}
            alt={article.title}
            onError={() => setImageError(true)}
            className="w-full h-full object-cover"
            loading="eager"
          />
          <figcaption className="p-2.5 text-[11px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-950/80 border-t border-stone-200 dark:border-stone-800 italic flex justify-between">
            <span>SportingSpy Editorial Archive</span>
            <span className="font-mono text-[10px]">Verified Sports Photography</span>
          </figcaption>
        </figure>
      )}

      {/* EDITORIAL PROSE CONTAINER */}
      <div className="prose prose-stone dark:prose-invert max-w-none text-stone-800 dark:text-stone-200 text-base sm:text-lg leading-relaxed space-y-6">
        {/* Lead Excerpt Drop Cap intro */}
        <p className="font-serif text-lg sm:text-xl text-stone-700 dark:text-stone-300 leading-relaxed italic border-l-2 border-amber-600 pl-4 py-1">
          {article.excerpt}
        </p>

        {contentParagraphs.map((para, idx) => {
          // Check if paragraph is an H3
          if (para.startsWith('### ')) {
            return (
              <h3
                key={idx}
                className="font-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100 pt-4"
              >
                {para.replace('### ', '')}
              </h3>
            );
          }

          // Check if paragraph is an H2
          if (para.startsWith('## ')) {
            return (
              <h2
                key={idx}
                className="font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100 pt-6"
              >
                {para.replace('## ', '')}
              </h2>
            );
          }

          // Check if paragraph is a bullet list
          if (para.startsWith('* ') || para.startsWith('- ')) {
            const listItems = para.split('\n').map((li) => li.replace(/^[\*\-]\s+/, ''));
            return (
              <ul key={idx} className="list-disc pl-6 space-y-2 text-stone-700 dark:text-stone-300">
                {listItems.map((li, i) => (
                  <li key={i}>{li}</li>
                ))}
              </ul>
            );
          }

          // Check if paragraph is a numbered list
          if (/^\d+\.\s/.test(para)) {
            const listItems = para.split('\n').map((li) => li.replace(/^\d+\.\s+/, ''));
            return (
              <ol key={idx} className="list-decimal pl-6 space-y-2 text-stone-700 dark:text-stone-300">
                {listItems.map((li, i) => (
                  <li key={i}>{li}</li>
                ))}
              </ol>
            );
          }

          // Standard paragraph with drop cap on the very first body block
          return (
            <React.Fragment key={idx}>
              <p className={idx === 0 ? 'first-letter:text-5xl first-letter:font-serif first-letter:font-bold first-letter:float-left first-letter:mr-3 first-letter:mt-1 first-letter:text-amber-700 dark:first-letter:text-amber-500' : ''}>
                {para}
              </p>

              {/* In-Read Ad slot after 2nd paragraph */}
              {idx === 1 && <AdSlot id="ARTICLE_MIDDLE" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* STRUCTURED DATA TABLES */}
      {article.tables && article.tables.length > 0 && (
        <section aria-labelledby="tables-heading" className="pt-4">
          <h3 id="tables-heading" className="sr-only">
            Statistical & Schedule Data
          </h3>
          {article.tables.map((table, tIdx) => (
            <StructuredTable key={tIdx} table={table} />
          ))}
        </section>
      )}

      {/* EXTERNAL REFERENCES & CITATIONS */}
      {article.references && article.references.length > 0 && (
        <div className="p-4 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs">
          <h4 className="font-semibold text-stone-900 dark:text-stone-100 uppercase tracking-wider mb-2">
            Authoritative Sources & Regulatory References
          </h4>
          <ul className="space-y-1">
            {article.references.map((ref, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className="text-amber-600">↗</span>
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-stone-700 dark:text-stone-300 hover:text-amber-600 dark:hover:text-amber-400 hover:underline"
                >
                  {ref.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AdSlot id="ARTICLE_BOTTOM" />

      {/* AUTHOR SIGNATURE CARD */}
      {author && (
        <div className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <img
            src={author.avatar}
            alt={author.name}
            className="w-16 h-16 rounded-full object-cover shrink-0"
          />
          <div className="flex-1 text-center sm:text-left">
            <h4 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              Written by {author.name}
            </h4>
            <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold mb-1">
              {author.roleTitle}
            </p>
            <p className="text-xs text-stone-600 dark:text-stone-400 leading-relaxed">
              {author.bio}
            </p>
            <div className="mt-3 flex items-center justify-center sm:justify-start gap-3 text-xs text-stone-500">
              {author.twitter && <span>{author.twitter}</span>}
              <button
                onClick={() => navigate(`/author/${author.slug}`)}
                className="text-amber-600 dark:text-amber-400 hover:underline font-semibold"
              >
                View all articles ({author.articleCount}) &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* COMMENTS FOUNDATION */}
      <CommentsSection articleId={article.id} />

      {/* RELATED ARTICLES */}
      {relatedArticles.length > 0 && (
        <section aria-labelledby="related-heading" className="pt-8 border-t border-stone-200 dark:border-stone-800">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-500">
              Continue Reading
            </span>
            <h3 id="related-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Related {sport?.name} Editorial
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {relatedArticles.map((rel) => (
              <ArticleCard key={rel.id} article={rel} variant="standard" />
            ))}
          </div>
        </section>
      )}
    </article>
  );
};
