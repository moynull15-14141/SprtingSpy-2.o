/**
 * One reusable extraction worker per server process.
 *
 * - PDF and DOCX parsing run off the HTTP thread, so a large document never stalls other
 *   requests (a blocked event loop showed up on Render as 502s and extraction timeouts).
 * - The worker loads tsx and pdf.js once and is reused; on a small instance that startup takes
 *   several seconds and used to be paid by every DOCX request and counted against its deadline.
 * - The per-document deadline (EXTRACTION_TIMEOUT_MS) covers parsing only. At the deadline the
 *   worker is terminated (the only way to stop runaway parsing) and the next job starts a new one.
 * - Jobs run one at a time; a short queue is allowed, beyond that callers get "busy".
 * - An idle worker exits after a few minutes, so it holds no memory when unused.
 */
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DocumentImportError, type RawExtraction } from './types';

export const EXTRACTION_TIMEOUT_MS = 15_000;
const STARTUP_TIMEOUT_MS = 60_000;
const IDLE_SHUTDOWN_MS = 5 * 60_000;
const MAX_QUEUED = 4;
const WORKER_MEMORY_MB = 256;

type Kind = 'pdf' | 'docx';
interface Reply { id?: number; ready?: boolean; ok?: boolean; result?: RawExtraction; error?: { message: string; status: number; code: string } }

let worker: Worker | null = null;
let ready: Promise<Worker> | null = null;
let current: { id: number; reject: (error: Error) => void } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 1;
let queued = 0;
let tail: Promise<unknown> = Promise.resolve();

const entry = pathToFileURL(fileURLToPath(new URL('./extractionWorker.ts', import.meta.url))).href;

function discard(target: Worker, reason: DocumentImportError) {
  if (worker === target) { worker = null; ready = null; }
  if (current) { const job = current; current = null; job.reject(reason); }
  void target.terminate().catch(() => undefined);
}

function startWorker(): Promise<Worker> {
  if (ready) return ready;
  const w = new Worker(new URL('./workerBootstrap.mjs', import.meta.url), { workerData: { entry }, resourceLimits: { maxOldGenerationSizeMb: WORKER_MEMORY_MB } });
  w.unref();
  worker = w;
  ready = new Promise<Worker>((resolve, reject) => {
    const timer = setTimeout(() => { discard(w, new DocumentImportError('The document extractor could not start in time. Try again.', 503, 'extractor_unavailable')); reject(new DocumentImportError('The document extractor could not start in time. Try again.', 503, 'extractor_unavailable')); }, STARTUP_TIMEOUT_MS);
    w.once('message', (m: Reply) => { if (m.ready) { clearTimeout(timer); resolve(w); } });
    w.once('error', (error: Error & { code?: string }) => {
      clearTimeout(timer);
      const reason = error.code === 'ERR_WORKER_OUT_OF_MEMORY'
        ? new DocumentImportError('The document is too large to process.', 413, 'document_limit')
        : new DocumentImportError('The document extractor failed. Try again.', 422, 'document_unreadable');
      discard(w, reason);
      reject(reason);
    });
    w.once('exit', () => {
      clearTimeout(timer);
      const reason = new DocumentImportError('The document extractor stopped unexpectedly. Try again.', 422, 'document_unreadable');
      if (worker === w) { worker = null; ready = null; }
      if (current) { const job = current; current = null; job.reject(reason); }
      reject(reason);
    });
  });
  ready.catch(() => undefined);
  return ready;
}

async function run(kind: Kind, buffer: Buffer, timeoutMs: number): Promise<RawExtraction> {
  clearTimeout(idleTimer);
  const w = await startWorker();
  const id = nextId++;
  try {
    return await new Promise<RawExtraction>((resolve, reject) => {
      const finish = () => { clearTimeout(timer); w.off('message', onMessage); current = null; };
      const onMessage = (m: Reply) => {
        if (m.id !== id) return;
        finish();
        if (m.ok && m.result) resolve(m.result);
        else reject(new DocumentImportError(m.error?.message ?? 'The document could not be read.', m.error?.status ?? 422, m.error?.code ?? 'document_unreadable'));
      };
      // discard() (deadline, crash, out of memory) rejects the running job through this.
      current = { id, reject: (error) => { finish(); reject(error); } };
      const timer = setTimeout(() => discard(w, new DocumentImportError('Document extraction timed out.', 422, 'document_timeout')), timeoutMs);
      w.on('message', onMessage);
      const bytes = new Uint8Array(buffer);
      w.postMessage({ id, type: kind, bytes }, [bytes.buffer]);
    });
  } finally {
    idleTimer = setTimeout(() => { const idle = worker; if (idle && !current) { worker = null; ready = null; void idle.terminate().catch(() => undefined); } }, IDLE_SHUTDOWN_MS);
    idleTimer.unref();
  }
}

/** Extracts a PDF or DOCX in the shared worker. Jobs run one at a time. */
export function extractInWorker(kind: Kind, buffer: Buffer, timeoutMs = EXTRACTION_TIMEOUT_MS): Promise<RawExtraction> {
  if (queued >= MAX_QUEUED) return Promise.reject(new DocumentImportError('The document extractor is busy. Try again in a moment.', 503, 'extractor_busy'));
  queued++;
  const job = tail.then(() => run(kind, buffer, timeoutMs));
  tail = job.catch(() => undefined);
  return job.finally(() => { queued--; });
}

/** Stops the worker (tests and shutdown). */
export async function stopExtractionWorker(): Promise<void> {
  clearTimeout(idleTimer);
  const w = worker; worker = null; ready = null;
  if (w) await w.terminate().catch(() => undefined);
}
