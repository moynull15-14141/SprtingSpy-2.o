/** One disposable object in the configured R2 bucket; no database access. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { S3StorageProvider, s3ConfigFromEnv, signV4, EMPTY_PAYLOAD_SHA256 } from '../media/s3';

assert.equal(process.env.R2_LIVE_TEST, '1', 'Set R2_LIVE_TEST=1 to allow one disposable upload/delete.');
assert(process.env.R2_LIVE_TEST_BUCKET, 'Set R2_LIVE_TEST_BUCKET to confirm the intended bucket.');
assert.equal(process.env.R2_LIVE_TEST_BUCKET, process.env.MEDIA_S3_BUCKET, 'Test bucket confirmation must match MEDIA_S3_BUCKET.');
// Public delivery is configured separately. This placeholder only satisfies
// the normal startup validator for an authenticated S3 API exercise.
const config = s3ConfigFromEnv({ ...process.env, MEDIA_PUBLIC_BASE_URL: process.env.MEDIA_PUBLIC_BASE_URL || 'https://unused.example.invalid' }, 'r2');
const storage = new S3StorageProvider(config);
const now = new Date();
const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}/original.png`;
const body = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
let putAttempted = false;
try {
  await storage.healthCheck();
  console.log('PASS authenticated R2 bucket HEAD');
  putAttempted = true;
  await storage.put(key, body, 'image/png');
  assert.equal(await storage.exists(key), true);
  console.log('PASS conditional PUT and object HEAD');

  const url = new URL(`${config.endpoint}/${config.bucket}/${key}`);
  const date = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const headers = { host: url.host, 'x-amz-date': date, 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 };
  const authorization = signV4({ method: 'GET', url, headers, region: config.region, accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey });
  const response = await fetch(url, { headers: { 'x-amz-date': date, 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256, authorization }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, `Authenticated GET returned HTTP ${response.status}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  console.log('PASS authenticated GET returned identical image bytes');

  if (process.env.R2_LIVE_PUBLIC_BASE_URL) {
    const base = new URL(process.env.R2_LIVE_PUBLIC_BASE_URL);
    assert.equal(base.protocol, 'https:', 'Public media base must use HTTPS.');
    assert(!base.username && !base.password && !base.search && !base.hash, 'Public media base must not contain credentials, query or fragment.');
    const publicUrl = new URL(`${base.href.replace(/\/+$/, '')}/${key}`);
    let publicResponse: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      publicResponse = await fetch(publicUrl, { redirect: 'error', signal: AbortSignal.timeout(20_000), cache: 'no-store' });
      if (publicResponse.ok) break;
      await publicResponse.arrayBuffer();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(publicResponse?.status, 200, `Public GET returned HTTP ${publicResponse?.status}`);
    assert.equal(publicResponse.headers.get('content-type')?.split(';')[0], 'image/png');
    assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()), body);
    console.log('PASS unauthenticated public GET returned identical image bytes');
  }
} finally {
  if (putAttempted) {
    await storage.delete(key);
    assert.equal(await storage.exists(key), false);
    console.log('PASS disposable object deleted');
  }
}
