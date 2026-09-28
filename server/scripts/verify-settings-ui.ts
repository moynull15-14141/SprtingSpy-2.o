/** Isolated Settings UI verification. Local DB only; restores settings and verifies original rows. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { prisma } from '../db';
import { hashPassword } from '../password';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { SETTING_KEYS } from '../settingsRegistry';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Requires a local non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH.');
const prefix = `settings-ui-${crypto.randomUUID()}`;
const ids = { admin: `${prefix}-admin`, editor: `${prefix}-editor` };
const password = `Ui-${crypto.randomUUID()}`;
const tables = ['sport', 'sportEvent', 'eventEdition', 'article', 'articleMedia', 'author', 'user', 'session', 'comment', 'mediaItem', 'adSlotConfig', 'redirectRule', 'siteSetting', 'siteExperience', 'seoRule', 'seoScanRun', 'seoIntegrationLog', 'auditLog'] as const;
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async (table) => {
  const rows = await (prisma[table] as any).findMany();
  rows.sort((a: unknown, b: unknown) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return [table, crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')];
})));
const before = await snapshot();
const originalSettings = await prisma.siteSetting.findMany();
const auditIds = new Set((await prisma.auditLog.findMany({ select: { id: true } })).map((r) => r.id));
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let browser: Browser | undefined;
let child: ReturnType<typeof spawn> | undefined;
let output = '';
let passed = 0; let complete = false;
const pass = (message: string) => { passed++; console.log(`PASS ${message}`); };
const screenshots = 'verification/settings'; fs.mkdirSync(screenshots, { recursive: true });
const auditSource = fs.readFileSync('server/scripts/audit-a11y.ts', 'utf8').match(/const AUDIT = (`[\s\S]*?`);/);
assert(auditSource);
const accessibilityAudit = Function(`return ${auditSource[1]}`)() as string;
async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('input[name="siteName"]').waitFor();
}
const fixtureValues: Record<string, string> = {
  siteName: `Settings UI ${prefix.slice(-8)}`, siteDescription: 'Independent sports schedules, guides and tournament coverage.',
  defaultOgImage: '/favicon.ico', twitterHandle: '@SportingSpy', googleSiteVerification: 'SettingsGoogleToken123456',
  bingSiteVerification: 'SettingsBingToken123456', ga4MeasurementId: 'G-SETTINGS123', adsensePublisherId: 'ca-pub-0000000000000000', indexNowKey: 'settings-ui-indexnow-key-123456',
};
try {
  for (const role of ['admin', 'editor'] as const) await prisma.user.create({ data: { id: ids[role], name: `Settings UI ${role}`, email: `${ids[role]}@example.test`, role: role === 'admin' ? 'Admin' : 'Editor', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, TRUST_PROXY: 'false', GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (c) => output += c); child.stderr?.on('data', (c) => output += c);
  for (let i = 0; i < 160; i++) { if (child.exitCode !== null) throw new Error(output); try { if ((await fetch(base + '/api/health')).status === 200) break; } catch {} await new Promise((r) => setTimeout(r, 250)); }
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await context.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, (route) => route.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await context.route(/google-analytics\.com|googletagmanager\.com|googlesyndication\.com/, (route) => route.abort());
  const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/admin/');
  await page.getByPlaceholder('Email', { exact: true }).fill(`${ids.admin}@example.test`);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  let releaseLoad!: () => void;
  const delayedLoad = new Promise<void>((resolve) => { releaseLoad = resolve; });
  await page.route('**/api/settings', async (route) => { if (route.request().method() === 'GET') { await delayedLoad; } await route.continue(); });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByText('Loading settings…', { exact: true }).waitFor(); releaseLoad();
  await page.locator('input[name="siteName"]').waitFor(); await page.unroute('**/api/settings');
  const form = page.getByRole('form', { name: 'Site settings' });
  assert.equal(await form.locator('input,textarea').count(), 9);
  assert.equal(await form.locator('section').count(), 5);
  assert(await form.getByRole('button', { name: 'Save changes', exact: true }).isDisabled());
  assert.equal(await form.getByRole('region', { name: 'Unsaved settings changes' }).count(), 0);
  pass('initial loading placeholder, all nine fields in five categories, and visible disabled save action without edits');
  const originalResponse = await page.evaluate(async () => { const res = await fetch('/api/settings', { credentials: 'include' }); return { status: res.status, data: await res.json() }; });
  assert.equal(originalResponse.status, 200);
  const initialValues = originalResponse.data.values;
  await form.locator('[name="siteName"]').fill(`${initialValues.siteName ?? ''} edited`);
  await form.getByRole('region', { name: 'Unsaved settings changes' }).waitFor();
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal(await form.locator('[name="siteName"]').inputValue(), initialValues.siteName ?? '');
  assert.equal(await form.getByRole('region', { name: 'Unsaved settings changes' }).count(), 0);
  pass('dirty state is based on real edits; Cancel restores saved values');
  await form.locator('[name="siteName"]').fill('Unsaved identity');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'You have unsaved changes.' });
  await dialog.waitFor(); assert.equal(await dialog.getByRole('button', { name: 'Stay', exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Escape'); assert.equal(await dialog.count(), 0);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click(); await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  assert.equal(await form.locator('[name="siteName"]').inputValue(), 'Unsaved identity');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click(); await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByRole('heading', { name: 'Editorial Overview & Health', exact: true }).waitFor();
  await openSettings(page); assert.equal(await page.locator('[name="siteName"]').inputValue(), initialValues.siteName ?? '');
  pass('native unsaved dialog traps focus; Escape/Stay preserve edits; Leave navigates without saving');
  const labelAudit = await form.locator('input,textarea').evaluateAll((fields) => fields.every((field) => (field as HTMLInputElement).labels?.length && field.getAttribute('aria-describedby')));
  assert(labelAudit);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate((theme) => { localStorage.setItem('sportingspy_theme', theme); document.documentElement.classList.toggle('dark', theme === 'dark'); }, scheme);
    for (const width of [1440, 1280, 1024, 768, 390, 375]) {
      await page.setViewportSize({ width, height: width < 800 ? 844 : 1000 });
      await form.locator('[name="siteName"]').fill('Responsive unsaved identity');
      assert(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), `${scheme} ${width}: page overflow`);
      for (const key of SETTING_KEYS) {
        const field = form.locator(`[name="${key}"]`);
        await field.scrollIntoViewIfNeeded();
        const box = await field.boundingBox(); assert(box && box.width >= 200 && box.height >= 44, `${scheme} ${width} ${key}: input size`);
      }
      const help = form.getByRole('button', { name: 'Help: IndexNow', exact: true });
      await help.scrollIntoViewIfNeeded(); await help.focus();
      const tooltip = page.getByRole('tooltip'); await tooltip.waitFor();
      const tip = await tooltip.boundingBox(); assert(tip && tip.x >= 0 && tip.x + tip.width <= width && tip.y >= 0 && tip.y + tip.height <= (width < 800 ? 844 : 1000), `${scheme} ${width}: tooltip overflow`);
      await page.keyboard.press('Escape'); assert.equal(await tooltip.count(), 0);
      const audit = await page.evaluate(accessibilityAudit); assert.deepEqual(audit, [], `${scheme} ${width}: accessibility`);
      const bar = form.getByRole('region', { name: 'Unsaved settings changes' }); await bar.scrollIntoViewIfNeeded();
      const barBox = await bar.boundingBox(); assert(barBox && barBox.x >= 0 && barBox.x + barBox.width <= width);
      const last = form.locator('[name="indexNowKey"]'); await last.focus();
      const lastBox = await last.boundingBox(); const currentBar = await bar.boundingBox();
      assert(lastBox && currentBar && lastBox.y + lastBox.height <= currentBar.y, `${scheme} ${width}: bar must not cover last input`);
      await form.getByRole('button', { name: 'Cancel', exact: true }).click();
      if ([1440, 390].includes(width)) {
        await form.evaluate((el) => { const pane = el.closest('.cms-main'); if (pane) pane.scrollTop = 0; window.scrollTo(0, 0); });
        await page.screenshot({ path: `${screenshots}/${scheme}-${width}.png`, fullPage: true });
      }
    }
  }
  pass('all six viewport widths in light/dark: labels, contrast, focusable help, touch-sized inputs, tooltip bounds and sticky bar clearance');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await form.getByRole('button', { name: 'Analytics & ads', exact: true }).click();
  const gaHelp = form.getByRole('button', { name: 'Help: Google Analytics 4', exact: true });
  await gaHelp.hover(); await page.getByRole('tooltip').waitFor(); assert.match(await page.getByRole('tooltip').textContent() ?? '', /analytics consent/);
  await gaHelp.focus(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('tooltip').count(), 0);
  await gaHelp.blur(); await gaHelp.focus(); await page.getByRole('tooltip').waitFor(); await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate('document.activeElement.tagName'), 'BODY');
  pass('category navigation, hover help, keyboard help, Escape dismissal and normal tab navigation');
  const touchContext = await browser.newContext({ viewport: { width: 375, height: 844 }, hasTouch: true, isMobile: true });
  await touchContext.addCookies(await context.cookies());
  const touchPage = await touchContext.newPage(); await touchPage.goto(base + '/admin/'); await openSettings(touchPage);
  const touchHelp = touchPage.getByRole('button', { name: 'Help: Site name', exact: true });
  await touchHelp.tap(); await touchPage.getByRole('tooltip').waitFor();
  await touchHelp.tap(); assert.equal(await touchPage.getByRole('tooltip').count(), 0);
  await touchContext.close(); pass('mobile touch opens and dismisses field help without requiring hover');
  await form.locator('[name="ga4MeasurementId"]').fill('INVALID');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await form.getByRole('alert').filter({ hasText: 'Could not save settings.' }).waitFor();
  assert.equal(await form.locator('[name="ga4MeasurementId"]').getAttribute('aria-invalid'), 'true');
  assert.equal((await prisma.siteSetting.findUnique({ where: { key: 'ga4MeasurementId' } }))?.value, initialValues.ga4MeasurementId);
  pass('existing server validation remains authoritative; failed save highlights field and keeps edits/data unchanged');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const [key, value] of Object.entries(fixtureValues)) await form.locator(`[name="${key}"]`).fill(value);
  const expectedChanged = Object.keys(fixtureValues).filter((key) => fixtureValues[key] !== (initialValues[key] ?? ''));
  let puts = 0; let releaseSave!: () => void;
  const delayedSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  await page.route('**/api/settings', async (route) => { if (route.request().method() === 'PUT') { puts++; const body = route.request().postDataJSON(); assert.deepEqual(Object.keys(body).sort(), expectedChanged.sort()); await delayedSave; } await route.continue(); });
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await form.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  assert(await form.getByRole('button', { name: 'Saving…', exact: true }).isDisabled());
  assert(await form.locator('[name="siteName"]').isDisabled()); releaseSave();
  await form.getByRole('status').filter({ hasText: 'Settings saved successfully.' }).waitFor(); await page.unroute('**/api/settings');
  assert.equal(puts, 1); assert.equal(await form.getByRole('region', { name: 'Unsaved settings changes' }).count(), 0);
  for (const [key, value] of Object.entries(fixtureValues)) assert.equal((await prisma.siteSetting.findUniqueOrThrow({ where: { key } })).value, value);
  pass('all nine values save through unchanged partial PUT; Saving state blocks duplicates; persistent success and saved statuses');
  await page.reload(); await openSettings(page);
  for (const [key, value] of Object.entries(fixtureValues)) assert.equal(await form.locator(`[name="${key}"]`).inputValue(), value);
  assert.equal(await form.getByText('Configured', { exact: true }).count(), 9);
  assert.equal(await form.getByText('Active', { exact: true }).count(), 0);
  pass('reload restores all persisted values; configured badges reflect saves without claiming provider activation');
  const publicResponse = await fetch(base + '/'); const publicHtml = await publicResponse.text();
  assert(publicHtml.includes(fixtureValues.googleSiteVerification) && publicHtml.includes(fixtureValues.bingSiteVerification));
  assert.match(publicHtml, /<meta[^>]+name="google-site-verification"/); assert.match(publicHtml, /<meta[^>]+name="msvalidate.01"/);
  assert.equal((await fetch(`${base}/${fixtureValues.indexNowKey}.txt`)).status, 200);
  pass('saved verification meta tags and existing IndexNow key-file behavior preserved');
  await form.locator('[name="siteName"]').fill(`  ${fixtureValues.siteName}  `);
  await form.locator('[name="twitterHandle"]').fill('');
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await form.getByRole('status').filter({ hasText: 'Settings saved successfully.' }).waitFor();
  assert.equal(await form.locator('[name="siteName"]').inputValue(), fixtureValues.siteName);
  assert.equal(await prisma.siteSetting.findUnique({ where: { key: 'twitterHandle' } }), null);
  pass('server normalization and empty-value clearing preserve existing save semantics');
  await form.locator('[name="siteName"]').fill('Retry me');
  await page.route('**/api/settings', async (route) => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error.' }) }) : route.continue());
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await form.getByRole('alert').filter({ hasText: 'Could not save settings.' }).waitFor();
  assert.equal(await form.locator('[name="siteName"]').inputValue(), 'Retry me');
  assert(!(await form.textContent())?.includes('Internal server error.'));
  await page.unroute('**/api/settings'); await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  pass('save failure keeps edits and shows sanitized retry guidance in the page');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.route('**/api/settings', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error.' }) }));
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await form.getByText('Could not load settings. Please try again.', { exact: true }).waitFor();
  await page.unroute('**/api/settings'); await form.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await form.locator('[name="siteName"]').waitFor();
  pass('load failure has accessible feedback and retry restores the form');
  assert.equal((await fetch(base + '/api/settings')).status, 401);
  const noCsrf = await page.evaluate(async () => (await fetch('/api/settings', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ siteName: 'Rejected' }) })).status); assert.equal(noCsrf, 403);
  const editorContext = await browser.newContext(); const editorPage = await editorContext.newPage();
  await editorPage.goto(base + '/admin/'); await editorPage.getByPlaceholder('Email', { exact: true }).fill(`${ids.editor}@example.test`); await editorPage.getByPlaceholder('Password', { exact: true }).fill(password);
  await editorPage.getByRole('button', { name: 'Sign In', exact: true }).click();
  await editorPage.getByRole('heading', { name: 'Content Management System', exact: true }).waitFor();
  assert.equal(await editorPage.getByRole('button', { name: 'Settings', exact: true }).count(), 0);
  assert.equal(await editorPage.evaluate(async () => (await fetch('/api/settings', { credentials: 'include' })).status), 403);
  await editorContext.close(); pass('Admin authorization and existing CSRF enforced; anonymous/Editor access rejected');
  assert.deepEqual(errors, []); pass('no Settings runtime or hydration errors in the browser');
  complete = true;
} finally {
  await browser?.close();
  if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  for (const key of SETTING_KEYS) {
    const row = originalSettings.find((r) => r.key === key);
    if (row) await prisma.siteSetting.upsert({ where: { key }, create: row, update: row });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(ids) } } });
  const extraLogs = (await prisma.auditLog.findMany({ where: { userId: { in: Object.values(ids) } }, select: { id: true } })).filter((r) => !auditIds.has(r.id));
  await prisma.auditLog.deleteMany({ where: { id: { in: extraLogs.map((r) => r.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  assert.deepEqual(await snapshot(), before, 'All original database rows must be restored.');
  pass('database integrity: original settings/rows restored; fixture users/sessions/audits removed');
  console.log(`SETTINGS UI: ${passed} PASS, ${complete ? 0 : 1} FAIL`);
  await prisma.$disconnect();
}
