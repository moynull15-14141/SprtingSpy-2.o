/**
 * UI layout audit in real Chrome (PHASE R UI/UX). Read-only against a running
 * site, plus one disposable Admin account (local development database only)
 * so the CMS screens can be inspected. Reports, per page / viewport / colour
 * scheme: horizontal page overflow and the elements causing it, console and
 * page errors, failed requests; for the CMS also the article editor's column
 * widths. Optional screenshots for review.
 *
 *   UI_BASE_URL=http://localhost:3000 PLAYWRIGHT_EXECUTABLE_PATH=... npx tsx server/scripts/audit-ui-layout.ts
 *   (UI_PATHS=comma list, UI_SHOTS=dir to save screenshots, UI_ADMIN=0 / UI_PUBLIC=0 to skip a part)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH.');
const base = process.env.UI_BASE_URL || 'http://localhost:3000';
const shots = process.env.UI_SHOTS || '';
const paths = (process.env.UI_PATHS || '/,/sports/,/tennis/,/tennis/french-open/,/tennis/french-open/2027/,/tennis/french-open/2027/schedule/,/tennis/tennis-scoring/,/golf/the-masters/2026/,/events/,/events/?when=past,/latest/,/search/?q=french,/search/?q=zzzznothing,/author/alistair-vance/,/privacy-policy/,/about/,/contact/,/no-such-page/').split(',');
const widths = [360, 390, 414, 768, 1280, 1440, 1920];
const OVERFLOW = `(() => {
  const vw = document.documentElement.clientWidth;
  const offenders = [];
  if (document.documentElement.scrollWidth > vw + 1) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('[aria-hidden="true"],.sr-only')) {
        let p = el.parentElement, clipped = false;
        while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clipped = true; break; } p = p.parentElement; }
        if (!clipped) offenders.push((el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ').slice(0, 3).join('.') : '')).slice(0, 90) + ' →' + Math.round(r.right));
      }
    }
  }
  return { scrollWidth: document.documentElement.scrollWidth, vw, offenders: [...new Set(offenders)].slice(0, 6) };
})()`;

const findings: string[] = [];
const browser = await chromium.launch({ executablePath, headless: true });
const visit = async (page: Page, url: string) => {
  const errors: string[] = [];
  const onConsole = (m: { type(): string; text(): string }) => { if (m.type() === 'error' && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) errors.push(m.text().slice(0, 160)); };
  const onError = (e: Error) => errors.push(`pageerror: ${e.message.slice(0, 160)}`);
  const onFail = (r: { url(): string; failure(): { errorText: string } | null }) => { if (!/googletagmanager|google-analytics|googlesyndication/.test(r.url())) errors.push(`requestfailed: ${r.url().replace(base, '')} ${r.failure()?.errorText}`); };
  page.on('console', onConsole); page.on('pageerror', onError); page.on('requestfailed', onFail);
  await page.goto(base + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  const o = await page.evaluate(OVERFLOW) as { scrollWidth: number; vw: number; offenders: string[] };
  page.off('console', onConsole); page.off('pageerror', onError); page.off('requestfailed', onFail);
  return { o, errors };
};

try {
  // ── Public pages ──
  for (const scheme of process.env.UI_PUBLIC === '0' ? [] : ['light', 'dark'] as const) {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: scheme });
      const page = await context.newPage();
      for (const p of paths) {
        const { o, errors } = await visit(page, p);
        if (o.scrollWidth > o.vw + 1) findings.push(`OVERFLOW ${scheme} ${width}px ${p} scrollWidth=${o.scrollWidth} :: ${o.offenders.join(' | ')}`);
        for (const e of errors) findings.push(`ERROR ${scheme} ${width}px ${p} :: ${e}`);
        if (shots && scheme === 'light' && (width === 390 || width === 1440)) await page.screenshot({ path: path.join(shots, `pub-${width}-${p.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: true });
        if (shots && scheme === 'dark' && width === 1440 && ['/', '/tennis/french-open/2027/schedule/', '/tennis/french-open/'].includes(p)) await page.screenshot({ path: path.join(shots, `pub-dark-${p.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: false });
      }
      await context.close();
    }
  }

  // ── CMS ──
  if (process.env.UI_ADMIN !== '0') {
    assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'CMS audit needs the local development database.');
    const id = `ui-audit-${crypto.randomUUID().slice(0, 6)}`;
    const password = `Ui-${crypto.randomUUID()}`;
    await prisma.user.create({ data: { id, name: 'UI Audit Admin', email: `${id}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
    try {
      for (const scheme of ['light', 'dark'] as const) {
        for (const width of [390, 768, 1280, 1440, 1920]) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
          const page = await context.newPage();
          const errors: string[] = [];
          page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.slice(0, 160)}`));
          page.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(m.text().slice(0, 160)); });
          await page.goto(`${base}/admin/`, { waitUntil: 'networkidle' });
          await page.getByPlaceholder('Email').fill(`${id}@example.test`);
          await page.getByPlaceholder('Password', { exact: true }).fill(password);
          await page.getByRole('button', { name: 'Sign In', exact: true }).click();
          await page.getByRole('heading', { name: 'Content Management System' }).waitFor();
          const nav = page.locator('aside nav button, nav[aria-label] button').filter({ hasText: /\S/ });
          // First line only: some items carry a count badge (e.g. "URL Redirects (301/302)" + newline + "3").
          const labels = width < 768 ? [] : (await nav.allInnerTexts()).map((t) => t.trim().split(String.fromCharCode(10))[0].trim()).filter(Boolean);
          const tabs = labels.length ? labels : ['(mobile)'];
          for (const label of tabs) {
            if (label !== '(mobile)') {
              await page.evaluate('window.scrollTo(0, 0)');
              try { await page.locator('aside[aria-label="CMS navigation"] button', { hasText: label }).first().click({ timeout: 5000 }); }
              catch {
                findings.push(`CMS-BLOCKED ${scheme} ${width}px [${label}] nav button not clickable (covered by another element)`);
                if (shots) await page.screenshot({ path: path.join(shots, `cms-blocked-${width}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`) });
                continue;
              }
            }
            await page.waitForTimeout(500);
            const o = await page.evaluate(OVERFLOW) as { scrollWidth: number; vw: number; offenders: string[] };
            if (o.scrollWidth > o.vw + 1) findings.push(`CMS-OVERFLOW ${scheme} ${width}px [${label}] scrollWidth=${o.scrollWidth} :: ${o.offenders.join(' | ')}`);
            if (shots && scheme === 'light' && width === 1440) await page.screenshot({ path: path.join(shots, `cms-1440-${label.replace(/[^a-z0-9]+/gi, '_')}.png`), fullPage: false });
          }
          // Article editor widths.
          if (width >= 768) {
            await page.evaluate('window.scrollTo(0, 0)');
            await page.getByRole('button', { name: 'Articles', exact: true }).first().click();
            await page.getByTestId('create-article-button').click();
            await page.getByTestId('create-article-manual').click();
            await page.waitForTimeout(800);
            const cols = await page.evaluate(`(() => {
              const t = document.querySelector('input[placeholder^="Article title (H1)"]');
              const ed = document.querySelector('#article-body, .ProseMirror');
              const main = document.querySelector('main');
              const r = (el) => el ? Math.round(el.getBoundingClientRect().width) : null;
              return { title: r(t), body: r(ed), main: r(main), sidebar: r(document.querySelector('aside')) };
            })()`);
            findings.push(`EDITOR ${scheme} ${width}px widths ${JSON.stringify(cols)}`);
            if (shots && scheme === 'light') await page.screenshot({ path: path.join(shots, `cms-editor-${width}.png`), fullPage: false });
            const o = await page.evaluate(OVERFLOW) as { scrollWidth: number; vw: number; offenders: string[] };
            if (o.scrollWidth > o.vw + 1) findings.push(`CMS-OVERFLOW ${scheme} ${width}px [editor] scrollWidth=${o.scrollWidth} :: ${o.offenders.join(' | ')}`);
          }
          for (const e of [...new Set(errors)]) findings.push(`CMS-ERROR ${scheme} ${width}px :: ${e}`);
          await context.close();
        }
      }
    } finally {
      await prisma.session.deleteMany({ where: { userId: id } });
      await prisma.auditLog.deleteMany({ where: { userId: id } });
      await prisma.user.deleteMany({ where: { id } });
    }
  }
} finally {
  await browser.close();
  await prisma.$disconnect();
}
for (const f of findings) console.log(f);
console.log(`\n${findings.filter((f) => !f.startsWith('EDITOR')).length} finding(s).`);
