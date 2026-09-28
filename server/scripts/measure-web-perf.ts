/** Measures public-page loading cost in a real browser (Phase F before/after).
 * Usage: PLAYWRIGHT_EXECUTABLE_PATH=... PERF_BASE_URL=http://127.0.0.1:3100 tsx server/scripts/measure-web-perf.ts
 * Reports, per page and viewport: script bytes transferred, request counts,
 * third-party requests, LCP and CLS (from PerformanceObserver). Read-only.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
assert(executablePath && fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH.');
const base = process.env.PERF_BASE_URL || 'http://127.0.0.1:3100';
const pages = (process.env.PERF_PATHS || '/,/tennis/french-open/2027/schedule/,/search/?q=french').split(',');
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
const RUNS = Number(process.env.PERF_RUNS || 3);

const browser = await chromium.launch({ executablePath, headless: true });
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
try {
  for (const [vpName, viewport] of Object.entries(viewports)) {
    for (const path of pages) {
      const samples: { js: number; requests: number; thirdParty: number; lcp: number; cls: number; ttfb: number; fcp: number }[] = [];
      for (let run = 0; run < RUNS; run++) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.addInitScript(`
          window.__cls = 0; window.__lcp = 0;
          new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
          new PerformanceObserver((l) => { const es = l.getEntries(); window.__lcp = es[es.length - 1].startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
        `);
        await page.goto(base + path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(500);
        // A string (not a function) so the TS loader cannot inject helpers into the page.
        const { cls, lcp, js, requests, thirdParty, ttfb, fcp } = (await page.evaluate(`(() => {
          const res = performance.getEntriesByType('resource');
          const isFont = (h) => h.endsWith('fonts.googleapis.com') || h.endsWith('fonts.gstatic.com');
          const nav = performance.getEntriesByType('navigation')[0];
          const fcp = performance.getEntriesByName('first-contentful-paint')[0];
          return {
            ttfb: nav ? nav.responseStart : 0, fcp: fcp ? fcp.startTime : 0,
            cls: window.__cls, lcp: window.__lcp,
            js: res.filter((r) => r.initiatorType === 'script' || /[.]js([?]|$)/.test(r.name)).reduce((n, r) => n + r.encodedBodySize, 0),
            requests: res.length + 1,
            thirdParty: res.filter((r) => { const u = new URL(r.name); return u.origin !== location.origin && !isFont(u.hostname); }).length,
          };
        })()`)) as { ttfb: number; fcp: number; cls: number; lcp: number; js: number; requests: number; thirdParty: number };
        samples.push({ js, requests, thirdParty, lcp, cls, ttfb, fcp });
        await context.close();
      }
      console.log(JSON.stringify({
        viewport: vpName, path,
        scriptKB: Math.round(median(samples.map((s) => s.js)) / 102.4) / 10,
        requests: median(samples.map((s) => s.requests)),
        thirdPartyRequests: median(samples.map((s) => s.thirdParty)),
        ttfbMs: Math.round(median(samples.map((s) => s.ttfb))),
        fcpMs: Math.round(median(samples.map((s) => s.fcp))),
        lcpMs: Math.round(median(samples.map((s) => s.lcp))),
        cls: Math.round(median(samples.map((s) => s.cls)) * 1000) / 1000,
      }));
    }
  }
} finally {
  await browser.close();
}
