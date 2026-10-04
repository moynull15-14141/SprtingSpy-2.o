/**
 * SportingSpy Unified Editorial Article Page
 * One reusable template for every Article Type (database-backed list,
 * including both "How to Watch" and "Sports Viewing Guide").
 * Structure (Spec §9.7): breadcrumbs · title · author/dates · featured image ·
 * body · sources · FAQ · related articles · latest articles · author info.
 *
 * Implements:
 * - Museum/Editorial typography and reading cadence
 * - Author byline & biographical footer
 * - Structured data tables with tabular figures
 * - References & external citations
 * - Moderated comments section
 * - Reusable ad slot integrations (ARTICLE_TOP, ARTICLE_MIDDLE, ARTICLE_BOTTOM)
 */

import React from 'react';
import Link from 'next/link';
import { Breadcrumbs } from '../components/ui/Breadcrumbs';
import { MetadataRow } from '../components/ui/MetadataRow';
import { StructuredTable } from '../components/ui/StructuredTable';
import { CommentsSection } from '../components/editorial/CommentsSection';
import { ArticleCard } from '../components/editorial/ArticleCard';
import { FeaturedImage } from '../components/editorial/FeaturedImage';
import { RichText } from '../components/editorial/RichText';
import { ResponsiveImage } from '../components/editorial/ResponsiveImage';
import { AdSlot } from '../components/ui/AdSlot';
import { JsonLd } from '../components/seo/JsonLd';
import { absoluteUrl, articlePath, authorPath } from '../lib/paths';
import type { Comment } from '../types';
import { ArticleAnalytics } from '../components/editorial/ArticleAnalytics';
import type { getArticlePage } from '../../server/services/public/content';
import { Avatar } from '../components/ui/Avatar';
import { PlacedBlocks } from '../components/site/GlobalBlocks';
import { ContextFaq } from '../components/editorial/ContextFaq';
import { RumPageType } from '../components/analytics/RumPageType';

type ArticlePageData = NonNullable<Awaited<ReturnType<typeof getArticlePage>>>;


export const ArticlePage: React.FC<{ data: ArticlePageData; comments: Comment[] | null; preview?: boolean }> = ({ data, comments, preview = false }) => {
  const { article, sport, event, edition, author, related: relatedArticles, latest: latestArticles, body, media, featuredImage, faqs, faqSchemaEnabled, schemaType } = data;
  // PHASE R: no invented caption/credit — only what the editor or the Media Library record says.
  const imageCaption = body.attrs?.featuredCaption ?? (featuredImage?.caption || '');
  const imageCredit = body.attrs?.featuredCredit ?? (featuredImage?.credit || '');

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

  const formattedDate = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const formattedUpdate = article.updatedAt
    ? new Date(article.updatedAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : null;

  // Matches the page's canonical tag, including an editor canonical override.
  const canonicalUrl = article.seo.canonicalUrl ? new URL(article.seo.canonicalUrl, absoluteUrl('/')).toString() : absoluteUrl(articlePath(article));
  const imageUrl = article.featuredImage ? new URL(article.featuredImage, absoluteUrl('/')).toString() : undefined;
  const structuredData = {
    '@context': 'https://schema.org',
    // PHASE R: Article / NewsArticle / BlogPosting is configured per Article Type (Admin → Article Types).
    '@type': schemaType,
    headline: article.title,
    description: article.excerpt,
    mainEntityOfPage: canonicalUrl,
    url: canonicalUrl,
    datePublished: article.publishedAt,
    dateModified: article.updatedAt || article.publishedAt,
    author: author
      ? {
          '@type': 'Person',
          name: author.name,
          jobTitle: author.roleTitle,
          url: absoluteUrl(authorPath(author.slug)),
        }
      : undefined,
    publisher: {
      '@type': 'Organization',
      name: 'SportingSpy',
      url: absoluteUrl('/'),
    },
    image: imageUrl ? [imageUrl] : undefined,
    articleSection: sport.name,
  };

  return (
    <article className="max-w-[98rem] mx-auto space-y-8">
      {preview ? (
        <div role="status" className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 font-semibold">
          PREVIEW — status: {article.status}. This page is visible only to signed-in staff and is not published by viewing it.
        </div>
      ) : (
        <>
          <RumPageType type="article" />
          <JsonLd data={structuredData} />
          <ArticleAnalytics id={article.id} sport={article.sportSlug} category={article.articleType} author={author?.slug} event={article.eventSlug || undefined} publishedAt={new Date(article.publishedAt).toISOString()} />
        </>
      )}

      <Breadcrumbs items={breadcrumbItems} />

      <AdSlot id="ARTICLE_TOP" />

      {/* ARTICLE HEADER & BYLINE */}
      <header className="space-y-4 pt-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-500 uppercase tracking-wider">
          <span>{sport.name}</span>
          {event && (
            <>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">/</span>
              <span>{event.name}</span>
            </>
          )}
          {edition && (
            <>
              <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
              <span className="font-mono">{edition.year}</span>
            </>
          )}
          <span aria-hidden="true" className="text-stone-300 dark:text-stone-700">·</span>
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
            <Link href={authorPath(author.slug)} className="flex items-center gap-3 cursor-pointer group">
              <Avatar src={author.avatar} name={author.name} className="w-10 h-10 rounded-full object-cover ring-1 ring-stone-200 dark:ring-stone-800 group-hover:ring-amber-500 transition-all" />
              <div>
                <p className="text-xs font-semibold text-stone-900 dark:text-stone-100 group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors">
                  {author.name}
                </p>
                <p className="text-[11px] text-stone-500 dark:text-stone-400">{author.roleTitle}</p>
              </div>
            </Link>
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
      {featuredImage ? (
        <figure className="overflow-hidden rounded-2xl border border-stone-200 dark:border-stone-800 bg-stone-100 dark:bg-stone-900">
          <ResponsiveImage asset={featuredImage} alt={featuredImage.alt || article.title} sizes="(min-width: 896px) 896px, 100vw" priority className="w-full h-auto aspect-video object-cover" />
          {(imageCaption || imageCredit) && <figcaption className="p-2.5 text-[11px] text-stone-500 dark:text-stone-400 bg-stone-50 dark:bg-stone-950/80 border-t border-stone-200 dark:border-stone-800 italic flex flex-wrap justify-between gap-2 break-words">
            <span>{imageCaption}</span>
            <span className="font-mono text-[10px]">{imageCredit}</span>
          </figcaption>}
        </figure>
      ) : (
        article.featuredImage && <FeaturedImage src={article.featuredImage} alt={article.title} caption={imageCaption} credit={imageCredit} />
      )}

      {/* EDITORIAL PROSE CONTAINER */}
      <div className="prose prose-stone dark:prose-invert max-w-none text-stone-800 dark:text-stone-200 text-base sm:text-lg leading-relaxed space-y-6">
        {/* Lead Excerpt Drop Cap intro */}
        <p className="font-serif text-lg sm:text-xl text-stone-700 dark:text-stone-300 leading-relaxed italic border-l-2 border-amber-600 pl-4 py-1">
          {article.excerpt}
        </p>

        <RichText doc={body} media={media} afterSecondParagraph={<AdSlot id="ARTICLE_MIDDLE" />} />
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
            Sources &amp; references
          </h4>
          <ul className="space-y-1">
            {article.references.map((ref, idx) => (
              <li key={idx} className="flex items-center gap-2">
                <span className="text-amber-700 dark:text-amber-500">↗</span>
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

      {/* READER QUESTIONS (published, editor-approved; FAQPage markup only when enabled) */}
      <ContextFaq items={faqs} heading="Frequently asked questions" schemaEnabled={faqSchemaEnabled && !preview} />

      {!preview && <PlacedBlocks placement="article_end" />}
      <AdSlot id="ARTICLE_BOTTOM" />

      {/* COMMENTS (launch-disabled unless the server enables them) */}
      {comments && <CommentsSection articleId={article.id} initialComments={comments} />}

      {/* RELATED ARTICLES */}
      {relatedArticles.length > 0 && (
        <section aria-labelledby="related-heading" className="pt-8 border-t border-stone-200 dark:border-stone-800">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">
              Related articles
            </span>
            <h3 id="related-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
              Related {sport.name} articles
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {relatedArticles.map((rel) => (
              <ArticleCard key={rel.id} article={rel} variant="standard" />
            ))}
          </div>
        </section>
      )}
      {/* LATEST ARTICLES (Spec §9.7) */}
      {!preview && latestArticles.length > 0 && (
        <section aria-labelledby="latest-heading" className="pt-8 border-t border-stone-200 dark:border-stone-800">
          <div className="mb-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">Latest articles</span>
            <h3 id="latest-heading" className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Latest {sport.name} articles</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {latestArticles.map((a) => <ArticleCard key={a.id} article={a} variant="standard" />)}
          </div>
        </section>
      )}

      {/* AUTHOR SIGNATURE CARD */}
      {author && (
        <div className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] flex flex-col sm:flex-row items-center sm:items-start gap-4">
          <Avatar src={author.avatar} name={author.name} className="w-16 h-16 rounded-full object-cover shrink-0" />
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
            <div className="mt-3 flex items-center justify-center sm:justify-start gap-3 text-xs text-stone-500 dark:text-stone-400">
              {author.twitter && <span>{author.twitter}</span>}
              <Link href={authorPath(author.slug)} className="text-amber-700 dark:text-amber-400 hover:underline font-semibold">
                View all articles by {author.name} &rarr;
              </Link>
            </div>
          </div>
        </div>
      )}

    </article>
  );
};
