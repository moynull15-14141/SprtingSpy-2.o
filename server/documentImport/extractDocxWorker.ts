import { EXTRACTION_TIMEOUT_MS, extractInWorker } from './extractionPool';
import type { RawExtraction } from './types';

export const DOCX_EXTRACTION_TIMEOUT_MS = EXTRACTION_TIMEOUT_MS;

/** Runs untrusted ZIP/XML parsing in the shared extraction worker, terminated at a hard deadline. */
export function extractDocxInWorker(buffer: Buffer, timeoutMs = DOCX_EXTRACTION_TIMEOUT_MS): Promise<RawExtraction> {
  return extractInWorker('docx', buffer, timeoutMs);
}

/** Runs pdf.js parsing in the shared extraction worker (never on the HTTP thread), terminated at a hard deadline. */
export function extractPdfInWorker(buffer: Buffer, timeoutMs = EXTRACTION_TIMEOUT_MS): Promise<RawExtraction> {
  return extractInWorker('pdf', buffer, timeoutMs);
}
