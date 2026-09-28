/** Phase E search UI verification in a real browser (running dev/prod server).
 * Uses existing published content for public checks and a disposable Admin
 * user for the CMS article search; the user is removed in finally.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'UI verification requires a local development database.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to an installed Chromium executable.');
const base = process.env.UI_BASE_URL || 'http://localhost:3000';
const fixture = `search-ui-${crypto.randomUUID()}`;
const userId = `${fixture}-admin`;
const email = `${fixture}@example.test`;
const password = `Ui-${crypto.randomUUID()}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const pass = (s: string) => console.log(`PASS ${s}`);

// A real published title word to search for.
const sample = await prisma.article.findFirstOrThrow({ where: { status: 'published', sport: { isVisible: true } }, orderBy: { publishedAt: 'desc' } });
const word = (sample.title.match(/[A-Za-z]{5,}/g) ?? ['french'])[0].toLowerCase();

try {
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let suggestionRequests = 0;
  page.on('request', (r) => { if (r.url().includes('/api/search/suggestions')) suggestionRequests++; });

  await page.goto(`${base}/search/`, { waitUntil: 'networkidle' });
  const box = page.getByRole('combobox', { name: 'Search SportingSpy' });
  assert(await box.evaluate((el) => el === document.activeElement), 'empty search page focuses the input');
  await box.pressSequentially(word, { delay: 25 });
  const list = page.getByRole('listbox', { name: 'Search suggestions' });
  await list.waitFor({ state: 'visible' });
  assert(suggestionRequests <= 2, `debounce: ${suggestionRequests} suggestion requests while typing "${word}"`);
  const options = await list.getByRole('option').count();
  assert(options > 0 && options <= 9, 'a short suggestion list is shown');
  await box.press('Escape');
  await list.waitFor({ state: 'hidden' });
  await box.press('ArrowDown');
  await list.waitFor({ state: 'visible' });
  assert.equal(await list.getByRole('option').first().getAttribute('aria-selected'), 'true', 'ArrowDown highlights the first suggestion');
  assert.equal(await box.getAttribute('aria-activedescendant'), await list.getByRole('option').first().getAttribute('id'));
  pass('autocomplete is debounced, limited and keyboard-operable (type, Escape, ArrowDown, aria-activedescendant)');

  const target = (await list.getByRole('option').first().locator('span').first().textContent())?.trim();
  assert(target, 'suggestion has a label');
  await box.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/search'));
  await page.waitForFunction((t) => document.querySelector('h1')?.textContent?.includes(t), target);
  pass('Enter on a highlighted suggestion opens that page');

  await page.goto(`${base}/search/`, { waitUntil: 'networkidle' });
  await page.getByRole('combobox', { name: 'Search SportingSpy' }).fill(word);
  await page.getByRole('combobox', { name: 'Search SportingSpy' }).press('Enter');
  await page.waitForURL((u) => u.searchParams.get('q') === word);
  await page.locator('ol mark').first().waitFor();
  const resultsHeading = await page.locator('#search-results-heading').innerText();
  assert.match(resultsHeading, new RegExp(`results? for “${word}”`, 'i'));
  pass('Enter without a highlighted suggestion submits a URL-driven search with highlighted results');

  const sportSelect = page.locator('select[name="sport"]');
  const firstSport = await sportSelect.locator('option').nth(1).getAttribute('value');
  await sportSelect.selectOption(firstSport!);
  await page.waitForURL((u) => u.searchParams.get('sport') === firstSport && u.searchParams.get('q') === word);
  await page.locator('select[name="sort"]').selectOption('oldest');
  await page.waitForURL((u) => u.searchParams.get('sort') === 'oldest' && u.searchParams.get('sport') === firstSport);
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.locator('select[name="sport"]').inputValue(), firstSport, 'filters survive reload (bookmarkable)');
  await page.screenshot({ path: path.join('.codex-runtime', 'search-desktop.png') });
  pass('filters and sorting live in the URL and survive reload');

  await page.goto(`${base}/search/?q=xv${crypto.randomUUID().replace(/[^a-z]/g, '')}`, { waitUntil: 'networkidle' });
  assert(await page.getByText('No results found for').isVisible());
  pass('no-result state is shown');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/search/?q=${word}`, { waitUntil: 'networkidle' });
  assert(!(await page.locator('#search-filters').isVisible()), 'filters are collapsed on mobile');
  await page.getByRole('button', { name: /Filters/ }).click();
  assert(await page.locator('#search-filters').isVisible(), 'filter sheet opens');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Close filters', 'focus moves into the sheet');
  assert.equal(await page.locator('#search-filters').getAttribute('role'), 'dialog');
  await page.screenshot({ path: path.join('.codex-runtime', 'search-mobile-filters.png') });
  await page.keyboard.press('Escape');
  assert(!(await page.locator('#search-filters').isVisible()), 'Escape closes the filter sheet');
  assert.match(await page.evaluate(() => document.activeElement?.textContent || ''), /Filters/, 'focus returns to the Filters button');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow on mobile');
  pass('mobile: filters open as a dialog sheet with focus inside, close with Escape returning focus, and the page has no horizontal overflow');

  // CMS article search (server-side, paged).
  await prisma.user.create({ data: { id: userId, name: 'Search UI Verifier', email, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('heading', { name: 'Content Management System' }).waitFor();
  await page.getByRole('button', { name: /Articles/ }).click();
  const cmsSearch = page.getByPlaceholder('Title, text, slug or article ID…');
  await cmsSearch.waitFor();
  await page.waitForFunction(() => document.querySelectorAll('tbody tr p').length > 0);
  const all = await page.locator('tbody tr').count();
  const response = page.waitForResponse((r) => r.url().includes('/api/cms/articles/search') && r.url().includes(`q=${sample.id}`));
  await cmsSearch.fill(sample.id);
  await response;
  await page.waitForFunction((t) => document.querySelector('tbody tr p')?.textContent === t, sample.title);
  assert(await page.locator('tbody tr').count() <= all);
  pass('CMS article list searches on the server (by article id here) and shows the match first');

  assert.deepEqual(errors, [], `Browser errors: ${errors.join('; ')}`);
} finally {
  await browser?.close();
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
