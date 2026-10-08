import type { ArticleTypeDefinition, Author, EventEdition, Sport, SportEvent } from '../types';
import { docToPlainText, legacyToDoc, validateRichDoc, type RichDoc, type RichNode } from './richText';

export type ImportConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';
export type ImportFieldName = 'title' | 'sport' | 'event' | 'editionYear' | 'articleType' | 'author' | 'subtitle' | 'excerpt' | 'body' | 'seoTitle' | 'metaDescription' | 'keywords' | 'startDate' | 'endDate' | 'venue';
export interface ImportEvidence { field: ImportFieldName | 'document' | 'faq'; excerpt: string; page?: number; paragraph?: number; table?: number; row?: number; line?: number; sectionKind?: 'heading' | 'paragraph' | 'table' | 'page-break'; sourceType?: ImportProposal['sourceType'] }
export interface ImportDetectedField<T = string> { value: T | null; confidence: ImportConfidence; evidence: ImportEvidence[] }
export type ImportFields = Record<ImportFieldName, ImportDetectedField<string | number | string[]>>;
export interface ImportFaqCandidate { question: string; answer: string; confidence: ImportConfidence; evidence: ImportEvidence[] }
export interface PendingFaq { question: string; answer: string }
export interface ImportProposal { sourceType: 'pdf' | 'docx' | 'manual-text'; text: string; sections: unknown[]; fields: ImportFields; faqs: ImportFaqCandidate[]; warnings: string[]; sourceEvidence: ImportEvidence[] }
export type ReviewValues = Record<ImportFieldName, string>;

export interface CmsTransfer {
  title?: string; subtitle?: string; excerpt?: string; body?: RichDoc;
  sportSlug?: string; eventSlug?: string; editionYear?: number; articleType?: string; authorId?: string;
  metaTitle?: string; metaDescription?: string; keywords?: string[];
  faqs?: PendingFaq[];
}
export interface TaxonomyData { sports: Sport[]; events: SportEvent[]; editions: EventEdition[]; authors: Author[]; articleTypes: ArticleTypeDefinition[] }
export interface MappedField { field: ImportFieldName; value: unknown; destination?: keyof CmsTransfer; error?: string }

/** Mirrors the server limits (routes.ts, extractPdf.ts, extractText.ts) for display only; the server enforces them. */
export const SOURCE_LIMITS = { documentMegabytes: 10, pdfPages: 200, manualCharacters: 500_000 };

/** Turns an extraction failure into a safe, actionable message (server messages are already user-facing). */
export function sourceErrorMessage(status: number, body: { error?: unknown; code?: unknown }, fallback: string): string {
  const message = typeof body.error === 'string' && body.error ? body.error : `${fallback} (${status}).`;
  if (body.code === 'ocr_required') return `${message} OCR is not supported here; paste the text with Manual Source Text instead.`;
  if (body.code === 'document_timeout') return `${message} Try again, or paste the text with Manual Source Text instead.`;
  if (status >= 500) return `${fallback}. Try again in a moment.`;
  return message;
}

export const TRANSFER_FIELD_LABELS: Record<keyof CmsTransfer, string> = {
  title: 'Title', subtitle: 'Subtitle', excerpt: 'Excerpt', body: 'Content', sportSlug: 'Sport', eventSlug: 'Event', editionYear: 'Edition year',
  articleType: 'Article type', authorId: 'Author', metaTitle: 'SEO title', metaDescription: 'Meta description', keywords: 'Keywords', faqs: 'FAQ',
};

export const IMPORT_FIELD_LABELS: Record<ImportFieldName, string> = {
  title: 'Title', subtitle: 'Subtitle', excerpt: 'Excerpt', body: 'Content', sport: 'Sport', event: 'Event', editionYear: 'Edition year', articleType: 'Article type / category', author: 'Author', seoTitle: 'SEO title', metaDescription: 'Meta description', keywords: 'Keywords', startDate: 'Start date', endDate: 'End date', venue: 'Venue',
};
export const IMPORT_FIELD_ORDER: ImportFieldName[] = ['title', 'subtitle', 'excerpt', 'body', 'sport', 'event', 'editionYear', 'articleType', 'author', 'seoTitle', 'metaDescription', 'keywords', 'startDate', 'endDate', 'venue'];

export function proposalValues(proposal: ImportProposal): ReviewValues {
  return Object.fromEntries(IMPORT_FIELD_ORDER.map((field) => {
    const value = proposal.fields[field].value;
    return [field, Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)];
  })) as ReviewValues;
}

const key = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const exactOne = <T,>(items: T[], value: string, candidates: (item: T) => (string | null | undefined)[]) => {
  const wanted = key(value);
  const matches = items.filter((item) => candidates(item).some((candidate) => candidate && key(candidate) === wanted));
  return matches.length === 1 ? matches[0] : null;
};
const text = (value: string, max: number, label: string) => {
  const clean = value.trim();
  if (!clean) return { error: `${label} is empty.` };
  if (clean.length > max) return { error: `${label} exceeds the CMS limit of ${max} characters.` };
  return { value: clean };
};

/**
 * PHASE 6: extraction writes source tables as one "cell | cell" line per row, often inside the
 * same paragraph as the text around them (PDFs have no blank line before a table). Within a
 * plain-text paragraph, each run of 2+ consecutive lines with the same 2–20 cells becomes a real
 * table; the lines before and after stay paragraphs. Anything irregular or formatted stays text,
 * so nothing is guessed. Import path only — legacy article bodies are not affected.
 */
export function sourceTablesToRich(doc: RichDoc): RichDoc {
  const cellsOf = (line: string) => line.includes(' | ') ? line.split(' | ').map((cell) => cell.trim()) : null;
  const paragraph = (lines: string[]): RichNode => ({ type: 'paragraph', content: lines.flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]) });
  const cell = (value: string): RichNode => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1 }, content: [value ? { type: 'paragraph', content: [{ type: 'text', text: value }] } : { type: 'paragraph' }] });
  const split = (node: RichNode): RichNode[] => {
    if (node.type !== 'paragraph' || !node.content?.length || node.content.length % 2 === 0) return [node];
    const lines: string[] = [];
    for (const [index, child] of node.content.entries()) {
      if (index % 2 === 1) { if (child.type !== 'hardBreak') return [node]; continue; }
      if (child.type !== 'text' || child.marks?.length || !child.text) return [node];
      lines.push(child.text);
    }
    const out: RichNode[] = [];
    let text: string[] = [], converted = false;
    for (let i = 0; i < lines.length;) {
      const first = cellsOf(lines[i]);
      let end = i + 1;
      while (first && end < lines.length && cellsOf(lines[end])?.length === first.length) end++;
      if (first && first.length >= 2 && first.length <= 20 && end - i >= 2) {
        if (text.length) out.push(paragraph(text));
        text = [];
        out.push({ type: 'table', content: lines.slice(i, end).map((line) => ({ type: 'tableRow', content: cellsOf(line)!.map(cell) })) });
        converted = true;
        i = end;
      } else { text.push(lines[i]); i++; }
    }
    if (text.length) out.push(paragraph(text));
    return converted ? out : [node];
  };
  return { ...doc, content: doc.content.flatMap(split) };
}

export function mapImportField(field: ImportFieldName, value: string, taxonomy: TaxonomyData, context: { sportSlug?: string; eventSlug?: string } = {}): MappedField {
  if (!value.trim()) return { field, value: null, error: 'No extracted value is available.' };
  if (field === 'title') { const r = text(value, 300, 'Title'); return r.error ? { field, value, error: r.error } : { field, value: r.value, destination: 'title' }; }
  if (field === 'subtitle') { const r = text(value, 300, 'Subtitle'); return r.error ? { field, value, error: r.error } : { field, value: r.value, destination: 'subtitle' }; }
  if (field === 'excerpt') { const r = text(value, 1000, 'Excerpt'); return r.error ? { field, value, error: r.error } : { field, value: r.value, destination: 'excerpt' }; }
  if (field === 'seoTitle') { const r = text(value, 300, 'SEO title'); return r.error ? { field, value, error: r.error } : { field, value: r.value, destination: 'metaTitle' }; }
  if (field === 'metaDescription') { const r = text(value, 500, 'Meta description'); return r.error ? { field, value, error: r.error } : { field, value: r.value, destination: 'metaDescription' }; }
  if (field === 'body') {
    const doc = sourceTablesToRich(legacyToDoc(value));
    const checked = validateRichDoc(doc);
    return checked.ok ? { field, value: checked.doc, destination: 'body' } : { field, value, error: `Content cannot be transferred: ${(checked as { error: string }).error}` };
  }
  if (field === 'keywords') {
    const values = value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
    if (!values.length) return { field, value, error: 'Keywords are empty.' };
    if (values.length > 30 || values.some((item) => item.length > 100)) return { field, value, error: 'Keywords must contain at most 30 values of 100 characters or fewer.' };
    return { field, value: values, destination: 'keywords' };
  }
  if (field === 'sport') {
    const sport = exactOne(taxonomy.sports, value, (item) => [item.name, item.slug]);
    return sport ? { field, value: sport.slug, destination: 'sportSlug' } : { field, value, error: 'Unable to map this value automatically to one existing Sport.' };
  }
  if (field === 'event') {
    const candidates = context.sportSlug ? taxonomy.events.filter((item) => item.sportSlug === context.sportSlug) : taxonomy.events;
    const event = exactOne(candidates, value, (item) => [item.name, item.shortName, item.slug, ...(item.alternativeNames ?? '').split(/\r?\n/)]);
    return event ? { field, value: event.slug, destination: 'eventSlug' } : { field, value, error: 'Unable to map this value automatically to one existing Event in the selected Sport.' };
  }
  if (field === 'editionYear') {
    const year = Number(value);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) return { field, value, error: 'Edition year must be a whole year from 1900 to 2200.' };
    if (!context.sportSlug || !context.eventSlug || !taxonomy.editions.some((item) => item.sportSlug === context.sportSlug && item.eventSlug === context.eventSlug && item.year === year)) return { field, value, error: 'Unable to map this year to an existing edition of the selected Event.' };
    return { field, value: year, destination: 'editionYear' };
  }
  if (field === 'articleType') {
    const type = exactOne(taxonomy.articleTypes.filter((item) => item.isActive), value, (item) => [item.name, item.slug]);
    return type ? { field, value: type.name, destination: 'articleType' } : { field, value, error: 'Unable to map this value automatically to one active Article Type.' };
  }
  if (field === 'author') {
    const author = exactOne(taxonomy.authors, value.replace(/^by\s+/i, ''), (item) => [item.name, item.slug]);
    return author ? { field, value: author.id, destination: 'authorId' } : { field, value, error: 'Unable to map this value automatically to one existing Author profile.' };
  }
  return { field, value, error: `${IMPORT_FIELD_LABELS[field]} has no compatible Article field and will remain for manual review.` };
}

export function mapSelectedImport(selected: Set<ImportFieldName>, values: ReviewValues, taxonomy: TaxonomyData, current: { sportSlug?: string; eventSlug?: string } = {}): { transfer: CmsTransfer; mapped: MappedField[] } {
  const mapped: MappedField[] = [];
  const transfer: CmsTransfer = {};
  const sport = selected.has('sport') ? mapImportField('sport', values.sport, taxonomy) : null;
  if (sport) mapped.push(sport);
  const sportSlug = sport?.destination ? String(sport.value) : selected.has('sport') ? undefined : current.sportSlug;
  const event = selected.has('event') ? mapImportField('event', values.event, taxonomy, { sportSlug }) : null;
  if (event) mapped.push(event);
  const eventSlug = event?.destination ? String(event.value) : selected.has('event') ? undefined : current.eventSlug;
  for (const field of selected) {
    if (field === 'sport' || field === 'event') continue;
    mapped.push(mapImportField(field, values[field], taxonomy, { sportSlug, eventSlug }));
  }
  for (const item of mapped) if (item.destination && !item.error) (transfer as Record<string, unknown>)[item.destination] = item.value;
  return { transfer, mapped };
}

export function transferConflicts(transfer: CmsTransfer, current: CmsTransfer): (keyof CmsTransfer)[] {
  return (Object.keys(transfer) as (keyof CmsTransfer)[]).filter((field) => {
    if (field === 'faqs') return false;
    const existing = current[field];
    if (existing == null || existing === '' || (Array.isArray(existing) && !existing.length)) return false;
    if (field === 'body' && typeof existing === 'object' && 'type' in existing && docToPlainText(existing as RichDoc).trim() === '') return false;
    return JSON.stringify(existing) !== JSON.stringify(transfer[field]);
  });
}
