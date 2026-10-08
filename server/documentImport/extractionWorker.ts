/**
 * Long-lived extraction worker (one per server process, see extractionPool.ts). PDF and DOCX
 * parsing run here, never on the HTTP thread, so a slow document cannot stall the server and
 * the pool can terminate it at a hard deadline.
 */
import { parentPort } from 'node:worker_threads';
import { extractPdf } from './extractPdf';
import { extractDocx } from './extractDocx';
import { DocumentImportError } from './types';

interface Job { id: number; type: 'pdf' | 'docx'; bytes: Uint8Array }

if (!parentPort) throw new Error('The extraction worker must run in a worker thread.');
const port = parentPort;

port.on('message', (job: Job) => {
  const buffer = Buffer.from(job.bytes);
  const work = job.type === 'pdf' ? extractPdf(buffer) : extractDocx(buffer);
  void work.then(
    (result) => port.postMessage({ id: job.id, ok: true, result }),
    (error: unknown) => port.postMessage({
      id: job.id,
      ok: false,
      error: error instanceof DocumentImportError
        ? { message: error.message, status: error.status, code: error.code }
        : { message: `The ${job.type.toUpperCase()} document is malformed or cannot be read.`, status: 422, code: 'document_unreadable' },
    }),
  );
});

// Libraries are loaded (the slow part on small instances): ready for jobs.
port.postMessage({ ready: true });
