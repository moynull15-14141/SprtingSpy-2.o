/**
 * Reusable editorial blocks (PHASE F.1) placed by the Site Experience.
 * Plain text and validated links only; clearly editorial (not advertising —
 * ads stay in Ad Placements with their own labelling and consent rules).
 */
import React from 'react';
import type { ResolvedBlock } from '../../../server/services/public/siteLayout';
import { ArticleCard } from '../editorial/ArticleCard';
import { SiteLink } from './SiteLink';

export function GlobalBlock({ block }: { block: ResolvedBlock }) {
  return (
    <aside aria-label={block.title || block.name} data-block-id={block.id} className="min-w-0 break-words rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6 dark:border-amber-900/60 dark:bg-amber-950/20">
      {block.type === 'featuredStory' && block.article ? (
        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">{block.title || 'Featured story'}</p>
          <ArticleCard article={block.article} variant="compact" />
        </div>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {block.title && <h2 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">{block.title}</h2>}
            {block.text && <p className="mt-1 max-w-3xl text-sm text-stone-700 dark:text-stone-300">{block.text}</p>}
          </div>
          {block.type === 'cta' && block.cta && (
            <SiteLink href={block.cta.href} className="inline-block shrink-0 rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
              {block.cta.label}
            </SiteLink>
          )}
        </div>
      )}
    </aside>
  );
}

export function GlobalBlocks({ blocks, className = '' }: { blocks: ResolvedBlock[]; className?: string }) {
  if (!blocks.length) return null;
  return <div className={`space-y-4 ${className}`}>{blocks.map((b) => <GlobalBlock key={b.id} block={b} />)}</div>;
}

/** Blocks for one placement, loaded from this request's Site Experience (cached per request). */
export async function PlacedBlocks({ placement, className = '' }: { placement: 'article_end' | 'sport_top'; className?: string }) {
  const [{ getSiteLayoutForRequest }, { blocksFor }] = await Promise.all([import('../../lib/data'), import('../../../server/services/public/siteLayout')]);
  return <GlobalBlocks blocks={blocksFor(await getSiteLayoutForRequest(), placement)} className={className} />;
}
