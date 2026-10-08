import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { DocumentImportError, type ExtractedSection, type RawExtraction } from './types';

export const PDF_LIMITS = { pages: 200, textCharacters: 500_000 };

export async function extractPdf(buffer: Buffer): Promise<RawExtraction> {
  let task: ReturnType<typeof getDocument> | undefined;
  try {
    task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, stopAtErrors: true });
    const pdf = await task.promise;
    if (pdf.numPages > PDF_LIMITS.pages) throw new DocumentImportError(`PDF has more than ${PDF_LIMITS.pages} pages.`, 413, 'document_limit');
    const sections: ExtractedSection[] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent({ disableNormalization: false });
      const lines: { y: number; fontSize: number; chunks: { x: number; value: string }[] }[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const textItem = item as { str: string; transform: number[] };
        const value = textItem.str.trim();
        if (!value) continue;
        const x = textItem.transform[4], y = textItem.transform[5];
        const fontSize = Math.abs((textItem as typeof textItem & { height?: number }).height ?? Math.hypot(textItem.transform[0], textItem.transform[1]));
        let line = lines.find((candidate) => Math.abs(candidate.y - y) < 2);
        if (!line) { line = { y, fontSize, chunks: [] }; lines.push(line); }
        line.fontSize = Math.max(line.fontSize, fontSize);
        line.chunks.push({ x, value });
      }
      const ordered = lines.sort((a, b) => b.y - a.y).map((line) => ({ ...line, text: line.chunks.sort((a, b) => a.x - b.x).map((chunk) => chunk.value).join(' ') }));
      const pageText = ordered.map((line) => line.text).join('\n');
      characters += pageText.length;
      if (characters > PDF_LIMITS.textCharacters) throw new DocumentImportError('Extracted PDF text exceeds the processing limit.', 413, 'document_limit');
      if (pageText.trim()) {
        const sizes = ordered.map((line) => line.fontSize).filter((size) => size > 0).sort((a, b) => a - b);
        const bodySize = sizes[Math.floor(Math.max(0, sizes.length - 1) * 0.25)] ?? 0;
        const pageHeight = Math.abs(Number(page.view[3]) - Number(page.view[1]));
        const headingIndexes = new Set(ordered.map((line, index) => ({ line, index })).filter(({ line }) =>
          line.text.length <= 160 && line.y >= pageHeight * 0.6 && line.fontSize >= Math.max(bodySize * 1.25, bodySize + 2)
        ).map(({ index }) => index));
        let paragraphLines: string[] = [];
        const flushParagraph = () => { if (paragraphLines.length) sections.push({ kind: 'paragraph', text: paragraphLines.join('\n'), page: pageNumber }); paragraphLines = []; };
        ordered.forEach((line, index) => {
          if (headingIndexes.has(index)) { flushParagraph(); sections.push({ kind: 'heading', text: line.text, page: pageNumber, level: 1 }); }
          else paragraphLines.push(line.text);
        });
        flushParagraph();
      }
      if (pageNumber < pdf.numPages) sections.push({ kind: 'page-break', text: '', page: pageNumber });
      page.cleanup();
    }
    if (!sections.some((section) => section.text.trim())) throw new DocumentImportError('No readable PDF text was found. OCR is required for scanned or image-only PDFs.', 422, 'ocr_required');
    return { sourceType: 'pdf', sections, warnings: [] };
  } catch (error) {
    if (error instanceof DocumentImportError) throw error;
    throw new DocumentImportError('The PDF is malformed, encrypted, or cannot be read.', 422, 'document_unreadable');
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}
