/**
 * Public FAQ reader (PHASE H; E5; PHASE R contexts): published entries only,
 * in the editors' order. Ties break on creation time then id, so the order is
 * always stable. Callers check that the context page itself is public.
 */

import type { FaqContext } from '../../../src/lib/faq';
import { faqContextColumns } from '../../../src/lib/faq';

// Loaded lazily (like content.ts) so importing this module never opens a database connection.
const db = async () => (await import('../../db')).prisma;

export interface PublicFaq { id: string; question: string; answer: string; updatedAt: Date }

/** Published entries of one context (site-wide entries when kind is "site"). */
export async function getPublishedFaqsFor(context: FaqContext): Promise<PublicFaq[]> {
  const prisma = await db();
  return prisma.faqEntry.findMany({
    where: { status: 'published', ...faqContextColumns(context) },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, question: true, answer: true, updatedAt: true },
  });
}

/** The site-wide /faq/ page (only rendered when Settings → FAQ enables it). */
export async function getPublishedFaqs(): Promise<PublicFaq[]> {
  return getPublishedFaqsFor({ kind: 'site', id: null });
}

/** PHASE E5: published entries scoped to one Event. */
export async function getPublishedEventFaqs(eventId: string): Promise<PublicFaq[]> {
  return getPublishedFaqsFor({ kind: 'event', id: eventId });
}

/** Whether the site-wide /faq/ page is switched on (v2.2: off at launch). */
export async function globalFaqPageEnabled(): Promise<boolean> {
  const prisma = await db();
  const row = await prisma.siteSetting.findUnique({ where: { key: 'globalFaqPage' } }).catch(() => null);
  return row?.value === 'enabled';
}
