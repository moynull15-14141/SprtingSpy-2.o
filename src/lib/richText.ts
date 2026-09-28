/**
 * SportingSpy rich-text document model (PHASE C).
 *
 * Article bodies are stored as a TipTap/ProseMirror JSON document. This file
 * is the single definition of what a body may contain. It is shared by:
 *   - the server (validateRichDoc: strict allow-list, run on every save),
 *   - the public/preview renderer (RichText.tsx),
 *   - the CMS editor (legacyToDoc, headingWarnings).
 * Nothing outside this allow-list is ever stored or rendered, and no HTML
 * string is ever stored — so there is no HTML sanitisation step to get wrong.
 */

export type Mark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'underline' }
  | { type: 'strike' }
  | { type: 'code' }
  | { type: 'textAppearance'; attrs: { size: string; color: string } }
  | { type: 'link'; attrs: LinkAttrs };

export interface LinkAttrs {
  href: string;
  /** '_blank' opens a new tab (rendered with rel="noopener noreferrer"). */
  target: '_blank' | null;
  /** Spec v1.1 §13 link qualifiers; empty for a normal editorial link. */
  rel: string | null;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  marks?: Mark[];
  text?: string;
}

export interface RichDoc {
  type: 'doc';
  content: RichNode[];
  attrs?: ArticlePresentation;
}

export const TEXT_SIZES = ['default', 'small', 'large', 'extraLarge'] as const;
export const TEXT_COLORS = ['default', 'amber', 'blue', 'green', 'red', 'purple'] as const;
export interface ArticlePresentation {
  featuredCaption?: string;
  featuredCredit?: string;
  dropCap?: boolean;
  dropCapSize?: 'small' | 'medium' | 'large';
  dropCapColor?: typeof TEXT_COLORS[number];
}

export const HEADING_LEVELS = [2, 3, 4] as const;
export const LINK_REL_OPTIONS = ['nofollow', 'sponsored', 'ugc'] as const;

const BLOCK_CHILDREN: Record<string, string[] | 'inline'> = {
  doc: ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'horizontalRule', 'image', 'table', 'codeBlock', 'newsBox', 'embed', 'relatedStory', 'mediaGroup'],
  paragraph: 'inline',
  heading: 'inline',
  blockquote: ['paragraph', 'heading', 'bulletList', 'orderedList', 'image', 'horizontalRule'],
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  taskList: ['taskItem'],
  taskItem: ['paragraph', 'bulletList', 'orderedList', 'taskList'],
  listItem: ['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'image'],
  table: ['tableRow'],
  tableRow: ['tableHeader', 'tableCell'],
  tableHeader: ['paragraph'],
  tableCell: ['paragraph'],
  codeBlock: 'inline',
};
const LEAF_BLOCKS = new Set(['horizontalRule', 'image', 'newsBox', 'embed', 'relatedStory', 'mediaGroup']);
const INLINE = new Set(['text', 'hardBreak']);

export const RICH_DOC_LIMITS = { maxNodes: 20000, maxDepth: 12, maxTextLength: 200000, maxJsonBytes: 600000 };

/** Allowed link targets: http(s), mailto, or a site-relative path. */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string' || !href || href.length > 2048 || /[\s\u0000-\u001f]/.test(href)) return false;
  if (href.startsWith('/')) return !href.startsWith('//');
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

type Result = { ok: true; doc: RichDoc; mediaIds: string[] } | { ok: false; error: string };

/**
 * Validates an untrusted document and returns a clean copy containing only
 * allow-listed node types, marks and attributes. Anything unexpected is an
 * error (not silently dropped), so editors never lose content unknowingly.
 */
export function validateRichDoc(input: unknown): Result {
  let bytes = 0;
  try {
    bytes = JSON.stringify(input)?.length ?? 0;
  } catch {
    return { ok: false, error: 'body is not valid JSON.' };
  }
  if (bytes > RICH_DOC_LIMITS.maxJsonBytes) return { ok: false, error: 'body is too large.' };
  if (!input || typeof input !== 'object' || (input as RichNode).type !== 'doc' || !Array.isArray((input as RichNode).content)) {
    return { ok: false, error: 'body must be a rich-text document.' };
  }

  let nodes = 0;
  let textLength = 0;
  const mediaIds = new Set<string>();

  const clean = (node: unknown, parent: string, depth: number): RichNode => {
    if (++nodes > RICH_DOC_LIMITS.maxNodes) throw new Error('body has too many elements.');
    if (depth > RICH_DOC_LIMITS.maxDepth) throw new Error('body is nested too deeply.');
    if (!node || typeof node !== 'object') throw new Error('body contains an invalid element.');
    const n = node as RichNode;
    const allowed = BLOCK_CHILDREN[parent];
    const isInline = allowed === 'inline';
    if (isInline ? !INLINE.has(n.type) : !(allowed as string[]).includes(n.type)) {
      throw new Error(`body: "${String(n.type)}" is not allowed inside "${parent}".`);
    }

    if (n.type === 'text') {
      if (typeof n.text !== 'string' || !n.text) throw new Error('body contains an empty text element.');
      textLength += n.text.length;
      if (textLength > RICH_DOC_LIMITS.maxTextLength) throw new Error('body text is too long.');
      const marks = (n.marks || []).map(cleanMark);
      return marks.length ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text };
    }
    if (n.type === 'hardBreak' || n.type === 'horizontalRule') return { type: n.type };

    if (n.type === 'image') {
      const a = n.attrs || {};
      if (typeof a.mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(a.mediaId)) {
        throw new Error('body images must be selected from the Media Library.');
      }
      mediaIds.add(a.mediaId);
      return {
        type: 'image',
        attrs: {
          mediaId: a.mediaId,
          // src/width/height are re-derived from the Media Library by the server.
          src: typeof a.src === 'string' && isSafeHref(a.src) ? a.src : null,
          alt: typeof a.alt === 'string' ? a.alt.slice(0, 300) : '',
          title: typeof a.title === 'string' && a.title ? a.title.slice(0, 300) : null,
          caption: typeof a.caption === 'string' ? a.caption.slice(0, 500) : '',
          credit: typeof a.credit === 'string' ? a.credit.slice(0, 200) : '',
          align: ['left', 'center', 'right'].includes(String(a.align)) ? a.align : 'center',
          width: ['small', 'medium', 'wide', 'full'].includes(String(a.width)) ? a.width : 'wide',
          lightbox: a.lightbox !== false,
        },
      };
    }

    if (n.type === 'mediaGroup') {
      const a = n.attrs || {};
      const ids = Array.isArray(a.mediaIds) ? a.mediaIds.filter((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)).slice(0, 12) : [];
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.length < 2) throw new Error('An image group requires at least two different Media Library images.');
      uniqueIds.forEach((id) => mediaIds.add(id));
      return { type: 'mediaGroup', attrs: { mediaIds: uniqueIds, layout: ['two', 'gallery', 'comparison'].includes(String(a.layout)) ? a.layout : 'gallery' } };
    }

    if (n.type === 'newsBox') {
      const a = n.attrs || {};
      const variants = ['pullQuote', 'callout', 'warning', 'breaking', 'keyPoints', 'factBox', 'source', 'readMore'];
      if (!variants.includes(String(a.variant))) throw new Error('body contains an invalid newsroom block.');
      const body = typeof a.body === 'string' ? a.body.trim().slice(0, 5000) : '';
      if (!body) throw new Error('Newsroom blocks require content.');
      return { type: 'newsBox', attrs: { variant: a.variant, title: typeof a.title === 'string' ? a.title.slice(0, 160) : '', body } };
    }

    if (n.type === 'embed') {
      const a = n.attrs || {};
      const kinds = ['youtube', 'vimeo', 'video', 'audio', 'document', 'generic'];
      const url = typeof a.url === 'string' ? a.url.trim() : '';
      if (!kinds.includes(String(a.kind)) || !isSafeHref(url) || url.startsWith('/')) throw new Error('Embed blocks require a safe absolute URL.');
      return { type: 'embed', attrs: { kind: a.kind, url, title: typeof a.title === 'string' ? a.title.slice(0, 200) : '' } };
    }

    if (n.type === 'relatedStory') {
      const a = n.attrs || {};
      if (typeof a.articleId !== 'string' || !a.articleId || !isSafeHref(a.href)) throw new Error('Related stories must reference an article.');
      return { type: 'relatedStory', attrs: { articleId: a.articleId.slice(0, 100), href: a.href, title: String(a.title || '').slice(0, 300), category: String(a.category || '').slice(0, 100), date: String(a.date || '').slice(0, 40), image: typeof a.image === 'string' && isSafeHref(a.image) ? a.image : '' } };
    }

    const attrs: Record<string, unknown> = {};
    if (n.type === 'heading') {
      const level = Number(n.attrs?.level);
      if (!(HEADING_LEVELS as readonly number[]).includes(level)) throw new Error('body headings must be H2, H3 or H4.');
      attrs.level = level;
    }
    if (n.type === 'paragraph' || n.type === 'heading') attrs.textAlign = ['left', 'center', 'right'].includes(String(n.attrs?.textAlign)) ? n.attrs?.textAlign : 'left';
    if (n.type === 'taskItem') attrs.checked = n.attrs?.checked === true;
    if (n.type === 'codeBlock') attrs.language = typeof n.attrs?.language === 'string' ? n.attrs.language.slice(0, 40) : null;
    if (n.type === 'orderedList') {
      const start = Number(n.attrs?.start ?? 1);
      attrs.start = Number.isInteger(start) && start > 0 && start < 100000 ? start : 1;
    }
    if (n.type === 'tableCell' || n.type === 'tableHeader') {
      const span = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 20 ? (v as number) : 1);
      attrs.colspan = span(n.attrs?.colspan);
      attrs.rowspan = span(n.attrs?.rowspan);
    }

    const children = Array.isArray(n.content) ? n.content : [];
    if (LEAF_BLOCKS.has(n.type) && children.length) throw new Error(`body: "${n.type}" cannot have content.`);
    const out: RichNode = { type: n.type };
    if (Object.keys(attrs).length) out.attrs = attrs;
    if (children.length) out.content = children.map((c) => clean(c, n.type, depth + 1));
    return out;
  };

  const cleanMark = (mark: unknown): Mark => {
    const m = mark as { type?: string; attrs?: Record<string, unknown> };
    if (m?.type === 'textAppearance') {
      const size = m.attrs?.size ?? 'default';
      const color = m.attrs?.color ?? 'default';
      if (!(TEXT_SIZES as readonly unknown[]).includes(size) || !(TEXT_COLORS as readonly unknown[]).includes(color)) throw new Error('body contains an invalid text size or color.');
      return { type: 'textAppearance', attrs: { size: String(size), color: String(color) } };
    }
    if (m?.type === 'bold' || m?.type === 'italic' || m?.type === 'underline' || m?.type === 'strike' || m?.type === 'code') return { type: m.type };
    if (m?.type === 'link') {
      const href = typeof m.attrs?.href === 'string' ? m.attrs.href.trim() : '';
      if (!isSafeHref(href)) throw new Error(`body contains an unsafe or invalid link: ${String(href).slice(0, 80) || '(empty)'}`);
      const relTokens = String(m.attrs?.rel || '')
        .split(/\s+/)
        .filter((t) => (LINK_REL_OPTIONS as readonly string[]).includes(t));
      return { type: 'link', attrs: { href, target: m.attrs?.target === '_blank' ? '_blank' : null, rel: relTokens.length ? [...new Set(relTokens)].join(' ') : null } };
    }
    throw new Error(`body contains an unsupported text style: ${String(m?.type)}`);
  };

  try {
    const doc: RichDoc = { type: 'doc', content: (input as RichDoc).content.map((c) => clean(c, 'doc', 1)) };
    const raw = (input as RichDoc).attrs;
    if (raw !== undefined) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid article appearance.');
      const a: ArticlePresentation = {};
      for (const key of ['featuredCaption', 'featuredCredit'] as const) {
        if (raw[key] !== undefined) {
          if (typeof raw[key] !== 'string' || raw[key].length > (key === 'featuredCaption' ? 500 : 200)) throw new Error(`Invalid ${key}.`);
          a[key] = raw[key];
        }
      }
      if (raw.dropCap !== undefined) {
        if (typeof raw.dropCap !== 'boolean') throw new Error('Invalid drop cap setting.');
        a.dropCap = raw.dropCap;
      }
      if (raw.dropCapSize !== undefined) {
        if (!['small', 'medium', 'large'].includes(raw.dropCapSize)) throw new Error('Invalid drop cap size.');
        a.dropCapSize = raw.dropCapSize;
      }
      if (raw.dropCapColor !== undefined) {
        if (!(TEXT_COLORS as readonly unknown[]).includes(raw.dropCapColor)) throw new Error('Invalid drop cap color.');
        a.dropCapColor = raw.dropCapColor;
      }
      if (Object.keys(a).length) doc.attrs = a;
    }
    if (!doc.content.length) return { ok: false, error: 'body is empty.' };
    return { ok: true, doc, mediaIds: [...mediaIds] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'body is invalid.' };
  }
}

/** Plain-text projection of a document (search, reading time, excerpts). Blocks are separated by blank lines. */
export function docToPlainText(doc: RichDoc): string {
  const inline = (nodes: RichNode[] = []): string =>
    nodes.map((n) => (n.type === 'text' ? n.text || '' : n.type === 'hardBreak' ? '\n' : inline(n.content))).join('');
  const blocks: string[] = [];
  const walk = (nodes: RichNode[] = []) => {
    for (const n of nodes) {
      if (n.type === 'paragraph' || n.type === 'heading') {
        const t = inline(n.content).trim();
        if (t) blocks.push(t);
      } else if (n.type === 'tableRow') {
        blocks.push((n.content || []).map((cell) => inline(cell.content?.flatMap((p) => p.content || []))).join(' | '));
      } else if (n.type === 'image') {
        if (n.attrs?.alt) blocks.push(String(n.attrs.alt));
      } else if (n.type === 'newsBox') {
        blocks.push([n.attrs?.title, n.attrs?.body].filter(Boolean).join('\n'));
      } else if (n.type === 'relatedStory') {
        if (n.attrs?.title) blocks.push(String(n.attrs.title));
      } else if (n.type === 'embed') {
        if (n.attrs?.title) blocks.push(String(n.attrs.title));
      } else walk(n.content);
    }
  };
  walk(doc.content);
  return blocks.join('\n\n');
}

/** Heading structure problems worth warning an editor about (non-blocking). */
export function headingWarnings(doc: RichDoc): string[] {
  const warnings: string[] = [];
  let previous = 1; // the article title is the page's H1
  for (const n of doc.content) {
    if (n.type !== 'heading') continue;
    const level = Number(n.attrs?.level);
    if (level > previous + 1) warnings.push(`H${level} follows H${previous}: a heading level is skipped.`);
    const text = (n.content || []).map((c) => c.text || '').join('').trim();
    if (!text) warnings.push(`An empty H${level} heading.`);
    previous = level;
  }
  return warnings;
}

// ── Legacy plain-text bodies ──

/** Inline legacy markup: **bold**, *italic*, [text](url). Everything else is literal text. */
function legacyInline(text: string): RichNode[] {
  const out: RichNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  const pushText = (value: string, marks?: Mark[]) => {
    const lines = value.split('\n');
    lines.forEach((line, i) => {
      if (i > 0) out.push({ type: 'hardBreak' });
      if (line) out.push(marks?.length ? { type: 'text', text: line, marks } : { type: 'text', text: line });
    });
  };
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    pushText(text.slice(last, m.index));
    if (m[1] !== undefined) pushText(m[1], [{ type: 'bold' }]);
    else if (m[2] !== undefined) pushText(m[2], [{ type: 'italic' }]);
    else if (isSafeHref(m[4])) pushText(m[3], [{ type: 'link', attrs: { href: m[4], target: null, rel: null } }]);
    else pushText(m[0]);
    last = m.index! + m[0].length;
  }
  pushText(text.slice(last));
  return out;
}

/**
 * Converts a legacy plain-text body (blank-line separated blocks, "## "/"### "
 * headings, "- "/"* " and "1. " lists) into a document. Used to render
 * articles saved before PHASE C and to open them in the rich editor.
 */
export function legacyToDoc(content: string): RichDoc {
  const blocks = content.trim().split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const nodes: RichNode[] = blocks.map((block) => {
    const heading = block.match(/^(#{2,4})\s+(.*)$/s);
    if (heading) return { type: 'heading', attrs: { level: heading[1].length }, content: legacyInline(heading[2].replace(/\n/g, ' ')) };
    if (/^[*-]\s/.test(block)) {
      return { type: 'bulletList', content: block.split('\n').map((li) => ({ type: 'listItem', content: [{ type: 'paragraph', content: legacyInline(li.replace(/^[*-]\s+/, '')) }] })) };
    }
    if (/^\d+\.\s/.test(block)) {
      return { type: 'orderedList', attrs: { start: 1 }, content: block.split('\n').map((li) => ({ type: 'listItem', content: [{ type: 'paragraph', content: legacyInline(li.replace(/^\d+\.\s+/, '')) }] })) };
    }
    return { type: 'paragraph', content: legacyInline(block) };
  });
  return { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] };
}
