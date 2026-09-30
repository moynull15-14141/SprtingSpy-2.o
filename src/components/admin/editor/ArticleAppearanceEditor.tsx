import { Pencil } from 'lucide-react';
import type { ArticlePresentation, RichNode } from '../../../lib/richText';
import { TEXT_COLORS } from '../../../lib/richText';
import { RichText } from '../../editorial/RichText';

const field = 'mt-1 block min-h-10 w-full rounded-lg border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-950';

export function ArticleAppearanceEditor({ value, onChange, caption, credit, firstParagraph, onEditFirstParagraph }: {
  value: ArticlePresentation; onChange: (value: ArticlePresentation) => void; caption?: string; credit?: string;
  firstParagraph?: RichNode; onEditFirstParagraph: () => void;
}) {
  const patch = (change: Partial<ArticlePresentation>) => onChange({ ...value, ...change });
  return <fieldset className="min-w-0 space-y-4 rounded-lg border border-stone-300 p-3 dark:border-stone-700">
    <legend className="px-1 text-xs font-bold">Image caption & article appearance</legend>
    <p className="text-xs text-stone-500 dark:text-stone-400">These settings apply only to this article. Save the article to keep your changes.</p>
    <div className="grid gap-4 sm:grid-cols-2">
      {(['featuredCaption', 'featuredCredit'] as const).map((key) => {
        const fallback = key === 'featuredCaption' ? caption || 'SportingSpy Editorial Archive' : credit || 'Verified Sports Photography';
        const label = key === 'featuredCaption' ? 'Featured image caption' : 'Featured image credit';
        return <div key={key} className="space-y-2 text-xs">
          <label className="block font-semibold">{label}<input className={field} aria-label={label} maxLength={key === 'featuredCaption' ? 500 : 200} disabled={value[key] === undefined} value={value[key] ?? fallback} onChange={e => patch({ [key]: e.target.value })}/></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={value[key] === undefined} onChange={e => { const next = { ...value }; if (e.target.checked) delete next[key]; else next[key] = fallback; onChange(next); }}/> Use Media Library text</label>
          <p className="text-stone-500 dark:text-stone-400">Turn off to edit. Leave the field empty to hide this text.</p>
        </div>;
      })}
    </div>
    <div className="flex flex-wrap items-end gap-4 text-xs">
      <label className="flex min-h-10 items-center gap-2 font-semibold"><input type="checkbox" checked={value.dropCap !== false} onChange={e => patch({ dropCap: e.target.checked })}/> Show large first letter (drop cap)</label>
      <label>First letter size<select className={field} aria-label="First letter size" disabled={value.dropCap === false} value={value.dropCapSize || 'medium'} onChange={e => patch({ dropCapSize: e.target.value as ArticlePresentation['dropCapSize'] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
      <label>First letter color<select className={field} aria-label="First letter color" disabled={value.dropCap === false} value={value.dropCapColor || 'amber'} onChange={e => patch({ dropCapColor: e.target.value as ArticlePresentation['dropCapColor'] })}>{TEXT_COLORS.map(color => <option key={color} value={color}>{color === 'default' ? 'Body text color' : color.charAt(0).toUpperCase() + color.slice(1)}</option>)}</select></label>
    </div>
    <div className="min-w-0 rounded-lg bg-stone-50 p-3 dark:bg-stone-900" role="region" aria-label="First letter preview">
      <p className="mb-2 text-[10px] font-bold uppercase text-stone-500 dark:text-stone-400">First letter preview</p>
      {firstParagraph?.content?.some(node => node.type === 'text' && node.text?.trim())
        ? <div className="flow-root break-words text-base leading-relaxed"><RichText doc={{ type: 'doc', content: [firstParagraph], attrs: value }} media={{}} /></div>
        : <p className="text-sm text-stone-500 dark:text-stone-400">Add your article’s first paragraph to preview its appearance.</p>}
      <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
        <button type="button" onClick={onEditFirstParagraph} aria-controls="article-body" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-xs font-semibold hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-stone-700 dark:hover:bg-stone-800">
          <Pencil size={14} aria-hidden="true" /> Edit first paragraph
        </button>
        <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">Edit this text in the article body. The preview updates as you type; save the article to keep your changes.</p>
      </div>
    </div>
  </fieldset>;
}
