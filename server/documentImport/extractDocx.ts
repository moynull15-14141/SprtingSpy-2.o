import { inflateRawSync } from 'node:zlib';
import { DocumentImportError, type ExtractedSection, type RawExtraction } from './types';

export const DOCX_LIMITS = { entries: 2_000, expandedBytes: 50 * 1024 * 1024, paragraphs: 10_000, tables: 100, rowsPerTable: 500, cellsPerRow: 100, textCharacters: 500_000 };

const decode = (value: string) => value.replace(/<w:(?:br|cr)\s*\/?\s*>/gi, '\n').replace(/<w:tab\s*\/?\s*>/gi, '\t').replace(/<[^>]+>/g, '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
  if (entity[0] === '#') return String.fromCodePoint(parseInt(entity.slice(entity[1]?.toLowerCase() === 'x' ? 2 : 1), entity[1]?.toLowerCase() === 'x' ? 16 : 10));
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[entity.toLowerCase()] ?? '';
});

interface ZipEntry { name: string; method: number; compressedSize: number; expandedSize: number; localOffset: number }

function inspectEntries(buffer: Buffer): ZipEntry[] {
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b || ![0x03, 0x05, 0x07].includes(buffer[2]) || ![0x04, 0x06, 0x08].includes(buffer[3])) throw new DocumentImportError('The DOCX signature is invalid.', 415, 'type_mismatch');
  let offset = 0, entries = 0, expanded = 0;
  const entriesFound: ZipEntry[] = [];
  while ((offset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), offset)) !== -1) {
    if (offset + 46 > buffer.length) break;
    entries++; expanded += buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (name.includes('../') || name.startsWith('/') || name.includes('\u0000')) throw new DocumentImportError('DOCX contains an unsafe package path.', 415, 'document_unreadable');
    entriesFound.push({ name, method: buffer.readUInt16LE(offset + 10), compressedSize: buffer.readUInt32LE(offset + 20), expandedSize: buffer.readUInt32LE(offset + 24), localOffset: buffer.readUInt32LE(offset + 42) });
    offset += 46 + nameLength + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (entries > DOCX_LIMITS.entries || expanded > DOCX_LIMITS.expandedBytes) throw new DocumentImportError('DOCX expanded content exceeds the processing limit.', 413, 'document_limit');
  }
  const names = entriesFound.map((entry) => entry.name);
  if (!names.includes('[Content_Types].xml') || !names.includes('word/document.xml')) throw new DocumentImportError('The file is not a valid DOCX document.', 415, 'type_mismatch');
  return entriesFound;
}

export function inspectDocx(buffer: Buffer): void {
  inspectEntries(buffer);
}

function readEntry(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.localOffset + 30 > buffer.length || buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) throw new DocumentImportError('DOCX package data is malformed.', 422, 'document_unreadable');
  const start = entry.localOffset + 30 + buffer.readUInt16LE(entry.localOffset + 26) + buffer.readUInt16LE(entry.localOffset + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new DocumentImportError('DOCX package data is truncated.', 422, 'document_unreadable');
  const data = buffer.subarray(start, end);
  let output: Buffer;
  if (entry.method === 0) output = Buffer.from(data);
  else if (entry.method === 8) output = inflateRawSync(data, { maxOutputLength: Math.min(entry.expandedSize + 1, DOCX_LIMITS.expandedBytes) });
  else throw new DocumentImportError('DOCX uses an unsupported compression method.', 422, 'document_unreadable');
  if (output.length !== entry.expandedSize) throw new DocumentImportError('DOCX package size metadata is inconsistent.', 422, 'document_unreadable');
  return output;
}

export async function extractDocx(buffer: Buffer): Promise<RawExtraction> {
  try {
    const entries = inspectEntries(buffer);
    const documentEntry = entries.find((entry) => entry.name === 'word/document.xml')!;
    const xml = readEntry(buffer, documentEntry).toString('utf8');
    const sections: ExtractedSection[] = [];
    let paragraph = 0, tableNumber = 0;
    const block = /<w:(p|tbl)\b[^>]*>([\s\S]*?)<\/w:\1>/gi;
    for (const match of xml.matchAll(block)) {
      if (match[1] === 'tbl') {
        if (++tableNumber > DOCX_LIMITS.tables) throw new DocumentImportError('DOCX has too many tables.', 413, 'document_limit');
        const rows = [...match[2].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/gi)].slice(0, DOCX_LIMITS.rowsPerTable + 1);
        if (rows.length > DOCX_LIMITS.rowsPerTable) throw new DocumentImportError('A DOCX table has too many rows.', 413, 'document_limit');
        const values = rows.map((row) => [...row[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/gi)].map((cell) => decode(cell[1]).trim()));
        if (values.some((row) => row.length > DOCX_LIMITS.cellsPerRow)) throw new DocumentImportError('A DOCX table has too many cells.', 413, 'document_limit');
        sections.push({ kind: 'table', text: values.map((row) => row.join(' | ')).join('\n'), rows: values, table: tableNumber });
      } else {
        if (++paragraph > DOCX_LIMITS.paragraphs) throw new DocumentImportError('DOCX has too many paragraphs.', 413, 'document_limit');
        const style = match[2].match(/<w:pStyle\b[^>]*w:val=["']([^"']+)["']/i)?.[1] ?? '';
        const heading = style.match(/^Heading\s*([1-6])$/i);
        const isTitle = /^Title$/i.test(style);
        sections.push({ kind: heading || isTitle ? 'heading' : 'paragraph', text: decode(match[2]), paragraph, ...(heading || isTitle ? { level: isTitle ? 1 : Number(heading![1]) } : {}) });
      }
    }
    const characters = sections.reduce((sum, section) => sum + section.text.length, 0);
    if (characters > DOCX_LIMITS.textCharacters) throw new DocumentImportError('Extracted DOCX text exceeds the processing limit.', 413, 'document_limit');
    if (!sections.some((section) => section.text.trim())) throw new DocumentImportError('The DOCX document contains no readable text.', 422, 'document_empty');
    return { sourceType: 'docx', sections, warnings: [] };
  } catch (error) {
    if (error instanceof DocumentImportError) throw error;
    throw new DocumentImportError('The DOCX document is malformed or cannot be read.', 422, 'document_unreadable');
  }
}
