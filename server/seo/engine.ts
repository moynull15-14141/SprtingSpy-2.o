/**
 * SEO rules engine (PHASE D). Evaluates the rule registry against the site
 * using each rule's stored settings (SeoRule table), producing findings with
 * what / why / where / fix / severity. Scans are admin-triggered and cached
 * in SeoScanRun; nothing here runs during public page rendering.
 */

import crypto from 'node:crypto';
import { prisma } from '../db';
import { RULES, RULES_BY_KEY, SEVERITIES, type Category, type RuleDef, type Severity, type TargetType } from './rules';
import { buildSeoContext, toArticleSubject, type ArticleSubject, type SeoContext } from './context';

export interface Finding {
  id: string;
  ruleKey: string;
  ruleName: string;
  category: Category;
  severity: Severity;
  entityType: TargetType;
  entityId: string;
  entityTitle: string;
  url?: string;
  message: string;
  why: string;
  fix: string;
  /** Where to fix it in the CMS. */
  edit?: { tab: 'articles' | 'events' | 'sports' | 'media' | 'redirects' | 'settings'; id?: string };
}

export interface RuleSettings {
  enabled: boolean;
  severity: Severity;
  articleTypes: string[];
  config: Record<string, unknown>;
  version: number;
}

/** Inserts rows for rules that are not in the database yet. Never overwrites edited rules. */
export async function ensureSeoRules() {
  const now = new Date();
  await prisma.seoRule.createMany({
    skipDuplicates: true,
    data: RULES.map((r) => ({
      id: `seo-rule-${r.key}`,
      key: r.key,
      name: r.name,
      description: r.why,
      category: r.category,
      targetType: r.target,
      articleTypes: r.articleTypes || [],
      severity: r.severity,
      enabled: true,
      config: r.config as object,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })),
  });
}

export async function loadRuleSettings(): Promise<Map<string, RuleSettings>> {
  const rows = await prisma.seoRule.findMany();
  const map = new Map<string, RuleSettings>();
  for (const def of RULES) {
    const row = rows.find((r) => r.key === def.key);
    map.set(def.key, {
      enabled: row ? row.enabled : true,
      severity: (row && SEVERITIES.includes(row.severity as Severity) ? row.severity : def.severity) as Severity,
      articleTypes: row ? row.articleTypes : def.articleTypes || [],
      // Stored values override defaults key by key (new default keys still apply).
      config: { ...def.config, ...((row?.config as Record<string, unknown>) || {}) },
      version: row?.version || 1,
    });
  }
  return map;
}

const editFor = (type: TargetType, id: string): Finding['edit'] =>
  type === 'article' ? { tab: 'articles', id } : type === 'edition' || type === 'event' ? { tab: 'events', id } : type === 'sport' ? { tab: 'sports', id } : type === 'media' ? { tab: 'media', id } : type === 'redirect' ? { tab: 'redirects', id } : { tab: 'settings' };

function subjectsFor(type: TargetType, ctx: SeoContext, scope: 'published' | ArticleSubject[]) {
  switch (type) {
    case 'article': {
      const list = scope === 'published' ? ctx.published : scope;
      return list.map((s) => ({ subject: s, id: s.id, title: s.title, url: s.path, articleType: s.articleType }));
    }
    case 'edition': return ctx.editionList.filter((ed) => ctx.events.get(`${ed.sportSlug}/${ed.eventSlug}`)?.isVisible).map((ed) => ({ subject: ed, id: ed.id, title: ed.title, url: ed.path }));
    case 'event': return ctx.eventList.filter((e) => e.isVisible).map((e) => ({ subject: e, id: e.id, title: e.name, url: e.path }));
    case 'sport': return ctx.sportList.filter((s) => s.isVisible).map((s) => ({ subject: s, id: s.id, title: s.name, url: s.path }));
    case 'media': {
      // Media actually used on the site.
      const used = new Set<string>([...ctx.articles.map((a) => a.featuredMediaId || ''), ...ctx.articles.flatMap((a) => a.a.images.map((i) => i.mediaId))]);
      return ctx.mediaList.filter((m) => used.has(m.id)).map((m) => ({ subject: m, id: m.id, title: m.title, url: m.url }));
    }
    case 'redirect': return ctx.site.redirects.map((r) => ({ subject: r, id: r.id, title: `${r.sourceUrl} → ${r.targetUrl}`, url: r.sourceUrl }));
    case 'site': return [{ subject: null, id: 'site', title: 'Site configuration', url: undefined }];
  }
}

export function evaluate(ctx: SeoContext, settings: Map<string, RuleSettings>, opts: { targets?: TargetType[]; articles?: ArticleSubject[] } = {}): Finding[] {
  const findings: Finding[] = [];
  for (const def of RULES as RuleDef[]) {
    const s = settings.get(def.key)!;
    if (!s.enabled || (opts.targets && !opts.targets.includes(def.target))) continue;
    for (const item of subjectsFor(def.target, ctx, opts.articles || 'published') as { subject: any; id: string; title: string; url?: string; articleType?: string }[]) {
      if (def.target === 'article' && s.articleTypes.length && !s.articleTypes.includes(item.articleType!)) continue;
      let issues;
      try {
        issues = def.check(item.subject, ctx, s.config);
      } catch (err) {
        issues = [{ message: `Rule could not be evaluated (${err instanceof Error ? err.message : 'error'}). Check this rule's configuration.` }];
      }
      for (const i of issues) {
        findings.push({
          id: crypto.createHash('sha1').update(`${def.key}|${item.id}|${i.message}`).digest('hex').slice(0, 16),
          ruleKey: def.key,
          ruleName: def.name,
          category: def.category,
          severity: s.severity,
          entityType: def.target,
          entityId: item.id,
          entityTitle: item.title,
          url: item.url,
          message: i.message,
          why: def.why,
          fix: i.fix || def.fix,
          edit: editFor(def.target, item.id),
        });
      }
    }
  }
  const order: Record<Severity, number> = { blocking: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.category.localeCompare(b.category));
}

export function summarize(findings: Finding[]) {
  const bySeverity: Record<string, number> = { blocking: 0, warning: 0, info: 0 };
  const byCategory: Record<string, Record<string, number>> = {};
  for (const f of findings) {
    bySeverity[f.severity]++;
    byCategory[f.category] ??= { blocking: 0, warning: 0, info: 0 };
    byCategory[f.category][f.severity]++;
  }
  return { total: findings.length, bySeverity, byCategory };
}

/** Full site scan; the result (and its findings) is stored as a SeoScanRun. */
export async function runScan(origin: string, triggeredBy: string) {
  const startedAt = new Date();
  const [ctx, settings] = await Promise.all([buildSeoContext(origin), loadRuleSettings()]);
  const findings = evaluate(ctx, settings);
  const finishedAt = new Date();
  const summary = {
    ...summarize(findings),
    checked: { articles: ctx.published.length, editions: ctx.editionList.length, events: ctx.eventList.length, redirects: ctx.site.redirects.length, pages: ctx.site.pages.length },
    rulesEnabled: [...settings.values()].filter((s) => s.enabled).length,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
  return prisma.seoScanRun.create({
    data: { id: `seo-scan-${crypto.randomUUID()}`, startedAt, finishedAt, status: 'completed', triggeredBy, summary, findings: findings as unknown as object },
  });
}

/** Checks one (possibly unsaved) article for the editor panel. Returns pass/fail per applicable rule. */
export async function checkArticleDraft(origin: string, input: Parameters<typeof toArticleSubject>[0]) {
  const [ctx, settings] = await Promise.all([buildSeoContext(origin), loadRuleSettings()]);
  const subject = toArticleSubject(input);
  const findings = evaluate(ctx, settings, { targets: ['article'], articles: [subject] });
  const applicable = RULES.filter((r) => {
    const s = settings.get(r.key)!;
    return r.target === 'article' && s.enabled && (!s.articleTypes.length || s.articleTypes.includes(subject.articleType));
  });
  const checklist = applicable.map((r) => {
    const own = findings.filter((f) => f.ruleKey === r.key);
    return { ruleKey: r.key, name: r.name, category: r.category, severity: settings.get(r.key)!.severity, passed: own.length === 0, issues: own.map((f) => ({ message: f.message, fix: f.fix })), why: r.why };
  });
  return { ctx, subject, checklist };
}

export { RULES_BY_KEY };
