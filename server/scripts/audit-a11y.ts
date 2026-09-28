/** Focused accessibility audit of public pages in a real browser (PHASE G).
 * No extra dependency: a small set of objective checks run in the page, in
 * light and dark mode, desktop and mobile. Not a replacement for a manual
 * screen-reader review.
 *
 *   A11Y_BASE_URL=http://localhost:3000 PLAYWRIGHT_EXECUTABLE_PATH=... npx tsx server/scripts/audit-a11y.ts
 *
 * Checks: <html lang>; one <h1>; no skipped heading levels; main/nav/header/
 * footer landmarks; images have alt; buttons/links/inputs have accessible
 * names; unique ids; text contrast >= 4.5:1 (3:1 for large text).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH.');
const base = process.env.A11Y_BASE_URL || 'http://localhost:3000';
const paths = (process.env.A11Y_PATHS || '/,/sports/,/tennis/,/tennis/french-open/,/tennis/french-open/2027/,/tennis/french-open/2027/schedule/,/events/,/latest/,/search/?q=french,/author/alistair-vance/,/privacy-policy/,/no-such-page/').split(',');

// Runs inside the page. A string so the TS loader cannot inject helpers.
const AUDIT = `(() => {
  const issues = [];
  const push = (rule, el, extra = '') => issues.push({ rule, where: (el && (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''))) || '', text: ((el && (el.textContent || el.getAttribute('aria-label') || '')) || '').trim().slice(0, 50), extra });
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[aria-hidden="true"]'); };
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || el.textContent || el.getAttribute('title') || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join('') || '').trim();
  if (!document.documentElement.lang) push('html-lang', document.documentElement);
  const h1s = [...document.querySelectorAll('h1')].filter(visible);
  if (h1s.length !== 1) push('one-h1', h1s[1] || document.body, 'found ' + h1s.length);
  let last = 0;
  for (const h of [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(visible)) { const lvl = Number(h.tagName[1]); if (last && lvl > last + 1) push('heading-skip', h, 'h' + last + ' -> h' + lvl); last = lvl; }
  for (const sel of ['main', 'header', 'footer', 'nav']) if (!document.querySelector(sel)) push('landmark-' + sel, document.body);
  for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) push('img-alt', img);
  for (const el of document.querySelectorAll('button, a[href], [role=button]')) if (visible(el) && !name(el)) push('control-name', el);
  for (const el of document.querySelectorAll('input:not([type=hidden]), select, textarea')) {
    if (!visible(el)) continue;
    const labelled = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
    if (!labelled) push('input-label', el);
  }
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) push('duplicate-id', document.getElementById(id), id + ' x' + n);
  // Contrast
  // Any CSS color (rgb, oklch, lab...) -> sRGB through a 1x1 canvas; alpha read from the string.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (c) => {
    if (!c || c === 'transparent') return null;
    const am = c.match(/\\/\\s*([\\d.]+%?)\\s*\\)$/) || c.match(/^rgba\\([^)]*,\\s*([\\d.]+)\\)$/);
    const a = am ? (am[1].endsWith('%') ? parseFloat(am[1]) / 100 : parseFloat(am[1])) : 1;
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a };
  };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.backgroundImage !== 'none' && s.backgroundImage) return null; const c = parse(s.backgroundColor); if (c && c.a > 0.9) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('svg,[aria-hidden="true"],[role=tooltip]')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const s = getComputedStyle(el); const fg = parse(s.color); const bg = bgOf(el);
    if (!fg || !bg || fg.a < 0.5) continue;
    const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    const size = parseFloat(s.fontSize); const bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const key = s.color + '|' + (bg.r + ',' + bg.g + ',' + bg.b) + '|' + need;
    if (ratio < need && !seen.has(key)) { seen.add(key); push('contrast', el, ratio.toFixed(2) + ' < ' + need + ' (' + s.color + ' on rgb(' + bg.r + ',' + bg.g + ',' + bg.b + '), ' + size + 'px)'); }
  }
  return issues;
})()`;

const browser = await chromium.launch({ executablePath, headless: true });
let total = 0;
try {
  for (const scheme of ['light', 'dark'] as const) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const ctx = await browser.newContext({ viewport, colorScheme: scheme });
      for (const p of paths) {
        const page = await ctx.newPage();
        await page.goto(base + p, { waitUntil: 'networkidle' });
        const issues = (await page.evaluate(AUDIT)) as { rule: string; where: string; text: string; extra: string }[];
        total += issues.length;
        for (const i of issues) console.log(`${scheme} ${viewport.width}px ${p} :: ${i.rule} ${i.where} "${i.text}" ${i.extra}`);
        await page.close();
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(total ? `FOUND ${total} accessibility issue(s)` : 'PASS no accessibility issues found by the automated checks');
if (total) process.exitCode = 1;
