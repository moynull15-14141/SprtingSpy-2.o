import { DocumentImportError, type ExtractedSection, type RawExtraction } from './types';

export const MAX_MANUAL_TEXT_CHARACTERS = 500_000;

/** Converts untrusted pasted source into the same bounded raw extraction shape as file adapters. */
export function extractManualText(input: unknown): RawExtraction {
  if (typeof input !== 'string') throw new DocumentImportError('Manual source text must be plain text.', 400, 'text_invalid');
  if (input.length > MAX_MANUAL_TEXT_CHARACTERS) throw new DocumentImportError(`Manual source text is limited to ${MAX_MANUAL_TEXT_CHARACTERS.toLocaleString('en-US')} characters.`, 413, 'document_limit');
  if (!input.trim()) throw new DocumentImportError('Paste source text before processing.', 422, 'document_empty');
  const normalizedLines = input.replace(/\r\n?/g, '\n').split('\n');
  const sections: ExtractedSection[] = [];
  let paragraph = 0, start = 0;
  while (start < normalizedLines.length) {
    while (start < normalizedLines.length && !normalizedLines[start].trim()) start++;
    if (start >= normalizedLines.length) break;
    let end = start;
    while (end + 1 < normalizedLines.length && normalizedLines[end + 1].trim()) end++;
    paragraph++;
    const value = normalizedLines.slice(start, end + 1).join('\n');
    const isFirstFreeformHeading = paragraph === 1 && !/^[A-Z][A-Z ]{1,30}\s*:/i.test(value) && value.length <= 200 && !value.includes('\n');
    sections.push({ kind: isFirstFreeformHeading ? 'heading' : 'paragraph', text: value, paragraph, line: start + 1, ...(isFirstFreeformHeading ? { level: 1 } : {}) });
    start = end + 1;
  }
  return { sourceType: 'manual-text', sections, warnings: [] };
}
