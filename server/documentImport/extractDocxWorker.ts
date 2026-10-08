import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { DocumentImportError, type RawExtraction } from './types';

export const DOCX_EXTRACTION_TIMEOUT_MS = 15_000;

/** Runs untrusted synchronous ZIP/XML work behind a boundary that can be terminated. */
export function extractDocxInWorker(buffer: Buffer, timeoutMs = DOCX_EXTRACTION_TIMEOUT_MS): Promise<RawExtraction> {
  return new Promise((resolve, reject) => {
    const bytes = new Uint8Array(buffer);
    const worker = new Worker("require('tsx/cjs'); const { workerData } = require('node:worker_threads'); require(workerData.entry);", {
      eval: true,
      workerData: { bytes, entry: fileURLToPath(new URL('./docxWorker.ts', import.meta.url)) },
      transferList: [bytes.buffer],
    });
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        worker.terminate().then(
          () => reject(new DocumentImportError('Document extraction timed out.', 422, 'document_timeout')),
          () => reject(new DocumentImportError('Document extraction timed out and its worker could not be stopped cleanly.', 500, 'document_worker_failure')),
        );
      });
    }, timeoutMs);
    worker.once('message', (message: { ok: boolean; result?: RawExtraction; error?: { message: string; status: number; code: string } }) => {
      finish(() => {
        worker.terminate().then(() => {
          if (message.ok && message.result) resolve(message.result);
          else reject(new DocumentImportError(message.error?.message ?? 'The DOCX document could not be read.', message.error?.status ?? 422, message.error?.code ?? 'document_unreadable'));
        }, () => reject(new DocumentImportError('The DOCX extraction worker could not be stopped cleanly.', 500, 'document_worker_failure')));
      });
    });
    worker.once('error', () => finish(() => reject(new DocumentImportError('The DOCX extraction worker failed.', 422, 'document_unreadable'))));
    worker.once('exit', (code) => { if (code !== 0) finish(() => reject(new DocumentImportError('The DOCX extraction worker stopped unexpectedly.', 422, 'document_unreadable'))); });
  });
}
