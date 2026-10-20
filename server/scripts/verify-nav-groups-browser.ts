/**
 * Public navbar: the Sports menu lists each visible sport with its groups
 * nested underneath (Sport → Group, two levels). Real Chrome, desktop and
 * phone, pointer, keyboard and tap. Production-mode server on the LOCAL
 * database, UUID-scoped fixtures, removed afterwards.
 *
 *   npm run build && npm run local -- test:nav-groups-browser
 *   (PLAYWRIGHT_EXECUTABLE_PATH=<chrome> when Chrome is not in its default place)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Navigation verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const fx = `nv${crypto.randomUUID().slice(0, 6)}`;
const password = `Nav-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`;
// Orders below every real sport, so the fixtures lead the menu and sit inside the mobile menu's first eight.
const A = `${fx}-athletics`; const P = `${fx}-plain`; const H = `${fx}-hidden`;

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' } as NodeJS.ProcessEnv,
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
const sportsBefore = JSON.stringify(await prisma.sport.findMany({ orderBy: { id: 'asc' } }));
const groupsBefore = JSON.stringify(await prisma.discipline.findMany({ orderBy: { id: 'asc' } }));

let browser: Browser | null = null;
try {
  await prisma.user.create({ data: { id: adminId, name: `${fx} Admin`, email: `${adminId}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  const sport = (slug: string, name: string, order: number, isVisible = true) => prisma.sport.create({ data: { id: `${fx}-s-${slug}`, slug, name, tagline: '', description: `${name}.`, order, isVisible, seo: {} } });
  await sport(A, `${fx} Athletics`, -30); await sport(P, `${fx} Plain`, -20); await sport(H, `${fx} Hidden`, -10, false);
  const group = (sportSlug: string, slug: string, name: string, order: number, extra: object = {}) => prisma.discipline.create({ data: { id: `${fx}-g-${sportSlug}-${slug}`, sportSlug, slug, name, order, ...extra } });
  await group(A, 'throwing', `${fx} Throwing`, 3);
  await group(A, 'running', `${fx} Running`, 1, { icon: '🏃' });
  await group(A, 'jumping', `${fx} Jumping`, 2);
  await group(A, 'secret', `${fx} Secret`, 4, { isVisible: false });
  await group(A, 'walking', `${fx} Walking`, 5, { isActive: false });
  await group(H, 'hrun', `${fx} Hidden Run`, 1);

  for (let i = 0; i < 180 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  browser = await chromium.launch({ executablePath: chromePath });
  const errors: string[] = [];
  const open = async (width: number, height: number, hasTouch = false): Promise<Page> => {
    const page = await (await browser!.newContext({ viewport: { width, height }, hasTouch, isMobile: hasTouch })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    return page;
  };
  /** The menu as a visitor sees it: sports in order, each with its nested group links. */
  const tree = (page: Page, list: string) => page.locator(list).evaluate((root) => [...root.querySelectorAll(':scope > li, :scope ul.grid > li, :scope > ul > li')].filter((li) => li.hasAttribute('data-sport')).map((li) => ({
    sport: li.getAttribute('data-sport'), href: li.querySelector('a')!.getAttribute('href'),
    groups: [...li.querySelectorAll('[data-group]')].map((g) => ({ slug: g.getAttribute('data-group'), href: g.querySelector('a')!.getAttribute('href'), text: g.textContent!.trim() })),
  })));

  // ── Desktop: hover opens the tree ──
  const desktop = await open(1440, 900);
  const sportsButton = desktop.locator('nav[aria-label="Main"] button[aria-controls="sports-menu-panel"]');
  assert.equal(await sportsButton.getAttribute('aria-expanded'), 'false');
  assert.equal(await desktop.getByTestId('sports-menu').count(), 0);
  await sportsButton.hover();
  const menu = desktop.getByTestId('sports-menu');
  await menu.waitFor();
  assert.equal(await sportsButton.getAttribute('aria-expanded'), 'true');
  const shown = await tree(desktop, '[data-testid="sports-menu"]');
  const mine = shown.filter((s) => s.sport!.startsWith(fx));
  assert.deepEqual(mine, [
    { sport: A, href: `/${A}/`, groups: [{ slug: 'running', href: `/${A}/running/`, text: `🏃${fx} Running` }, { slug: 'jumping', href: `/${A}/jumping/`, text: `${fx} Jumping` }, { slug: 'throwing', href: `/${A}/throwing/`, text: `${fx} Throwing` }] },
    { sport: P, href: `/${P}/`, groups: [] },
  ], 'visible sports in order; groups nested under their sport in display order; hidden and retired groups and the hidden sport are absent');
  assert.deepEqual(shown.slice(0, 2).map((s) => s.sport), [A, P], 'sports keep their display order');
  const text = await menu.innerText();
  for (const leak of [`${fx} Secret`, `${fx} Walking`, `${fx} Hidden`, `${fx} Hidden Run`]) assert(!text.includes(leak), `${leak} must not appear in the menu`);
  assert.equal(await menu.locator(`[data-sport="${P}"] ul`).count(), 0, 'a sport without groups has no nested list');
  assert.equal(await menu.locator(`[data-sport="${A}"] > ul`).getAttribute('aria-label'), `${fx} Athletics groups`);
  assert.equal(await menu.locator('[data-group] [data-group], [data-group] ul').count(), 0, 'nothing is nested under a group');
  assert(shown.length > 2, 'the site\'s own sports are still listed');
  assert.equal(await menu.getByRole('link', { name: /View Directory/ }).getAttribute('href'), '/sports/');
  await desktop.mouse.move(8, 400);
  await menu.waitFor({ state: 'detached' });
  assert.equal(await sportsButton.getAttribute('aria-expanded'), 'false', 'moving outside the Sports trigger and panel closes a hover-opened menu');
  await sportsButton.hover();
  await menu.waitFor();
  // The click that follows a hover keeps the panel open; a second click closes it.
  await sportsButton.click();
  assert.equal(await sportsButton.getAttribute('aria-expanded'), 'true', 'hover then click does not close the panel');
  await sportsButton.click();
  assert.equal(await sportsButton.getAttribute('aria-expanded'), 'false');
  pass('desktop hover: the Sports menu shows visible sports in order with their groups nested underneath (ordered, with icon); hidden/retired groups and hidden sports never appear; a sport without groups is a plain link');

  // ── Links ──
  await sportsButton.click(); // the pointer is still on the button, so this opens it again
  await menu.waitFor();
  await menu.locator(`[data-sport="${A}"] [data-group="jumping"] a`).click();
  await desktop.waitForURL(`${base}/${A}/jumping/`);
  assert.equal((await desktop.locator('h1').innerText()).trim(), `${fx} Jumping`);
  assert.equal(await desktop.getByTestId('sports-menu').count(), 0, 'the menu closes after navigation');
  await desktop.locator('nav[aria-label="Main"] button[aria-controls="sports-menu-panel"]').click();
  await desktop.getByTestId('sports-menu').locator(`[data-sport="${A}"] > a`).click();
  await desktop.waitForURL(`${base}/${A}/`);
  assert.equal((await desktop.locator('h1').innerText()).trim(), `${fx} Athletics`);
  await desktop.locator('nav[aria-label="Main"] button[aria-controls="sports-menu-panel"]').click();
  await desktop.getByTestId('sports-menu').locator(`[data-sport="${P}"] > a`).click();
  await desktop.waitForURL(`${base}/${P}/`);
  assert.equal((await desktop.locator('h1').innerText()).trim(), `${fx} Plain`);
  for (const [label, href] of [['Latest', '/latest/'], ['Events', '/events/']] as const) {
    const link = desktop.locator(`nav[aria-label="Main"] a[href="${href}"]`).first();
    if (await link.count()) { await link.click(); await desktop.waitForURL(`${base}${href}`); assert.equal(new URL(desktop.url()).pathname, href, `${label} still works`); }
  }
  pass('links: a group opens its own landing page, a sport its sport page (with or without groups), and the other navbar links still work');

  // ── Keyboard ──
  const keys = await open(1440, 900);
  const kButton = keys.locator('nav[aria-label="Main"] button[aria-controls="sports-menu-panel"]');
  await kButton.focus();
  await keys.keyboard.press('Enter');
  const kMenu = keys.getByTestId('sports-menu');
  await kMenu.waitFor();
  await keys.keyboard.press('Tab');
  assert.match(await keys.evaluate(() => document.activeElement?.textContent ?? ''), /View Directory/, 'Tab moves into the panel');
  const focusedHref = () => keys.evaluate(() => (document.activeElement as HTMLAnchorElement | null)?.getAttribute('href') ?? '');
  await keys.keyboard.press('Tab'); assert.equal(await focusedHref(), `/${A}/`);
  await keys.keyboard.press('Tab'); assert.equal(await focusedHref(), `/${A}/running/`, 'groups follow their sport in the focus order');
  await keys.keyboard.press('ArrowDown'); assert.equal(await focusedHref(), `/${A}/jumping/`);
  await keys.keyboard.press('ArrowUp'); assert.equal(await focusedHref(), `/${A}/running/`);
  await keys.keyboard.press('Home'); assert.equal(await focusedHref(), '/sports/');
  await keys.keyboard.press('Escape');
  assert.equal(await keys.getByTestId('sports-menu').count(), 0);
  assert.equal(await keys.evaluate(() => document.activeElement?.getAttribute('aria-controls')), 'sports-menu-panel', 'Escape closes the panel and returns focus to the Sports button');
  await keys.keyboard.press('ArrowDown');
  await kMenu.waitFor();
  assert.equal(await focusedHref(), '/sports/', 'Arrow Down on the button opens the panel and moves into it');
  await keys.keyboard.press('ArrowDown'); await keys.keyboard.press('ArrowDown'); await keys.keyboard.press('ArrowDown');
  assert.equal(await focusedHref(), `/${A}/jumping/`);
  await keys.keyboard.press('Enter');
  await keys.waitForURL(`${base}/${A}/jumping/`);
  pass('keyboard: Enter or Arrow Down opens the panel, Tab and the arrow keys walk sports and their groups in order, Enter follows a link, Escape closes and returns focus to the button');

  // ── Phone: tap to expand ──
  const phone = await open(390, 844, true);
  await phone.getByRole('button', { name: 'Toggle Navigation Menu' }).tap();
  const mobile = phone.getByTestId('mobile-sports');
  await mobile.waitFor();
  const toggle = mobile.getByRole('button', { name: `Show ${fx} Athletics groups` });
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await mobile.locator('[data-group]').count(), 0, 'groups are collapsed until a sport is expanded');
  assert.equal(await mobile.locator(`[data-sport="${P}"] button`).count(), 0, 'a sport without groups has no expand control');
  assert.equal(await mobile.locator(`[data-sport="${H}"]`).count(), 0);
  await toggle.tap();
  assert.equal(await mobile.getByRole('button', { name: `Hide ${fx} Athletics groups` }).getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await mobile.locator(`[data-sport="${A}"] [data-group] a`).evaluateAll((links) => links.map((a) => a.getAttribute('href'))), [`/${A}/running/`, `/${A}/jumping/`, `/${A}/throwing/`]);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal overflow');
  await mobile.locator(`[data-sport="${A}"] [data-group="throwing"] a`).tap();
  await phone.waitForURL(`${base}/${A}/throwing/`);
  assert.equal((await phone.locator('h1').innerText()).trim(), `${fx} Throwing`);
  await phone.getByRole('button', { name: 'Toggle Navigation Menu' }).tap();
  await phone.getByTestId('mobile-sports').locator(`[data-sport="${A}"] a`).first().tap();
  await phone.waitForURL(`${base}/${A}/`);
  pass('phone: tapping a sport\'s arrow expands its groups (ordered, without hidden or retired ones); a group link and a sport link both navigate; a sport without groups has no arrow; no overflow');

  // ── The menu follows CMS changes ──
  const cookies = new Map<string, string>();
  const api = async (route: string, method = 'GET', body?: unknown) => {
    const headers: Record<string, string> = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Content-Type': 'application/json' };
    if (method !== 'GET') headers['x-csrf-token'] = cookies.get('csrf_token') || '';
    const res = await fetch(base + route, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [pair] = c.split(';'); const i = pair.indexOf('='); cookies.set(pair.slice(0, i), pair.slice(i + 1)); }
    return res.status;
  };
  await api('/api/auth/me');
  assert.equal(await api('/api/auth/login', 'POST', { email: `${adminId}@example.test`, password }), 200);
  assert.equal(await api(`/api/disciplines/${fx}-g-${A}-jumping`, 'PUT', { isVisible: false }), 200);
  assert.equal(await api(`/api/disciplines/${fx}-g-${A}-throwing`, 'PUT', { order: 0 }), 200);
  assert.equal(await api(`/api/disciplines/${fx}-g-${A}-walking`, 'PUT', { isActive: true }), 200);
  const after = await open(1440, 900);
  await after.locator('nav[aria-label="Main"] button[aria-controls="sports-menu-panel"]').hover();
  await after.getByTestId('sports-menu').waitFor();
  assert.deepEqual((await tree(after, '[data-testid="sports-menu"]')).find((s) => s.sport === A)!.groups.map((g) => g.slug), ['throwing', 'running', 'walking'], 'hiding, reordering and reactivating in the CMS shows in the menu on the next page load');
  pass('after CMS changes (hide, reorder, reactivate) the next page load shows the updated tree');

  assert.deepEqual(errors, [], 'no runtime errors on the public pages');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await prisma.discipline.deleteMany({ where: { id: { startsWith: `${fx}-g-` } } });
  await prisma.sport.deleteMany({ where: { id: { startsWith: `${fx}-s-` } } });
  await prisma.auditLog.deleteMany({ where: { userId: adminId } });
  await prisma.session.deleteMany({ where: { userId: adminId } });
  await prisma.user.deleteMany({ where: { id: adminId } });
  assert.equal(JSON.stringify(await prisma.sport.findMany({ orderBy: { id: 'asc' } })), sportsBefore, 'existing sports are unchanged');
  assert.equal(JSON.stringify(await prisma.discipline.findMany({ orderBy: { id: 'asc' } })), groupsBefore, 'existing groups are unchanged');
  await prisma.$disconnect();
}
console.log(`Navbar Sports → Groups browser acceptance: ${checks} checks passed.`);
