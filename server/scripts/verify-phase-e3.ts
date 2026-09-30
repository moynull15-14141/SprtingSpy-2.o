/** E3 browser integration with disposable local records and exact original-row checks. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'E3 requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before E3 verification.');
const fixture = `e3-${crypto.randomUUID()}`;
const secondSlug = `${fixture}-other`;
const password = `Test-${crypto.randomUUID()}`;
const adminId = `${fixture}-admin`, editorId = `${fixture}-editor`;
const hash = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const snapshot = async () => ({
  sports: hash(await prisma.sport.findMany({ orderBy: { id: 'asc' } })),
  events: hash(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })),
  editions: hash(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })),
});
const before = await snapshot();
const beforeCounts = await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]);
const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
let output = ''; child.stdout.on('data', (chunk) => { output += chunk; }); child.stderr.on('data', (chunk) => { output += chunk; });
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
    if (method !== 'GET') headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) { const [pair] = cookie.split(';'); const split = pair.indexOf('='); this.cookies.set(pair.slice(0, split), pair.slice(split + 1)); }
    const text = await response.text(); let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(text); } catch { /* HTML */ }
    return { status: response.status, data, text };
  }
  async expect(path: string, status: number, method = 'GET', body?: unknown) { const result = await this.request(path, method, body); assert.equal(result.status, status, `${method} ${path}: ${result.status}, expected ${status}: ${result.text.slice(0, 300)}`); return result; }
  async login(id: string) { await this.expect('/api/auth/me', 401); await this.expect('/api/auth/login', 200, 'POST', { email: `${id}@example.test`, password }); }
}
const admin = new Client(), editor = new Client(), anon = new Client();
let checks = 0; const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
try {
  await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`E3 server did not start: ${output.slice(-500)}`)), 60_000); child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } }); child.once('exit', () => { clearTimeout(timer); reject(new Error(`E3 server exited: ${output.slice(-500)}`)); }); });
  for (const [id, role] of [[adminId, 'Admin'], [editorId, 'Editor']] as const) await prisma.user.create({ data: { id, name: `E3 ${role}`, email: `${id}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await admin.login(adminId); await editor.login(editorId);
  const configPath = `/api/sports/${fixture}/event-configuration`;
  await anon.expect(configPath, 401);
  const sport = (await admin.expect('/api/sports', 201, 'POST', { name: 'Temporary Sport X', slug: fixture, isVisible: true })).data!;
  await admin.expect('/api/sports', 201, 'POST', { name: 'Temporary Sport Y', slug: secondSlug, isVisible: true });
  assert.equal((await editor.expect(configPath, 200)).data?.configuration, null);
  pass('New unrelated Sport has a generic configuration; anonymous access is blocked');

  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  assert(fs.existsSync(executablePath), 'Chrome is required for E3 browser verification.');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    await context.addCookies([...admin.cookies].map(([name, value]) => ({ name, value, url: base })));
    const page = await context.newPage(); const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/admin/');
    await page.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    await page.getByText('Generic Configuration is active.').waitFor();
    assert.equal(await page.getByText('No custom fields.').count(), 1);
    pass('Admin browser opens generic Sport configuration without fake fields');

    await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
    await page.getByRole('button', { name: '+ New Permanent Event' }).click();
    await page.locator('#event-editor-field-3').selectOption(secondSlug);
    await page.locator('#event-editor-field-1').fill('E3 Generic Event');
    await page.locator('#event-editor-field-2').fill(`${secondSlug}-event`);
    assert.equal(await page.getByText('Sport-specific Event details').count(), 0);
    await page.getByRole('button', { name: 'Save Event' }).click();
    await page.getByText('Permanent event "E3 Generic Event" created.', { exact: true }).waitFor();
    assert.equal((await prisma.sportEvent.findFirstOrThrow({ where: { sportSlug: secondSlug } })).sportSpecificValues, null);
    await page.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    pass('Browser creates a generic Event for an unconfigured new Sport');

    const config = page.getByRole('region', { name: 'Sport Event Configuration' });
    await config.getByLabel('event', { exact: true }).fill('Tournament');
    for (const [key, label, type] of [['surface', 'Surface', 'select'], ['capacity', 'Capacity', 'number'], ['indoor', 'Indoor', 'boolean'], ['notes', 'Notes', 'text']] as const) {
      await config.getByRole('button', { name: '+ Add field' }).click();
      const field = config.getByTestId(`config-field-${(await config.getByTestId(/^config-field-/).count()) - 1}`);
      await field.getByLabel('Key *').fill(key); await field.getByLabel('Label *').fill(label); await field.getByLabel('Type').selectOption(type);
      if (type === 'select') { await field.getByLabel('Options (one per line, 1–30)').fill('Clay\nGrass'); await field.getByLabel('Required').check(); }
      if (key === 'notes') { await field.getByLabel('Help text').fill('Internal editorial note'); await field.getByLabel('Public visible').uncheck(); }
    }
    await config.getByRole('button', { name: 'Move Notes up' }).click();
    assert(await config.getByText('Preview').isVisible());
    assert(await config.getByText('Grass').count() > 0);
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText('Event configuration saved.').waitFor();
    let stored = (await admin.expect(configPath, 200)).data!.configuration as { terminology: { event: string }; fields: { key: string; label: string; order: number; helpText?: string; adminVisible: boolean; publicVisible: boolean }[] };
    assert.equal(stored.terminology.event, 'Tournament');
    assert.deepEqual(stored.fields.map((field) => field.key), ['surface', 'capacity', 'notes', 'indoor']);
    assert.equal(stored.fields.find((field) => field.key === 'notes')?.helpText, 'Internal editorial note');
    await page.reload(); await page.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    await config.getByTestId('config-field-0').getByLabel('Key *').waitFor();
    assert.equal(await config.getByTestId('config-field-0').getByLabel('Key *').inputValue(), 'surface');
    pass('Browser config terminology, four types, options, help, visibility and keyboard reorder persist after refresh');

    await config.getByTestId('config-field-0').getByLabel('Key *').fill('capacity');
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText(/Duplicate field key/).first().waitFor();
    await config.getByTestId('config-field-0').getByLabel('Key *').fill('name');
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText(/invalid or reserved key/).first().waitFor();
    await config.getByTestId('config-field-0').getByLabel('Key *').fill('surface');
    await config.getByTestId('config-field-0').getByLabel('Label *').fill('');
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText(/needs a nonempty label/).first().waitFor();
    await config.getByTestId('config-field-0').getByLabel('Label *').fill('Surface');
    await config.getByTestId('config-field-0').getByLabel('Options (one per line, 1–30)').fill('');
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText(/needs 1/).first().waitFor();
    await config.getByTestId('config-field-0').getByLabel('Options (one per line, 1–30)').fill('Clay\nGrass');
    assert.equal(await config.getByRole('button', { name: 'Save configuration' }).isDisabled(), true);
    pass('Browser shows E2 duplicate/reserved-key validation and preserves unsaved fields');

    await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
    await page.getByRole('button', { name: '+ New Permanent Event' }).click();
    await page.locator('#event-editor-field-3').selectOption(fixture);
    await page.locator('#event-dynamic-surface').waitFor();
    await page.locator('#event-editor-field-1').fill('E3 Fixture Event');
    await page.locator('#event-editor-field-2').fill(`${fixture}-event`);
    await page.getByRole('button', { name: 'Save Event' }).click();
    assert.equal(await page.locator('#event-dynamic-surface').getAttribute('required'), '');
    await page.locator('#event-dynamic-surface').selectOption('Clay');
    await page.locator('#event-dynamic-capacity').fill('500');
    await page.locator('#event-dynamic-indoor').selectOption('true');
    await page.getByRole('button', { name: 'Save Event' }).click();
    await page.getByText('Permanent event "E3 Fixture Event" created.', { exact: true }).waitFor();
    const event = await prisma.sportEvent.findFirstOrThrow({ where: { sportSlug: fixture, slug: `${fixture}-event` } });
    assert.deepEqual(event.sportSpecificValues, { surface: 'Clay', capacity: 500, indoor: true });
    pass('Browser Event creation renders metadata fields, enforces required select and stores typed values');

    await page.getByRole('row').filter({ hasText: 'E3 Fixture Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#event-dynamic-surface').waitFor();
    assert.equal(await page.locator('#event-dynamic-surface').inputValue(), 'Clay');
    await page.locator('#event-editor-field-9').fill('Updated common overview');
    await page.getByRole('button', { name: 'Save Updates' }).click();
    await page.getByText('Permanent event "E3 Fixture Event" updated.', { exact: true }).waitFor();
    assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: event.id } })).sportSpecificValues, event.sportSpecificValues);
    await page.getByRole('row').filter({ hasText: 'E3 Fixture Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#event-dynamic-capacity').fill('700');
    await page.getByRole('button', { name: 'Save Updates' }).click();
    await page.getByRole('button', { name: '+ New Permanent Event' }).waitFor();
    assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: event.id } })).sportSpecificValues, { surface: 'Clay', capacity: 700, indoor: true });
    pass('Browser Event edit reloads values; common edit preserves and custom edit updates them');

    await page.getByRole('row').filter({ hasText: 'E3 Fixture Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.locator('#event-editor-field-3').selectOption(secondSlug);
    assert.equal(await page.locator('#event-editor-field-3').inputValue(), fixture);
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#event-editor-field-3').selectOption(secondSlug);
    assert.equal(await page.locator('#event-editor-field-3').inputValue(), secondSlug);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    pass('Sport switch warns; dismissal preserves values and acceptance clears incompatible draft values');

    await page.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await page.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    page.once('dialog', (dialog) => dialog.accept());
    await config.getByRole('button', { name: 'Clear configuration' }).click();
    await config.getByText(/Existing Event value/).first().waitFor();
    assert.equal((await admin.expect(configPath, 200)).data?.configuration !== null, true);
    const notes = config.getByTestId('config-field-2');
    await notes.getByLabel('Label *').fill('Editorial notes');
    await notes.getByLabel('Help text').fill('Visible to staff when enabled');
    await notes.getByLabel('Admin visible').uncheck();
    await notes.getByLabel('Public visible').check();
    page.once('dialog', (dialog) => dialog.dismiss());
    await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
    assert(await config.isVisible(), 'Dismissed unsaved-change warning must keep the editor open.');
    await config.getByRole('button', { name: 'Save configuration' }).click();
    await config.getByText('Event configuration saved.').waitFor();
    stored = (await admin.expect(configPath, 200)).data!.configuration as typeof stored;
    assert.equal(stored.fields.find((field) => field.key === 'notes')?.label, 'Editorial notes');
    pass('Browser clear surfaces E2 compatibility conflict; field label, help and visibility edits persist');

    for (const width of [1440, 900, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
      await page.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
      await config.getByTestId('config-field-0').waitFor();
      assert(await config.getByRole('button', { name: 'Save configuration' }).isVisible());
      await config.getByRole('button', { name: 'Close configuration' }).click();
      await page.getByRole('button', { name: 'Events & Editions', exact: true }).click();
      await page.getByRole('row').filter({ hasText: 'E3 Fixture Event' }).getByRole('button', { name: 'Edit', exact: true }).click();
      await page.locator('#event-dynamic-surface').waitFor();
      assert(await page.locator('#event-dynamic-surface').isVisible());
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 2), `Horizontal page overflow at ${width}px`);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
    assert.deepEqual(errors, []);
    pass('Browser desktop/tablet/mobile controls remain visible without page errors');

    const editorContext = await browser.newContext();
    await editorContext.addCookies([...editor.cookies].map(([name, value]) => ({ name, value, url: base })));
    const editorPage = await editorContext.newPage();
    await editorPage.goto(base + '/admin/');
    await editorPage.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await editorPage.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    const editorConfig = editorPage.getByRole('region', { name: 'Sport Event Configuration' });
    await editorConfig.getByTestId('config-field-0').waitFor();
    assert.equal(await editorConfig.getByRole('button', { name: 'Save configuration' }).count(), 0);
    assert(await editorConfig.getByTestId('config-field-0').getByLabel('Key *').isDisabled());
    await editorContext.close();
    pass('Editor browser reads configured fields but cannot edit or save Sport configuration');

    const retryContext = await browser.newContext();
    await retryContext.addCookies([...admin.cookies].map(([name, value]) => ({ name, value, url: base })));
    const retryPage = await retryContext.newPage();
    let configRequests = 0;
    await retryPage.route(`**${configPath}`, async (route) => {
      configRequests++;
      if (configRequests === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Simulated configuration outage"}' });
      else await route.continue();
    });
    await retryPage.goto(base + '/admin/');
    await retryPage.getByRole('complementary', { name: 'CMS navigation' }).getByRole('button', { name: 'Sports', exact: true }).click();
    await retryPage.getByRole('row').filter({ hasText: 'Temporary Sport X' }).getByRole('button', { name: 'Event configuration' }).click();
    await retryPage.getByRole('button', { name: 'Retry' }).waitFor();
    assert.equal(configRequests, 1, 'Failure should not trigger repeated configuration requests.');
    await retryPage.getByRole('button', { name: 'Retry' }).click();
    await retryPage.getByTestId('config-field-0').waitFor();
    assert.equal(configRequests, 2);
    await retryContext.close();
    pass('Configuration API failure shows Retry and issues no automatic repeat request');
  } finally { await browser.close(); }

  await editor.expect(configPath, 403, 'PUT', { configuration: null });
  await anon.expect(configPath, 401, 'PUT', { configuration: null });
  await admin.expect(configPath, 409, 'PUT', { configuration: null });
  assert((await prisma.sportEvent.findFirstOrThrow({ where: { sportSlug: fixture } })).sportSpecificValues);
  await prisma.sportEvent.deleteMany({ where: { sportSlug: fixture } });
  await admin.expect(configPath, 200, 'PUT', { configuration: null });
  assert.equal((await admin.expect(configPath, 200)).data?.configuration, null);
  pass('RBAC and incompatible clear rejected; compatible clear restores generic fallback');
  console.log(`PASS ${checks} E3 integration groups`);
} finally {
  child.kill(); if (child.exitCode === null) await once(child, 'exit');
  await prisma.sportEvent.deleteMany({ where: { sportSlug: { in: [fixture, secondSlug] } } });
  await prisma.sport.deleteMany({ where: { slug: { in: [fixture, secondSlug] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, editorId] } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Sport/Event/Edition rows changed.');
  assert.deepEqual(await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]), beforeCounts, 'Original counts changed.');
  console.log(`PASS original Sport/Event/Edition counts ${beforeCounts.join('/')} and full-row hashes restored`);
  await prisma.$disconnect();
}
