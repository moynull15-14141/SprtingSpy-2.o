/**
 * PHASE R (deployment): copies every locally stored media object (originals,
 * responsive sizes, ad creatives) to the configured R2/S3 bucket under the
 * SAME key, so existing database rows keep working when production switches
 * to MEDIA_STORAGE_PROVIDER=r2. Never overwrites (conditional PUT), never
 * deletes local files, never touches the database. Each object is read back
 * through the public media URL and compared byte for byte (SHA-256).
 * A manifest is written to backups/ (git-ignored).
 *
 *   MEDIA_COPY_TO_R2=1 MEDIA_COPY_BUCKET=<bucket> MEDIA_PUBLIC_BASE_URL=https://… npm run media:copy-to-r2
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { S3StorageProvider, s3ConfigFromEnv } from '../media/s3';

assert.equal(process.env.MEDIA_COPY_TO_R2, '1', 'Set MEDIA_COPY_TO_R2=1 to allow uploads to the bucket.');
assert(process.env.MEDIA_COPY_BUCKET && process.env.MEDIA_COPY_BUCKET === process.env.MEDIA_S3_BUCKET, 'MEDIA_COPY_BUCKET must equal MEDIA_S3_BUCKET (confirms the target bucket).');
const config = s3ConfigFromEnv(process.env, 'r2');
const storage = new S3StorageProvider(config);
const publicBase = process.env.MEDIA_PUBLIC_BASE_URL!.replace(/\/+$/, '');
const root = path.resolve(process.env.MEDIA_LOCAL_DIR || 'storage/media');
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };

const files: string[] = [];
const walk = (dir: string) => { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(dir, e.name); if (e.isDirectory()) walk(p); else files.push(p); } };
walk(root);
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

await storage.healthCheck();
const manifest: { key: string; bytes: number; sha256: string; contentType: string; action: 'uploaded' | 'already-present'; publicUrl: string; verified: boolean }[] = [];
for (const file of files) {
  const key = path.relative(root, file).split(path.sep).join('/');
  const data = fs.readFileSync(file);
  const contentType = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  let action: 'uploaded' | 'already-present' = 'already-present';
  if (!(await storage.exists(key))) { await storage.put(key, data, contentType); action = 'uploaded'; }
  const publicUrl = `${publicBase}/${key}`;
  const res = await fetch(publicUrl, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
  const verified = res.ok && sha(Buffer.from(await res.arrayBuffer())) === sha(data) && (res.headers.get('content-type') || '').startsWith(contentType.split(';')[0]);
  manifest.push({ key, bytes: data.length, sha256: sha(data), contentType, action, publicUrl, verified });
  console.log(`${verified ? 'OK ' : 'BAD'} ${action.padEnd(15)} ${key}`);
}
fs.mkdirSync('backups', { recursive: true });
const out = `backups/media-r2-manifest-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(out, JSON.stringify({ bucket: config.bucket, publicBase, at: new Date().toISOString(), objects: manifest }, null, 2));
const bad = manifest.filter((m) => !m.verified);
console.log(`\n${manifest.length} object(s): ${manifest.filter((m) => m.action === 'uploaded').length} uploaded, ${manifest.filter((m) => m.action === 'already-present').length} already present, ${bad.length} failed verification. Manifest: ${out}`);
if (bad.length) process.exitCode = 1;
