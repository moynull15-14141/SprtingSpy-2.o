/** Read-only real Chrome SEO smoke scan against an isolated local production server. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { loadSiteIndex } from '../seo/siteIndex';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Phase S browser scan requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build first.');
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
assert(fs.existsSync(executablePath), 'Set PLAYWRIGHT_EXECUTABLE_PATH to Chrome/Chromium.');
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>(resolve => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const index = await loadSiteIndex(base);
const first = (kind: string) => index.pages.find(p => p.kind === kind && p.status.indexable)?.path;
const routes = [
  ['Home', '/'], ['Latest', '/latest/'], ['Article', first('article')], ['Event', first('event')],
  ['Edition', first('edition')], ['Sport', first('sport')], ['Author', first('author')],
  ['Events directory', '/events/'], ['Sports directory', '/sports/'],
  ['Category filter', '/latest/?sport=tennis'], ['Article type filter', '/latest/?type=News'],
  ['Search', '/search/?q=tennis'], ['404', '/phase-s-nonexistent/'],
  ...(index.resolve('/faq/') ? [['FAQ', '/faq/']] : []),
].filter((entry): entry is string[] => !!entry[1]);
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, SITE_ORIGIN: base, INDEXNOW_ENDPOINT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`Server did not start: ${output.slice(-800)}`)), 90_000); child.stdout.on('data', chunk => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error(`Server exited: ${output.slice(-800)}`)); }); });
  browser = await chromium.launch({ executablePath, headless: true });
  let inspected = 0;
  for (const [width, colorScheme] of [[390, 'dark'], [768, 'light'], [1280, 'dark'], [1440, 'light']] as const) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    for (const [name, path] of routes) {
      const response = await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const status = response?.status();
      assert.equal(status, name === '404' ? 404 : 200, `${name} ${path}: ${status}`);
      const state = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
        robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || '',
        og: document.querySelector('meta[property="og:title"]')?.getAttribute('content') || '',
        twitter: document.querySelector('meta[name="twitter:card"]')?.getAttribute('content') || '',
        h1: document.querySelectorAll('h1').length,
        breadcrumb: !!document.querySelector('nav[aria-label="Breadcrumb"]'),
        schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent || '{}') as Record<string, unknown>),
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        dark: document.documentElement.classList.contains('dark'),
      }));
      assert.ok(state.title && state.h1 === 1 && !state.overflow, `${name}: title/H1/overflow`);
      if (name !== '404') assert.equal(state.dark, colorScheme === 'dark', `${name}: system theme`);
      assert.deepEqual(pageErrors, [], `${name}: browser page errors`);
      if (name === '404') { assert.ok(!state.canonical && /noindex/i.test(state.robots), `${name}: 404 indexability`); }
      else {
        assert.ok(state.description && state.canonical.startsWith(base) && state.og && state.twitter, `${name}: metadata`);
        const noindex = ['Category filter', 'Article type filter', 'Search'].includes(name);
        assert.equal(/noindex/i.test(state.robots), noindex, `${name}: robots ${state.robots}`);
        if (['Article', 'Event', 'Edition', 'Sport', 'Author'].includes(name)) assert.ok(state.breadcrumb, `${name}: breadcrumb`);
        const schemas = state.schemas.flatMap(value => Array.isArray(value) ? value as Record<string, unknown>[] : [value]);
        for (const schema of schemas) assert.equal(schema['@context'], 'https://schema.org', `${name}: JSON-LD context`);
        const ofType = (type: string) => schemas.find(schema => schema['@type'] === type);
        if (name === 'Home') {
          assert.ok(ofType('Organization')?.['@id'] && ofType('WebSite')?.['@id'], 'Home: coherent Organization/WebSite entities');
        }
        if (name === 'Article') {
          const article = schemas.find(schema => ['Article', 'NewsArticle', 'BlogPosting'].includes(String(schema['@type'])));
          assert.ok(article?.headline && article?.author && article?.publisher && article?.datePublished && article?.mainEntityOfPage, 'Article: core schema fields');
          assert.ok(!Number.isNaN(Date.parse(String(article.datePublished))), 'Article: valid publication date');
        }
        if (name === 'Sport') assert.ok(ofType('CollectionPage'), 'Sport: CollectionPage');
        if (name === 'Author') assert.ok(ofType('ProfilePage')?.mainEntity, 'Author: ProfilePage/Person');
        if (['Article', 'Event', 'Edition', 'Sport', 'Author'].includes(name)) {
          const crumbs = ofType('BreadcrumbList')?.itemListElement as { position: number; name: string; item?: string }[] | undefined;
          assert.ok(crumbs && crumbs.length >= 2, `${name}: BreadcrumbList`);
          crumbs.forEach((crumb, i) => { assert.equal(crumb.position, i + 1); assert.ok(crumb.name); if (i < crumbs.length - 1) assert.ok(crumb.item?.startsWith(base), `${name}: breadcrumb item URL`); });
        }
        if (['Event', 'Edition'].includes(name)) {
          const event = ofType('SportsEvent');
          if (event) { assert.ok(event.name && event.url && event.startDate, `${name}: SportsEvent facts`); assert.ok(!Number.isNaN(Date.parse(String(event.startDate))), `${name}: event date`); }
        }
      }
      inspected++;
    }
    await page.close();
  }
  console.log(`Phase S/T Chrome scan passed: ${inspected} route/viewport/scheme visits; 390/768/1280/1440px with system light/dark.`);
} finally {
  await browser?.close();
  child.kill();
}
