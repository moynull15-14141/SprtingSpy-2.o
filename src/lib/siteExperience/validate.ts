/**
 * Strict validation of Site Experience documents (PHASE F.1). Shared by the
 * API (authoritative) and the CMS editor (inline errors). Every object must
 * have exactly the known keys (no mass assignment), text is plain text (no
 * markup), and links are either site paths or https URLs.
 */

import {
  BLOCK_PLACEMENTS, SOCIAL_PLATFORMS, INTRO_STYLES, type IntroAppearance, type AnnouncementsConfig, type ArticleSource, type AutoSource, type BlocksConfig, type CtaLink,
  type FooterConfig, type HomeSection, type HomepageConfig, type NavigationConfig, type SiteArea, type SiteExperienceDocs,
} from './types';
import { validateSafeUrl } from '../../../server/validation';

export class ConfigError extends Error {}
const fail = (path: string, message: string): never => { throw new ConfigError(`${path}: ${message}`); };

type Obj = Record<string, unknown>;
function obj(v: unknown, path: string, keys: string[]): Obj {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(path, 'must be an object');
  const o = v as Obj;
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) fail(path, `unknown field(s): ${extra.join(', ')}`);
  const missing = keys.filter((k) => !(k in o));
  if (missing.length) fail(path, `missing field(s): ${missing.join(', ')}`);
  return o;
}
function arr(v: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'must be a list');
  if ((v as unknown[]).length > max) fail(path, `at most ${max} items`);
  return v as unknown[];
}
const bool = (v: unknown, path: string) => (typeof v === 'boolean' ? v : fail(path, 'must be true or false'));
function int(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) fail(path, `must be a whole number from ${min} to ${max}`);
  return v as number;
}
/** Plain text: no markup, no control characters. */
function text(v: unknown, path: string, max: number, required = false): string {
  if (typeof v !== 'string') fail(path, 'must be text');
  const s = (v as string).trim();
  if (required && !s) fail(path, 'is required');
  if (s.length > max) fail(path, `at most ${max} characters`);
  if (/[<>]/.test(s)) fail(path, 'must be plain text (no < or >)');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) fail(path, 'contains control characters');
  return s;
}
const oneOf = <T extends string>(v: unknown, path: string, allowed: readonly T[]): T => (allowed.includes(v as T) ? (v as T) : fail(path, `must be one of ${allowed.join(', ')}`));
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const id = (v: unknown, path: string) => (typeof v === 'string' && ID.test(v) ? v : fail(path, 'must be a short id (a-z, 0-9, -)'));
const ARTICLE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A site path ("/events/") or an https URL. Anything else (javascript:, data:, //host, http:) is rejected. */
export function checkHref(v: unknown, path: string, { allowEmpty = false, allowExternal = true } = {}): string {
  if (typeof v !== 'string') return fail(path, 'must be a link');
  const s = v.trim();
  if (!s) return allowEmpty ? '' : fail(path, 'is required');
  if (s.length > 500) fail(path, 'is too long');
  const safe = validateSafeUrl(s, path);
  if (!safe.valid) fail(path, safe.error ?? 'unsafe URL');
  if (/[\s<>\\]/.test(s)) fail(path, 'contains unsafe characters');
  if (s.startsWith('/')) {
    if (s.startsWith('//') || s.includes('\\') || !/^\/[A-Za-z0-9\-._~/%?=&#+]*$/.test(s)) fail(path, 'must be a site path such as /events/');
    let decoded: string;
    try { decoded = decodeURIComponent(s); } catch { return fail(path, 'contains invalid encoding'); }
    if (/[\\\u0000-\u0020\u007f<>]/.test(decoded) || decoded.startsWith('//')) fail(path, 'contains unsafe encoded characters');
    const u = new URL(s, 'https://site.invalid');
    if (u.origin !== 'https://site.invalid' || /^\/(admin|api|account)(\/|$)/i.test(decodeURIComponent(u.pathname))) fail(path, 'must link to a public page');
    return `${u.pathname}${u.search}${u.hash}`;
  }
  if (!allowExternal) fail(path, 'must be a site path starting with /');
  let u: URL;
  try { u = new URL(s); } catch { return fail(path, 'must be a site path (/…) or an https:// URL'); }
  if (u.protocol !== 'https:') fail(path, 'external links must use https://');
  if (u.username || u.password) fail(path, 'must not contain credentials');
  return u.toString();
}
export const isExternal = (href: string) => /^https:\/\//.test(href);

function iso(v: unknown, path: string): string | null {
  if (v === null) return null;
  if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) fail(path, 'must be a date/time or empty');
  return new Date(v as string).toISOString();
}
function cta(v: unknown, path: string): CtaLink | null {
  if (v === null) return null;
  const o = obj(v, path, ['label', 'href']);
  return { label: text(o.label, `${path}.label`, 60, true), href: checkHref(o.href, `${path}.href`) };
}
function uniqueIds<T extends { id: string }>(items: T[], path: string): T[] {
  const seen = new Set<string>();
  for (const i of items) { if (seen.has(i.id)) fail(path, `duplicate id "${i.id}"`); seen.add(i.id); }
  return items;
}

function autoSource(v: unknown, path: string): AutoSource {
  const kind = oneOf((v as Obj | null)?.kind, `${path}.kind`, ['latest', 'sport', 'event', 'type'] as const);
  if (kind === 'latest') { obj(v, path, ['kind']); return { kind }; }
  const o = obj(v, path, ['kind', 'value']);
  const value = text(o.value, `${path}.value`, 120, true);
  if (kind === 'sport' && !SLUG.test(value)) fail(`${path}.value`, 'must be a sport slug');
  if (kind === 'event' && !/^[a-z0-9-]+\/[a-z0-9-]+$/.test(value)) fail(`${path}.value`, 'must be "<sport>/<event>"');
  // PHASE R: Article Types are database-backed; the server route checks the name exists.
  if (kind === 'type' && !/^[\p{L}\p{N}][\p{L}\p{N} &'’/().,-]{0,58}[\p{L}\p{N})]$/u.test(value)) fail(`${path}.value`, 'must be an article category name');
  return { kind, value } as AutoSource;
}
function source(v: unknown, path: string): ArticleSource {
  const o = obj(v, path, ['mode', 'auto', 'articleIds']);
  const mode = oneOf(o.mode, `${path}.mode`, ['auto', 'manual', 'mixed'] as const);
  const articleIds = arr(o.articleIds, `${path}.articleIds`, 12).map((x, i) => (typeof x === 'string' && ARTICLE_ID.test(x) ? x : fail(`${path}.articleIds[${i}]`, 'must be an article id')));
  if (new Set(articleIds).size !== articleIds.length) fail(`${path}.articleIds`, 'the same article is selected twice');
  if (mode !== 'auto' && !articleIds.length) fail(`${path}.articleIds`, 'choose at least one article');
  return { mode, auto: autoSource(o.auto, `${path}.auto`), articleIds };
}

function introAppearance(v: unknown, path: string): IntroAppearance {
  const o = obj(v, path, ['mediaId', 'style', 'focalX', 'focalY', 'mobileFocalX', 'mobileFocalY', 'zoom', 'overlay', 'height', 'textSize', 'align', 'vertical', 'width']);
  const mediaId = o.mediaId === '' ? '' : typeof o.mediaId === 'string' && ARTICLE_ID.test(o.mediaId) ? o.mediaId : fail(`${path}.mediaId`, 'must be a Media Library id');
  return {
    mediaId, style: oneOf(o.style, `${path}.style`, INTRO_STYLES),
    focalX: int(o.focalX, `${path}.focalX`, 0, 100), focalY: int(o.focalY, `${path}.focalY`, 0, 100),
    mobileFocalX: int(o.mobileFocalX, `${path}.mobileFocalX`, 0, 100), mobileFocalY: int(o.mobileFocalY, `${path}.mobileFocalY`, 0, 100),
    zoom: int(o.zoom, `${path}.zoom`, 100, 160), overlay: int(o.overlay, `${path}.overlay`, 25, 90),
    height: oneOf(o.height, `${path}.height`, ['compact', 'standard', 'tall']),
    textSize: oneOf(o.textSize, `${path}.textSize`, ['compact', 'standard', 'large']),
    align: oneOf(o.align, `${path}.align`, ['preset', 'left', 'center', 'right']),
    vertical: oneOf(o.vertical, `${path}.vertical`, ['preset', 'top', 'center', 'bottom']),
    width: oneOf(o.width, `${path}.width`, ['narrow', 'medium', 'wide']),
  };
}

function section(v: unknown, path: string): HomeSection {
  const type = oneOf((v as Obj | null)?.type, `${path}.type`, ['intro', 'featured', 'articles', 'featuredEvents', 'sportsGrid', 'upcomingEditions', 'block', 'adSlot'] as const);
  const base = (keys: string[]) => { const o = obj(v, path, ['id', 'type', 'enabled', ...keys]); return { o, id: id(o.id, `${path}.id`), enabled: bool(o.enabled, `${path}.enabled`) }; };
  switch (type) {
    case 'intro': { const legacy = !Object.hasOwn(v as Obj, 'appearance'); const { o, ...b } = base(['eyebrow', 'title', 'text', 'primaryCta', 'secondaryCta', ...(legacy ? [] : ['appearance'])]); return { ...b, type, eyebrow: text(o.eyebrow, `${path}.eyebrow`, 120), title: text(o.title, `${path}.title`, 200, true), text: text(o.text, `${path}.text`, 600), primaryCta: cta(o.primaryCta, `${path}.primaryCta`), secondaryCta: cta(o.secondaryCta, `${path}.secondaryCta`), ...(legacy ? {} : { appearance: introAppearance(o.appearance, `${path}.appearance`) }) }; }
    case 'featured': { const legacy = !Object.hasOwn(v as Obj, 'layout'); const { o, ...b } = base(['label', 'source', 'count', ...(legacy ? [] : ['layout'])]); return { ...b, type, label: text(o.label, `${path}.label`, 60), source: source(o.source, `${path}.source`), count: int(o.count, `${path}.count`, 1, 4), ...(legacy ? {} : { layout: oneOf(o.layout, `${path}.layout`, ['lead-grid', 'grid'] as const) }) }; }
    case 'articles': { const { o, ...b } = base(['eyebrow', 'title', 'layout', 'source', 'count', 'moreLink']); return { ...b, type, eyebrow: text(o.eyebrow, `${path}.eyebrow`, 80), title: text(o.title, `${path}.title`, 120, true), layout: oneOf(o.layout, `${path}.layout`, ['lead-grid', 'grid', 'list'] as const), source: source(o.source, `${path}.source`), count: int(o.count, `${path}.count`, 1, 12), moreLink: cta(o.moreLink, `${path}.moreLink`) }; }
    case 'featuredEvents': case 'upcomingEditions': { const { o, ...b } = base(['eyebrow', 'title', 'count']); return { ...b, type, eyebrow: text(o.eyebrow, `${path}.eyebrow`, 80), title: text(o.title, `${path}.title`, 120, true), count: int(o.count, `${path}.count`, 1, 12) } as HomeSection; }
    case 'sportsGrid': { const { o, ...b } = base(['eyebrow', 'title']); return { ...b, type, eyebrow: text(o.eyebrow, `${path}.eyebrow`, 80), title: text(o.title, `${path}.title`, 120, true) }; }
    case 'block': { const { o, ...b } = base(['blockId']); return { ...b, type, blockId: id(o.blockId, `${path}.blockId`) }; }
    case 'adSlot': { const { o, ...b } = base(['slot']); return { ...b, type, slot: oneOf(o.slot, `${path}.slot`, ['HOMEPAGE_TOP', 'HOMEPAGE_MIDDLE'] as const) }; }
  }
}

export function validateHomepage(v: unknown): HomepageConfig {
  const o = obj(v, 'homepage', ['sections']);
  const sections = uniqueIds(arr(o.sections, 'homepage.sections', 30).map((s, i) => section(s, `homepage.sections[${i}]`)), 'homepage.sections');
  for (const slot of ['HOMEPAGE_TOP', 'HOMEPAGE_MIDDLE']) if (sections.filter((s) => s.type === 'adSlot' && s.slot === slot).length > 1) fail('homepage.sections', `ad slot ${slot} can be placed only once`);
  return { sections };
}

export function validateNavigation(v: unknown): NavigationConfig {
  const o = obj(v, 'navigation', ['items']);
  const items = uniqueIds(arr(o.items, 'navigation.items', 12).map((raw, i) => {
    const p = `navigation.items[${i}]`;
    const x = obj(raw, p, ['id', 'kind', 'label', 'mobileLabel', 'href', 'icon', 'desktop', 'mobile', 'newTab']);
    const kind = oneOf(x.kind, `${p}.kind`, ['sportsMenu', 'link'] as const);
    const href = checkHref(x.href, `${p}.href`);
    return { id: id(x.id, `${p}.id`), kind, label: text(x.label, `${p}.label`, 40, true), mobileLabel: text(x.mobileLabel, `${p}.mobileLabel`, 60), href, icon: oneOf(x.icon, `${p}.icon`, ['none', 'search'] as const), desktop: bool(x.desktop, `${p}.desktop`), mobile: bool(x.mobile, `${p}.mobile`), newTab: bool(x.newTab, `${p}.newTab`) && isExternal(href) };
  }), 'navigation.items');
  if (items.filter((i) => i.kind === 'sportsMenu').length > 1) fail('navigation.items', 'only one sports menu');
  return { items };
}

export function validateFooter(v: unknown): FooterConfig {
  const o = obj(v, 'footer', ['tagline', 'notes', 'copyright', 'statusText', 'columns', 'social']);
  const columns = uniqueIds(arr(o.columns, 'footer.columns', 6).map((raw, i) => {
    const p = `footer.columns[${i}]`;
    const c = obj(raw, p, ['id', 'title', 'enabled', 'kind', 'sportsCount', 'links']);
    const kind = oneOf(c.kind, `${p}.kind`, ['links', 'sports'] as const);
    const links = uniqueIds(arr(c.links, `${p}.links`, 12).map((rl, j) => {
      const lp = `${p}.links[${j}]`;
      const l = obj(rl, lp, ['id', 'label', 'href', 'enabled', 'kind', 'system']);
      const lkind = oneOf(l.kind, `${lp}.kind`, ['link', 'privacyChoices'] as const);
      return { id: id(l.id, `${lp}.id`), label: text(l.label, `${lp}.label`, 60, true), href: lkind === 'privacyChoices' ? '' : checkHref(l.href, `${lp}.href`), enabled: bool(l.enabled, `${lp}.enabled`), kind: lkind, system: bool(l.system, `${lp}.system`) };
    }), `${p}.links`);
    return { id: id(c.id, `${p}.id`), title: text(c.title, `${p}.title`, 60, true), enabled: bool(c.enabled, `${p}.enabled`), kind, sportsCount: kind === 'sports' ? int(c.sportsCount, `${p}.sportsCount`, 1, 20) : 0, links };
  }), 'footer.columns');
  const social = arr(o.social, 'footer.social', SOCIAL_PLATFORMS.length).map((rs, i) => {
    const p = `footer.social[${i}]`;
    const s = obj(rs, p, ['platform', 'url', 'enabled']);
    const url = checkHref(s.url, `${p}.url`);
    if (!isExternal(url)) fail(`${p}.url`, 'must be an https:// profile URL');
    return { platform: oneOf(s.platform, `${p}.platform`, SOCIAL_PLATFORMS), url, enabled: bool(s.enabled, `${p}.enabled`) };
  });
  if (new Set(social.map((s) => s.platform)).size !== social.length) fail('footer.social', 'each platform once');
  return {
    tagline: text(o.tagline, 'footer.tagline', 400), notes: arr(o.notes, 'footer.notes', 3).map((n, i) => text(n, `footer.notes[${i}]`, 160)),
    copyright: text(o.copyright, 'footer.copyright', 300), statusText: text(o.statusText, 'footer.statusText', 60), columns, social,
  };
}

function windowed(o: Obj, p: string) {
  const startAt = iso(o.startAt, `${p}.startAt`), endAt = iso(o.endAt, `${p}.endAt`);
  if (startAt && endAt && Date.parse(endAt) <= Date.parse(startAt)) fail(`${p}.endAt`, 'must be after the start');
  return { startAt, endAt };
}

export function validateAnnouncements(v: unknown): AnnouncementsConfig {
  const o = obj(v, 'announcements', ['items']);
  return { items: uniqueIds(arr(o.items, 'announcements.items', 20).map((raw, i) => {
    const p = `announcements.items[${i}]`;
    const a = obj(raw, p, ['id', 'enabled', 'variant', 'text', 'href', 'articleId', 'priority', 'startAt', 'endAt']);
    const articleId = typeof a.articleId === 'string' && (a.articleId === '' || ARTICLE_ID.test(a.articleId)) ? a.articleId : fail(`${p}.articleId`, 'must be an article id or empty');
    return { id: id(a.id, `${p}.id`), enabled: bool(a.enabled, `${p}.enabled`), variant: oneOf(a.variant, `${p}.variant`, ['breaking', 'info'] as const), text: text(a.text, `${p}.text`, 200, true), href: checkHref(a.href, `${p}.href`, { allowEmpty: true }), articleId, priority: int(a.priority, `${p}.priority`, 0, 100), ...windowed(a, p) };
  }), 'announcements.items') };
}

export function validateBlocks(v: unknown): BlocksConfig {
  const o = obj(v, 'blocks', ['items']);
  return { items: uniqueIds(arr(o.items, 'blocks.items', 30).map((raw, i) => {
    const p = `blocks.items[${i}]`;
    const b = obj(raw, p, ['id', 'name', 'type', 'enabled', 'title', 'text', 'cta', 'articleId', 'placements', 'startAt', 'endAt']);
    const type = oneOf(b.type, `${p}.type`, ['message', 'cta', 'featuredStory'] as const);
    const ctaLink = cta(b.cta, `${p}.cta`);
    if (type === 'cta' && !ctaLink) fail(`${p}.cta`, 'a call-to-action block needs a button');
    const articleId = typeof b.articleId === 'string' && (b.articleId === '' || ARTICLE_ID.test(b.articleId)) ? b.articleId : fail(`${p}.articleId`, 'must be an article id or empty');
    if (type === 'featuredStory' && !articleId) fail(`${p}.articleId`, 'choose the featured article');
    const placements = arr(b.placements, `${p}.placements`, BLOCK_PLACEMENTS.length).map((x, j) => oneOf(x, `${p}.placements[${j}]`, BLOCK_PLACEMENTS));
    return { id: id(b.id, `${p}.id`), name: text(b.name, `${p}.name`, 80, true), type, enabled: bool(b.enabled, `${p}.enabled`), title: text(b.title, `${p}.title`, 120, type !== 'featuredStory'), text: text(b.text, `${p}.text`, 500), cta: type === 'cta' ? ctaLink : null, articleId: type === 'featuredStory' ? articleId : '', placements: [...new Set(placements)], ...windowed(b, p) };
  }), 'blocks.items') };
}

export const VALIDATORS: { [A in SiteArea]: (v: unknown) => SiteExperienceDocs[A] } = {
  homepage: validateHomepage, navigation: validateNavigation, footer: validateFooter, announcements: validateAnnouncements, blocks: validateBlocks,
};

/** Validates a document for an area; returns the error message instead of throwing. */
export function checkDocument<A extends SiteArea>(area: A, doc: unknown): { ok: true; value: SiteExperienceDocs[A]; error?: undefined } | { ok: false; error: string; value?: undefined } {
  try { return { ok: true, value: VALIDATORS[area](doc) }; } catch (e) { if (e instanceof ConfigError) return { ok: false, error: e.message }; throw e; }
}
