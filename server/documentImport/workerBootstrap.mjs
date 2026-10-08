// Worker-thread entry for document extraction. Worker threads do not inherit the main
// process's `--import tsx` loader, so it is registered here before loading the TypeScript worker.
import { workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
await import(workerData.entry);
