/**
 * Article body renderer (PHASE C). Renders a validated rich-text document
 * (see src/lib/richText.ts) to semantic HTML: h2–h4, p, lists, blockquote,
 * hr, tables and responsive images. Used by the public article page and the
 * staff preview, so both show exactly the same output. No
 * dangerouslySetInnerHTML: text is always rendered as React text.
 */

import React from 'react';
import type { Mark, RichDoc, RichNode } from '../../lib/richText';
import type { MediaAsset } from '../../lib/media';
import { ResponsiveImage } from './ResponsiveImage';
import styles from './TextAppearance.module.css';

interface RichTextProps {
  doc: RichDoc;
  media: Record<string, MediaAsset>;
  /** Inserted after the second top-level paragraph (in-article ad slot). */
  afterSecondParagraph?: React.ReactNode;
}

/** rel for a link: editor-chosen qualifiers, plus noopener/noreferrer for new tabs. */
function linkRel(attrs: Extract<Mark, { type: 'link' }>['attrs']): string | undefined {
  const tokens = new Set((attrs.rel || '').split(' ').filter(Boolean));
  if (attrs.target === '_blank') {
    tokens.add('noopener');
    tokens.add('noreferrer');
  }
  return tokens.size ? [...tokens].join(' ') : undefined;
}

function renderText(node: RichNode, key: React.Key): React.ReactNode {
  let out: React.ReactNode = node.text;
  for (const mark of node.marks || []) {
    if (mark.type === 'bold') out = <strong>{out}</strong>;
    else if (mark.type === 'italic') out = <em>{out}</em>;
    else if (mark.type === 'underline') out = <u>{out}</u>;
    else if (mark.type === 'strike') out = <s>{out}</s>;
    else if (mark.type === 'code') out = <code className="rounded bg-stone-100 px-1 py-0.5 text-[0.9em] dark:bg-stone-800">{out}</code>;
    else if (mark.type === 'textAppearance') out = <span className={styles.textAppearance} data-size={mark.attrs.size} data-color={mark.attrs.color}>{out}</span>;
    else if (mark.type === 'link') {
      out = (
        <a
          href={mark.attrs.href}
          target={mark.attrs.target || undefined}
          rel={linkRel(mark.attrs)}
          className="text-amber-700 dark:text-amber-400 underline underline-offset-2 hover:text-amber-600"
        >
          {out}
        </a>
      );
    }
  }
  return <React.Fragment key={key}>{out}</React.Fragment>;
}

function renderInline(nodes: RichNode[] = []): React.ReactNode[] {
  return nodes.map((n, i) => (n.type === 'hardBreak' ? <br key={i} /> : renderText(n, i)));
}

export function RichText({ doc, media, afterSecondParagraph }: RichTextProps) {
  let paragraphCount = 0;
  // PHASE R UI/UX: the page title is the only h1, so the body's shallowest
  // heading becomes h2 (an article whose sections start at H3 would otherwise
  // skip a level). Only the element changes; the size the editor chose stays.
  const levels: number[] = [];
  const collect = (nodes: RichNode[] = []) => nodes.forEach((n) => { if (n.type === 'heading') levels.push(Number(n.attrs?.level) || 2); else collect(n.content); });
  collect(doc.content);
  const headingShift = levels.length ? Math.max(0, Math.min(...levels) - 2) : 0;

  const renderBlock = (node: RichNode, key: React.Key, topLevel: boolean): React.ReactNode => {
    switch (node.type) {
      case 'paragraph': {
        if (!topLevel) return <p key={key}>{renderInline(node.content)}</p>;
        paragraphCount++;
        const isFirst = paragraphCount === 1;
        return (
          <React.Fragment key={key}>
            <p style={{ textAlign: String(node.attrs?.textAlign || 'left') as React.CSSProperties['textAlign'] }}
              className={isFirst && doc.attrs?.dropCap !== false ? styles.dropCap : undefined}
              data-size={isFirst ? doc.attrs?.dropCapSize || 'medium' : undefined}
              data-color={isFirst ? doc.attrs?.dropCapColor || 'amber' : undefined}
            >
              {renderInline(node.content)}
            </p>
            {paragraphCount === 2 && afterSecondParagraph}
          </React.Fragment>
        );
      }
      case 'heading': {
        const level = node.attrs?.level as 2 | 3 | 4;
        const className = {
          2: 'font-serif text-2xl sm:text-3xl font-bold text-stone-900 dark:text-stone-100 pt-6',
          3: 'font-serif text-xl sm:text-2xl font-bold text-stone-900 dark:text-stone-100 pt-4',
          4: 'font-serif text-lg sm:text-xl font-semibold text-stone-900 dark:text-stone-100 pt-2',
        }[level];
        const Tag = `h${Math.max(2, level - headingShift)}` as 'h2' | 'h3' | 'h4';
        return <Tag key={key} style={{ textAlign: String(node.attrs?.textAlign || 'left') as React.CSSProperties['textAlign'] }} className={className}>{renderInline(node.content)}</Tag>;
      }
      case 'bulletList':
        return <ul key={key} className="list-disc pl-6 space-y-2 text-stone-700 dark:text-stone-300">{node.content?.map((c, i) => renderBlock(c, i, false))}</ul>;
      case 'orderedList':
        return (
          <ol key={key} start={(node.attrs?.start as number) || undefined} className="list-decimal pl-6 space-y-2 text-stone-700 dark:text-stone-300">
            {node.content?.map((c, i) => renderBlock(c, i, false))}
          </ol>
        );
      case 'taskList':
        return <ul key={key} className="space-y-2">{node.content?.map((c, i) => renderBlock(c, i, false))}</ul>;
      case 'taskItem':
        return <li key={key} className="flex items-start gap-2"><input type="checkbox" checked={node.attrs?.checked === true} readOnly aria-label="Checklist item" className="mt-1"/><div>{node.content?.map((c, i) => renderBlock(c, i, false))}</div></li>;
      case 'listItem':
        // A list item's single paragraph renders inline, matching the pre-Phase-C output.
        return (
          <li key={key}>
            {node.content?.length === 1 && node.content[0].type === 'paragraph'
              ? renderInline(node.content[0].content)
              : node.content?.map((c, i) => renderBlock(c, i, false))}
          </li>
        );
      case 'blockquote':
        return (
          <blockquote key={key} className="border-l-4 border-amber-600 pl-4 italic text-stone-700 dark:text-stone-300 space-y-3">
            {node.content?.map((c, i) => renderBlock(c, i, false))}
          </blockquote>
        );
      case 'horizontalRule':
        return <hr key={key} className="my-8 border-stone-200 dark:border-stone-800" />;
      case 'image': {
        const asset = media[String(node.attrs?.mediaId)];
        if (!asset) return null; // media removed or not public: render nothing
        const alt = (node.attrs?.alt as string) || asset.alt;
        const width = String(node.attrs?.width || 'wide');
        const widthClass = width === 'small' ? 'max-w-md' : width === 'medium' ? 'max-w-2xl' : width === 'full' ? 'md:w-[calc(100%+8rem)] md:-ml-16' : 'max-w-4xl';
        const alignClass = node.attrs?.align === 'left' ? 'mr-auto' : node.attrs?.align === 'right' ? 'ml-auto' : 'mx-auto';
        const picture = <ResponsiveImage asset={asset} alt={alt} sizes="(min-width: 896px) 896px, 100vw" className="w-full h-auto rounded-xl border border-stone-200 dark:border-stone-800" />;
        return (
          <figure key={key} className={`my-6 ${widthClass} ${alignClass}`}>
            {node.attrs?.lightbox === false ? picture : <a href={asset.url} target="_blank" rel="noopener noreferrer" aria-label={`Open larger image: ${alt}`}>{picture}</a>}
            {(node.attrs?.caption || node.attrs?.credit || asset.caption || asset.credit) && (
              <figcaption className="mt-2 text-xs text-stone-500 dark:text-stone-400 flex justify-between gap-4 not-italic">
                <span>{String(node.attrs?.caption || asset.caption || '')}</span>
                {(node.attrs?.credit || asset.credit) && <span className="font-mono text-[10px]">{String(node.attrs?.credit || asset.credit)}</span>}
              </figcaption>
            )}
          </figure>
        );
      }
      case 'mediaGroup': {
        const assets = ((node.attrs?.mediaIds as string[]) || []).map((id) => media[id]).filter(Boolean);
        if (assets.length < 2) return null;
        const comparison = node.attrs?.layout === 'comparison';
        return <figure key={key} className={`my-8 grid gap-3 overflow-hidden ${comparison || node.attrs?.layout === 'two' ? 'sm:grid-cols-2' : 'grid-cols-2 md:grid-cols-3'}`} aria-label={comparison ? 'Image comparison' : 'Image gallery'}>{assets.map((asset, i) => <a key={i} href={asset.url} target="_blank" rel="noopener noreferrer" className="group relative"><ResponsiveImage asset={asset} alt={asset.alt} sizes="(min-width: 768px) 45vw, 100vw" className="h-full min-h-48 w-full rounded-lg border border-stone-200 object-cover dark:border-stone-800"/>{comparison && <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-bold uppercase text-white">{i === 0 ? 'Before' : 'After'}</span>}</a>)}</figure>;
      }
      case 'newsBox': {
        const variant = String(node.attrs?.variant || 'callout');
        const styles: Record<string, string> = { pullQuote: 'border-l-4 border-amber-600 bg-transparent text-xl italic', callout: 'border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30', warning: 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30', breaking: 'border-rose-400 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/30', keyPoints: 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30', factBox: 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30', source: 'border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900', readMore: 'border-x-0 border-amber-500 bg-transparent text-center' };
        const lines = String(node.attrs?.body || '').split('\n').filter(Boolean);
        return <aside key={key} className={`my-7 rounded-lg border p-5 ${styles[variant] || styles.callout}`} aria-label={String(node.attrs?.title || variant)}>{node.attrs?.title && <h3 className="mb-2 text-sm font-bold uppercase tracking-wider">{String(node.attrs.title)}</h3>}{variant === 'keyPoints' ? <ul className="list-disc space-y-1 pl-5">{lines.map((line, i) => <li key={i}>{line.replace(/^[-•]\s*/, '')}</li>)}</ul> : lines.map((line, i) => <p key={i} className="my-1 whitespace-pre-wrap">{line}</p>)}</aside>;
      }
      case 'relatedStory':
        return <a key={key} href={String(node.attrs?.href)} className="my-7 flex gap-4 rounded-xl border border-stone-200 p-3 no-underline transition hover:border-amber-500 dark:border-stone-800">{node.attrs?.image && <img src={String(node.attrs.image)} alt="" className="h-20 w-28 rounded-lg object-cover" loading="lazy"/>}<span><span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">Related story · {String(node.attrs?.category || '')}</span><strong className="mt-1 block text-base text-stone-900 dark:text-stone-100">{String(node.attrs?.title || '')}</strong>{node.attrs?.date && <time className="text-[11px] text-stone-500 dark:text-stone-400">{new Date(String(node.attrs.date)).toLocaleDateString()}</time>}</span></a>;
      case 'embed': {
        const kind = String(node.attrs?.kind); const url = String(node.attrs?.url); const title = String(node.attrs?.title || 'Embedded media');
        const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{6,})/i)?.[1];
        const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1];
        if (kind === 'youtube' && yt) return <div key={key} className="my-7 aspect-video overflow-hidden rounded-xl"><iframe className="h-full w-full" src={`https://www.youtube-nocookie.com/embed/${yt}`} title={title} loading="lazy" allowFullScreen/></div>;
        if (kind === 'vimeo' && vm) return <div key={key} className="my-7 aspect-video overflow-hidden rounded-xl"><iframe className="h-full w-full" src={`https://player.vimeo.com/video/${vm}`} title={title} loading="lazy" allowFullScreen/></div>;
        if (kind === 'video') return <video key={key} className="my-7 w-full rounded-xl" controls preload="metadata" src={url}>{title}</video>;
        if (kind === 'audio') return <figure key={key} className="my-7"><figcaption className="mb-2 text-sm font-semibold">{title}</figcaption><audio className="w-full" controls preload="metadata" src={url}/></figure>;
        return <a key={key} href={url} target="_blank" rel="noopener noreferrer" className="my-7 block rounded-lg border border-stone-200 p-4 font-semibold text-amber-700 dark:border-stone-800 dark:text-amber-400">{kind === 'document' ? 'Download / open document: ' : 'Open external resource: '}{title}</a>;
      }
      case 'codeBlock':
        return <pre key={key} className="my-6 overflow-x-auto rounded-lg bg-stone-950 p-4 text-sm text-stone-100"><code>{node.content?.map((n) => n.text || '').join('')}</code></pre>;
      case 'table':
        // The table scrolls inside its own container on small screens.
        return (
          <div key={key} className="my-6 overflow-x-auto rounded-lg border border-stone-200 dark:border-stone-800">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-stone-100 dark:divide-stone-800/60">{node.content?.map((c, i) => renderBlock(c, i, false))}</tbody>
            </table>
          </div>
        );
      case 'tableRow':
        return <tr key={key}>{node.content?.map((c, i) => renderBlock(c, i, false))}</tr>;
      case 'tableHeader':
      case 'tableCell': {
        const Cell = node.type === 'tableHeader' ? 'th' : 'td';
        const colSpan = (node.attrs?.colspan as number) > 1 ? (node.attrs?.colspan as number) : undefined;
        const rowSpan = (node.attrs?.rowspan as number) > 1 ? (node.attrs?.rowspan as number) : undefined;
        return (
          <Cell
            key={key}
            colSpan={colSpan}
            rowSpan={rowSpan}
            scope={node.type === 'tableHeader' ? 'col' : undefined}
            className={
              node.type === 'tableHeader'
                ? 'px-4 py-3 bg-stone-50 dark:bg-stone-900/40 text-xs font-semibold uppercase tracking-wider text-stone-600 dark:text-stone-400 align-top'
                : 'px-4 py-3 text-stone-800 dark:text-stone-200 tabular-nums align-top'
            }
          >
            {node.content?.map((p, i) => <React.Fragment key={i}>{renderInline(p.content)}</React.Fragment>)}
          </Cell>
        );
      }
      default:
        return null;
    }
  };

  return <>{doc.content.map((node, i) => renderBlock(node, i, true))}</>;
}
