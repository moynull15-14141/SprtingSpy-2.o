/**
 * Copies every object of the media bucket (R2/S3: originals, responsive
 * sizes, ad creatives) to a folder on this computer, under the SAME keys.
 * Read-only on the bucket: it only lists and downloads (signed GET).
 *
 *   npm run media:backup:live [-- --out <folder outside the repository>]
 *
 * - Default folder: SportingSpy-backups/media in the user's home folder.
 * - Incremental: an object already downloaded with the same size is skipped.
 *   Objects later deleted from the bucket stay in the backup.
 * - Verified: the size of every file, and its MD5 against the ETag when the
 *   object was uploaded in one part (all uploads from this project are).
 * - A manifest (.manifest.json) lists every key, size and ETag.
 *
 * Restore: point MEDIA_LOCAL_DIR at that folder and run
 * `npm run media:copy-to-r2` (it uploads under the same keys, never
 * overwrites, and verifies each object through the public URL).
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EMPTY_PAYLOAD_SHA256, s3ConfigFromEnv, signV4, type S3Config } from '../media/s3';

export interface MediaBackupResult { objects: number; downloaded: number; skipped: number; bytes: number; dir: string; notSaved: string[] }
interface Listed { key: string; size: number; etag: string }

const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const xmlText = (s: string) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function bucketUrl(config: S3Config, key?: string): URL {
  const endpoint = new URL(config.endpoint || `https://s3.${config.region}.amazonaws.com`);
  const keyPath = key ? `/${key.split('/').map(encodeSegment).join('/')}` : '/';
  if (config.forcePathStyle) return new URL(`${endpoint.origin}/${encodeSegment(config.bucket)}${key ? keyPath : ''}`);
  return new URL(`${endpoint.protocol}//${config.bucket}.${endpoint.host}${keyPath}`);
}

/** A signed GET (the only request this script sends). */
async function signedGet(config: S3Config, url: URL): Promise<Response> {
  const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256, ...(config.sessionToken ? { 'x-amz-security-token': config.sessionToken } : {}) };
  const authorization = signV4({ method: 'GET', url, headers, region: config.region, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
  const { host: _host, ...sendHeaders } = headers;
  return fetch(url, { method: 'GET', headers: { ...sendHeaders, authorization }, redirect: 'error', signal: AbortSignal.timeout(120_000) });
}

/** Every object in the bucket (ListObjectsV2, 1000 per page). */
async function listAll(config: S3Config): Promise<Listed[]> {
  const out: Listed[] = [];
  let token: string | undefined;
  do {
    const url = bucketUrl(config);
    url.searchParams.set('list-type', '2');
    url.searchParams.set('max-keys', '1000');
    if (token) url.searchParams.set('continuation-token', token);
    const res = await signedGet(config, url);
    if (!res.ok) throw new Error(`Listing the bucket failed (HTTP ${res.status}).`);
    const xml = await res.text();
    for (const block of xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []) {
      const field = (name: string) => xmlText(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? '');
      out.push({ key: field('Key'), size: Number(field('Size')), etag: field('ETag').replace(/"/g, '') });
    }
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/)?.[1] ?? '') || undefined : undefined;
  } while (token);
  return out;
}

export async function backupBucket(config: S3Config, dir: string, log: (line: string) => void = console.log): Promise<MediaBackupResult> {
  fs.mkdirSync(dir, { recursive: true });
  const objects = await listAll(config);
  let downloaded = 0; let skipped = 0; let bytes = 0;
  const notSaved: string[] = [];
  for (const [i, o] of objects.entries()) {
    // Every key is kept, but none may point outside the folder ("..", absolute paths, drive letters).
    if (!o.key || o.key.split('/').some((part) => !part || part === '.' || part === '..' || /[\\:]/.test(part))) throw new Error(`Refusing an unsafe object key: ${o.key}`);
    // Names Windows cannot store (this project's own uploads never use them): listed, not fatal.
    if (o.key.split('/').some((part) => /[<>"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part))) { notSaved.push(o.key); log(`[media-backup] Not saved (name not allowed on this computer): ${o.key}`); continue; }
    const file = path.join(dir, ...o.key.split('/'));
    if (!path.resolve(file).startsWith(path.resolve(dir) + path.sep)) throw new Error(`Refusing key outside the backup folder: ${o.key}`);
    bytes += o.size;
    if (fs.existsSync(file) && fs.statSync(file).size === o.size) { skipped++; continue; }
    const res = await signedGet(config, bucketUrl(config, o.key));
    if (!res.ok) throw new Error(`Downloading ${o.key} failed (HTTP ${res.status}).`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length !== o.size) throw new Error(`${o.key}: got ${data.length} bytes, the bucket lists ${o.size}.`);
    // A one-part upload's ETag is the MD5 of the object; multipart ETags contain "-".
    if (/^[0-9a-f]{32}$/i.test(o.etag) && crypto.createHash('md5').update(data).digest('hex') !== o.etag.toLowerCase()) throw new Error(`${o.key}: content does not match its ETag.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Dot-names are skipped by media:copy-to-r2, so a partial file or the manifest is never restored as media.
    const partial = path.join(path.dirname(file), `.${path.basename(file)}.part`);
    fs.writeFileSync(partial, data);
    fs.renameSync(partial, file);
    downloaded++;
    if (downloaded % 25 === 0) log(`[media-backup] ${i + 1}/${objects.length} checked, ${downloaded} downloaded…`);
  }
  fs.writeFileSync(path.join(dir, '.manifest.json'), JSON.stringify({ bucket: config.bucket, takenAt: new Date().toISOString(), objects: objects.map(({ key, size, etag }) => ({ key, size, etag })), notSaved }, null, 2));
  return { objects: objects.length, downloaded, skipped, bytes, dir, notSaved };
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : undefined;
  const dir = path.resolve(outArg ?? path.join(os.homedir(), 'SportingSpy-backups', 'media'));
  const relative = path.relative(process.cwd(), dir);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('The backup folder must be outside the repository.');
  const config = s3ConfigFromEnv(process.env, process.env.MEDIA_STORAGE_PROVIDER || 'r2');
  console.log(`[media-backup] Bucket "${config.bucket}" → ${dir} (read-only on the bucket).`);
  const r = await backupBucket(config, dir);
  console.log(`[media-backup] Done: ${r.objects} objects (${(r.bytes / 1048576).toFixed(1)} MB) — ${r.downloaded} downloaded now, ${r.skipped} already in the backup. Manifest: ${path.join(dir, '.manifest.json')}`);
  if (r.notSaved.length) { console.error(`[media-backup] WARNING: ${r.notSaved.length} object(s) could not be saved on this computer (listed in the manifest).`); process.exitCode = 2; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error(`[media-backup] ${err instanceof Error ? err.message : err}`); process.exit(1); });
}
