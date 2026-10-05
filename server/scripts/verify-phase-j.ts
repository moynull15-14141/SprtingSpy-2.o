/** Phase J regression checks. No database writes, migrations or credentials printed.
 * Set PHASE_J_BASE_URL to additionally inspect a running production/staging build.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { deploymentConfig } from '../deployment';
import { LocalStorageProvider } from '../media/storage';
import { EMPTY_PAYLOAD_SHA256, S3StorageProvider, s3ConfigFromEnv, signV4 } from '../media/s3';
import { robotsTxt } from '../seo/robots';
import { productionCsp } from '../securityHeaders';
import { profileImageOrigins, validateProfileImageUrl } from '../profileImage';

let checks = 0;
const pass = (name: string) => { checks++; console.log(`PASS ${name}`); };
const production: NodeJS.ProcessEnv = { NODE_ENV: 'production', APP_ENV: 'production', DATABASE_URL: 'postgresql://fixture:fixture@db.example.invalid/sportingspy', ALLOWED_ORIGIN: 'https://www.sportingspy.com', HOST: '127.0.0.1', TRUST_PROXY: '127.0.0.1/32' };
assert.equal(deploymentConfig(production, true).production, true);
for (const patch of [
  { DATABASE_URL: '' }, { DATABASE_URL: 'postgresql://USER:PASSWORD@localhost/db' },
  { DATABASE_URL: 'postgresql://fixture:fixture@db.example.invalid/sportingspy_dev' },
  { DATABASE_URL: 'file:dev.db' }, { ALLOWED_ORIGIN: '' },
  { ALLOWED_ORIGIN: 'http://public.example' }, { ALLOWED_ORIGIN: 'https://public.example/path' }, { ALLOWED_ORIGIN: 'https://sportingspy.com' },
  { DEV_LOGIN_BYPASS: 'true' }, { ALLOW_DESTRUCTIVE_DB_OPS: 'true' },
  { SHADOW_DATABASE_URL: 'postgresql://fixture:fixture@db.example.invalid/shadow' },
  { PORT: '0' }, { HOST: 'public.example' }, { TRUST_PROXY: 'true' },
  { TRUST_PROXY: '1' }, { TRUST_PROXY: '0.0.0.0/0' }, { APP_ENV: 'typo' }, { APP_ENV: 'development' },
]) assert.throws(() => deploymentConfig({ ...production, ...patch }, true));
assert.throws(() => deploymentConfig(production, false), /build missing/);
assert.throws(() => deploymentConfig({ NODE_ENV: 'development', APP_ENV: 'staging' }, true), /requires NODE_ENV/);
assert.equal(deploymentConfig({ ...production, APP_ENV: 'staging' }, true).appEnv, 'staging');
assert.match(robotsTxt('https://staging.example', 'staging'), /Disallow: \//);
assert(!robotsTxt('https://staging.example', 'staging').includes('Sitemap:'));
pass('production/staging startup, database target, proxy, HTTPS, build and shadow-database guards');

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sportingspy-phase-j-'));
const key = '2026/09/12345678-1234-1234-1234-123456789abc/original.jpg';
try {
  const local = new LocalStorageProvider(temp);
  await local.healthCheck();
  assert.deepEqual(await fs.readdir(temp), [], 'readiness removes its probe');
  await local.put(key, Buffer.from('fixture'));
  assert.equal(await local.exists(key), true);
  await assert.rejects(local.put(key, Buffer.from('overwrite')), /EEXIST/);
  await assert.rejects(local.put('../outside.jpg', Buffer.from('fixture')), /Invalid media/);
  await local.delete(key);
  assert.equal(await local.exists(key), false);
  pass('persistent local media write readiness, cleanup, immutable writes and traversal protection');
} finally {
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sportingspy-phase-j-'));
  await fs.rm(temp, { recursive: true, force: true });
}

const s3Env: NodeJS.ProcessEnv = { NODE_ENV: 'test', MEDIA_S3_BUCKET: 'fixture-bucket', MEDIA_S3_REGION: 'auto', MEDIA_S3_ACCESS_KEY_ID: 'fixture-access', MEDIA_S3_SECRET_ACCESS_KEY: 'fixture-secret', MEDIA_S3_ENDPOINT: 'https://objects.example', MEDIA_PUBLIC_BASE_URL: 'https://cdn.example/media', MEDIA_S3_FORCE_PATH_STYLE: 'true', MEDIA_S3_SESSION_TOKEN: 'fixture-session' };
const config = s3ConfigFromEnv(s3Env);
assert.deepEqual(s3ConfigFromEnv(s3Env, 'r2'), config, 'R2 uses the existing S3 adapter');
for (const patch of [
  { MEDIA_S3_ENDPOINT: '' }, { MEDIA_S3_REGION: 'us-east-1' }, { MEDIA_S3_FORCE_PATH_STYLE: 'false' },
]) assert.throws(() => s3ConfigFromEnv({ ...s3Env, ...patch }, 'r2'));
pass('R2 alias reuses S3 and requires its HTTPS endpoint, auto region and path-style URLs');

const profileEnv: NodeJS.ProcessEnv = { NODE_ENV: 'test', MEDIA_PUBLIC_BASE_URL: 'https://media.example.test/assets', PROFILE_IMAGE_ALLOWED_ORIGINS: 'https://avatars.example.test' };
assert(profileImageOrigins(profileEnv).includes('https://media.example.test'));
for (const src of ['https://avatars.example.test/person.jpg', 'https://media.example.test/assets/person.jpg', '/media/person.jpg', '']) {
  assert.equal(validateProfileImageUrl(src, 'avatar', profileEnv), null);
}
for (const src of ['http://avatars.example.test/person.jpg', 'https://unknown.example.test/person.jpg', 'javascript:alert(1)', '//unknown.example.test/person.jpg', 'https://user:pass@avatars.example.test/person.jpg']) {
  assert(validateProfileImageUrl(src, 'avatar', profileEnv));
}
assert.throws(() => profileImageOrigins({ NODE_ENV: 'test', PROFILE_IMAGE_ALLOWED_ORIGINS: 'https://avatars.example.test/path' }));
const oldImageEnv = { MEDIA_PUBLIC_BASE_URL: process.env.MEDIA_PUBLIC_BASE_URL, PROFILE_IMAGE_ALLOWED_ORIGINS: process.env.PROFILE_IMAGE_ALLOWED_ORIGINS };
try {
  process.env.MEDIA_PUBLIC_BASE_URL = profileEnv.MEDIA_PUBLIC_BASE_URL;
  process.env.PROFILE_IMAGE_ALLOWED_ORIGINS = profileEnv.PROFILE_IMAGE_ALLOWED_ORIGINS;
  const csp = productionCsp('fixture');
  assert(csp.includes('https://media.example.test') && csp.includes('https://avatars.example.test'));
  assert(!csp.includes('img-src https:') && !csp.includes('img-src *'));
} finally {
  for (const [key, value] of Object.entries(oldImageEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}
pass('profile URL policy permits configured HTTPS, R2 and local images; blocks invalid hosts with strict CSP');
// Public AWS example credentials (not deployment secrets). Official reference:
// https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html
const awsExample = {
  method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
  headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 },
  region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};
assert.equal(signV4(awsExample).split('Signature=')[1], 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41', 'AWS GET Object reference signature');
assert.equal(signV4({ ...awsExample, url: new URL('https://examplebucket.s3.amazonaws.com/?prefix=J&max-keys=2'), headers: { host: awsExample.headers.host, 'x-amz-date': awsExample.headers['x-amz-date'], 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 } }).split('Signature=')[1], '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7', 'AWS List Objects reference signature with query ordering');
pass('SigV4 matches official AWS GET Object and List Objects known signatures');
for (const patch of [{ MEDIA_S3_SECRET_ACCESS_KEY: '' }, { MEDIA_S3_ENDPOINT: 'https://user:pass@objects.example' }, { MEDIA_S3_ENDPOINT: 'https://objects.example/path' }, { MEDIA_PUBLIC_BASE_URL: 'https://cdn.example?credential=bad' }, { MEDIA_PUBLIC_BASE_URL: 'http://cdn.example' }, { MEDIA_S3_REGION: 'bad/region' }, { MEDIA_S3_FORCE_PATH_STYLE: 'typo' }]) assert.throws(() => s3ConfigFromEnv({ ...s3Env, ...patch }));
const input = { method: 'HEAD', url: new URL('https://objects.example/fixture-bucket'), headers: { host: 'objects.example', 'x-amz-date': '20260929T000000Z', 'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256 }, ...config };
assert.match(signV4(input), /^AWS4-HMAC-SHA256 Credential=fixture-access\/20260929\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
assert.notEqual(signV4(input), signV4({ ...input, method: 'PUT' }), 'method must be signed');
assert.notEqual(signV4(input), signV4({ ...input, url: new URL('https://objects.example/another-bucket') }), 'target path must be signed');
const originalFetch = globalThis.fetch;
let status = 200;
const requests: { url: URL; init: RequestInit }[] = [];
try {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: new URL(String(url)), init: init! });
    return new Response(null, { status });
  }) as typeof fetch;
  const storage = new S3StorageProvider(config);
  await storage.healthCheck();
  await storage.put(key, Buffer.from('fixture'), 'image/jpeg');
  assert.equal(requests[0].url.href, 'https://objects.example/fixture-bucket');
  const put = requests[1];
  assert.equal(put.init.redirect, 'error');
  const headers = new Headers(put.init.headers);
  assert.equal(headers.get('if-none-match'), '*');
  assert.equal(headers.get('x-amz-security-token'), 'fixture-session');
  assert(headers.get('authorization')?.includes('x-amz-security-token'));
  status = 404; assert.equal(await storage.exists(key), false); await storage.delete(key);
  status = 503; await assert.rejects(storage.exists(key), /HTTP 503/); await assert.rejects(storage.healthCheck(), /HTTP 503/);
  status = 412; await assert.rejects(storage.put(key, Buffer.from('fixture'), 'image/jpeg'), /HTTP 412/);
  await assert.rejects(storage.delete('../escape.jpg'), /Invalid media/);
  pass('S3 configuration, signed requests, session tokens, immutable uploads and failures (mock transport)');
} finally { globalThis.fetch = originalFetch; }

const dbSource = await fs.readFile('server/db.ts', 'utf8');
assert(!/process\.on\(['"]SIG(?:INT|TERM)/.test(dbSource), 'database module must not terminate before server drains requests');
const serverSource = await fs.readFile('server.ts', 'utf8');
assert(serverSource.includes('assertProductionLaunchSafe(deployment)'));
assert(!/prisma\s+(?:migrate|db\s+push)|exec(?:Sync|FileSync)?\(/.test(serverSource));
assert(serverSource.includes("process.once('SIGTERM'"));
pass('server owns shutdown; production password guard preserved; startup does not execute migrations');

if (process.env.PHASE_J_BASE_URL) {
  const base = process.env.PHASE_J_BASE_URL.replace(/\/+$/, '');
  const live = await fetch(`${base}/api/health`);
  assert.equal(live.status, 200); assert.deepEqual(await live.json(), { status: 'ok' });
  assert(live.headers.get('x-request-id'));
  const ready = await fetch(`${base}/api/health/ready`);
  assert.equal(ready.status, 200); assert.deepEqual(await ready.json(), { status: 'ready', checks: { database: 'ok', storage: 'ok' } });
  if (process.env.PHASE_J_EXPECT_STAGING === '1') {
    assert.equal(ready.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.match(await (await fetch(`${base}/robots.txt`)).text(), /Disallow: \//);
  }
  pass('running instance liveness/readiness, request IDs and optional staging indexing protection');
} else console.log('SKIP runtime probes: set PHASE_J_BASE_URL to a running production/staging instance.');
console.log(`Phase J: ${checks} checks passed. Object-store provider infrastructure is not certified by mock tests.`);
