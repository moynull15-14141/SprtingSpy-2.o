/** Phase E search loading / failure / recovery states in a real browser.
 * Local database only. Starts the production build on a random port whose
 * database connections use a short lock_timeout, then makes the search query
 * fail by holding a read-blocking lock on "Article" inside a transaction that
 * is rolled back (no data is written). The public layout (Sport/Settings
 * queries) keeps working, so only the search segment fails. No production
 * code is modified for this test.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Requires a local, non-production database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chromium executable.');

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://127.0.0.1:${port}`;
const dbUrl = new URL(process.env.DATABASE_URL!);
dbUrl.searchParams.set('options', '-c lock_timeout=4000');
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, DATABASE_URL: dbUrl.toString(), PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', TRUST_PROXY: 'false', ALLOWED_ORIGIN: base, GEMINI_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = ''; child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pass = (s: string) => console.log(`PASS ${s}`);
// While a streamed Suspense boundary is revealed, React briefly holds the new
// content in a hidden container, so wait until exactly one visible results
// heading remains (a persistent duplicate id would fail here).
const resultsSettled = (p: import('playwright-core').Page, timeout = 10_000) =>
  p.waitForFunction(() => { const h = document.querySelectorAll('#search-results-heading'); return h.length === 1 && !!(h[0] as HTMLElement).offsetParent; }, undefined, { timeout });
const before = await prisma.article.count();

try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${output}`)), 30_000);
    child.stdout.on('data', (c) => { if (String(c).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited. ${output}`)); });
  });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // 1. Loading state: a filter change while the search query is held up
  //    server-side (lock held < lock_timeout, then released).
  await page.goto(`${base}/search/?q=french`, { waitUntil: 'networkidle' });
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('LOCK TABLE "Article" IN ACCESS EXCLUSIVE MODE');
    await page.locator('select[name="sort"]').selectOption('oldest');
    await page.getByRole('status', { name: 'Loading search results' }).waitFor({ state: 'visible', timeout: 3000 });
  }, { timeout: 30_000, maxWait: 10_000 });
  await page.waitForURL((u) => u.searchParams.get('sort') === 'oldest');
  await resultsSettled(page, 10_000);
  assert.equal(await page.getByRole('status', { name: 'Loading search results' }).count(), 0, 'skeleton is replaced by results');
  pass('changing a filter/sort on /search shows the loading skeleton while the query runs, then the results');

  // 2. Suggestions API failure: the box keeps working, nothing breaks.
  await page.route('**/api/search/suggestions**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' }));
  await page.goto(`${base}/search/`, { waitUntil: 'networkidle' });
  const box = page.getByRole('combobox', { name: 'Search SportingSpy' });
  await box.pressSequentially('fren', { delay: 20 });
  await page.waitForResponse('**/api/search/suggestions**');
  await page.waitForTimeout(150);
  assert(!(await page.getByRole('listbox', { name: 'Search suggestions' }).isVisible()), 'no suggestion list on API failure');
  await box.press('Enter');
  await page.waitForURL((u) => u.searchParams.get('q') === 'fren');
  await resultsSettled(page);
  await page.unroute('**/api/search/suggestions**');
  pass('a failing suggestions API degrades silently; submitting the search still works');

  // 3. Search failure (database lock) and recovery.
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('LOCK TABLE "Article" IN ACCESS EXCLUSIVE MODE');
    await page.goto(`${base}/search/?q=prize`, { waitUntil: 'load' });
    await page.getByRole('heading', { name: 'Search is temporarily unavailable' }).waitFor({ timeout: 15_000 });
    const text = await page.locator('body').innerText();
    assert(!/lock|timeout|prisma|stack|at \w+ \(/i.test(text), `no internal error details shown: ${text.slice(0, 300)}`);
    assert(await page.getByRole('navigation').first().isVisible(), 'site header/navigation still renders');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no broken layout / horizontal overflow');
    await page.screenshot({ path: path.join('.codex-runtime', 'search-error-state.png') });
  }, { timeout: 60_000, maxWait: 10_000 });
  pass('a failing search shows a friendly error inside the intact site layout, without internal details');

  await page.getByRole('button', { name: 'Try again' }).click();
  await resultsSettled(page, 15_000);
  // PHASE M: when Events also match, the heading reads "N articles and M events for …".
  assert.match(await page.locator('#search-results-heading').innerText(), /(results?|articles? and \d+ events?) for “prize”/);
  pass('"Try again" recovers once the database is available again');

  // React #441 is the production-sanitized report of the deliberately failed
  // server render ("specific message is omitted in production builds"); it
  // carries no internal details. Anything else is a real failure.
  const unexpectedPage = pageErrors.filter((m) => !/Minified React error #441/.test(m));
  assert.deepEqual(unexpectedPage, [], `uncaught page errors: ${unexpectedPage.join('; ')}`);
  assert(pageErrors.every((m) => !/lock|timeout|prisma|Article/i.test(m)), 'reported errors leak no internal details');
  const unexpected = consoleErrors.filter((m) => !/500|Failed to load resource|Server Components render|digest|Minified React error #441/i.test(m));
  assert.deepEqual(unexpected, [], `unexpected console errors: ${unexpected.join('; ')}`);
  console.log(`     console errors observed (expected: the forced 500 and the server-render failure): ${consoleErrors.length}`);
  pass('no unexpected page or console errors; the forced failures are reported only in sanitized form');
  assert.equal(await prisma.article.count(), before, 'no article rows changed');
} finally {
  await browser?.close();
  child.kill(); await once(child, 'exit').catch(() => undefined);
  await prisma.$disconnect();
}
