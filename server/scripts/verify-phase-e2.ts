/** E2 integration: Sport configuration, generic fallback and existing-row integrity. */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';
import { getEventPage } from '../services/public/content';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'E2 verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Run npm run build before E2 verification.');
const fixture = `e2-${crypto.randomUUID()}`;
const slug = fixture;
const users = { admin: `${fixture}-admin`, editor: `${fixture}-editor` };
const password = `Test-${crypto.randomUUID()}`;
const digest = (rows: unknown) => crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function snapshot() {
  return {
    sports: digest(await prisma.sport.findMany({ orderBy: { id: 'asc' } })),
    events: digest(await prisma.sportEvent.findMany({ orderBy: { id: 'asc' } })),
    editions: digest(await prisma.eventEdition.findMany({ orderBy: { id: 'asc' } })),
  };
}
const before = await snapshot();
const beforeCounts = await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]);
const probe = createServer();
probe.listen(0, '127.0.0.1');
await once(probe, 'listening');
const port = (probe.address() as { port: number }).port;
await new Promise<void>((resolve) => probe.close(() => resolve()));
const base = `http://localhost:${port}`;
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, csrf = true) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') };
    if (method !== 'GET' && csrf) headers['x-csrf-token'] = this.cookies.get('csrf_token') || '';
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const split = pair.indexOf('=');
      this.cookies.set(pair.slice(0, split), pair.slice(split + 1));
    }
    const text = await response.text();
    let data: Record<string, unknown> | null = null;
    try { data = JSON.parse(text); } catch { /* public HTML */ }
    return { status: response.status, data, text };
  }
  async expect(path: string, code: number, method = 'GET', body?: unknown, csrf = true) {
    const result = await this.request(path, method, body, csrf);
    assert.equal(result.status, code, `${method} ${path}: got ${result.status}, expected ${code}: ${result.text.slice(0, 300)}`);
    return result;
  }
  async login(id: string) {
    await this.expect('/api/auth/me', 401);
    await this.expect('/api/auth/login', 200, 'POST', { email: `${id}@example.test`, password });
  }
}
const admin = new Client();
const editor = new Client();
const anon = new Client();
let checks = 0;
const pass = (message: string) => { checks++; console.log(`PASS ${message}`); };
const configPath = `/api/sports/${slug}/event-configuration`;
const eventBase = { name: 'E2 Padel Open', slug: `${slug}-event`, sportSlug: slug };
const fields = [
  { key: 'surface', label: 'Surface', type: 'select', required: false, order: 20, helpText: 'Confirmed playing surface.', adminVisible: true, publicVisible: true, options: ['Clay', 'Grass', 'Hard'] },
  { key: 'capacity', label: 'Capacity', type: 'number', required: false, order: 10, adminVisible: true, publicVisible: true },
  { key: 'indoor', label: 'Indoor', type: 'boolean', required: false, order: 30, adminVisible: true, publicVisible: true },
  { key: 'internal_note', label: 'Internal note', type: 'textarea', required: false, order: 40, adminVisible: true, publicVisible: false },
  { key: 'official_page', label: 'Official page', type: 'url', required: false, order: 50, adminVisible: true, publicVisible: true },
  { key: 'opening_day', label: 'Opening day', type: 'date', required: false, order: 60, adminVisible: true, publicVisible: true },
];
const configuration = { terminology: { event: 'Tournament', participant: 'Players', venue: 'Court' }, fields };
try {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`E2 server did not start: ${output.slice(-500)}`)), 60_000);
    if (output.includes('Server running')) { clearTimeout(timer); resolve(); return; }
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('Server running')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`E2 server exited: ${output.slice(-500)}`)); });
  });
  for (const [role, id] of [['Admin', users.admin], ['Editor', users.editor]] as const) {
    await prisma.user.create({ data: { id, name: `E2 ${role}`, email: `${id}@example.test`, role, avatar: '/favicon.ico', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  }
  await admin.login(users.admin);
  await editor.login(users.editor);
  await anon.expect(configPath, 401);
  await admin.expect(configPath, 404);
  await admin.expect(`/api/sports/${slug}/event-configuration`, 404, 'PUT', { configuration });
  pass('Unknown Sport configuration fails safely; anonymous access and writes are blocked');

  const createdSport = (await admin.expect('/api/sports', 201, 'POST', { name: 'E2 Padel Fixture', slug, isVisible: true })).data!;
  const sportId = String(createdSport.id);
  const generic = (await editor.expect(configPath, 200)).data!;
  assert.equal((generic.resolved as { configured: boolean }).configured, false);
  assert.deepEqual((generic.resolved as { fields: unknown[] }).fields, []);
  assert.equal((generic.resolved as { terminology: { venue: string } }).terminology.venue, 'Venue');
  const genericEvent = (await editor.expect('/api/events', 201, 'POST', eventBase)).data!;
  assert.equal(genericEvent.sportSpecificValues, null);
  assert.equal((await anon.expect(`/${slug}/${eventBase.slug}/`, 200)).status, 200);
  pass('New Sport and Event work with generic configuration; no sport-specific values are fabricated');

  await editor.expect(configPath, 403, 'PUT', { configuration });
  await admin.expect(configPath, 403, 'PUT', { configuration }, false);
  const invalid = async (config: unknown) => { const result = await admin.expect(configPath, 400, 'PUT', { configuration: config }); assert(result.data?.error); };
  await invalid({ ...configuration, terminology: { event: '' } });
  await invalid({ ...configuration, terminology: { venue: 'Event' } });
  await invalid({ ...configuration, terminology: { unknown: 'Thing' } });
  await invalid({ ...configuration, fields: [fields[0], { ...fields[1], key: 'surface' }] });
  await invalid({ ...configuration, fields: [{ ...fields[0], type: 'entity' }] });
  await invalid({ ...configuration, fields: [{ ...fields[0], options: [] }] });
  await invalid({ ...configuration, fields: [{ ...fields[0], options: ['Clay', 'clay'] }] });
  await invalid({ ...configuration, fields: [fields[0], { ...fields[1], order: 20 }] });
  await invalid({ ...configuration, fields: [{ ...fields[0], key: 'defaultVenue' }] });
  await invalid({ ...configuration, fields: [{ ...fields[0], required: true, adminVisible: false }] });
  assert.equal((await prisma.sport.findUniqueOrThrow({ where: { id: sportId } })).eventConfiguration, null);
  pass('Admin-only configuration writes enforce CSRF, terminology, field keys/types/options/order and required visibility');

  await admin.expect(configPath, 200, 'PUT', { configuration });
  const configured = (await editor.expect(configPath, 200)).data!;
  assert.equal((configured.resolved as { configured: boolean }).configured, true);
  assert.deepEqual((configured.resolved as { fields: { key: string }[] }).fields.map((field) => field.key), ['capacity', 'surface', 'indoor', 'internal_note', 'official_page', 'opening_day']);
  assert.equal((configured.resolved as { terminology: { competition: string } }).terminology.competition, 'Competition');
  const legacy = await getEventPage(slug, eventBase.slug);
  assert(legacy && Object.keys(legacy.sportSpecificValues).length === 0);
  pass('Configured terminology inherits generic labels; existing generic Event remains readable and unchanged');

  const requiredConfig = { ...configuration, fields: fields.map((field) => field.key === 'surface' ? { ...field, required: true } : field) };
  await admin.expect(configPath, 200, 'PUT', { configuration: requiredConfig });
  assert(await getEventPage(slug, eventBase.slug), 'Existing Event without newly required field remains readable.');
  await editor.expect('/api/events', 400, 'POST', { ...eventBase, slug: `${slug}-second` });
  await editor.expect('/api/events', 400, 'POST', { ...eventBase, slug: `${slug}-second`, sportSpecificValues: { surface: 'Ice' } });
  await editor.expect('/api/events', 400, 'POST', { ...eventBase, slug: `${slug}-second`, sportSpecificValues: { surface: 'Clay', unknown: 'invented' } });
  await editor.expect('/api/events', 400, 'POST', { ...eventBase, slug: `${slug}-second`, sportSpecificValues: { surface: 'Clay', official_page: 'javascript:alert(1)' } });
  await editor.expect('/api/events', 400, 'POST', { ...eventBase, slug: `${slug}-second`, sportSpecificValues: { surface: 'Clay', opening_day: '2098-02-30' } });
  const values = { surface: 'Grass', capacity: 500, indoor: false, internal_note: 'Editor-only note', official_page: 'https://example.org/official', opening_day: '2098-04-01' };
  const configuredEvent = (await editor.expect('/api/events', 201, 'POST', { ...eventBase, slug: `${slug}-second`, sportSpecificValues: values })).data!;
  const configuredEventId = String(configuredEvent.id);
  assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: configuredEventId } })).sportSpecificValues, values);
  pass('Required fields apply to new Events; invalid/unknown values rejected; valid typed values stored separately');

  await editor.expect(`/api/events/${configuredEventId}`, 200, 'PUT', { name: 'E2 Padel Open Updated' });
  assert.deepEqual((await prisma.sportEvent.findUniqueOrThrow({ where: { id: configuredEventId } })).sportSpecificValues, values);
  await editor.expect(`/api/events/${configuredEventId}`, 400, 'PUT', { sportSpecificValues: { capacity: 700 } });
  await editor.expect(`/api/events/${configuredEventId}`, 400, 'PUT', { sportSpecificValues: { ...values, surface: null } });
  const revised = { ...values, capacity: 700, internal_note: 'Private planning note' };
  await editor.expect(`/api/events/${configuredEventId}`, 200, 'PUT', { sportSpecificValues: revised });
  const publicPage = await getEventPage(slug, `${slug}-second`);
  assert(publicPage);
  assert.equal(publicPage.sportSpecificValues.capacity, 700);
  assert.equal(publicPage.sportSpecificValues.surface, 'Grass');
  assert(!('internal_note' in publicPage.sportSpecificValues));
  assert(!publicPage.sportConfiguration.fields.some((field) => field.key === 'internal_note'));
  assert(!JSON.stringify(publicPage).includes('Private planning note'));
  pass('Unrelated Event updates preserve values; public contract exposes only public-visible definitions and values');

  const changedOptions = { ...requiredConfig, fields: requiredConfig.fields.map((field) => field.key === 'surface' ? { ...field, options: ['Clay', 'Hard'] } : field) };
  await admin.expect(configPath, 409, 'PUT', { configuration: changedOptions });
  await admin.expect(configPath, 409, 'PUT', { configuration: null });
  assert.equal(((await admin.expect(configPath, 200)).data!.configuration as { fields: { key: string; options?: string[] }[] }).fields.find((field) => field.key === 'surface')?.options?.includes('Grass'), true);
  pass('Incompatible definition changes and clearing a configuration with stored values are rejected');

  await admin.expect(`/api/sports/${sportId}`, 200, 'PUT', { isVisible: false });
  await editor.expect(configPath, 200);
  await anon.expect(`/${slug}/${eventBase.slug}/`, 404);
  pass('Hidden Sport configuration remains staff-accessible while its Events stay private');

  console.log(`PASS ${checks} E2 integration groups`);
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await prisma.sportEvent.deleteMany({ where: { sportSlug: slug } });
  await prisma.sport.deleteMany({ where: { slug } });
  await prisma.session.deleteMany({ where: { userId: { in: Object.values(users) } } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: Object.values(users) } } });
  await prisma.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  assert.deepEqual(await snapshot(), before, 'Pre-existing Sport/Event/Edition rows changed.');
  assert.deepEqual(await Promise.all([prisma.sport.count(), prisma.sportEvent.count(), prisma.eventEdition.count()]), beforeCounts, 'Original counts changed.');
  console.log('PASS original Sport/Event/Edition IDs, counts and full-row hashes restored');
  await prisma.$disconnect();
}
