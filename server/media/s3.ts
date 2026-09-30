/**
 * S3-compatible media storage (PHASE J): AWS S3, Cloudflare R2, Backblaze B2,
 * MinIO and other S3-API services, behind the existing MediaStorageProvider
 * interface. Requests are signed with AWS Signature Version 4 using
 * node:crypto and sent with fetch — no SDK dependency.
 *
 * Objects are written with long-lived immutable caching (keys are unique per
 * upload, so an object never changes). Visitors fetch files from
 * MEDIA_PUBLIC_BASE_URL (the bucket's public domain or a CDN in front of it),
 * never through this server.
 */

import crypto from 'node:crypto';
import { assertValidKey, type MediaStorageProvider } from './storage';

export interface S3Config {
  bucket: string;
  region: string;
  /** e.g. https://<account>.r2.cloudflarestorage.com ; default https://s3.<region>.amazonaws.com */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Path-style URLs (endpoint/bucket/key) instead of virtual-hosted (bucket.endpoint/key). */
  forcePathStyle?: boolean;
  /** Required when the provider issues temporary session credentials. */
  sessionToken?: string;
}

const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data).digest();
/** RFC 3986 encoding of one path segment, as SigV4 requires. */
const encodeSegment = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const EMPTY_PAYLOAD_SHA256 = sha256('');

/**
 * AWS Signature Version 4 for S3. Returns the Authorization header value.
 * `headers` must already contain host, x-amz-date and x-amz-content-sha256;
 * every header passed here is signed.
 */
export function signV4(input: { method: string; url: URL; headers: Record<string, string>; region: string; accessKeyId: string; secretAccessKey: string; service?: string }): string {
  const service = input.service ?? 's3';
  const amzDate = input.headers['x-amz-date'];
  const day = amzDate.slice(0, 8);
  const names = Object.keys(input.headers).map((h) => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v]));
  const canonicalHeaders = names.map((n) => `${n}:${String(lower[n]).trim().replace(/\s+/g, ' ')}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeSegment(k), encodeSegment(v)])
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalRequest = [input.method, input.url.pathname || '/', canonicalQuery, canonicalHeaders, signedHeaders, lower['x-amz-content-sha256']].join('\n');
  const scope = `${day}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), service), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

export class S3StorageProvider implements MediaStorageProvider {
  readonly name = 's3';
  readonly localRoot = null;

  constructor(private readonly config: S3Config) {}

  /** Object (or, with no key, bucket) URL. */
  private url(key?: string): URL {
    const endpoint = new URL(this.config.endpoint || `https://s3.${this.config.region}.amazonaws.com`);
    const path = key ? `/${key.split('/').map(encodeSegment).join('/')}` : '/';
    if (this.config.forcePathStyle) return new URL(`${endpoint.origin}/${encodeSegment(this.config.bucket)}${key ? path : ''}`);
    return new URL(`${endpoint.protocol}//${this.config.bucket}.${endpoint.host}${path}`);
  }

  private async send(method: 'PUT' | 'DELETE' | 'HEAD', url: URL, body?: Buffer, extra: Record<string, string> = {}): Promise<Response> {
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const headers: Record<string, string> = { host: url.host, 'x-amz-date': amzDate, 'x-amz-content-sha256': body ? sha256(body) : EMPTY_PAYLOAD_SHA256, ...(this.config.sessionToken ? { 'x-amz-security-token': this.config.sessionToken } : {}), ...extra };
    const authorization = signV4({ method, url, headers, region: this.config.region, accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey });
    const { host: _host, ...sendHeaders } = headers; // fetch sets Host itself
    // Do not forward signed headers or credentials to a redirected endpoint.
    return fetch(url, { method, headers: { ...sendHeaders, authorization }, body: body ? new Uint8Array(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    assertValidKey(key);
    const res = await this.send('PUT', this.url(key), data, { 'content-type': contentType, 'cache-control': 'public, max-age=31536000, immutable', 'if-none-match': '*' });
    if (!res.ok) throw new Error(`Object storage rejected the upload (HTTP ${res.status}).`);
  }

  async delete(key: string): Promise<void> {
    assertValidKey(key);
    const res = await this.send('DELETE', this.url(key));
    if (!res.ok && res.status !== 404) throw new Error(`Object storage rejected the delete (HTTP ${res.status}).`);
  }

  async exists(key: string): Promise<boolean> {
    assertValidKey(key);
    const res = await this.send('HEAD', this.url(key));
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`Object storage check failed (HTTP ${res.status}).`);
    return true;
  }

  /** Readiness: the bucket answers an authenticated HeadBucket. */
  async healthCheck(): Promise<void> {
    const res = await this.send('HEAD', this.url());
    if (!res.ok) throw new Error(`Object storage bucket check failed (HTTP ${res.status}).`);
  }
}

/** Reads S3 settings from the environment; throws a clear message when incomplete. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const missing = ['MEDIA_S3_BUCKET', 'MEDIA_S3_REGION', 'MEDIA_S3_ACCESS_KEY_ID', 'MEDIA_S3_SECRET_ACCESS_KEY'].filter((k) => !env[k]?.trim());
  if (missing.length) throw new Error(`MEDIA_STORAGE_PROVIDER=s3 needs ${missing.join(', ')}.`);
  const publicBase = env.MEDIA_PUBLIC_BASE_URL?.trim();
  const validHttpsUrl = (value: string | undefined, originOnly = false): boolean => {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !url.search && !url.hash && (!originOnly || url.pathname === '/');
    } catch { return false; }
  };
  if (!validHttpsUrl(publicBase)) {
    throw new Error('MEDIA_STORAGE_PROVIDER=s3 needs MEDIA_PUBLIC_BASE_URL set to the https:// public URL of the bucket or its CDN (media is not served by this server).');
  }
  const endpoint = env.MEDIA_S3_ENDPOINT?.trim();
  if (endpoint && !validHttpsUrl(endpoint, true)) throw new Error('MEDIA_S3_ENDPOINT must be an https:// origin (no path, credentials, query or fragment).');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.MEDIA_S3_BUCKET!.trim())) throw new Error('MEDIA_S3_BUCKET is not a valid bucket name.');
  if (!/^[a-z0-9-]+$/.test(env.MEDIA_S3_REGION!.trim())) throw new Error('MEDIA_S3_REGION is invalid.');
  if (env.MEDIA_S3_FORCE_PATH_STYLE && !['true', 'false'].includes(env.MEDIA_S3_FORCE_PATH_STYLE)) throw new Error('MEDIA_S3_FORCE_PATH_STYLE must be true or false.');
  return {
    bucket: env.MEDIA_S3_BUCKET!.trim(),
    region: env.MEDIA_S3_REGION!.trim(),
    endpoint: endpoint || undefined,
    accessKeyId: env.MEDIA_S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.MEDIA_S3_SECRET_ACCESS_KEY!.trim(),
    forcePathStyle: env.MEDIA_S3_FORCE_PATH_STYLE === 'true',
    sessionToken: env.MEDIA_S3_SESSION_TOKEN?.trim() || undefined,
  };
}
