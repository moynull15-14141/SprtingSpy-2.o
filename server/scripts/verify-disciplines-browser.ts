/**
 * Disciplines in the CMS, in a real browser: the Discipline section of the
 * Sport form (Admin), and the optional Discipline selector of the Event and
 * Article forms. Production-mode server on the LOCAL database, UUID-scoped
 * fixtures, removed afterwards. No public discipline page exists yet.
 *
 *   npm run build && npm run local -- test:disciplines-browser
 *   (PLAYWRIGHT_EXECUTABLE_PATH=<chrome> when Chrome is not in its default place)
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright-core';
import { prisma } from '../db';
import { checkDatabaseUrlIsLocalDev } from '../dbSafety';
import { hashPassword } from '../password';

assert(checkDatabaseUrlIsLocalDev(process.env.DATABASE_URL).safe, 'Discipline verification requires a local development database.');
assert(fs.existsSync('.next/BUILD_ID'), 'Build before verification (npm run build).');
const chromePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const fx = `dc${crypto.randomUUID().slice(0, 6)}`;
const password = `Disc-${crypto.randomUUID()}`;
const adminId = `${fx}-admin`; const editorId = `${fx}-editor`;
const A = `${fx}-athletics`; const B = `${fx}-cycling`;

const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = (probe.address() as { port: number }).port; await new Promise<void>((r) => probe.close(() => r()));
const base = `http://127.0.0.1:${port}`;
let output = '';
const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TRUST_PROXY: 'false', NODE_ENV: 'production', APP_ENV: 'production', AUTH_MODE: 'production', DEV_LOGIN_BYPASS: 'false', ALLOWED_ORIGIN: base, ENABLE_READER_ACCOUNTS: 'false', ENABLE_COMMENTS: 'false' } as NodeJS.ProcessEnv,
});
child.stdout.on('data', (c) => { output += c; }); child.stderr.on('data', (c) => { output += c; });
let checks = 0; const pass = (m: string) => { checks++; console.log(`PASS ${m}`); };
/** Waits until the database shows what the screen just saved. */
async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string): Promise<T> {
  for (let i = 0; i < 60; i++) { const value = await read(); if (ok(value)) return value; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error(`Timed out waiting for: ${what}`);
}
const disciplinesOfA = () => prisma.discipline.findMany({ where: { sportSlug: A }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });

let browser: Browser | null = null;
try {
  await prisma.user.create({ data: { id: adminId, name: `${fx} Admin`, email: `${adminId}@example.test`, role: 'Admin', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.user.create({ data: { id: editorId, name: `${fx} Editor`, email: `${editorId}@example.test`, role: 'Editor', avatar: '', joinedAt: new Date(), passwordHash: hashPassword(password) } });
  await prisma.author.create({ data: { id: `${fx}-byline`, userId: editorId, slug: `${fx}-byline`, name: `${fx} Byline`, roleTitle: 'Correspondent', bio: 'Bio', avatar: '' } });
  const sportBase = { tagline: 'Fixture', description: 'Fixture sport.', order: 900, isVisible: false, seo: {} };
  await prisma.sport.create({ data: { id: `${fx}-sport-a`, slug: A, name: `${fx} Athletics`, ...sportBase } });
  await prisma.sport.create({ data: { id: `${fx}-sport-b`, slug: B, name: `${fx} Cycling`, ...sportBase, order: 901 } });
  const imageUrl = `https://images.unsplash.com/photo-${fx}-jump?w=1600`;
  await prisma.mediaItem.create({ data: { id: `${fx}-media`, title: `${fx} jump photo`, url: imageUrl, altText: 'High jump', width: 1600, height: 1067, uploadedAt: new Date(), copyrightReview: 'reviewed' } });
  await prisma.sportEvent.create({ data: { id: `${fx}-event`, sportSlug: A, slug: `${fx}-open`, name: `${fx} Open`, shortName: `${fx} Open`, description: 'Fixture event.', seo: {} } });
  const type = await prisma.articleType.findFirstOrThrow({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  await prisma.article.create({ data: { id: `${fx}-article`, slug: `${fx}-guide`, title: `${fx} training guide`, sportSlug: A, articleType: type.name, excerpt: 'Excerpt.', content: 'Body text of the fixture article.', featuredImage: '', authorId: `${fx}-byline`, publishedAt: new Date(), status: 'draft', readingTimeMinutes: 1, seo: {} } });

  for (let i = 0; i < 180 && !/Server running/.test(output); i++) await new Promise((r) => setTimeout(r, 500));
  assert.match(output, /Server running/, `server did not start:\n${output.slice(-2000)}`);
  browser = await chromium.launch({ executablePath: chromePath });
  const errors: string[] = [];
  const signIn = async (userId: string, desk: string): Promise<Page> => {
    const page = await (await browser!.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => void d.accept());
    await page.goto(`${base}/admin/#${desk}`);
    await page.getByRole('textbox', { name: 'Email' }).fill(`${userId}@example.test`);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    return page;
  };

  // ── Admin: the Discipline section of the Sport form ──
  const cms = await signIn(adminId, 'sports');
  await cms.locator('tr', { hasText: `${fx} Athletics` }).getByRole('button', { name: 'Edit', exact: true }).click();
  const manager = cms.getByTestId('discipline-manager');
  await manager.getByText('This sport has no groups').waitFor();
  assert.match(await manager.locator('legend').innerText(), new RegExp(`^GROUPS IN ${fx} ATHLETICS \\(0\\)$`, 'i'), 'the section is titled Groups in <sport>');
  const add = async (name: string, slug: string) => {
    await manager.getByLabel('Group name', { exact: true }).fill(name);
    assert.equal(await manager.getByLabel('Slug (unique within this sport)').inputValue(), slug, 'the slug is suggested from the name');
    await manager.getByRole('button', { name: 'Create group' }).click();
    await manager.locator(`[data-discipline="${slug}"]`).waitFor();
  };
  await add('Running', 'running'); await add('Jumping', 'jumping'); await add('Throwing', 'throwing');
  assert.deepEqual((await disciplinesOfA()).map((d) => [d.slug, d.order, d.isVisible, d.isActive]), [['running', 1, true, true], ['jumping', 2, true, true], ['throwing', 3, true, true]]);
  // A duplicate slug is refused by the server and nothing is added.
  await manager.getByLabel('Group name', { exact: true }).fill('Running');
  await manager.getByRole('button', { name: 'Create group' }).click();
  await cms.getByText(/already exists under sport/).first().waitFor();
  assert.equal((await disciplinesOfA()).length, 3);
  await manager.getByLabel('Group name', { exact: true }).fill('');
  pass('Admin adds groups in the Sport form (slug suggested from the name); a duplicate slug shows the server message and adds nothing');

  await manager.getByRole('button', { name: 'Move Throwing up' }).click();
  await until(disciplinesOfA, (rows) => rows.map((d) => d.slug).join() === 'running,throwing,jumping', 'Throwing moved up');
  // ── Edit opens the full Group editor (there is no Rename-only action) ──
  assert.equal(await manager.getByRole('button', { name: /^Rename / }).count(), 0, 'Rename is replaced by Edit');
  const sportRowBefore = JSON.stringify(await prisma.sport.findUniqueOrThrow({ where: { id: `${fx}-sport-a` } }));
  const siblingsBefore = JSON.stringify((await disciplinesOfA()).filter((d) => d.slug !== 'jumping').map((d) => ({ ...d, updatedAt: null })));
  // Something typed in the sport form, not saved: it must survive a visit to the group editor and never be saved by it.
  const sportTagline = cms.getByPlaceholder('e.g. Test Matches, World Cups, Pitch Conditions & Formats');
  await sportTagline.fill('Unsaved sport tagline');
  await manager.getByRole('button', { name: 'Edit Jumping' }).click();
  const editor = cms.getByTestId('group-editor');
  await editor.waitFor();
  assert.match(await editor.getByTestId('sport-unsaved-note').innerText(), /Save Group does not save them/, 'the group editor says the sport form has unsaved changes');
  assert.equal(await cms.getByTestId('discipline-manager').count(), 0, 'the group editor is its own form, not a row inside the list');
  assert.match(await editor.innerText(), new RegExp(`${fx} Athletics · Group`, 'i'));
  // The Sport form's fields, loaded with the group's stored values.
  for (const id of ['group-name', 'group-slug', 'group-tagline', 'group-description', 'group-order', 'group-hero-image', 'group-seo-title']) assert.equal(await editor.locator(`#${id}`).count(), 1, `the editor has the field #${id}`);
  assert.equal(await editor.locator('#group-name').inputValue(), 'Jumping'); assert.equal(await editor.locator('#group-slug').inputValue(), 'jumping');
  assert.equal(await editor.locator('#group-tagline').inputValue(), ''); assert.equal(await editor.locator('#group-order').inputValue(), '3');
  assert(/Featured events \(0\/12\)/i.test(await editor.innerText()) && (await editor.innerText()).includes('No event belongs to this group yet'));
  assert.equal(await editor.getByText(/event configuration|FAQPage structured data/i).count(), 0, 'sport-only settings are not offered for a group');
  await editor.locator('#group-name').fill('High Jump');
  await editor.locator('#group-slug').fill('high-jump');
  await editor.locator('#group-tagline').fill('Fosbury flop and scissors');
  await editor.locator('#group-description').fill('Everything about the high jump.');
  await editor.getByRole('button', { name: '+ Add an icon' }).click();
  await editor.getByTestId('group-hero-image-pick').click();
  await cms.getByRole('dialog', { name: 'Choose an image' }).getByRole('button', { name: new RegExp(`${fx} jump photo`) }).click();
  assert.equal(await editor.locator('#group-hero-image').inputValue(), imageUrl);
  await editor.locator('#group-seo-title').fill('High Jump guides | Test');
  await editor.locator('#group-seo-description').fill('Custom meta description for the high jump group.');
  await editor.getByRole('button', { name: 'Save Group' }).click(); // the slug-change confirmation is accepted
  await editor.getByText('Group "High Jump" saved.').waitFor();
  const stored = await until(() => prisma.discipline.findFirstOrThrow({ where: { sportSlug: A, slug: 'high-jump' } }), (d) => d.tagline === 'Fosbury flop and scissors', 'the group settings are stored');
  assert.deepEqual([stored.name, stored.description, stored.heroImage, stored.heroMediaId, !!stored.icon, (stored.seo as any).metaTitle, (stored.seo as any).metaDescription, stored.order, stored.isVisible, stored.isActive], ['High Jump', 'Everything about the high jump.', imageUrl, `${fx}-media`, true, 'High Jump guides | Test', 'Custom meta description for the high jump group.', 3, true, true]);
  assert.equal((await prisma.redirectRule.findFirstOrThrow({ where: { sourceUrl: `/${A}/jumping` } })).targetUrl, `/${A}/high-jump`, 'the slug change wrote the 301 from the old address');
  assert.equal(JSON.stringify(await prisma.sport.findUniqueOrThrow({ where: { id: `${fx}-sport-a` } })), sportRowBefore, 'the parent sport is unchanged');
  assert.equal(JSON.stringify((await disciplinesOfA()).filter((d) => d.slug !== 'high-jump').map((d) => ({ ...d, updatedAt: null }))), siblingsBefore, 'sibling groups are unchanged');
  // Close, reopen: every value comes back from the server.
  await editor.getByRole('button', { name: `Back to ${fx} Athletics` }).last().click();
  await manager.locator('[data-discipline="high-jump"]').waitFor();
  assert.equal(await sportTagline.inputValue(), 'Unsaved sport tagline', 'the unsaved sport edit is still in the sport form');
  assert.equal((await prisma.sport.findUniqueOrThrow({ where: { id: `${fx}-sport-a` } })).tagline, 'Fixture', 'Save Group did not save it');
  await sportTagline.fill('Fixture'); // back to the stored value: nothing unsaved is left
  await manager.getByRole('button', { name: 'Edit High Jump' }).click();
  assert.equal(await cms.getByTestId('sport-unsaved-note').count(), 0);
  await editor.waitFor();
  const reopened = { name: await editor.locator('#group-name').inputValue(), slug: await editor.locator('#group-slug').inputValue(), tagline: await editor.locator('#group-tagline').inputValue(), description: await editor.locator('#group-description').inputValue(), image: await editor.locator('#group-hero-image').inputValue(), seoTitle: await editor.locator('#group-seo-title').inputValue(), seoDescription: await editor.locator('#group-seo-description').inputValue() };
  assert.deepEqual(reopened, { name: 'High Jump', slug: 'high-jump', tagline: 'Fosbury flop and scissors', description: 'Everything about the high jump.', image: imageUrl, seoTitle: 'High Jump guides | Test', seoDescription: 'Custom meta description for the high jump group.' });
  assert.equal(await editor.getByRole('button', { name: 'Remove icon' }).count(), 1, 'the stored icon is loaded');
  // Saving again without a change writes nothing.
  await editor.getByRole('button', { name: 'Save Group' }).click();
  await editor.getByText('No changes to save.').waitFor();
  await editor.getByRole('button', { name: `Back to ${fx} Athletics` }).last().click();
  await manager.locator('[data-discipline="high-jump"]').waitFor();
  pass('Edit opens the full Group editor with the Sport form\'s fields (name, URL slug, icon, tagline, description, order, visibility, Media Library image, featured events, SEO); values save, reload on reopening and write a 301 for the slug change; the parent sport and sibling groups are untouched');
  await manager.getByRole('button', { name: 'Hide Running' }).click();
  await manager.locator('[data-discipline="running"]').getByText('Hidden').waitFor();
  await manager.getByRole('button', { name: 'Show Running' }).click();
  await until(disciplinesOfA, (rows) => rows.find((d) => d.slug === 'running')!.isVisible, 'Running visible again');
  await manager.getByRole('button', { name: 'Retire Throwing' }).click();
  await manager.locator('[data-discipline="throwing"]').getByText('Retired').waitFor();
  await manager.getByRole('button', { name: 'Reactivate Throwing' }).click();
  await until(disciplinesOfA, (rows) => rows.find((d) => d.slug === 'throwing')!.isActive, 'Throwing reactivated');
  await manager.getByRole('button', { name: 'Retire Throwing' }).click();
  await until(disciplinesOfA, (rows) => !rows.find((d) => d.slug === 'throwing')!.isActive, 'Throwing retired');
  await manager.getByRole('button', { name: 'Delete High Jump' }).click();
  await until(disciplinesOfA, (rows) => rows.length === 2, 'High Jump deleted');
  assert.deepEqual((await disciplinesOfA()).map((d) => [d.slug, d.name, d.isVisible, d.isActive]), [['running', 'Running', true, true], ['throwing', 'Throwing', true, false]]);
  const actions = (await prisma.auditLog.findMany({ where: { userId: adminId }, select: { action: true } })).map((l) => l.action);
  for (const action of ['Created Group', 'Updated Group', 'Deleted Group']) assert(actions.includes(action), `${action} is in the audit log`);
  assert.equal(await cms.locator('tbody tr', { hasText: 'Running' }).count(), 0, 'a discipline is not listed as a sport');
  assert.equal(await prisma.sport.count({ where: { slug: { in: ['running', 'throwing', 'high-jump'] } } }), 0);
  assert(!/discipline/i.test(await manager.innerText()), 'the section says Group everywhere');
  assert.equal(await manager.locator('[data-discipline] [data-discipline], [data-discipline] input[id^="new-"]').count(), 0, 'a group row offers no way to add a group inside it');
  pass('Admin reorders, renames (name and slug), hides/shows, retires/reactivates and deletes an unused group; each change is audited; a group never becomes a sport');

  // ── Event form: optional selector, active disciplines of the event's sport ──
  await cms.goto(`${base}/admin/#events`);
  await cms.locator('tr', { hasText: `${fx} Open` }).getByRole('button', { name: 'Edit', exact: true }).first().click();
  const eventSelect = cms.locator('#event-discipline');
  await eventSelect.waitFor();
  assert.deepEqual(await eventSelect.locator('option').allTextContents(), ['None (whole sport, or several groups)', 'Running'], 'only active disciplines of this sport are offered');
  assert.equal(await eventSelect.inputValue(), '');
  assert.equal((await cms.locator('label[for="event-discipline"]').innerText()).trim(), 'Group (optional)');
  await eventSelect.selectOption('running');
  await cms.getByRole('button', { name: 'Save Updates' }).click();
  await until(() => prisma.sportEvent.findUniqueOrThrow({ where: { id: `${fx}-event` } }), (e) => e.disciplineSlug === 'running', 'the event got its discipline');
  pass('Event form: the selector offers "None" and the active groups of the event\'s sport (a retired one is not offered); the choice is saved');

  // ── Sport form again: a discipline in use cannot be deleted ──
  await cms.goto(`${base}/admin/#sports`);
  await cms.locator('tr', { hasText: `${fx} Athletics` }).getByRole('button', { name: 'Edit', exact: true }).click();
  await manager.locator('[data-discipline="running"]').getByText('1 event(s), 0 article(s)').waitFor();
  assert.equal(await manager.getByRole('button', { name: 'Delete Running' }).isDisabled(), true);
  assert.equal(await manager.getByRole('button', { name: 'Delete Throwing' }).isDisabled(), false);
  // Featured events: only this group's own events are offered, and the choice is the group's.
  await manager.getByRole('button', { name: 'Edit Running' }).click();
  const runningEditor = cms.getByTestId('group-editor');
  await runningEditor.getByLabel(`${fx} Open`).check();
  await runningEditor.getByRole('button', { name: 'Save Group' }).click();
  await runningEditor.getByText('Group "Running" saved.').waitFor();
  assert.deepEqual((await prisma.discipline.findFirstOrThrow({ where: { sportSlug: A, slug: 'running' } })).featuredEventIds, [`${fx}-event`]);
  assert.deepEqual((await prisma.sport.findUniqueOrThrow({ where: { id: `${fx}-sport-a` } })).featuredEventIds, [], 'the sport\'s own featured list is not touched');
  await runningEditor.getByRole('button', { name: `Back to ${fx} Athletics` }).last().click();
  await manager.locator('[data-discipline="running"]').waitFor();
  pass('Sport form shows where a group is used and disables Delete while it is');

  // ── Article form (the one existing editor): optional selector; follows the event; cleared with the sport ──
  await cms.goto(`${base}/admin/#articles`);
  await cms.locator('tr', { hasText: `${fx} training guide` }).getByRole('button', { name: 'Edit', exact: true }).click();
  const articleSelect = cms.locator('#article-discipline');
  await articleSelect.waitFor();
  assert.deepEqual(await articleSelect.locator('option').allTextContents(), ['None', 'Running']);
  assert.equal((await cms.locator('label[for="article-discipline"]').innerText()).trim(), 'Group (optional)');
  assert.equal(await articleSelect.inputValue(), '', 'an existing article has no discipline until someone chooses one');
  assert.equal(await articleSelect.isDisabled(), false);
  // Inside the event that now has "Running" the article follows it and the selector is locked.
  await cms.getByRole('radio', { name: 'Specific Championship / Event' }).check();
  await cms.locator('select', { has: cms.locator('option', { hasText: '-- Choose Event --' }) }).selectOption(`${fx}-open`);
  await cms.getByTestId('article-discipline-inherited').waitFor();
  assert.equal(await articleSelect.isDisabled(), true); assert.equal(await articleSelect.inputValue(), 'running');
  // Back to a general article: free choice again; saved with the article.
  await cms.getByRole('radio', { name: /General Sport Guide/ }).check();
  assert.equal(await articleSelect.isDisabled(), false); assert.equal(await articleSelect.inputValue(), '');
  await articleSelect.selectOption('running');
  await cms.getByRole('button', { name: 'Save draft' }).click();
  const saved = await until(() => prisma.article.findUniqueOrThrow({ where: { id: `${fx}-article` } }), (a) => a.disciplineSlug === 'running', 'the article got its discipline');
  assert.deepEqual([saved.status, saved.sportSlug, saved.eventSlug, saved.slug], ['draft', A, null, `${fx}-guide`], 'status, sport and URL parts are unchanged');
  // Another sport: the choice is cleared, and that sport has no disciplines to offer.
  await cms.locator('select', { has: cms.locator('option', { hasText: `${fx} Cycling` }) }).first().selectOption(B);
  await articleSelect.waitFor({ state: 'detached' });
  pass('Article form: optional selector with the sport\'s active groups; locked to the event\'s group inside an event; saved with a draft without changing its status or URL; cleared when the sport changes');

  // ── An Editor sees the list but cannot manage it ──
  const editorPage = await signIn(editorId, 'sports');
  await editorPage.locator('tr', { hasText: `${fx} Athletics` }).getByRole('button', { name: 'Edit', exact: true }).click();
  const readOnly = editorPage.getByTestId('discipline-manager');
  await readOnly.getByText('Only an Admin can change groups.').waitFor();
  await readOnly.locator('[data-discipline="running"]').waitFor();
  assert.equal(await readOnly.getByRole('button', { name: 'Create group' }).count(), 0);
  assert.equal(await readOnly.getByRole('button', { name: /^(Rename|Hide|Show|Retire|Reactivate|Delete|Move) / }).count(), 0);
  pass('an Editor sees a sport\'s groups without any management control');

  assert.deepEqual(errors, [], 'no runtime errors in the CMS');
} finally {
  await browser?.close().catch(() => undefined);
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  await prisma.article.deleteMany({ where: { id: `${fx}-article` } });
  await prisma.sportEvent.deleteMany({ where: { id: `${fx}-event` } });
  await prisma.discipline.deleteMany({ where: { sportSlug: { in: [A, B] } } });
  await prisma.mediaItem.deleteMany({ where: { id: `${fx}-media` } });
  await prisma.redirectRule.deleteMany({ where: { OR: [{ sourceUrl: { startsWith: `/${fx}` } }, { targetUrl: { startsWith: `/${fx}` } }] } });
  await prisma.sport.deleteMany({ where: { id: { in: [`${fx}-sport-a`, `${fx}-sport-b`] } } });
  await prisma.author.deleteMany({ where: { id: `${fx}-byline` } });
  await prisma.auditLog.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.editorDraft.deleteMany({ where: { ownerId: { in: [adminId, editorId] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [adminId, editorId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, editorId] } } });
  await prisma.$disconnect();
}
console.log(`Discipline CMS browser acceptance: ${checks} checks passed.`);
