/**
 * Public FAQ reader (PHASE H): published entries only, in the editors' order.
 * Ties break on creation time then id, so the order is always stable.
 */

// Loaded lazily (like content.ts) so importing this module never opens a database connection.
const db = async () => (await import('../../db')).prisma;

export interface PublicFaq { id: string; question: string; answer: string; updatedAt: Date }

export async function getPublishedFaqs(): Promise<PublicFaq[]> {
  const prisma = await db();
  return prisma.faqEntry.findMany({
    where: { status: 'published' },
    orderBy: [{ displayOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, question: true, answer: true, updatedAt: true },
  });
}
