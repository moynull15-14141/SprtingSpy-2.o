// Worker-thread entry for document extraction.
//
// pdf.js is loaded here as plain JavaScript BEFORE the tsx loader is registered: run through
// tsx, its multi-megabyte bundles cost ~330 MB of memory instead of ~40 MB, which exceeded the
// memory of a small hosting instance (the server was killed and answered 502). Its parser
// ("worker") module is installed on globalThis.pdfjsWorker, so pdf.js uses it in-process
// instead of importing it later through the loader.
import { workerData } from 'node:worker_threads';
import 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.mjs';

globalThis.pdfjsWorker = pdfjsWorker;

// Worker threads do not inherit the main process's `--import tsx` loader; register it for our
// own TypeScript files (already-loaded modules such as pdf.js above are not re-compiled).
const { register } = await import('tsx/esm/api');
register();
await import(workerData.entry);
