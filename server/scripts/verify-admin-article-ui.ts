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
const fixture = `newsroom-ui-${crypto.randomUUID()}`;
const userId = `${fixture}-admin`;
const email = `${fixture}@example.test`;
const password = `Ui-${crypto.randomUUID()}`;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
type Region = { height: number; top: number; overflowY: string; scrollHeight: number; clientHeight: number };
type ScrollState = { page: number; editor: number; seo: number; titleTop: number; toolbarTop: number; columnTop: number };

try {
  await prisma.user.create({ data: { id: userId, name: 'Newsroom UI Verifier', email, role: 'Admin', avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.getByRole('heading', { name: 'Content Management System' }).waitFor();

  await page.getByRole('button', { name: /Articles/ }).click();
  const create = page.getByTestId('create-article-button');
  await create.waitFor();
  await create.click();
  await page.getByRole('heading', { name: 'New Article Guided Workflow' }).waitFor();
  assert.equal(await page.getByRole('columnheader', { name: 'Title & Hierarchy' }).count(), 0, 'article repository must not compete with the editor workspace');
  const title = page.getByLabel('Article Title (H1) *');
  assert(await page.evaluate("document.activeElement === document.querySelector('#article-title')"), 'Create Article should focus the title field.');
  await page.locator('#article-body').waitFor();

  const layout = await page.evaluate(`(() => {
    const rect = (selector) => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      return { height: r.height, top: r.top, overflowY: getComputedStyle(el).overflowY, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    };
    return { nav: rect('.cms-admin-nav'), editor: rect('.cms-editor-column'), seo: rect('.cms-seo-sidebar'), workspace: rect('.cms-workspace-frame') };
  })()`) as { nav: Region; editor: Region; seo: Region; workspace: Region };
  assert(layout.workspace.height <= 900 && layout.workspace.height >= 550, 'workspace must use the available viewport height');
  const pageScroll = await page.evaluate(`({ scrollHeight: document.documentElement.scrollHeight, innerHeight, footerVisible: !!document.querySelector('footer')?.getClientRects().length })`) as { scrollHeight: number; innerHeight: number; footerVisible: boolean };
  assert(pageScroll.scrollHeight <= pageScroll.innerHeight + 1, 'desktop CMS must not make the browser page scroll (the sidebar would move)');
  assert(!pageScroll.footerVisible, 'public footer must not render inside the CMS workspace');
  assert.equal(layout.editor.overflowY, 'auto');
  assert.equal(layout.seo.overflowY, 'auto');
  assert(layout.editor.scrollHeight > layout.editor.clientHeight, 'article column must have independent overflow');
  assert(layout.seo.scrollHeight > layout.seo.clientHeight, 'SEO column must have independent overflow');

  const before = await page.evaluate(`({ page: scrollY, editor: document.querySelector('.cms-editor-column').scrollTop, seo: document.querySelector('.cms-seo-sidebar').scrollTop, titleTop: document.querySelector('.cms-title-hierarchy').getBoundingClientRect().top, toolbarTop: document.querySelector('.cms-editor-toolbar').getBoundingClientRect().top, columnTop: document.querySelector('.cms-editor-column').getBoundingClientRect().top })`) as ScrollState;
  await page.evaluate(`document.querySelector('.cms-editor-column').scrollTop = 650`);
  const afterEditor = await page.evaluate(`({ page: scrollY, editor: document.querySelector('.cms-editor-column').scrollTop, seo: document.querySelector('.cms-seo-sidebar').scrollTop, titleTop: document.querySelector('.cms-title-hierarchy').getBoundingClientRect().top, toolbarTop: document.querySelector('.cms-editor-toolbar').getBoundingClientRect().top, columnTop: document.querySelector('.cms-editor-column').getBoundingClientRect().top })`) as ScrollState;
  assert(afterEditor.editor > 0, 'article column did not scroll');
  assert.equal(afterEditor.seo, before.seo, 'article scrolling moved the SEO panel');
  assert.equal(afterEditor.page, before.page, 'article scrolling moved the browser page');
  // Title & Hierarchy scrolls away with the content (more writing room); the
  // formatting toolbar stays pinned at the top of the article column.
  assert(afterEditor.titleTop < before.titleTop - 100, 'Title & Hierarchy should scroll away with the content');
  // Scroll past the toolbar's own position: it must then stick to the column top.
  const pinned = await page.evaluate(`(() => { const col = document.querySelector('.cms-editor-column'); col.scrollTop = ${before.toolbarTop - before.columnTop + 200}; return { toolbarTop: document.querySelector('.cms-editor-toolbar').getBoundingClientRect().top, columnTop: col.getBoundingClientRect().top, page: scrollY }; })()`) as { toolbarTop: number; columnTop: number; page: number };
  assert(Math.abs(pinned.toolbarTop - pinned.columnTop) < 2 && pinned.page === 0, `formatting toolbar should stay pinned at the top of the article column: ${JSON.stringify(pinned)}`);
  await page.evaluate(`document.querySelector('.cms-editor-column').scrollTop = 650`);

  await page.evaluate(`document.querySelector('.cms-seo-sidebar').scrollTop = 500`);
  const afterSeo = await page.evaluate(`({ editor: document.querySelector('.cms-editor-column').scrollTop, seo: document.querySelector('.cms-seo-sidebar').scrollTop })`) as Pick<ScrollState, 'editor' | 'seo'>;
  assert(afterSeo.seo > 0, 'SEO panel did not scroll');
  assert.equal(afterSeo.editor, afterEditor.editor, 'SEO scrolling moved the article column');

  await page.screenshot({ path: path.join('.codex-runtime', 'admin-article-ui-fixed.png'), fullPage: false });
  // Laptop width: the pane is too narrow for Article | SEO columns, so the
  // content pane itself must scroll (nothing may be clipped).
  await page.setViewportSize({ width: 1280, height: 800 });
  const laptop = await page.evaluate(`(() => {
    const main = document.querySelector('.cms-main');
    main.scrollTop = main.scrollHeight;
    const seo = document.querySelector('.cms-seo-sidebar').getBoundingClientRect();
    const pane = main.getBoundingClientRect();
    return { pageHeight: document.documentElement.scrollHeight, innerHeight, seoBottom: seo.bottom, paneBottom: pane.bottom, scrolled: main.scrollTop > 0 };
  })()`) as { pageHeight: number; innerHeight: number; seoBottom: number; paneBottom: number; scrolled: boolean };
  assert(laptop.pageHeight <= laptop.innerHeight + 1, 'laptop CMS must not make the browser page scroll');
  assert(laptop.scrolled && laptop.seoBottom <= laptop.paneBottom + 1, 'laptop article form must be reachable by scrolling the content pane');
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.evaluate(`({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    gridColumns: getComputedStyle(document.querySelector('.cms-article-grid')).gridTemplateColumns,
    editorOverflow: getComputedStyle(document.querySelector('.cms-editor-column')).overflowY
  })`) as { pageWidth: number; viewportWidth: number; gridColumns: string; editorOverflow: string };
  assert(mobile.pageWidth <= mobile.viewportWidth, 'mobile article editor has horizontal page overflow');
  assert(!mobile.gridColumns.includes(' '), 'mobile editor must use one column');
  assert.notEqual(mobile.editorOverflow, 'auto', 'mobile must return to the normal page flow');
  await page.getByRole('button', { name: /Back to articles/ }).click();
  await page.getByTestId('create-article-button').waitFor();
  assert.deepEqual(pageErrors, [], `Browser errors: ${pageErrors.join('; ')}`);
  console.log('PASS Create New Article opens and focuses the real editor');
  console.log('PASS sidebar workspace height is viewport-aware');
  console.log('PASS Article and SEO columns scroll independently; browser page remains stable');
  console.log('PASS Title & Hierarchy scrolls away with the content while the formatting toolbar stays pinned');
  console.log('PASS mobile editor stacks without horizontal overflow and Back returns to the repository');
} finally {
  await browser?.close();
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.auditLog.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
