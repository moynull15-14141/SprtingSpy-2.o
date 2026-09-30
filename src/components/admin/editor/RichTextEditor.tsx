'use client';

/**
 * Article body editor (PHASE C) built on TipTap. CMS-only: loaded lazily
 * from the admin bundle, never on public pages.
 *
 * It produces the document format defined in src/lib/richText.ts. The
 * toolbar only offers what that format allows (H2–H4, bold, italic, links
 * with rel options, lists, quotes, rules, tables, library images), and the
 * server validates every saved document again.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { NodeSelection } from '@tiptap/pm/state';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { headingWarnings, isSafeHref, validateRichDoc, type RichDoc } from '../../../lib/richText';
import type { MediaItem } from '../../../types';
import { MediaPicker } from '../media/MediaShared';
import { useApp } from '../../../context/AppContext';
import { EmbedBlock, MediaGroup, NewsBox, RelatedStory } from './NewsroomNodes';
import { TextAppearance } from './TextAppearance';
import { TEXT_COLORS, TEXT_SIZES } from '../../../lib/richText';
import { useArticleSearch } from '../useArticleSearch';
import {
  Bold, Heading2, Heading3, Heading4, ImageIcon, Italic, Link as LinkIcon,
  List, ListOrdered, Minus, Pilcrow, Plus, Quote, Rows3, Columns3,
  Table as TableIcon, Trash2, Underline as UnderlineIcon, Strikethrough,
  Undo2, Redo2, Eraser, ListChecks, AlignLeft, AlignCenter, AlignRight,
  Blocks, Code2, ChevronUp, ChevronDown, Copy, Settings2,
} from 'lucide-react';

/** Images are Media Library references (mediaId), not free URLs. */
const LibraryImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: { default: null },
      caption: { default: '' }, credit: { default: '' }, align: { default: 'center' },
      width: { default: 'wide' },
      // Copy/paste round-trips through HTML, where attributes are strings.
      lightbox: { default: true, parseHTML: (el: HTMLElement) => el.getAttribute('lightbox') !== 'false' },
    };
  },
});

const extensions = [
  StarterKit.configure({
    heading: { levels: [2, 3, 4] },
    code: {},
    codeBlock: {},
    strike: {},
    underline: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      // rel/target are chosen per link in the link dialog.
      HTMLAttributes: { rel: null, target: null },
    },
  }),
  LibraryImage.configure({ inline: false, allowBase64: false }),
  Underline,
  TextAppearance,
  TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right'] }),
  TaskList,
  TaskItem.configure({ nested: true }),
  NewsBox, EmbedBlock, RelatedStory, MediaGroup,
  // Table cells hold text paragraphs only (matches the stored document format).
  TableKit.configure({ table: { resizable: false }, tableCell: false, tableHeader: false }),
  TableCell.extend({ content: 'paragraph+' }),
  TableHeader.extend({ content: 'paragraph+' }),
];

const btn = (active = false) =>
  `inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-amber-700 text-white border-amber-600' : 'border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'}`;

function ToolButton({ label, description, active = false, disabled = false, onClick, children }: { label: string; description: string; active?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <span className="group/tool relative inline-flex">
      <button type="button" className={btn(active)} onClick={onClick} disabled={disabled} aria-label={`${label} — ${description}`} aria-pressed={active} title={`${label} — ${description}`}>
        {children}
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-max max-w-56 -translate-x-1/2 rounded-md bg-stone-950 px-2 py-1.5 text-[11px] font-medium text-white shadow-lg group-hover/tool:block group-focus-within/tool:block dark:bg-stone-100 dark:text-stone-950">
        <strong>{label}</strong> — {description}
      </span>
    </span>
  );
}

const Divider = () => <span aria-hidden="true" className="mx-1 hidden h-6 w-px bg-stone-300 dark:bg-stone-700 sm:block" />;
const dialogBtn = (primary = false) => `rounded-md border px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${primary ? 'border-amber-600 bg-amber-700 text-white' : 'border-stone-300 dark:border-stone-700 hover:bg-stone-100 dark:hover:bg-stone-800'}`;

export default function RichTextEditor({ initialDoc, onChange, firstParagraphFocusRequest = 0, editable = true }: { initialDoc: RichDoc; onChange: (doc: RichDoc) => void; firstParagraphFocusRequest?: number; editable?: boolean }) {
  const [doc, setDoc] = useState<RichDoc>(initialDoc);
  const [linkOpen, setLinkOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [blockMenu, setBlockMenu] = useState(false);
  const [dialog, setDialog] = useState<'news' | 'embed' | 'related' | 'mediaGroup' | 'image' | null>(null);
  const [replaceImage, setReplaceImage] = useState(false);
  const [slashPending, setSlashPending] = useState(false);
  const { mediaItems } = useApp();
  const styleSelection = useRef<{ from: number; to: number } | null>(null);

  const editor = useEditor({
    extensions,
    content: initialDoc,
    immediatelyRender: false,
    // Toolbar active states and the selected-block bar depend on the
    // selection, so re-render on every transaction, not only on edits.
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'prose-editor min-h-[420px] max-w-none p-4 focus:outline-none text-sm leading-relaxed',
        id: 'article-body',
        'aria-label': 'Article body',
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => {
      const json = e.getJSON() as RichDoc;
      setDoc(json);
      onChange(json);
      // "/" typed at the start of a block or after a space opens the block
      // menu; URLs, dates and "and/or" do not.
      const { $from, empty } = e.state.selection;
      const before = $from.parent.isTextblock && empty ? $from.parent.textBetween(Math.max(0, $from.parentOffset - 2), $from.parentOffset) : '';
      if (before === '/' || before.endsWith(' /')) { setSlashPending(true); setBlockMenu(true); }
    },
  });

  const warnings = useMemo(() => headingWarnings(doc), [doc]);
  const validity = useMemo(() => validateRichDoc(doc), [doc]);
  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  useEffect(() => {
    if (!editor || !firstParagraphFocusRequest) return;
    let paragraphPosition: number | undefined;
    editor.state.doc.forEach((node, offset) => {
      if (paragraphPosition === undefined && node.type.name === 'paragraph') paragraphPosition = offset + 1;
    });
    // Headings, tables and other blocks keep their positions. If the article
    // has no top-level paragraph, add one for its opening text.
    if (paragraphPosition === undefined) {
      editor.commands.insertContentAt(0, { type: 'paragraph' });
      paragraphPosition = 1;
    }
    editor.chain().focus().setTextSelection(paragraphPosition).scrollIntoView().run();
  }, [editor, firstParagraphFocusRequest]);

  if (!editor) return <div className="min-h-[420px] rounded-lg border border-stone-300 dark:border-stone-700 p-4 text-xs text-stone-500 dark:text-stone-400">Loading editor…</div>;

  const inTable = editor.isActive('table');
  const rememberStyleSelection = () => { styleSelection.current = { from: editor.state.selection.from, to: editor.state.selection.to }; };
  const applyTextStyle = (attrs: { size?: string; color?: string }) => {
    const chain = editor.chain();
    if (styleSelection.current) chain.setTextSelection(styleSelection.current);
    chain.setMark('textAppearance', attrs).run();
    // Native select focus must not collapse the text selection before the
    // next style control is used. Restore it explicitly after the change.
    editor.commands.focus();
  };
  const insertImage = (item: MediaItem) => {
    const image = { type: 'image', attrs: { src: item.url, alt: item.altText, title: item.title, caption: item.caption || '', credit: item.credit || '', align: 'center', width: 'wide', lightbox: true, mediaId: item.id } };
    if (replaceImage && editor.isActive('image')) {
      editor.chain().focus().updateAttributes('image', image.attrs).run();
      setReplaceImage(false); setPickerOpen(false); return;
    }
    // Images cannot go inside a table cell: place them right after the table.
    const { $from } = editor.state.selection;
    let tableDepth = -1;
    for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') tableDepth = d;
    if (tableDepth > 0) editor.chain().focus().insertContentAt($from.after(tableDepth), image).run();
    else editor.chain().focus().insertContent(image).run();
    setPickerOpen(false);
  };

  const beforeInsert = () => {
    if (slashPending) editor.chain().focus().deleteRange({ from: Math.max(0, editor.state.selection.from - 1), to: editor.state.selection.from }).run();
    setSlashPending(false); setBlockMenu(false);
  };
  const insert = (content: Record<string, unknown>) => { beforeInsert(); editor.chain().focus().insertContent(content).run(); };
  const selection = editor.state.selection;
  const selectedNode = selection instanceof NodeSelection ? selection.node : null;
  const selectedAtom = selectedNode && ['image', 'newsBox', 'embed', 'relatedStory', 'mediaGroup', 'horizontalRule'].includes(selectedNode.type.name);
  const selectedIndex = selectedAtom ? selection.$from.index() : -1;
  const canMoveUp = selectedIndex > 0;
  const canMoveDown = selectedAtom ? selectedIndex < selection.$from.parent.childCount - 1 : false;
  const mutateSelected = (action: 'up' | 'down' | 'duplicate' | 'delete') => {
    if (!(editor.state.selection instanceof NodeSelection)) return;
    const { from, node, $from } = editor.state.selection;
    const tr = editor.state.tr;
    let target = from;
    if (action === 'delete') tr.delete(from, from + node.nodeSize);
    else if (action === 'duplicate') { tr.insert(from + node.nodeSize, node.copy(node.content)); target = from + node.nodeSize; }
    else {
      const index = $from.index();
      const siblingIndex = action === 'up' ? index - 1 : index + 1;
      if (siblingIndex < 0 || siblingIndex >= $from.parent.childCount) return;
      const sibling = $from.parent.child(siblingIndex);
      tr.delete(from, from + node.nodeSize);
      target = action === 'up' ? from - sibling.nodeSize : from + sibling.nodeSize;
      tr.insert(target, node);
    }
    // Keep the moved/duplicated block selected so it can be moved again.
    if (action !== 'delete') tr.setSelection(NodeSelection.create(tr.doc, target));
    editor.view.dispatch(tr.scrollIntoView());
    editor.commands.focus();
  };

  return (
    <div className="rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950">
      <div
        className="cms-editor-toolbar flex flex-wrap items-center gap-1 rounded-t-lg border-b border-stone-200 bg-white p-2 dark:border-stone-800 dark:bg-stone-950"
        role="toolbar"
        aria-label="Formatting"
        // Toolbar clicks must not take focus (and the selection) from the editor.
        onMouseDown={(e) => { if ((e.target as HTMLElement).closest('button')) e.preventDefault(); }}
      >
        <ToolButton label="Paragraph" description="Use normal body text" active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()}><Pilcrow size={18} /></ToolButton>
        <ToolButton label="Heading 2" description="Apply a section heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}><Heading2 size={18} /></ToolButton>
        <ToolButton label="Heading 3" description="Apply a subsection heading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}><Heading3 size={18} /></ToolButton>
        <ToolButton label="Heading 4" description="Apply a minor heading" active={editor.isActive('heading', { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}><Heading4 size={18} /></ToolButton>
        <Divider />
        <ToolButton label="Bold" description="Make selected text bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold size={18} /></ToolButton>
        <ToolButton label="Italic" description="Italicize selected text" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic size={18} /></ToolButton>
        <ToolButton label="Underline" description="Underline selected text" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}><UnderlineIcon size={18} /></ToolButton>
        <ToolButton label="Strikethrough" description="Strike selected text" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><Strikethrough size={18} /></ToolButton>
        <ToolButton label="Insert Link" description="Add an internal or external link" active={editor.isActive('link')} onClick={() => setLinkOpen((o) => !o)}><LinkIcon size={18} /></ToolButton>
        <label className="flex items-center gap-1 px-1 text-xs">Text size
          <select aria-label="Text size" className="h-9 rounded border border-stone-300 bg-white px-2 dark:border-stone-700 dark:bg-stone-950" value={editor.getAttributes('textAppearance').size || 'default'} onPointerDown={rememberStyleSelection} onFocus={rememberStyleSelection} onChange={e => applyTextStyle({ size: e.target.value })}>
            {TEXT_SIZES.map((size, i) => <option key={size} value={size}>{['Default', 'Small', 'Large', 'Extra large'][i]}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 px-1 text-xs">Text color
          <select aria-label="Text color" className="h-9 rounded border border-stone-300 bg-white px-2 dark:border-stone-700 dark:bg-stone-950" value={editor.getAttributes('textAppearance').color || 'default'} onPointerDown={rememberStyleSelection} onFocus={rememberStyleSelection} onChange={e => applyTextStyle({ color: e.target.value })}>
            {TEXT_COLORS.map(color => <option key={color} value={color}>{color.charAt(0).toUpperCase() + color.slice(1)}</option>)}
          </select>
        </label>
        <Divider />
        <ToolButton label="Bullet List" description="Create a bulleted list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={18} /></ToolButton>
        <ToolButton label="Numbered List" description="Create a numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={18} /></ToolButton>
        <ToolButton label="Checklist" description="Create an editorial checklist" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}><ListChecks size={18} /></ToolButton>
        <ToolButton label="Block Quote" description="Format selected text as a quotation" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={18} /></ToolButton>
        <ToolButton label="Divider" description="Insert a horizontal section divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={18} /></ToolButton>
        <Divider />
        <ToolButton label="Insert Image" description="Add an image from Media Library" onClick={() => setPickerOpen(true)}><ImageIcon size={18} /></ToolButton>
        {!inTable ? (
          <ToolButton label="Insert Table" description="Add a three-column data table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><TableIcon size={18} /></ToolButton>
        ) : (
          <>
            <ToolButton label="Add Row" description="Add a row after the current row" onClick={() => editor.chain().focus().addRowAfter().run()}><span className="relative"><Rows3 size={18}/><Plus size={10} className="absolute -right-1 -top-1"/></span></ToolButton>
            <ToolButton label="Delete Row" description="Delete the current table row" onClick={() => editor.chain().focus().deleteRow().run()}><span className="relative"><Rows3 size={18}/><Minus size={10} className="absolute -right-1 -top-1"/></span></ToolButton>
            <ToolButton label="Add Column" description="Add a column after the current column" onClick={() => editor.chain().focus().addColumnAfter().run()}><span className="relative"><Columns3 size={18}/><Plus size={10} className="absolute -right-1 -top-1"/></span></ToolButton>
            <ToolButton label="Delete Column" description="Delete the current table column" onClick={() => editor.chain().focus().deleteColumn().run()}><span className="relative"><Columns3 size={18}/><Minus size={10} className="absolute -right-1 -top-1"/></span></ToolButton>
            <ToolButton label="Delete Table" description="Remove the entire table" onClick={() => editor.chain().focus().deleteTable().run()}><Trash2 size={18}/></ToolButton>
          </>
        )}
        <Divider />
        <ToolButton label="Align left" description="Align the current paragraph left" active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}><AlignLeft size={18}/></ToolButton>
        <ToolButton label="Align center" description="Center the current paragraph" active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}><AlignCenter size={18}/></ToolButton>
        <ToolButton label="Align right" description="Align the current paragraph right" active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}><AlignRight size={18}/></ToolButton>
        <ToolButton label="Clear formatting" description="Remove text styles" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><Eraser size={18}/></ToolButton>
        <ToolButton label="Undo" description="Undo the last change (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={18}/></ToolButton>
        <ToolButton label="Redo" description="Redo the last change (Ctrl+Shift+Z)" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={18}/></ToolButton>
        <button type="button" className={`${dialogBtn(true)} ml-auto inline-flex items-center gap-1.5`} aria-expanded={blockMenu} onClick={() => setBlockMenu((v) => !v)}><Blocks size={16}/> Add block</button>
      </div>

      {blockMenu && <BlockMenu onChoose={(choice) => {
        if (choice === 'paragraph') { beforeInsert(); editor.chain().focus().setParagraph().run(); }
        else if (choice === 'heading') { beforeInsert(); editor.chain().focus().toggleHeading({ level: 2 }).run(); }
        else if (choice === 'quote') { beforeInsert(); editor.chain().focus().toggleBlockquote().run(); }
        else if (choice === 'table') { beforeInsert(); editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); }
        else if (choice === 'code') { beforeInsert(); editor.chain().focus().toggleCodeBlock().run(); }
        else if (choice === 'image') { beforeInsert(); setPickerOpen(true); }
        else { setBlockMenu(false); setDialog(choice as typeof dialog); }
      }} onClose={() => { setBlockMenu(false); setSlashPending(false); }} />}

      {selectedAtom && <div className="flex flex-wrap items-center gap-1 border-b border-stone-200 bg-stone-50 px-2 py-1.5 text-[11px] dark:border-stone-800 dark:bg-stone-900" aria-label="Selected block actions">
        <Settings2 size={14}/><span className="mr-2 font-semibold">Selected {selectedNode.type.name}</span>
        <button type="button" className={dialogBtn()} disabled={!canMoveUp} onClick={() => mutateSelected('up')}><ChevronUp size={13} className="inline"/> Move up</button>
        <button type="button" className={dialogBtn()} disabled={!canMoveDown} onClick={() => mutateSelected('down')}><ChevronDown size={13} className="inline"/> Move down</button>
        <button type="button" className={dialogBtn()} onClick={() => mutateSelected('duplicate')}><Copy size={13} className="inline"/> Duplicate</button>
        {selectedNode.type.name === 'image' && <><button type="button" className={dialogBtn()} onClick={() => setDialog('image')}><Settings2 size={13} className="inline"/> Image settings</button><button type="button" className={dialogBtn()} onClick={() => { setReplaceImage(true); setPickerOpen(true); }}>Replace image</button></>}
        <button type="button" className={dialogBtn()} onClick={() => mutateSelected('delete')}><Trash2 size={13} className="inline"/> Delete</button>
      </div>}

      {linkOpen && <LinkDialog editor={editor} onClose={() => setLinkOpen(false)} />}

      <EditorContent editor={editor} />

      {(warnings.length > 0 || !validity.ok) && (
        <div className="p-2 border-t border-stone-200 dark:border-stone-800 space-y-0.5 text-[11px]" role="status">
          {!validity.ok && <p className="text-rose-600 dark:text-rose-400">⚠ {(validity as { error: string }).error}</p>}
          {warnings.map((w, i) => <p key={i} className="text-amber-700 dark:text-amber-400">⚠ Heading structure: {w}</p>)}
        </div>
      )}

      {pickerOpen && <MediaPicker onSelect={insertImage} onClose={() => setPickerOpen(false)} />}
      {dialog === 'news' && <NewsDialog onClose={() => setDialog(null)} onInsert={(attrs) => { insert({ type: 'newsBox', attrs }); setDialog(null); }} />}
      {dialog === 'embed' && <EmbedDialog onClose={() => setDialog(null)} onInsert={(attrs) => { insert({ type: 'embed', attrs }); setDialog(null); }} />}
      {dialog === 'related' && <RelatedDialog onClose={() => setDialog(null)} onInsert={(attrs) => { insert({ type: 'relatedStory', attrs }); setDialog(null); }} />}
      {dialog === 'mediaGroup' && <MediaGroupDialog items={mediaItems} onClose={() => setDialog(null)} onInsert={(attrs) => { insert({ type: 'mediaGroup', attrs }); setDialog(null); }} />}
      {dialog === 'image' && <ImageSettingsDialog attrs={editor.getAttributes('image')} onClose={() => setDialog(null)} onApply={(attrs) => { editor.chain().focus().updateAttributes('image', attrs).run(); setDialog(null); }} />}
    </div>
  );
}

/** Link editor: URL, link qualifier (Spec §13: normal / nofollow / sponsored / UGC) and new tab. */
function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const current = editor.getAttributes('link') as { href?: string; rel?: string | null; target?: string | null };
  const [href, setHref] = useState(current.href || '');
  const [rel, setRel] = useState((current.rel || '').split(' ').find((t) => ['nofollow', 'sponsored', 'ugc'].includes(t)) || '');
  const [newTab, setNewTab] = useState(current.target === '_blank');
  const [displayText, setDisplayText] = useState(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '));
  const [articleQuery, setArticleQuery] = useState('');
  const [error, setError] = useState('');
  useEffect(() => setError(''), [href]);
  // Internal links point at published articles only (server-side search).
  const found = useArticleSearch({ q: articleQuery.trim(), publicOnly: true, limit: 6 }, { enabled: articleQuery.trim().length > 0 });

  const apply = () => {
    const url = href.trim();
    if (!isSafeHref(url)) {
      setError('Use an https:// link, a mailto: address, or a site path starting with "/".');
      return;
    }
    const linkAttrs = { href: url, target: newTab ? '_blank' : null, rel: rel || null };
    const selectedText = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' ');
    if (displayText.trim() && (editor.state.selection.empty || displayText.trim() !== selectedText)) {
      editor.chain().focus().insertContent({ type: 'text', text: displayText.trim(), marks: [{ type: 'link', attrs: linkAttrs }] }).run();
    } else editor.chain().focus().extendMarkRange('link').setLink(linkAttrs as never).run();
    onClose();
  };

  return (
    <div className="p-3 border-b border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900 flex flex-wrap items-end gap-2 text-xs" role="group" aria-label="Edit link">
      <label className="min-w-[180px] flex-1">Display text
        <input className="w-full p-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" value={displayText} onChange={(e) => setDisplayText(e.target.value)} placeholder="Link text" />
      </label>
      <label className="flex-1 min-w-[220px]">Link URL
        <input autoFocus className="w-full p-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" value={href} onChange={(e) => setHref(e.target.value)} placeholder="https://… or /tennis/…" onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }} />
      </label>
      <label>Link type
        <select className="block p-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950" value={rel} onChange={(e) => setRel(e.target.value)} aria-label="Link type">
          <option value="">Editorial (normal)</option>
          <option value="nofollow">Nofollow</option>
          <option value="sponsored">Sponsored / paid</option>
          <option value="ugc">User-generated (UGC)</option>
        </select>
      </label>
      <label className="flex items-center gap-1 pb-1.5"><input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} /> New tab</label>
      <button type="button" className={dialogBtn(true)} onClick={apply}>Apply</button>
      {editor.isActive('link') && <button type="button" className={dialogBtn()} onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>Remove link</button>}
      <button type="button" className={dialogBtn()} onClick={onClose}>Cancel</button>
      {error && <p className="w-full text-rose-600">{error}</p>}
      <div className="w-full border-t border-stone-200 pt-2 dark:border-stone-700"><label className="font-semibold">Find an internal article<input className="mt-1 w-full rounded border border-stone-300 bg-white p-1.5 dark:border-stone-700 dark:bg-stone-950" value={articleQuery} onChange={(e) => setArticleQuery(e.target.value)} placeholder="Search title…"/></label>{articleQuery.trim() && <div className="mt-2 grid gap-1 sm:grid-cols-2" aria-busy={found.loading}>{(found.data?.items ?? []).map((a) => <button key={a.id} type="button" className="rounded border border-stone-200 p-2 text-left dark:border-stone-700" onClick={() => { setHref(a.url); setDisplayText(a.title); setNewTab(false); }}><strong className="block truncate">{a.title}</strong><span className="text-[10px] text-stone-500 dark:text-stone-400">{a.sportName} · {a.articleType} · {new Date(a.publishedAt).toLocaleDateString()}</span></button>)}{found.data && !found.loading && found.data.items.length === 0 && <p className="text-stone-500 dark:text-stone-400">No published article matches.</p>}</div>}</div>
    </div>
  );
}

type BlockChoice = 'paragraph' | 'heading' | 'quote' | 'image' | 'mediaGroup' | 'embed' | 'related' | 'news' | 'table' | 'code';
function BlockMenu({ onChoose, onClose }: { onChoose: (choice: BlockChoice) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const groups: [string, { id: BlockChoice; label: string; hint: string }[]][] = [
    ['Text', [{ id: 'paragraph', label: 'Paragraph', hint: 'Body copy' }, { id: 'heading', label: 'Heading', hint: 'Section heading' }, { id: 'quote', label: 'Quote', hint: 'Quoted text' }, { id: 'code', label: 'Code block', hint: 'Preformatted data/code' }]],
    ['Media', [{ id: 'image', label: 'Single image', hint: 'Media Library image' }, { id: 'mediaGroup', label: 'Gallery / comparison', hint: 'Two or more library images' }, { id: 'embed', label: 'Video, audio or document', hint: 'Safe URL embed' }]],
    ['News', [{ id: 'news', label: 'Newsroom block', hint: 'Key points, fact box, warning, source…' }, { id: 'related', label: 'Related story', hint: 'Live article reference' }]],
    ['Data', [{ id: 'table', label: 'Responsive table', hint: 'Structured rows and columns' }]],
  ];
  const q = query.trim().toLowerCase();
  return <div className="border-b border-stone-200 bg-stone-50 p-3 dark:border-stone-800 dark:bg-stone-900" role="dialog" aria-label="Add article block">
    <div className="mb-2 flex gap-2"><input autoFocus className="min-w-0 flex-1 rounded border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-950" placeholder="Search blocks… (or type / in the editor)" value={query} onChange={(e) => setQuery(e.target.value)}/><button type="button" className={dialogBtn()} onClick={onClose}>Close</button></div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{groups.map(([group, choices]) => {
      const visible = choices.filter((c) => !q || `${c.label} ${c.hint}`.toLowerCase().includes(q));
      return visible.length ? <div key={group}><div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">{group}</div><div className="space-y-1">{visible.map((c) => <button key={c.id} type="button" className="block w-full rounded-md border border-stone-200 bg-white p-2 text-left hover:border-amber-500 dark:border-stone-700 dark:bg-stone-950" onClick={() => onChoose(c.id)}><span className="block text-xs font-semibold">{c.label}</span><span className="text-[10px] text-stone-500 dark:text-stone-400">{c.hint}</span></button>)}</div></div> : null;
    })}</div>
  </div>;
}

const Modal = ({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) => <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label={title}><div className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl dark:bg-stone-900"><div className="mb-4 flex items-center justify-between"><h3 className="font-serif text-lg font-bold">{title}</h3><button type="button" className={dialogBtn()} onClick={onClose}>Close</button></div>{children}</div></div>;

function NewsDialog({ onInsert, onClose }: { onInsert: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const [variant, setVariant] = useState('callout'); const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  return <Modal title="Insert newsroom block" onClose={onClose}><div className="space-y-3 text-xs"><label className="block">Block type<select className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={variant} onChange={(e) => setVariant(e.target.value)}><option value="pullQuote">Pull quote</option><option value="callout">Callout / info</option><option value="warning">Warning / notice</option><option value="breaking">Breaking news</option><option value="keyPoints">Key points</option><option value="factBox">Fact box</option><option value="source">Source / reference</option><option value="readMore">Read more separator</option></select></label><label className="block">Heading (optional)<input className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={title} onChange={(e) => setTitle(e.target.value)}/></label><label className="block">Content<textarea autoFocus rows={6} className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Use one line per key point where appropriate."/></label><button type="button" disabled={!body.trim()} className={dialogBtn(true)} onClick={() => onInsert({ variant, title, body })}>Insert block</button></div></Modal>;
}

function EmbedDialog({ onInsert, onClose }: { onInsert: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const [kind, setKind] = useState('youtube'); const [url, setUrl] = useState(''); const [title, setTitle] = useState(''); const valid = isSafeHref(url) && /^https?:\/\//.test(url);
  return <Modal title="Insert media or document" onClose={onClose}><div className="space-y-3 text-xs"><label className="block">Format<select className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={kind} onChange={(e) => setKind(e.target.value)}><option value="youtube">YouTube</option><option value="vimeo">Vimeo</option><option value="video">Video file</option><option value="audio">Audio file</option><option value="document">PDF / document</option><option value="generic">Generic safe link</option></select></label><label className="block">Title<input className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={title} onChange={(e) => setTitle(e.target.value)}/></label><label className="block">HTTPS URL<input autoFocus className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={url} onChange={(e) => setUrl(e.target.value)}/></label><p className="text-stone-500 dark:text-stone-400">Raw HTML and social scripts are intentionally not accepted.</p>{(kind === 'video' || kind === 'audio') && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">Video and audio files must be served from this site (or its media CDN). The site&apos;s security policy blocks playing files from other websites — use YouTube or Vimeo, or insert a generic link instead.</p>}<button type="button" disabled={!valid} className={dialogBtn(true)} onClick={() => onInsert({ kind, url, title })}>Insert media</button></div></Modal>;
}

function RelatedDialog({ onInsert, onClose }: { onInsert: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  // Ranked server-side search; with no query it lists the latest published articles.
  const found = useArticleSearch({ q: query.trim(), publicOnly: true, limit: 10 });
  const matches = found.data?.items ?? [];
  return <Modal title="Insert related story" onClose={onClose}><input autoFocus className="mb-3 w-full rounded border p-2 text-xs dark:bg-stone-950" placeholder="Search article title or type…" value={query} onChange={(e) => setQuery(e.target.value)}/><div className="space-y-2">{matches.map((a) => <button key={a.id} type="button" className="flex w-full gap-3 rounded-lg border p-2 text-left hover:border-amber-500 dark:border-stone-700" onClick={() => onInsert({ articleId: a.id, href: a.url, title: a.title, category: a.articleType, date: a.publishedAt, image: a.featuredImage || '' })}>{a.featuredImage && <img src={a.featuredImage} alt="" className="h-12 w-20 rounded object-cover"/>}<span><strong className="block text-xs">{a.title}</strong><span className="text-[10px] text-stone-500 dark:text-stone-400">{a.sportName} · {a.articleType} · {new Date(a.publishedAt).toLocaleDateString()}</span></span></button>)}{found.data && !found.loading && !matches.length && <p className="text-xs text-stone-500 dark:text-stone-400">No published article matches.</p>}</div></Modal>;
}

function MediaGroupDialog({ items, onInsert, onClose }: { items: MediaItem[]; onInsert: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const [layout, setLayout] = useState('gallery'); const [selected, setSelected] = useState<string[]>([]); const [query, setQuery] = useState(''); const q = query.toLowerCase();
  const visible = items.filter((m) => m.copyrightReview !== 'restricted' && (!q || `${m.title} ${m.altText}`.toLowerCase().includes(q))).slice(0, 24);
  return <Modal title="Insert image group" onClose={onClose}><div className="space-y-3 text-xs"><div className="grid grid-cols-2 gap-2"><select className="rounded border p-2 dark:bg-stone-950" value={layout} onChange={(e) => setLayout(e.target.value)}><option value="two">Two-image layout</option><option value="gallery">Gallery grid</option><option value="comparison">Image comparison</option></select><input className="rounded border p-2 dark:bg-stone-950" placeholder="Search Media Library…" value={query} onChange={(e) => setQuery(e.target.value)}/></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-4">{visible.map((m) => <button key={m.id} type="button" aria-pressed={selected.includes(m.id)} className={`overflow-hidden rounded border ${selected.includes(m.id) ? 'border-amber-500 ring-2 ring-amber-500' : 'border-stone-200 dark:border-stone-700'}`} onClick={() => setSelected((s) => s.includes(m.id) ? s.filter((id) => id !== m.id) : [...s, m.id].slice(0, 12))}><img src={m.url} alt={m.altText} className="aspect-video w-full object-cover"/><span className="block truncate p-1 text-[10px]">{m.title}</span></button>)}</div><div className="flex items-center justify-between"><span>{selected.length} selected</span><button type="button" disabled={selected.length < 2 || ((layout === 'two' || layout === 'comparison') && selected.length !== 2)} className={dialogBtn(true)} onClick={() => onInsert({ layout, mediaIds: selected })}>Insert group</button></div></div></Modal>;
}

function ImageSettingsDialog({ attrs, onApply, onClose }: { attrs: Record<string, unknown>; onApply: (attrs: Record<string, unknown>) => void; onClose: () => void }) {
  const [alt, setAlt] = useState(String(attrs.alt || '')); const [caption, setCaption] = useState(String(attrs.caption || '')); const [credit, setCredit] = useState(String(attrs.credit || '')); const [align, setAlign] = useState(String(attrs.align || 'center')); const [width, setWidth] = useState(String(attrs.width || 'wide')); const [lightbox, setLightbox] = useState(attrs.lightbox !== false);
  return <Modal title="Image settings" onClose={onClose}><div className="space-y-3 text-xs"><label className="block">Alt text<input autoFocus className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={alt} onChange={(e) => setAlt(e.target.value)}/></label><label className="block">Caption<textarea className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={caption} onChange={(e) => setCaption(e.target.value)}/></label><label className="block">Credit / source<input className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={credit} onChange={(e) => setCredit(e.target.value)}/></label><div className="grid grid-cols-2 gap-3"><label>Alignment<select className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={align} onChange={(e) => setAlign(e.target.value)}><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select></label><label>Width<select className="mt-1 w-full rounded border p-2 dark:bg-stone-950" value={width} onChange={(e) => setWidth(e.target.value)}><option value="small">Small</option><option value="medium">Medium</option><option value="wide">Wide</option><option value="full">Full width</option></select></label></div><label className="flex items-center gap-2"><input type="checkbox" checked={lightbox} onChange={(e) => setLightbox(e.target.checked)}/> Open larger image when clicked</label><button type="button" disabled={!alt.trim()} className={dialogBtn(true)} onClick={() => onApply({ alt, caption, credit, align, width, lightbox })}>Apply settings</button></div></Modal>;
}
