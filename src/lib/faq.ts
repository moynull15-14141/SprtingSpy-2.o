/** FAQ shapes shared by the CMS, the public page and the server (PHASE H). */

export const FAQ_STATUSES = ['draft', 'published', 'archived'] as const;
export type FaqStatus = (typeof FAQ_STATUSES)[number];

export interface FaqEntry {
  id: string;
  question: string;
  answer: string;
  displayOrder: number;
  status: FaqStatus;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

/** Plain-text answer → paragraphs (blank lines separate paragraphs; single newlines are kept as line breaks). */
export const answerParagraphs = (answer: string): string[][] =>
  answer.split(/\n\s*\n/).map((p) => p.split('\n').map((line) => line.trim()).filter(Boolean)).filter((p) => p.length);
