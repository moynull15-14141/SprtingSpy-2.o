/**
 * PHASE H content correction for already-published Site Experience documents.
 *
 *   npm run content:phase-h            dry run: shows what would change
 *   npm run content:phase-h -- --apply  applies it through the normal draft → publish service (audited)
 *
 * 1. Homepage intro: the Spec v1.1 §7.1 H1 ("Latest Sports News & Events") and
 *    short multi-sport introduction — only where the intro still has the
 *    unedited pre-Phase-H wording (an editor's own wording is never replaced).
 * 2. Footer: adds a "FAQ" link to the Editorial column if no /faq/ link exists.
 *
 * Idempotent. Skips an area whose draft has unpublished editor changes, so
 * nobody's work in progress is published by this script.
 */
import 'dotenv/config';
import { prisma } from '../db';
import { publish, saveDraft, referencedArticleIds, unavailableArticles, SiteExperienceError } from '../siteExperience';
import { sameDocument } from '../../src/lib/siteExperience/compare';
import { checkDocument } from '../../src/lib/siteExperience/validate';
import { HOMEPAGE_H1, HOMEPAGE_INTRO, LEGACY_HOMEPAGE_INTRO } from '../../src/lib/siteExperience/defaults';
import type { FooterConfig, HomepageConfig, SiteArea } from '../../src/lib/siteExperience/types';

const apply = process.argv.includes('--apply');
const actor = { userId: 'system-phase-h', userName: 'Phase H spec correction' };

async function correct<T>(area: SiteArea, change: (doc: T) => string[]) {
  const row = await prisma.siteExperience.findUnique({ where: { area } });
  if (!row?.published) return console.log(`${area}: never published — the built-in defaults already include the change.`);
  if (!sameDocument(row.draft, row.published)) return console.log(`${area}: SKIPPED — the draft has unpublished editor changes. Apply the change in Admin → Site Experience instead.`);
  const checked = checkDocument(area, row.published);
  if (!checked.ok) return console.log(`${area}: SKIPPED — the stored document does not validate (${checked.error.split(':')[0]}).`);
  const doc = structuredClone(checked.value) as T;
  const changes = change(doc);
  if (!changes.length) return console.log(`${area}: already up to date.`);
  console.log(`${area}: ${apply ? 'applying' : 'would apply'} — ${changes.join('; ')}`);
  if (!apply) return;
  // Do not leave a changed draft behind when existing selections cannot be
  // republished. Public rendering already upgrades the untouched legacy intro.
  if ((await unavailableArticles(referencedArticleIds(area, doc))).length) {
    console.log(`${area}: SKIPPED — existing article selections are not all public; draft and published documents are preserved. The public legacy intro correction still applies.`);
    return;
  }
  await saveDraft(area, doc, actor);
  try { await publish(area, actor); }
  catch (error) {
    // Restore only our own still-current draft; never overwrite a concurrent
    // editor save. Keep the audit history truthful about this failed attempt.
    const current = await prisma.siteExperience.findUnique({ where: { area } });
    if (current && current.draftUpdatedBy === actor.userName && sameDocument(current.draft, doc)) {
      await prisma.siteExperience.updateMany({ where: { area, draftUpdatedAt: current.draftUpdatedAt }, data: { draft: row.draft as object, draftUpdatedAt: row.draftUpdatedAt, draftUpdatedBy: row.draftUpdatedBy } });
    }
    if (error instanceof SiteExperienceError) { console.log(`${area}: SKIPPED — publication validation failed; our draft was rolled back when unchanged.`); return; }
    throw error;
  }
  console.log(`${area}: published.`);
}

try {
  await correct<HomepageConfig>('homepage', (doc) => {
    const changes: string[] = [];
    for (const s of doc.sections) {
      if (s.type !== 'intro') continue;
      if (s.title === LEGACY_HOMEPAGE_INTRO.title) { s.title = HOMEPAGE_H1; changes.push(`intro heading → "${HOMEPAGE_H1}"`); }
      if (s.text === LEGACY_HOMEPAGE_INTRO.text) { s.text = HOMEPAGE_INTRO; changes.push('intro text → short multi-sport introduction'); }
      if (s.secondaryCta?.label === LEGACY_HOMEPAGE_INTRO.secondaryCtaLabel) { s.secondaryCta.label = 'Browse All Sports'; changes.push('"Browse All 12 Sports" → "Browse All Sports"'); }
    }
    return changes;
  });
  await correct<FooterConfig>('footer', (doc) => {
    if (doc.columns.some((c) => c.links.some((l) => l.href === '/faq/'))) return [];
    const column = doc.columns.find((c) => c.id === 'editorial') ?? doc.columns.find((c) => c.kind === 'links');
    if (!column) return [];
    const id = column.links.some((l) => l.id === 'faq') ? `faq-${Date.now()}` : 'faq';
    column.links.push({ id, label: 'FAQ', href: '/faq/', enabled: true, kind: 'link', system: false });
    return [`FAQ link added to the "${column.title}" column`];
  });
  if (!apply) console.log('\nDry run only. Re-run with --apply to publish these changes.');
} finally {
  await prisma.$disconnect();
}
