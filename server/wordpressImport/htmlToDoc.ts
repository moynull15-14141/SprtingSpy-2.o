/**
 * WordPress post HTML → SportingSpy rich-text document.
 *
 * The output is the document format defined in src/lib/richText.ts and every
 * result is passed through its validateRichDoc; no HTML is ever kept. Nothing
 * is dropped silently: whatever has no equivalent in the document format
 * (inline styles, justified text, H1/H5/H6, block content in table cells,
 * missing images …) is recorded as an issue with a count and samples, and a
 * word-level comparison of source and result is returned as `coverage`.
 *
 * Pure: no database, no network, no file access. Images are resolved through
 * the caller's `resolveImage`, which returns a Media Library id (or, in a dry
 * run, a placeholder id) — the converter never invents one.
 */
import { parseFragment } from 'parse5';
import { isSafeHref, validateRichDoc, LINK_REL_OPTIONS, type Mark, type RichDoc, type RichNode } from '../../src/lib/richText';

export type IssueSeverity = 'loss' | 'notice';
export interface ConversionIssue { code: string; severity: IssueSeverity; count: number; samples: string[] }
export interface ConvertedImage { src: string; mediaId: string | null; placed: boolean; alt: string; caption: string; reason?: string }
export interface ConvertedLink { href: string; originalHref: string; text: string }
export interface ConvertedFaq { question: string; answer: string; problems: string[] }
export interface ImageResolution { mediaId: string; alt?: string }
export interface ConvertOptions {
  /** A Media Library id for an image URL, or why the image cannot be used. */
  resolveImage: (src: string) => ImageResolution | { missing: string };
  /** A verified new address for a link of the old site; undefined keeps the link as it is. */
  rewriteLink?: (href: string) => string | undefined;
  /** The post's separate video link (theme meta); becomes an embed block at the top. */
  videoUrl?: string;
}
export interface ConversionResult {
  ok: boolean;
  error?: string;
  doc: RichDoc | null;
  issues: ConversionIssue[];
  images: ConvertedImage[];
  links: ConvertedLink[];
  faqs: ConvertedFaq[];
  stats: Record<string, number>;
  coverage: { sourceWords: number; convertedWords: number; missingWords: number; missingSample: string[] };
}

/** FAQ limits of the existing FAQ system (server/faq.ts parseFaqInput). */
export const FAQ_LIMITS = { question: [5, 300], answer: [2, 5000] } as const;

type El = { nodeName: string; tagName?: string; attrs?: { name: string; value: string }[]; childNodes?: El[]; value?: string };
type Align = 'left' | 'center' | 'right';

const attr = (el: El, name: string) => el.attrs?.find((a) => a.name === name)?.value ?? '';
const SKIPPED_TEXT = new Set(['script', 'style', 'svg', 'noscript', 'template']);
const textOf = (el: El): string => (el.nodeName === '#text' ? el.value ?? '' : SKIPPED_TEXT.has(el.nodeName) ? '' : (el.childNodes ?? []).map(textOf).join(''));
const clean = (s: string) => s.replace(/[\s ]+/g, ' ').trim();
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const has = (el: El, name: string): boolean => (el.childNodes ?? []).some((c) => c.nodeName === name || has(c, name));

const MARK_TAGS: Record<string, Mark['type']> = { strong: 'bold', b: 'bold', em: 'italic', i: 'italic', u: 'underline', ins: 'underline', s: 'strike', del: 'strike', strike: 'strike', code: 'code', kbd: 'code', tt: 'code' };
const PLAIN_INLINE = new Set(['span', 'font', 'small', 'big', 'mark', 'abbr', 'cite', 'label', 'time', 'q', 'sup', 'sub']);
const WRAPPERS = new Set(['div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'nav', 'center', 'address', 'picture']);
const HEADING_LEVEL: Record<string, number> = { h1: 2, h2: 2, h3: 3, h4: 4, h5: 4, h6: 4 };
const TABLE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col']);
const LIST_ITEM_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'image']);
const QUOTE_ALLOWED = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'image', 'horizontalRule']);

const paragraph = (content: RichNode[] = [], textAlign: Align = 'left'): RichNode => (content.length ? { type: 'paragraph', attrs: { textAlign }, content } : { type: 'paragraph', attrs: { textAlign } });
const withMark = (marks: Mark[], mark: Mark): Mark[] => [...marks.filter((m) => m.type !== mark.type), mark];
const sameMarks = (a?: Mark[], b?: Mark[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

/** Merges adjacent text, trims the edges and drops an all-whitespace run. */
function tidy(run: RichNode[]): RichNode[] {
  const out: RichNode[] = [];
  for (const n of run) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text' && sameMarks(last.marks, n.marks)) last.text = `${last.text}${n.text}`.replace(/ {2,}/g, ' ');
    else if (n.type === 'hardBreak' && last?.type === 'hardBreak') continue;
    else out.push({ ...n });
  }
  const trimEdge = (edge: 'start' | 'end') => {
    for (;;) {
      const node = edge === 'start' ? out[0] : out[out.length - 1];
      if (!node) return;
      if (node.type === 'text') {
        node.text = edge === 'start' ? node.text!.replace(/^ +/, '') : node.text!.replace(/ +$/, '');
        if (node.text) return;
      }
      if (edge === 'start') out.shift(); else out.pop();
    }
  };
  trimEdge('start');
  trimEdge('end');
  // A space next to a line break carries nothing.
  out.forEach((n, i) => {
    if (n.type !== 'text') return;
    if (out[i + 1]?.type === 'hardBreak') n.text = n.text!.replace(/ +$/, '');
    if (out[i - 1]?.type === 'hardBreak') n.text = n.text!.replace(/^ +/, '');
  });
  return out.filter((n) => n.type !== 'text' || n.text);
}

const plainOf = (node: RichNode): string => (node.type === 'text' ? node.text ?? '' : node.type === 'hardBreak' ? ' ' : (node.content ?? []).map(plainOf).join(node.type === 'paragraph' || node.type === 'heading' ? '' : ' '));

/** `[caption]<img> text[/caption]` → figure + figcaption, so one code path handles captions. */
function expandCaptionShortcodes(html: string): string {
  return html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/g, (_all, inner: string) => {
    const m = inner.match(/^(\s*(?:<a\b[^>]*>\s*)?<img\b[^>]*>(?:\s*<\/a>)?)([\s\S]*)$/);
    return m ? `<figure>${m[1]}<figcaption>${m[2]}</figcaption></figure>` : inner;
  });
}

export function convertWordPressHtml(html: string, options: ConvertOptions): ConversionResult {
  const issues = new Map<string, ConversionIssue>();
  const issue = (code: string, severity: IssueSeverity, sample?: string, count = 1) => {
    const entry = issues.get(code) ?? { code, severity, count: 0, samples: [] };
    entry.count += count;
    const s = sample ? clean(sample).slice(0, 160) : '';
    if (s && entry.samples.length < 5 && !entry.samples.includes(s)) entry.samples.push(s);
    issues.set(code, entry);
  };
  const images: ConvertedImage[] = [];
  const links: ConvertedLink[] = [];
  const faqs: ConvertedFaq[] = [];
  /** Text removed on purpose and reported as its own issue (so it is not also counted as lost text). */
  const removedText: string[] = [];

  /** Block list under construction; `run` is the inline content of the paragraph being built. */
  class Flow {
    blocks: RichNode[] = [];
    private run: RichNode[] = [];
    inParagraph = false;
    constructor(readonly autoParagraphs: boolean, public align: Align = 'left') {}
    text(value: string, marks: Mark[]) {
      // WordPress (wpautop) turns a blank line into a new paragraph and a single newline into a line break.
      const parts = this.autoParagraphs && !this.inParagraph ? value.split(/\n[ \t\r]*\n\s*/) : [value];
      parts.forEach((part, p) => {
        if (p > 0) this.flush();
        part.split('\n').forEach((line, i) => {
          if (i > 0) this.run.push({ type: 'hardBreak' });
          const t = line.replace(/[ \t\r\f\v ]+/g, ' ');
          if (t) this.run.push(marks.length ? { type: 'text', text: t, marks } : { type: 'text', text: t });
        });
      });
    }
    lineBreak() { this.run.push({ type: 'hardBreak' }); }
    flush() {
      const content = tidy(this.run);
      this.run = [];
      if (content.length) this.blocks.push(paragraph(content, this.align));
    }
    block(node: RichNode) { this.flush(); this.blocks.push(node); }
  }

  /** Marks and alignment carried by an element's style/class; everything else in `style` is reported. */
  function presentation(el: El, tag: string, kind: 'block' | 'inline'): { marks: Mark['type'][]; align?: Align } {
    const marks: Mark['type'][] = [];
    let align: Align | undefined;
    const setAlign = (value: string, where: string) => {
      const v = value.trim().toLowerCase();
      if (kind === 'inline' || ['table', 'thead', 'tbody', 'tfoot', 'tr'].includes(tag)) { issue(TABLE_TAGS.has(tag) ? 'table-style-flattened' : 'style-flattened', 'loss', `text-align on <${tag}>`); return; }
      if (v === 'center' || v === 'right') align = v;
      else if (v === 'justify') { align = 'left'; issue('text-justify-flattened', 'loss', where); }
      else if (v === 'left' || v === 'start') align = 'left';
    };
    for (const rule of attr(el, 'style').split(';')) {
      const at = rule.indexOf(':');
      if (at === -1) continue;
      const prop = rule.slice(0, at).trim().toLowerCase();
      const value = rule.slice(at + 1).trim().toLowerCase();
      if (!prop) continue;
      const emphasis = tag !== 'th' && !(tag in HEADING_LEVEL);
      if (prop === 'text-align') setAlign(value, `<${tag}>`);
      else if (prop === 'font-weight') { if (emphasis && (/^bold/.test(value) || Number(value) >= 600)) marks.push('bold'); }
      else if (prop === 'font-style') { if (value === 'italic' || value === 'oblique') marks.push('italic'); }
      else if (prop === 'text-decoration' || prop === 'text-decoration-line') { if (value.includes('underline')) marks.push('underline'); if (value.includes('line-through')) marks.push('strike'); }
      else issue(TABLE_TAGS.has(tag) ? 'table-style-flattened' : 'style-flattened', 'loss', prop);
    }
    const cls = attr(el, 'class');
    if (/\bhas-text-align-center\b|\baligncenter\b/.test(cls) && tag !== 'img') align = 'center';
    if (/\bhas-text-align-right\b/.test(cls)) align = 'right';
    const legacy = attr(el, 'align').toLowerCase();
    if (legacy && tag !== 'img' && tag !== 'table') setAlign(legacy, `<${tag} align>`);
    if (attr(el, 'id') && tag !== 'details') issue('anchor-id-dropped', 'notice', `#${attr(el, 'id')}`);
    return { marks, align };
  }
  const applyMarks = (marks: Mark[], types: Mark['type'][]) => types.reduce((all, type) => withMark(all, { type } as Mark), marks);

  /** Converts an element's children in their own block list. */
  function subFlow(el: El, marks: Mark[], align: Align = 'left'): RichNode[] {
    const sub = new Flow(false, align);
    for (const child of el.childNodes ?? []) walk(child, sub, marks);
    sub.flush();
    return sub.blocks;
  }

  /** Paragraph content of a block list joined with line breaks; the remaining blocks are returned to be placed after. */
  function inlineOf(blocks: RichNode[]): { inline: RichNode[]; others: RichNode[] } {
    const inline: RichNode[] = [];
    const others: RichNode[] = [];
    for (const b of blocks) {
      if (b.type === 'paragraph') { if (inline.length && b.content?.length) inline.push({ type: 'hardBreak' }); inline.push(...(b.content ?? [])); }
      else others.push(b);
    }
    return { inline, others };
  }

  function image(el: El, f: Flow) {
    const src = attr(el, 'src').trim();
    const resolved = options.resolveImage(src);
    if ('missing' in resolved) {
      issue('image-missing', 'loss', `${src} (${resolved.missing})`);
      images.push({ src, mediaId: null, placed: false, alt: attr(el, 'alt').trim(), caption: '', reason: resolved.missing });
      return;
    }
    const alt = (attr(el, 'alt').trim() || resolved.alt || '').slice(0, 300);
    if (!alt) issue('image-missing-alt', 'notice', src);
    const cls = attr(el, 'class');
    const align = /\balignleft\b/.test(cls) ? 'left' : /\balignright\b/.test(cls) ? 'right' : 'center';
    images.push({ src, mediaId: resolved.mediaId, placed: true, alt, caption: '' });
    f.block({ type: 'image', attrs: { mediaId: resolved.mediaId, src: null, alt, title: null, caption: '', credit: '', align, width: 'wide', lightbox: true } });
  }
  const unplace = (mediaId: unknown) => { const record = [...images].reverse().find((i) => i.placed && i.mediaId === mediaId); if (record) record.placed = false; };

  /** A table cell may hold paragraphs only: anything else is flattened to paragraphs and reported. */
  function cellContent(blocks: RichNode[], align: Align): RichNode[] {
    const out: RichNode[] = [];
    const flatten = (b: RichNode, prefix = '') => {
      if (b.type === 'paragraph') {
        const content = prefix && b.content?.length ? [{ type: 'text', text: prefix } as RichNode, ...b.content] : b.content ?? [];
        if (content.length) out.push(paragraph(tidy(content), align));
      } else if (b.type === 'heading') {
        issue('table-cell-heading-flattened', 'loss', plainOf(b));
        out.push(paragraph((b.content ?? []).map((n) => (n.type === 'text' ? { ...n, marks: withMark(n.marks ?? [], { type: 'bold' }) } : n)), align));
      } else if (b.type === 'bulletList' || b.type === 'orderedList') {
        issue('table-cell-list-flattened', 'loss', plainOf(b));
        (b.content ?? []).forEach((item, i) => (item.content ?? []).forEach((child, k) => flatten(child, k === 0 ? (b.type === 'bulletList' ? '• ' : `${i + 1}. `) : '')));
      } else if (b.type === 'image') {
        issue('table-cell-image-dropped', 'loss', String(b.attrs?.mediaId));
        unplace(b.attrs?.mediaId);
      } else if (b.type === 'blockquote') {
        issue('table-cell-block-flattened', 'loss', 'blockquote');
        (b.content ?? []).forEach((child) => flatten(child));
      } else {
        issue('table-cell-block-flattened', 'loss', b.type);
        const t = clean(plainOf(b));
        if (t) out.push(paragraph([{ type: 'text', text: t }], align));
      }
    };
    blocks.forEach((b) => flatten(b));
    return out.length ? out : [paragraph([], align)];
  }

  function table(el: El, f: Flow) {
    const rows: RichNode[] = [];
    const widths: number[] = [];
    let spansRows = false;
    const span = (cell: El, name: string) => {
      const n = Number.parseInt(attr(cell, name), 10);
      if (!Number.isInteger(n) || n < 1) return 1;
      if (n > 20) { issue('table-span-clamped', 'loss', `${name}=${n}`); return 20; }
      return n;
    };
    const visit = (parent: El) => {
      for (const child of parent.childNodes ?? []) {
        const tag = child.tagName;
        if (!tag) continue;
        presentation(child, tag, 'block');
        if (tag === 'caption') {
          const { inline } = inlineOf(subFlow(child, []));
          if (inline.length) { issue('table-caption-moved', 'notice', plainOf({ type: 'paragraph', content: inline })); f.block(paragraph(inline.map((n) => (n.type === 'text' ? { ...n, marks: withMark(n.marks ?? [], { type: 'bold' }) } : n)), 'left')); }
        } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') visit(child);
        else if (tag === 'tr') {
          const cells: RichNode[] = [];
          let width = 0;
          for (const cell of child.childNodes ?? []) {
            if (cell.tagName !== 'td' && cell.tagName !== 'th') continue;
            const style = presentation(cell, cell.tagName, 'block');
            const align = style.align ?? 'left';
            const colspan = span(cell, 'colspan');
            const rowspan = span(cell, 'rowspan');
            if (rowspan > 1) spansRows = true;
            width += colspan;
            cells.push({ type: cell.tagName === 'th' ? 'tableHeader' : 'tableCell', attrs: { colspan, rowspan }, content: cellContent(subFlow(cell, applyMarks([], style.marks), align), align) });
          }
          if (cells.length) { rows.push({ type: 'tableRow', content: cells }); widths.push(width); }
        } else if (tag !== 'colgroup' && tag !== 'col') issue('unsupported-element', 'loss', `<${tag}> inside a table`);
      }
    };
    presentation(el, 'table', 'block');
    visit(el);
    if (!rows.length) { issue('empty-table-dropped', 'notice'); return; }
    if (!spansRows && new Set(widths).size > 1) issue('table-ragged-rows', 'notice', `row widths ${[...new Set(widths)].join('/')}`);
    f.block({ type: 'table', content: rows });
  }

  function list(el: El, tag: string, f: Flow) {
    const items: RichNode[] = [];
    const hoisted: RichNode[] = [];
    const item = (blocks: RichNode[]) => {
      const kept = blocks.filter((b) => LIST_ITEM_ALLOWED.has(b.type));
      for (const b of blocks) if (!LIST_ITEM_ALLOWED.has(b.type)) { hoisted.push(b); issue('list-item-block-moved', 'notice', b.type); }
      if (!kept.length) return;
      // A list item starts with a paragraph (editor schema).
      items.push({ type: 'listItem', content: kept[0].type === 'paragraph' ? kept : [paragraph(), ...kept] });
    };
    for (const child of el.childNodes ?? []) {
      if (child.tagName === 'li') { presentation(child, 'li', 'block'); item(subFlow(child, [])); }
      else if (child.tagName) item(subFlow({ nodeName: 'li', tagName: 'li', childNodes: [child] }, []));
      else if (child.nodeName === '#text' && clean(child.value ?? '')) item([paragraph([{ type: 'text', text: clean(child.value!) }])]);
    }
    if (items.length) {
      const start = Number.parseInt(attr(el, 'start'), 10);
      f.block(tag === 'ul' ? { type: 'bulletList', content: items } : { type: 'orderedList', attrs: { start: Number.isInteger(start) && start > 0 ? start : 1 }, content: items });
    }
    hoisted.forEach((b) => f.block(b));
  }

  /** Text of an FAQ answer: plain text with paragraph breaks, as the FAQ system stores it. */
  function answerText(nodes: El[]): string {
    const BREAKS = new Set(['p', 'div', 'li', 'br', 'ul', 'ol', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'table']);
    const read = (n: El): string => (n.nodeName === '#text' ? (n.value ?? '').replace(/[\s ]+/g, ' ') : SKIPPED_TEXT.has(n.nodeName) ? '' : BREAKS.has(n.nodeName) ? `\n${(n.childNodes ?? []).map(read).join('')}\n` : (n.childNodes ?? []).map(read).join(''));
    return nodes.map(read).join('').split('\n').map((l) => l.trim()).filter(Boolean).join('\n\n');
  }

  function faq(el: El, f: Flow) {
    f.flush();
    const summary = (el.childNodes ?? []).find((c) => c.tagName === 'summary');
    const rest = (el.childNodes ?? []).filter((c) => c !== summary);
    const question = clean(summary ? textOf(summary) : '');
    const answer = answerText(rest);
    const problems: string[] = [];
    if (!summary) problems.push('No <summary>: the question is missing.');
    if (question.length < FAQ_LIMITS.question[0] || question.length > FAQ_LIMITS.question[1]) problems.push(`Question must be ${FAQ_LIMITS.question[0]}–${FAQ_LIMITS.question[1]} characters (${question.length}).`);
    if (answer.length < FAQ_LIMITS.answer[0] || answer.length > FAQ_LIMITS.answer[1]) problems.push(`Answer must be ${FAQ_LIMITS.answer[0]}–${FAQ_LIMITS.answer[1]} characters (${answer.length}).`);
    if (problems.length) issue('faq-invalid', 'loss', `${question || '(no question)'}: ${problems.join(' ')}`);
    if (has(el, 'svg')) issue('decorative-svg-dropped', 'notice', 'accordion icon');
    const holder: El = { nodeName: 'div', childNodes: rest };
    if (has(holder, 'a')) issue('faq-answer-link-flattened', 'loss', question);
    if (['img', 'table', 'ul', 'ol'].some((t) => has(holder, t))) issue('faq-answer-rich-content-flattened', 'loss', question);
    faqs.push({ question, answer, problems });
    const last = f.blocks[f.blocks.length - 1];
    if (last?.type === 'heading' && /\bfaqs?\b|frequently asked/i.test(plainOf(last))) { f.blocks.pop(); removedText.push(plainOf(last)); issue('faq-heading-removed', 'notice', plainOf(last)); }
  }

  function embedOf(url: string): RichNode | null {
    if (!isSafeHref(url) || url.startsWith('/')) return null;
    const host = new URL(url).hostname.replace(/^www\./, '');
    const kind = /(^|\.)youtube\.com$|^youtu\.be$|^youtube-nocookie\.com$/.test(host) ? 'youtube' : /(^|\.)vimeo\.com$/.test(host) ? 'vimeo' : 'generic';
    return { type: 'embed', attrs: { kind, url, title: '' } };
  }

  function walk(node: El, f: Flow, marks: Mark[]) {
    if (node.nodeName === '#text') { f.text(node.value ?? '', marks); return; }
    const tag = node.tagName;
    if (!tag) return; // comments (<!-- wp:… -->, <!--more-->) and doctype
    const children = node.childNodes ?? [];

    if (tag === 'br') { f.lineBreak(); return; }
    if (tag === 'img') { image(node, f); return; }
    if (tag === 'hr') { f.block({ type: 'horizontalRule' }); return; }
    if (tag === 'svg') { issue('decorative-svg-dropped', 'notice'); return; }
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'template') { issue('script-or-style-dropped', 'loss', `<${tag}>`); return; }
    if (tag === 'details') { faq(node, f); return; }
    if (tag === 'table') { f.flush(); table(node, f); return; }
    if (tag === 'ul' || tag === 'ol') { f.flush(); presentation(node, tag, 'block'); list(node, tag, f); return; }
    if (tag === 'iframe' || tag === 'video' || tag === 'audio' || tag === 'embed' || tag === 'object') {
      const embed = embedOf(attr(node, 'src').trim());
      // Only a known video host becomes an embed block; any other frame is reported, not kept.
      if (embed && tag === 'iframe' && embed.attrs!.kind !== 'generic') { issue('iframe-converted-to-embed', 'notice', attr(node, 'src')); f.block(embed); }
      else issue('embedded-media-dropped', 'loss', `<${tag}> ${attr(node, 'src')}`);
      return;
    }

    if (tag in MARK_TAGS) {
      const style = presentation(node, tag, 'inline');
      const next = applyMarks(withMark(marks, { type: MARK_TAGS[tag] } as Mark), style.marks);
      children.forEach((c) => walk(c, f, next));
      return;
    }
    if (PLAIN_INLINE.has(tag)) {
      if (tag === 'sup' || tag === 'sub') issue('superscript-subscript-flattened', 'loss', textOf(node));
      const style = presentation(node, tag, 'inline');
      const next = applyMarks(marks, style.marks);
      children.forEach((c) => walk(c, f, next));
      return;
    }
    if (tag === 'a') {
      presentation(node, tag, 'inline');
      const href = attr(node, 'href').trim();
      if (!isSafeHref(href)) {
        if (clean(textOf(node))) issue('link-dropped', 'loss', `${href || '(no href)'} — text kept: ${textOf(node)}`);
        children.forEach((c) => walk(c, f, marks));
        return;
      }
      if (has(node, 'img')) issue('image-link-dropped', 'loss', href);
      const rel = attr(node, 'rel').split(/\s+/).filter((t) => (LINK_REL_OPTIONS as readonly string[]).includes(t));
      const rewritten = options.rewriteLink?.(href);
      const finalHref = rewritten && isSafeHref(rewritten) ? rewritten : href;
      links.push({ href: finalHref, originalHref: href, text: clean(textOf(node)).slice(0, 160) });
      const link: Mark = { type: 'link', attrs: { href: finalHref, target: attr(node, 'target') === '_blank' ? '_blank' : null, rel: rel.length ? [...new Set(rel)].join(' ') : null } };
      children.forEach((c) => walk(c, f, withMark(marks, link)));
      return;
    }

    if (tag === 'p') {
      f.flush();
      const style = presentation(node, tag, 'block');
      const before = f.align;
      f.align = style.align ?? before;
      f.inParagraph = true;
      children.forEach((c) => walk(c, f, applyMarks(marks, style.marks)));
      f.flush();
      f.inParagraph = false;
      f.align = before;
      return;
    }
    if (tag in HEADING_LEVEL) {
      f.flush();
      const style = presentation(node, tag, 'block');
      const level = HEADING_LEVEL[tag];
      if (tag === 'h1' || tag === 'h5' || tag === 'h6') issue('heading-level-changed', 'loss', `${tag.toUpperCase()} → H${level}: ${textOf(node)}`);
      const { inline, others } = inlineOf(subFlow(node, marks.filter((m) => m.type === 'link')));
      // Headings are bold already; a bold mark inside one adds nothing.
      const content = tidy(inline.map((n) => (n.type === 'text' && n.marks ? { ...n, marks: n.marks.filter((m) => m.type !== 'bold') } : n)).map((n) => (n.type === 'text' && n.marks && !n.marks.length ? { type: 'text', text: n.text } : n)));
      if (content.length) f.block({ type: 'heading', attrs: { level, textAlign: style.align ?? f.align }, content });
      others.forEach((b) => { issue('heading-block-content-moved', 'notice', b.type); f.block(b); });
      return;
    }
    if (tag === 'blockquote') {
      f.flush();
      presentation(node, tag, 'block');
      const blocks = subFlow(node, marks);
      const kept = blocks.filter((b) => QUOTE_ALLOWED.has(b.type));
      if (kept.length) f.block({ type: 'blockquote', content: kept });
      blocks.filter((b) => !QUOTE_ALLOWED.has(b.type)).forEach((b) => { issue('blockquote-block-moved', 'notice', b.type); f.block(b); });
      return;
    }
    if (tag === 'pre') {
      f.flush();
      const code = textOf(node).replace(/\n+$/, '');
      if (code.trim()) f.block({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: code }] });
      return;
    }
    if (tag === 'figure') {
      f.flush();
      presentation(node, tag, 'block');
      const start = f.blocks.length;
      const caption = clean(children.filter((c) => c.tagName === 'figcaption').map(textOf).join(' '));
      children.filter((c) => c.tagName !== 'figcaption').forEach((c) => walk(c, f, marks));
      f.flush();
      const figureImages = f.blocks.slice(start).filter((b) => b.type === 'image');
      if (caption && figureImages.length) {
        if (caption.length > 500) issue('image-caption-truncated', 'loss', caption);
        const target = figureImages[figureImages.length - 1];
        target.attrs!.caption = caption.slice(0, 500);
        const record = [...images].reverse().find((i) => i.mediaId === target.attrs!.mediaId);
        if (record) record.caption = caption.slice(0, 500);
      } else if (caption) f.block(paragraph([{ type: 'text', text: caption }], f.align));
      return;
    }
    if (WRAPPERS.has(tag) || tag === 'figcaption' || tag === 'summary') {
      f.flush();
      const style = presentation(node, tag, 'block');
      const before = f.align;
      f.align = tag === 'center' ? 'center' : style.align ?? before;
      children.forEach((c) => walk(c, f, applyMarks(marks, style.marks)));
      f.flush();
      f.align = before;
      return;
    }
    if (TABLE_TAGS.has(tag) || tag === 'li') { // stray table/list parts outside their container
      issue('unsupported-element', 'loss', `<${tag}> outside its container`);
      f.flush();
      children.forEach((c) => walk(c, f, marks));
      f.flush();
      return;
    }
    issue('unsupported-element', 'loss', `<${tag}>`);
    children.forEach((c) => walk(c, f, marks));
  }

  const source = expandCaptionShortcodes(html);
  const fragment = parseFragment(source) as unknown as El;
  const top = new Flow(true);
  for (const child of fragment.childNodes ?? []) walk(child, top, []);
  top.flush();
  const content = top.blocks;

  for (const m of textOf(fragment).matchAll(/\[\/?[a-z_][a-z0-9_-]*(?:\s[^\]]*)?\]/g)) if (/[\s=/]/.test(m[0])) issue('possible-shortcode-left-as-text', 'notice', m[0]);

  if (options.videoUrl) {
    const embed = embedOf(options.videoUrl);
    if (embed) { content.unshift(embed); issue('video-link-added-as-embed', 'notice', `${options.videoUrl} (placed at the top; the old theme showed it in the post header)`); }
    else issue('video-link-invalid', 'loss', options.videoUrl);
  }

  // Word-level check that no text went missing between source and result.
  // Words are compared block by block, so text split across inline tags stays one word on both sides.
  const sourceText = (n: El): string => (n.nodeName === '#text' ? n.value ?? '' : SKIPPED_TEXT.has(n.nodeName) ? '' : n.nodeName === 'br' ? ' ' : n.nodeName in MARK_TAGS || PLAIN_INLINE.has(n.nodeName) || n.nodeName === 'a' ? (n.childNodes ?? []).map(sourceText).join('') : ` ${(n.childNodes ?? []).map(sourceText).join('')} `);
  const sourceWords = words(sourceText(fragment));
  const resultText: string[] = [...removedText];
  const collect = (n: RichNode) => {
    if (n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock') resultText.push(plainOf(n));
    else if (n.type === 'image' && n.attrs?.caption) resultText.push(String(n.attrs.caption));
    else (n.content ?? []).forEach(collect);
  };
  content.forEach(collect);
  faqs.forEach((q) => resultText.push(q.question, q.answer));
  const convertedWords = words(resultText.join(' '));
  const remaining = new Map<string, number>();
  for (const w of convertedWords) remaining.set(w, (remaining.get(w) ?? 0) + 1);
  const missing: string[] = [];
  for (const w of sourceWords) { const n = remaining.get(w) ?? 0; if (n > 0) remaining.set(w, n - 1); else missing.push(w); }
  const coverage = { sourceWords: sourceWords.length, convertedWords: convertedWords.length, missingWords: missing.length, missingSample: [...new Set(missing)].slice(0, 20) };
  if (missing.length) issue('text-not-carried-over', 'loss', missing.slice(0, 12).join(' '), missing.length);

  const stats: Record<string, number> = {};
  const tally = (n: RichNode) => { stats[n.type] = (stats[n.type] ?? 0) + 1; (n.content ?? []).forEach(tally); };
  content.forEach(tally);

  const sorted = () => [...issues.values()].sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === 'loss' ? -1 : 1));
  const base = { images, links, faqs, stats, coverage };
  if (!content.length) return { ok: false, error: 'The post body produced no content.', doc: null, issues: sorted(), ...base };
  const validated = validateRichDoc({ type: 'doc', content });
  if (!validated.ok) return { ok: false, error: (validated as { error: string }).error, doc: null, issues: sorted(), ...base };
  return { ok: true, doc: validated.doc, issues: sorted(), ...base };
}
