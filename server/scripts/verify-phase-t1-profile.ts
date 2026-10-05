/** Phase T.1 disposable local production-mode profile image browser verification. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Local disposable database required.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath, 'Set PLAYWRIGHT_EXECUTABLE_PATH.');
const id = `t1-profile-${crypto.randomUUID()}`;
const email = `${id}@example.test`;
const password = `Profile-${crypto.randomUUID()}!`;
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sportingspy-t1-'));
const mediaKey = `2026/10/${crypto.randomUUID()}/original.png`;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
await fs.mkdir(path.dirname(path.join(temp, mediaKey)), { recursive: true });
await fs.writeFile(path.join(temp, mediaKey), png);
const listener = createServer(); listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
const port = (listener.address() as { port: number }).port; await new Promise<void>(resolve => listener.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
let child: ReturnType<typeof spawn> | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let output = '';
try {
  await prisma.user.create({ data: { id, name: 'Profile Fixture', email, role: 'Editor', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { env: { ...process.env, NODE_ENV: 'production', APP_ENV: 'staging', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, HOST: '127.0.0.1', PORT: String(port), TRUST_PROXY: 'false', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local', MEDIA_LOCAL_DIR: temp, MEDIA_PUBLIC_BASE_URL: '', PROFILE_IMAGE_ALLOWED_ORIGINS: 'https://avatars.example.test,https://media.example.test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout!.on('data', chunk => { output += chunk; }); child.stderr!.on('data', chunk => { output += chunk; });
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${output.slice(-1500)}`);
    try { if ((await fetch(`${base}/api/health/ready`)).ok) break; } catch { /* booting */ }
    if (i === 59) throw new Error(`Server did not become ready: ${output.slice(-1500)}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://avatars.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  await page.route('https://media.example.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: png }));
  const login = async () => {
    await page.goto(`${base}/account/`);
    // Browsers discard Secure cookies on plain HTTP IPs. Seed a local-only
    // non-Secure CSRF cookie; a real deployment uses HTTPS/Secure throughout.
    const csrf = crypto.randomBytes(32).toString('hex');
    await page.evaluate(token => { document.cookie = `csrf_token=${token}; Path=/; SameSite=Lax`; }, csrf);
    const response = await page.request.post(`${base}/api/auth/login`, { data: { email, password }, headers: { 'x-csrf-token': csrf } });
    assert.equal(response.status(), 200, await response.text());
  };
  const imageLoaded = async (expected: string) => {
    const image = page.locator('#profile img').first();
    await image.waitFor();
    await page.waitForFunction(src => {
      const img = document.querySelector<HTMLImageElement>('#profile img');
      return img?.getAttribute('src') === src && img.complete && img.naturalWidth > 0;
    }, expected);
    await page.waitForFunction(src => {
      const img = document.querySelector<HTMLImageElement>('header img[alt="Profile Fixture"]');
      return img?.getAttribute('src') === src && img.complete && img.naturalWidth > 0;
    }, expected);
  };
  const save = async (url: string) => {
    await page.getByLabel('Avatar image URL').fill(url);
    const [response] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/auth/me') && response.request().method() === 'PATCH'),
      page.getByRole('button', { name: 'Save profile' }).click(),
    ]);
    assert.equal(response.status(), 200, await response.text());
    await page.getByText('Profile saved.').waitFor();
  };
  await login(); await page.goto(`${base}/account/`);
  await page.getByLabel('Avatar image URL').waitFor();
  const external = 'https://avatars.example.test/person.png';
  await save(external); await imageLoaded(external); console.log('PASS A external approved HTTPS URL renders after save');
  const r2 = 'https://media.example.test/person.png';
  await save(r2); await imageLoaded(r2); console.log('PASS B R2-style public custom-domain URL renders');
  const local = `/media/${mediaKey}`;
  await save(local); await imageLoaded(local); console.log('PASS C local media URL renders');
  await page.getByLabel('Avatar image URL').fill('https://blocked.example.test/person.png');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByRole('alert').getByText(/approved HTTPS image origin/).waitFor();
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).avatar, local);
  console.log('PASS D unapproved image URL is rejected and saved value remains');
  await save(''); await page.locator('#profile [role="img"]').waitFor();
  console.log('PASS E empty image URL displays initials');
  await save(r2); await page.reload(); await imageLoaded(r2);
  console.log('PASS G saved image survives a hard refresh');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login(); await page.goto(`${base}/account/`); await imageLoaded(r2);
  console.log('PASS F saved image survives logout/login');
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).avatar, r2);
  await context.close();
} finally {
  if (browser) await browser.close();
  if (child) { child.kill(); await once(child, 'exit').catch(() => undefined); }
  await prisma.session.deleteMany({ where: { userId: id } });
  await prisma.auditLog.deleteMany({ where: { userId: id } });
  await prisma.user.deleteMany({ where: { id } });
  assert(path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep + 'sportingspy-t1-'));
  await fs.rm(temp, { recursive: true, force: true });
  await prisma.$disconnect();
}
