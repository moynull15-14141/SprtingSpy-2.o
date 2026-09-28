/**
 * Optional LLM content suggestions (PHASE D, Spec v1.1 §14 "AI Content Assistant").
 *
 * Uses the project's existing Gemini dependency (@google/genai) when
 * GEMINI_API_KEY is configured. Suggestions only: the response is returned
 * to the editor and never written to the article, the database or the
 * public site. Without a key the feature reports "not configured" — no
 * placeholder or invented output.
 */

import type { ArticleSubject, SeoContext } from './context';

const PLACEHOLDER_KEYS = new Set(['', 'MY_GEMINI_API_KEY']);

export function assistantState() {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  const configured = !PLACEHOLDER_KEYS.has(key);
  return {
    configured,
    provider: 'Google Gemini (@google/genai)',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    reason: configured ? null : 'Set GEMINI_API_KEY (and optionally GEMINI_MODEL) on the server to enable AI suggestions.',
  };
}

export interface AssistantSuggestions {
  missingTopics: string[];
  missingEntities: string[];
  factsToVerify: string[];
  sectionIdeas: string[];
}

const clean = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => (x as string).trim().slice(0, 300)).slice(0, 8) : []);

export async function aiSuggestions(s: ArticleSubject, ctx: SeoContext): Promise<{ ok: true; suggestions: AssistantSuggestions } | { ok: false; status: number; error: string }> {
  const state = assistantState();
  if (!state.configured) return { ok: false, status: 503, error: state.reason! };

  const event = s.eventSlug ? ctx.events.get(`${s.sportSlug}/${s.eventSlug}`) : undefined;
  const edition = s.eventSlug && s.editionYear ? ctx.editions.get(`${s.sportSlug}/${s.eventSlug}/${s.editionYear}`) : undefined;
  const prompt = [
    'You assist a sports editor. Review the draft below and return JSON with arrays of short strings:',
    '"missingTopics" (useful sections readers of this article type expect but the draft lacks),',
    '"missingEntities" (people, venues, organisations or dates that should be named),',
    '"factsToVerify" (statements, dates or numbers the editor should check against official sources — do not assert they are wrong),',
    '"sectionIdeas" (headings that would improve structure).',
    'Do not rewrite the article. Do not invent facts. Maximum 8 items per array.',
    '',
    `Article type: ${s.articleType}`,
    `Sport: ${ctx.sports.get(s.sportSlug)?.name || s.sportSlug}`,
    event ? `Event: ${event.name}` : '',
    edition ? `Edition: ${edition.title} (${edition.startDate} – ${edition.endDate}, ${edition.venue}, ${edition.location})` : '',
    `Title: ${s.title}`,
    `Excerpt: ${s.excerpt}`,
    `Body:\n${s.a.text.slice(0, 12000)}`,
  ].filter(Boolean).join('\n');

  try {
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
    const response = await Promise.race([
      ai.models.generateContent({ model: state.model, contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.2 } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 30_000)),
    ]);
    const parsed = JSON.parse(response.text || '{}');
    return { ok: true, suggestions: { missingTopics: clean(parsed.missingTopics), missingEntities: clean(parsed.missingEntities), factsToVerify: clean(parsed.factsToVerify), sectionIdeas: clean(parsed.sectionIdeas) } };
  } catch (err) {
    // Never leak provider errors/keys; the editor sees a plain failure.
    console.error('[SEO assistant] AI request failed:', err instanceof Error ? err.name : 'error');
    return { ok: false, status: 502, error: 'The AI service did not return usable suggestions. Try again later.' };
  }
}
