/**
 * Content analysis helpers for the SEO rules (PHASE D). Pure functions over
 * the rich-text document model (src/lib/richText.ts).
 */

import type { RichDoc, RichNode } from '../../src/lib/richText';

export interface DocLink {
  href: string;
  text: string;
  rel: string | null;
  target: string | null;
}

export interface DocAnalysis {
  text: string;
  words: number;
  paragraphs: string[];
  headings: { level: number; text: string }[];
  links: DocLink[];
  images: { mediaId: string; alt: string }[];
  tables: number;
  lists: number;
}

const inlineText = (nodes: RichNode[] = []): string => nodes.map((n) => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? ' ' : inlineText(n.content))).join('');

export function analyzeDoc(doc: RichDoc): DocAnalysis {
  const out: DocAnalysis = { text: '', words: 0, paragraphs: [], headings: [], links: [], images: [], tables: 0, lists: 0 };
  const texts: string[] = [];
  const visit = (nodes: RichNode[] = [], topLevel: boolean) => {
    let previousHref: string | null = null; // adjacent runs with the same link are one link
    for (const n of nodes) {
      if (n.type === 'text') {
        texts.push(n.text || '');
        const link = n.marks?.find((m) => m.type === 'link');
        if (link && link.type === 'link') {
          if (previousHref === link.attrs.href) out.links[out.links.length - 1].text += n.text || '';
          else out.links.push({ href: link.attrs.href, text: n.text || '', rel: link.attrs.rel, target: link.attrs.target });
          previousHref = link.attrs.href;
        } else previousHref = null;
        continue;
      }
      previousHref = null;
      if (n.type === 'paragraph' && topLevel) out.paragraphs.push(inlineText(n.content).trim());
      if (n.type === 'heading') out.headings.push({ level: Number(n.attrs?.level), text: inlineText(n.content).trim() });
      if (n.type === 'image') out.images.push({ mediaId: String(n.attrs?.mediaId || ''), alt: String(n.attrs?.alt || '') });
      if (n.type === 'table') out.tables++;
      if (n.type === 'bulletList' || n.type === 'orderedList') out.lists++;
      texts.push(' ');
      visit(n.content, false);
      texts.push(' ');
    }
  };
  visit(doc.content, true);
  out.text = texts.join('').replace(/\s+/g, ' ').trim();
  out.words = out.text ? out.text.split(' ').length : 0;
  out.paragraphs = out.paragraphs.filter(Boolean);
  return out;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/** Calendar dates mentioned in text (ISO, "23 May 2027", "May 23, 2027"). Dates without a year are ignored. */
export function extractDates(text: string): { raw: string; date: Date }[] {
  const found: { raw: string; date: Date }[] = [];
  const push = (raw: string, y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m, d));
    if (date.getUTCMonth() === m && d >= 1 && d <= 31 && y >= 1900 && y <= 2200) found.push({ raw, date });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m[0], +m[1], +m[2] - 1, +m[3]);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\s+(\\d{4})\\b`, 'gi'))) push(m[0], +m[3], monthIndex(m[2]), +m[1]);
  for (const m of text.matchAll(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'))) push(m[0], +m[3], monthIndex(m[1]), +m[2]);
  return found;
}

function monthIndex(name: string): number {
  const key = name.toLowerCase().slice(0, 3);
  return MONTHS.findIndex((m) => m.startsWith(key));
}

/** Any date-like mention, including "23 May" without a year and weekday names. */
export function mentionsDates(text: string): boolean {
  return extractDates(text).length > 0 || new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b|\\b${MONTH_RE}\\s+\\d{1,2}\\b|\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\\b`, 'i').test(text);
}

export const TIME_RE = /\b(?:[01]?\d|2[0-3])[:.][0-5]\d\b|\b(?:1[0-2]|0?[1-9])\s?(?:am|pm)\b/i;

export function containsAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((t) => {
    const term = t.toLowerCase();
    return /^[a-z0-9]+$/.test(term) ? new RegExp(`\\b${term}\\b`).test(lower) : lower.includes(term);
  });
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
