/**
 * Sport hub header image: the sport's Media Library image fills the right of the header card and
 * fades into the card from the left; no image keeps the plain card. The CMS sport form offers the
 * shared "Choose or upload image" picker. Production build + LOCAL database only; real Chrome.
 *
 *   npm run build && PLAYWRIGHT_EXECUTABLE_PATH=<chrome> npm run test:sport-hero-browser
 *   (SPORT_HERO_SHOTS=<dir> saves screenshots)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Sport hero verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const shots = process.env.SPORT_HERO_SHOTS;
if (shots) fs.mkdirSync(shots, { recursive: true });

const fx = `sh${crypto.randomUUID().slice(0, 6)}`;
const password = `SportHero-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`;
const imageUrl = 'https://images.unsplash.com/photo-1554068865-24cecd4e34b8?auto=format&fit=crop&w=1600&q=80';

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '', GEMINI_API_KEY: '', MEDIA_STORAGE_PROVIDER: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };

let browser: Browser | null = null;
try {
  await prisma.user.create({ data: { id: adminId, name: `${fx} Admin`, email: `${adminId}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.mediaItem.create({ data: { id: `${fx}-media`, title: `${fx} tennis court`, url: imageUrl, altText: 'Tennis court', width: 1600, height: 1067, uploadedAt: new Date(), copyrightReview: 'reviewed' } });
  const sportBase = { tagline: 'Grand Slams, ATP/WTA Tournaments, Surface Nuances & Tactical Guides', description: 'Definitive reference guides, tournament schedules, prize fund breakdowns, and mechanical analysis across clay, grass, and hard courts.', order: 999, isVisible: true, featuredEventIds: [], seo: {} };
  await prisma.sport.create({ data: { id: `${fx}-with`, slug: `${fx}-with`, name: `${fx} Tennis`, heroImage: imageUrl, heroMediaId: `${fx}-media`, ...sportBase } });
  await prisma.sport.create({ data: { id: `${fx}-without`, slug: `${fx}-without`, name: `${fx} Plain`, ...sportBase } });

  for (let i = 0; i < 120 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  browser = await chromium.launch({ executablePath: chromePath });
  const errors: string[] = [];

  const view = async (width: number, scheme: 'light' | 'dark', slug: string) => {
    const page = await (await browser!.newContext({ viewport: { width, height: 900 }, colorScheme: scheme })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/${slug}/`, { waitUntil: 'networkidle' });
    return page;
  };

  // With an image: on the right, behind the text, faded from the card colour.
  for (const [width, scheme] of [[1440, 'light'], [1440, 'dark'], [390, 'light']] as const) {
    const page = await view(width, scheme, `${fx}-with`);
    const backdrop = page.getByTestId('sport-hero-backdrop');
    await backdrop.waitFor();
    const img = backdrop.locator('img');
    await img.evaluate((el: HTMLImageElement) => el.complete || new Promise((r) => { el.onload = r; el.onerror = r; }));
    assert(await img.evaluate((el: HTMLImageElement) => el.naturalWidth > 0), 'image loaded');
    assert.equal(await backdrop.getAttribute('aria-hidden'), 'true');
    const geo = await page.evaluate(`(() => {
      const card = document.querySelector('[data-testid="sport-hero-backdrop"]').parentElement.getBoundingClientRect();
      const bd = document.querySelector('[data-testid="sport-hero-backdrop"]').getBoundingClientRect();
      const h1 = document.querySelector('h1');
      const t = h1.getBoundingClientRect();
      const at = document.elementFromPoint(t.left + 5, t.top + t.height / 2);
      return { cardRight: Math.round(card.right), bdRight: Math.round(bd.right), bdLeft: Math.round(bd.left), cardLeft: Math.round(card.left), cardWidth: Math.round(card.width), h1OnTop: !!at && h1.contains(at), scroll: document.documentElement.scrollWidth <= innerWidth };
    })()`) as { cardRight: number; bdRight: number; bdLeft: number; cardLeft: number; cardWidth: number; h1OnTop: boolean; scroll: boolean };
    assert(Math.abs(geo.cardRight - geo.bdRight) <= 2, 'image is anchored to the right edge of the card');
    if (width >= 1024) assert(geo.bdLeft - geo.cardLeft > geo.cardWidth * 0.3, 'on desktop the image covers only the right part of the card');
    assert(geo.h1OnTop, 'the heading stays above the image');
    assert(geo.scroll, 'no horizontal overflow');
    if (shots) await page.screenshot({ path: path.join(shots, `sport-hero-${width}-${scheme}.png`) });
    await page.context().close();
  }
  pass('sport with an image: it fills the right of the header card behind the text, faded from the card colour (desktop light/dark and phone), no overflow');

  const plain = await view(1440, 'light', `${fx}-without`);
  await plain.locator('h1').waitFor();
  assert.equal(await plain.getByTestId('sport-hero-backdrop').count(), 0);
  await plain.context().close();
  pass('sport without an image keeps the plain header card');

  // CMS: the sport form offers the shared picker for this image.
  const cms = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await cms.goto(`${base}/admin/#sports`);
  await cms.getByRole('textbox', { name: 'Email' }).fill(`${adminId}@example.test`);
  await cms.getByRole('textbox', { name: 'Password' }).fill(password);
  await cms.getByRole('button', { name: 'Sign In' }).click();
  await cms.locator('tr', { hasText: `${fx} Plain` }).getByRole('button', { name: 'Edit', exact: true }).click();
  await cms.getByTestId('sport-hero-image-pick').click();
  await cms.getByRole('dialog', { name: 'Choose an image' }).getByRole('button', { name: new RegExp(`${fx} tennis court`) }).click();
  assert.equal(await cms.locator('#sport-hero-image').inputValue(), imageUrl);
  pass('the CMS sport form has the "Choose or upload image" picker for the sport image');
  assert.deepEqual(errors, []);
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  await prisma.sport.deleteMany({ where: { id: { startsWith: fx } } });
  await prisma.mediaItem.deleteMany({ where: { id: `${fx}-media` } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: adminId } });
  await prisma.session.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  await prisma.$disconnect();
}
console.log(`Sport hero browser acceptance: ${checks} checks passed.`);
