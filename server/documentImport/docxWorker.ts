import { parentPort, workerData } from 'node:worker_threads';
import { extractDocx } from './extractDocx';
import { DocumentImportError } from './types';

interface WorkerInput { bytes: Uint8Array }

if (!parentPort) throw new Error('DOCX worker must run in a worker thread.');

void extractDocx(Buffer.from((workerData as WorkerInput).bytes)).then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error: unknown) => {
    const known = error instanceof DocumentImportError;
    parentPort.postMessage({
      ok: false,
      error: known
        ? { message: error.message, status: error.status, code: error.code }
        : { message: 'The DOCX document is malformed or cannot be read.', status: 422, code: 'document_unreadable' },
    });
  },
);
