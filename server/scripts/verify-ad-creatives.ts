import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { mediaStorage } from '../media/storage';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe);
assert(fs.existsSync('.next/BUILD_ID'));
const prefix = `adtest-${crypto.randomUUID()}`;
const password = crypto.randomUUID();
const users = [prefix + '-admin', prefix + '-editor'];
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'adCreative', 'redirectRule', 'siteSetting', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog', 'siteExperience'];
const hash = (value: unknown) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshot = async () => {
  const out: Record<string, string> = {};
  for (const table of tables) { const rows = await (prisma as any)[table].findMany(); rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b))); out[table] = hash(rows); }
  return out;
};
const files = (root = path.resolve(process.env.MEDIA_LOCAL_DIR || 'storage/media')): string[] => !fs.existsSync(root) ? [] : fs.readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(root, e.name)) : [path.join(root, e.name)]).sort();
const before = await snapshot(), filesBefore = files();
const original = await prisma.adSlotConfig.findUniqueOrThrow({ where: { id: 'HOMEPAGE_TOP' } });
const assets: string[] = [];
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
const ready = new Promise<void>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Test server did not start. ' + output.slice(-2000))), 60000);
  child.stdout.on('data', b => { if (String(b).includes('Server running')) { clearTimeout(timer); resolve(); } });
  child.once('exit', () => { clearTimeout(timer); reject(new Error('Test server exited. ' + output.slice(-2000))); });
});
let checks = 0; const pass = (message: string) => { checks++; console.log('PASS ' + message); };
class Client {
  cookies = new Map<string, string>();
  async request(route: string, method = 'GET', body?: unknown, csrf = true) {
    const headers: Record<string, string> = { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (csrf && method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    if (!(body instanceof FormData)) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + route, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
    for (const c of res.headers.getSetCookie()) { const pair = c.split(';')[0], i = pair.indexOf('='); this.cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    const text = await res.text(); let data: any; try { data = JSON.parse(text); } catch { data = null; }
    return { status: res.status, text, data, headers: res.headers };
  }
  async upload(buffer: Buffer, name: string, mime: string, csrf = true) {
    const form = new FormData(); form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), name);
    const result = await this.request('/api/ad-creatives', 'POST', form, csrf);
    if (result.status === 201) assets.push(result.data.id);
    return result;
  }
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await ready;
  for (const [i, id] of users.entries()) await prisma.user.create({ data: { id, name: prefix, email: `${id}@example.test`, role: i ? 'Editor' : 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  const admin = new Client(), editor = new Client(), anon = new Client();
  for (const [client, id] of [[admin, users[0]], [editor, users[1]]] as const) { await client.request('/api/auth/me'); const login = await client.request('/api/auth/login', 'POST', { email: `${id}@example.test`, password }); assert.equal(login.status, 200, login.text); }
  assert.equal((await anon.request('/api/ad-creatives')).status, 401);
  assert.equal((await editor.request('/api/ad-creatives')).status, 403);
  const png = await sharp({ create: { width: 728, height: 90, channels: 3, background: '#126b43' } }).png().toBuffer();
  assert.equal((await admin.upload(png, 'x.png', 'image/png', false)).status, 403);
  assert.equal((await editor.upload(png, 'x.png', 'image/png')).status, 403);
  pass('ad media upload/library are Admin-only and uploads require CSRF');
  for (const [data, name, mime] of [[Buffer.from('<html>x</html>'), 'x.png', 'image/png'], [png, 'x.gif', 'image/gif'], [Buffer.from('fake'), 'x.mp4', 'video/mp4'], [png, 'x.svg', 'image/svg+xml'], [Buffer.alloc(26 * 1024 * 1024), 'x.gif', 'image/gif']] as const) assert((await admin.upload(data, name, mime)).status >= 400);
  assert.equal(await prisma.adCreative.count(), (await admin.request('/api/ad-creatives')).data.length);
  pass('fake media, extension/type mismatches, SVG and oversized uploads rejected without storing assets');
  const pngAsset = await admin.upload(png, 'banner.png', 'image/png'); assert.equal(pngAsset.status, 201, pngAsset.text);
  const jpeg = await sharp(png).jpeg().toBuffer();
  const jpgAsset = await admin.upload(jpeg, 'banner.jpeg', 'image/jpeg'); assert.equal(jpgAsset.status, 201, jpgAsset.text);
  const raw = Buffer.alloc(300 * 500 * 3); raw.fill(180, 0, raw.length / 2); raw.fill(60, raw.length / 2);
  const gif = await sharp(raw, { raw: { width: 300, height: 500, channels: 3, pageHeight: 250 } }).gif({ delay: [100, 150], loop: 0 }).toBuffer();
  const gifAsset = await admin.upload(gif, 'animated.gif', 'image/gif'); assert.equal(gifAsset.status, 201, gifAsset.text);
  const gifStored = await fetch(base + gifAsset.data.url); assert.equal(gifStored.headers.get('content-type'), 'image/gif');
  assert.equal((await sharp(Buffer.from(await gifStored.arrayBuffer()), { animated: true }).metadata()).pages, 2);
  pass('PNG/JPEG and animated GIF upload; GIF frames remain animated; server serves correct MIME');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([...admin.cookies].map(([name, value]) => ({ name, value, url: base })));
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/admin/'); await page.getByRole('button', { name: 'Ad Placements', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'HOMEPAGE_TOP' }).getByRole('button', { name: 'Configure', exact: true }).click();
  const chooser = page.getByRole('button', { name: 'Choose media from computer', exact: true });
  const [fileChooser] = await Promise.all([page.waitForEvent('filechooser'), chooser.click()]);
  await fileChooser.setFiles({ name: 'browser-upload.png', mimeType: 'image/png', buffer: png });
  const [uploaded] = await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/ad-creatives') && r.request().method() === 'POST'), page.getByRole('button', { name: 'Upload & select', exact: true }).click()]);
  assert.equal(uploaded.status(), 201); const uploadedAsset = await uploaded.json(); assets.push(uploadedAsset.id);
  await page.getByRole('textbox', { name: 'Ad media description / alt text', exact: true }).fill('Sponsor PNG banner');
  await page.getByRole('combobox', { name: 'Media fit', exact: true }).selectOption('cover');
  await page.getByRole('button', { name: 'Save Slot Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save Slot Settings', exact: true }).waitFor({ state: 'hidden' });
  const saved = await prisma.adSlotConfig.findUniqueOrThrow({ where: { id: original.id } });
  assert.equal(saved.creativeId, uploadedAsset.id); assert.equal(saved.creativeAlt, 'Sponsor PNG banner'); assert.equal(saved.creativeFit, 'cover');
  await page.reload(); await page.getByRole('button', { name: 'Ad Placements', exact: true }).click(); await page.getByRole('row').filter({ hasText: original.id }).getByRole('button', { name: 'Configure', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: 'Choose uploaded ad media', exact: true }).inputValue(), uploadedAsset.id);
  await page.screenshot({ path: 'verification/ad-creatives/admin-desktop.png' }).catch(async () => { fs.mkdirSync('verification/ad-creatives', { recursive: true }); await page.screenshot({ path: 'verification/ad-creatives/admin-desktop.png' }); });
  await page.setViewportSize({ width: 390, height: 844 }); await chooser.scrollIntoViewIfNeeded();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  pass('Chrome native computer file chooser, upload/select, alt/fit, Save and reload; mobile without overflow');
  const fixtureVideo = async (ext: string) => {
    const folder = path.resolve('.codex-runtime/ad-fixtures'); fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `flower.${ext}`);
    if (!fs.existsSync(target)) {
      const response = await fetch(`https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.${ext}`);
      assert.equal(response.status, 200); fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
    }
    return fs.readFileSync(target);
  };
  const webm = await fixtureVideo('webm');
  const video = await admin.upload(webm, 'short.webm', 'video/webm'); assert.equal(video.status, 201, video.text); assert(video.data.durationSeconds > 0);
  {
    const mp4 = await fixtureVideo('mp4');
    const mp4Asset = await admin.upload(mp4, 'short.mp4', 'video/mp4'); assert.equal(mp4Asset.status, 201, mp4Asset.text);
  }
  pass('real short WebM and H.264 MP4 are validated by ffprobe and uploaded');
  for (const body of [{ creativeId: 'missing', creativeAlt: 'x' }, { creativeFit: 'stretch' }, { creativeId: video.data.id, creativeAlt: '' }, { creative: { url: 'javascript:x' } }]) assert.equal((await admin.request('/api/ads/' + original.id, 'PUT', body)).status, 400);
  assert.equal((await editor.request('/api/ads/' + original.id, 'PUT', { creativeId: video.data.id, creativeAlt: 'x' })).status, 403);
  pass('invalid creative references, nested URL injection, invalid fit, missing description and Editor writes rejected');
  for (const item of [gifAsset.data, video.data]) {
    assert.equal((await admin.request('/api/ads/' + original.id, 'PUT', { enabled: true, provider: 'house', creativeId: item.id, creativeAlt: 'Sponsor creative', creativeFit: 'contain', linkUrl: 'https://example.com/sponsor' })).status, 200);
    const publicContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const publicPage = await publicContext.newPage(); await publicPage.goto(base + '/');
    const media = publicPage.locator(`[data-ad-creative="${item.id}"]`); await media.waitFor();
    if (item.kind === 'video') { assert(await media.locator('video[controls][muted]').count()); await media.locator('video').evaluate(async (video: HTMLVideoElement) => { await video.play(); video.pause(); }); }
    else { assert.equal(await media.locator('a').getAttribute('href'), 'https://example.com/sponsor'); assert(await media.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)); }
    assert(await publicPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal((await admin.request('/api/ad-creatives/' + item.id, 'DELETE')).status, 409, 'used media protected');
    await publicContext.close();
  }
  pass('public GIF/link and video player work without JS, mobile slots fit and used media cannot be deleted');
  await admin.request('/api/ads/' + original.id, 'PUT', { enabled: false, creativeId: null });
  const disabled = await fetch(base + '/'); assert(!(await disabled.text()).includes('data-ad-slot-id="HOMEPAGE_TOP"'));
  assert.deepEqual(errors, []);
  pass('removing media / disabling slot persists; browser has no runtime errors');
} catch (error) {
  fs.mkdirSync('verification/ad-creatives', { recursive: true });
  await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: 'verification/ad-creatives/check-failure.png' }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await prisma.adSlotConfig.update({ where: { id: original.id }, data: original });
  for (const id of assets) { const row = await prisma.adCreative.findUnique({ where: { id } }); if (row) { await prisma.adCreative.delete({ where: { id } }); await mediaStorage().delete(row.storageKey); } }
  await prisma.auditLog.deleteMany({ where: { userId: { in: users } } }); await prisma.session.deleteMany({ where: { userId: { in: users } } }); await prisma.user.deleteMany({ where: { id: { in: users } } });
  child.kill();
  assert.deepEqual(await snapshot(), before, 'all existing rows preserved'); assert.deepEqual(files(), filesBefore, 'all original media preserved');
  await prisma.$disconnect(); console.log(`PASS integrity and fixture cleanup; ${checks} ad creative groups`);
}
