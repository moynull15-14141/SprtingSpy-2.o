import { Node, mergeAttributes } from '@tiptap/core';

type AttributeSpec = { default: unknown; parseHTML?: (el: HTMLElement) => unknown; renderHTML?: (attrs: Record<string, unknown>) => Record<string, unknown> };

const atomNode = (name: string, label: (attrs: Record<string, unknown>) => string, attributes: Record<string, AttributeSpec>) =>
  Node.create({
    name,
    group: 'block',
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes: () => attributes,
    parseHTML: () => [{ tag: `[data-newsroom-node="${name}"]` }],
    renderHTML({ node, HTMLAttributes }) {
      return ['div', mergeAttributes(HTMLAttributes, { 'data-newsroom-node': name, class: `newsroom-node newsroom-node-${name}` }), label(node.attrs)];
    },
  });

export const NewsBox = atomNode(
  'newsBox',
  (a) => `${String(a.title || a.variant || 'Editorial block')} — ${String(a.body || '')}`,
  { variant: { default: 'callout' }, title: { default: '' }, body: { default: '' } },
);

export const EmbedBlock = atomNode(
  'embed',
  (a) => `${String(a.kind || 'Media').toUpperCase()}: ${String(a.title || a.url || '')}`,
  { kind: { default: 'generic' }, url: { default: '' }, title: { default: '' } },
);

export const RelatedStory = atomNode(
  'relatedStory',
  (a) => `RELATED STORY — ${String(a.title || '')}`,
  { articleId: { default: '' }, href: { default: '' }, title: { default: '' }, category: { default: '' }, date: { default: '' }, image: { default: '' } },
);

export const MediaGroup = atomNode(
  'mediaGroup',
  (a) => `${String(a.layout || 'gallery').toUpperCase()} — ${Array.isArray(a.mediaIds) ? a.mediaIds.length : 0} images`,
  {
    // Copy/paste round-trips through HTML: keep the id list as JSON, not "a,b".
    mediaIds: {
      default: [],
      parseHTML: (el: HTMLElement) => { try { const ids = JSON.parse(el.getAttribute('data-media-ids') || '[]'); return Array.isArray(ids) ? ids : []; } catch { return []; } },
      renderHTML: (attrs: Record<string, unknown>) => ({ 'data-media-ids': JSON.stringify(attrs.mediaIds ?? []) }),
    },
    layout: { default: 'gallery' },
  },
);
