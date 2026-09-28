/**
 * SportingSpy Editorial Article Workflow Component
 * Implements the required 10-step editorial progression:
 * New Article -> Select Sport -> Is Event? -> Select Event -> Select Edition? ->
 * Select Article Type -> Write -> Featured Image -> SEO Check -> Publish Status.
 */

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { legacyToDoc, validateRichDoc, type RichDoc } from '../../lib/richText';
import { MediaPicker, ReviewBadge, thumbnailUrl } from './media/MediaShared';
import { ArticleAppearanceEditor } from './editor/ArticleAppearanceEditor';

// The rich-text editor (TipTap) is loaded on demand, only inside the CMS.
const RichTextEditor = dynamic(() => import('./editor/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="min-h-[320px] rounded-lg border border-stone-300 dark:border-stone-700 p-4 text-xs text-stone-500 dark:text-stone-400">Loading editor…</div>,
});
const EMPTY_DOC: RichDoc = { type: 'doc', content: [{ type: 'paragraph' }] };
import { useApp } from '../../context/AppContext';
import { Article, ArticleType, ARTICLE_TYPES, SeoMetadata } from '../../types';
import { Button } from '../ui/Button';
import { useArticleSearch } from './useArticleSearch';

interface SeoCheckResult {
  checklist: { ruleKey: string; name: string; category: string; severity: string; passed: boolean; issues: { message: string; fix: string }[]; why: string }[];
  suggestions: {
    internalLinks: { title: string; url: string; reason: string }[];
    externalSources: { label: string; url: string }[];
    coverage: { type: string; edition: string }[];
  };
  assistant: { configured: boolean; reason: string | null };
}

interface AssistantResult {
  configured: boolean;
  suggestions: { missingTopics: string[]; missingEntities: string[]; factsToVerify: string[]; sectionIdeas: string[] };
}

const SuggestionList: React.FC<{ title: string; empty: string; items: React.ReactNode[] }> = ({ title, empty, items }) => (
  <section className="rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-2">
    <h5 className="font-semibold mb-1">{title}</h5>
    {items.length ? <ul className="space-y-1">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="text-stone-500 dark:text-stone-400">{empty}</p>}
  </section>
);

export const AdminArticles: React.FC = () => {
  const { articles, sports, events, editions, authors, addArticle, updateArticle, deleteArticle, navigate, mediaItems, apiCall, refreshData } =
    useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Workflow Form State
  const [sportSlug, setSportSlug] = useState<string>(sports[0]?.slug || 'tennis');
  const [isAboutEvent, setIsAboutEvent] = useState<boolean>(true);
  const [eventSlug, setEventSlug] = useState<string>('');
  const [editionYear, setEditionYear] = useState<number | undefined>(undefined);
  const [articleType, setArticleType] = useState<ArticleType>('Schedule');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [slug, setSlug] = useState('');
  const [excerpt, setExcerpt] = useState('');
  // PHASE C: rich body (editor document) + featured image from the Media Library.
  const [bodyDoc, setBodyDoc] = useState<RichDoc>(EMPTY_DOC);
  const [editorKey, setEditorKey] = useState(0);
  const [featuredImage, setFeaturedImage] = useState('');
  const [featuredMediaId, setFeaturedMediaId] = useState<string | null>(null);
  const [pickingFeatured, setPickingFeatured] = useState(false);
  const [saving, setSaving] = useState(false);
  const [authorId, setAuthorId] = useState<string>(authors[0]?.id || '');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  // Social metadata (Open Graph; Twitter/X reads the same tags).
  const [ogTitle, setOgTitle] = useState('');
  const [ogDescription, setOgDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  // SEO keys this form doesn't edit (canonicalUrl, keywords, noIndex) are kept as-is on save.
  const [otherSeo, setOtherSeo] = useState<SeoMetadata>({});
  // New articles start as drafts so nothing goes live by accident (PHASE C).
  const [status, setStatus] = useState<'draft' | 'preview' | 'scheduled' | 'published' | 'archived'>('draft');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [seoCheck, setSeoCheck] = useState<SeoCheckResult | null>(null);
  const [checkingSeo, setCheckingSeo] = useState(false);
  const [assistantResult, setAssistantResult] = useState<AssistantResult['suggestions'] | null>(null);
  const [runningAssistant, setRunningAssistant] = useState(false);

  // Filter events and editions by selected sport
  const availableEvents = events.filter((e) => e.sportSlug === sportSlug);
  const availableEditions = editions.filter((ed) => ed.eventSlug === eventSlug);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!editingId && !slug) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      );
    }
  };

  const resetForm = () => {
    setTitle('');
    setSubtitle('');
    setSlug('');
    setExcerpt('');
    setBodyDoc(EMPTY_DOC);
    setEditorKey((k) => k + 1);
    setFeaturedImage('');
    setFeaturedMediaId(null);
    setMetaTitle('');
    setMetaDescription('');
    setOgTitle('');
    setOgDescription('');
    setOgImage('');
    setOtherSeo({});
    setStatus('draft');
    setSeoCheck(null);
    setAssistantResult(null);
    setIsCreating(false);
    setEditingId(null);
  };

  const startCreate = () => {
    // The CMS dataset may finish loading after this component's first render,
    // so initialise required relationships at the moment the editor opens.
    if (!sportSlug && sports[0]) setSportSlug(sports[0].slug);
    if (!authorId && authors[0]) setAuthorId(authors[0].id);
    setFeedback(null);
    setEditingId(null);
    setIsCreating(true);
    requestAnimationFrame(() => document.getElementById('article-title')?.focus());
  };

  const seoDraft = () => ({
    id: editingId || 'draft', title, subtitle, slug, status, articleType, sportSlug,
    eventSlug: isAboutEvent && eventSlug ? eventSlug : null,
    editionYear: isAboutEvent && eventSlug && editionYear ? editionYear : null,
    excerpt, body: bodyDoc, featuredMediaId, featuredImage, authorId,
    seo: { ...otherSeo, metaTitle: metaTitle || title, metaDescription: metaDescription || excerpt, ogTitle, ogDescription, ogImage },
    references: [],
  });

  const runSeoCheck = async () => {
    setCheckingSeo(true);
    const result = await apiCall<SeoCheckResult>('/api/seo/article-check', { method: 'POST', body: seoDraft() });
    setCheckingSeo(false);
    if (result.data) setSeoCheck(result.data);
  };

  const runAssistant = async () => {
    setRunningAssistant(true);
    const result = await apiCall<AssistantResult>('/api/seo/assistant', { method: 'POST', body: seoDraft() });
    setRunningAssistant(false);
    if (result.data) setAssistantResult(result.data.suggestions);
  };

  const confirmFreshness = async (article: Article) => {
    const result = await apiCall<Article>(`/api/articles/${article.id}/review`, { method: 'POST', body: {} });
    if (result.data) {
      await refreshData();
      setFeedback(`Freshness review recorded for “${article.title}”. The content updated date was not changed.`);
    }
  };

  /** Saves the form; returns the saved article id, or null on failure (the form keeps its content). */
  const saveArticle = async (statusOverride = status): Promise<string | null> => {
    if (!title.trim() || !slug.trim()) return null;
    const bodyCheck = validateRichDoc(bodyDoc);
    if (!bodyCheck.ok) {
      setFeedback(`Body: ${(bodyCheck as { error: string }).error}`);
      return null;
    }

    const articlePayload = {
      title,
      subtitle: subtitle.trim() || undefined,
      slug,
      sportSlug,
      eventSlug: isAboutEvent && eventSlug ? eventSlug : undefined,
      editionYear: isAboutEvent && eventSlug && editionYear ? editionYear : undefined,
      articleType,
      excerpt,
      body: bodyDoc,
      featuredMediaId,
      // Legacy URL fallback only when no library image is chosen.
      ...(featuredMediaId ? {} : { featuredImage: featuredImage || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80' }),
      authorId,
      status: statusOverride,
      seo: {
        ...otherSeo,
        metaTitle: metaTitle || title,
        metaDescription: metaDescription || excerpt,
        ogTitle: ogTitle.trim() || undefined,
        ogDescription: ogDescription.trim() || undefined,
        ogImage: ogImage.trim() || undefined,
      },
    };

    setSaving(true);
    try {
      if (editingId) {
        return (await updateArticle(editingId, articlePayload as never)) ? editingId : null;
      }
      const created = await addArticle(articlePayload as never);
      if (created) setEditingId(created.id); // further saves/previews update the same article
      return created?.id ?? null;
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = await saveArticle();
    if (!id) return; // errors are shown; nothing is lost
    setFeedback(`Article "${title}" saved (${status}).`);
    resetForm();
    setTimeout(() => setFeedback(null), 5000);
  };

  const saveAs = async (nextStatus: typeof status) => {
    setStatus(nextStatus);
    const id = await saveArticle(nextStatus);
    if (id) setFeedback(`Article “${title}” saved as ${nextStatus}.`);
  };

  /**
   * Opens the staff-only preview in a new tab. Previewing never changes what
   * is live: an unpublished article is saved first (keeping its unpublished
   * status); a published article shows its last saved version without saving.
   */
  const willBeLive = status === 'published';
  const handlePreview = async () => {
    const tab = window.open('', '_blank');
    const id = willBeLive ? editingId : await saveArticle();
    if (!id) {
      tab?.close();
      if (willBeLive) setFeedback('Save the article first, or set it to Draft to preview unpublished changes.');
      return;
    }
    if (tab) tab.location.href = `/admin/preview/${id}/`;
  };

  const featuredMedia = featuredMediaId ? mediaItems.find((m) => m.id === featuredMediaId) : undefined;
  const editingArticle = editingId ? articles.find((article) => article.id === editingId) : undefined;
  const severityCounts = seoCheck?.checklist.reduce((counts, item) => {
    if (item.passed) counts.passed++;
    else if (item.severity === 'blocking') counts.blocking++;
    else if (item.severity === 'warning') counts.warning++;
    else counts.info++;
    return counts;
  }, { passed: 0, blocking: 0, warning: 0, info: 0 }) ?? null;
  const focusField = (id: string) => document.getElementById(id)?.focus();

  const startEdit = (art: Article) => {
    setEditingId(art.id);
    setIsCreating(true);
    setSportSlug(art.sportSlug);
    setIsAboutEvent(!!art.eventSlug);
    setEventSlug(art.eventSlug || '');
    setEditionYear(art.editionYear);
    setArticleType(art.articleType);
    setTitle(art.title);
    setSubtitle(art.subtitle || '');
    setSlug(art.slug);
    setExcerpt(art.excerpt);
    setBodyDoc(art.body ?? legacyToDoc(art.content));
    setEditorKey((k) => k + 1);
    setFeaturedImage(art.featuredImage);
    setFeaturedMediaId(art.featuredMediaId ?? null);
    setAuthorId(art.authorId);
    setMetaTitle(art.seo.metaTitle || '');
    setMetaDescription(art.seo.metaDescription || '');
    const { metaTitle: _mt, metaDescription: _md, ogTitle: savedOgTitle, ogDescription: savedOgDescription, ogImage: savedOgImage, ...rest } = art.seo;
    setOgTitle(savedOgTitle || '');
    setOgDescription(savedOgDescription || '');
    setOgImage(savedOgImage || '');
    setOtherSeo(rest);
    setStatus(art.status);
  };

  return (
    <div className="cms-articles-screen space-y-6">
      {!isCreating && (
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Article Editorial Management
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Publish guides, schedules, records, and tournament analysis.
          </p>
        </div>
        <Button type="button" onClick={startCreate} size="sm" data-testid="create-article-button">
          + Create New Article
        </Button>
      </div>
      )}

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {/* ARTICLE WORKFLOW FORM */}
      {isCreating && (
        <form onSubmit={handleSave} className="cms-article-form rounded-xl border border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/60">
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800 sm:px-5">
            <h3 className="min-w-0 truncate font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              {editingId ? 'Edit Article Dossier' : 'New Article Guided Workflow'}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-stone-800 dark:hover:text-stone-200 dark:text-stone-400"
            >
              &larr; Back to articles
            </button>
          </div>

          <div className="cms-article-grid grid min-w-0 grid-cols-1 gap-5 p-3 sm:p-4">
          <div className="cms-editor-column min-w-0 space-y-5">
          <section className="cms-title-hierarchy space-y-2 rounded-xl border border-amber-300 bg-white px-4 py-3 shadow-sm dark:border-amber-800 dark:bg-stone-950" aria-labelledby="title-hierarchy-heading">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="title-hierarchy-heading" className="text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-400">Title &amp; hierarchy</h4>
              <code className="max-w-full truncate rounded bg-stone-100 px-2 py-0.5 text-[10px] text-stone-600 dark:bg-stone-900 dark:text-stone-300" title="Public URL">/{sportSlug}/{eventSlug ? `${eventSlug}/${editionYear || 'edition'}/` : ''}{slug || 'article-slug'}/</code>
            </div>
            <div>
              <label className="sr-only" htmlFor="article-title">Article Title (H1) *</label>
              <input type="text" required value={title} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Article title (H1) — e.g. 2027 French Open Schedule & Daily Order of Play" id="article-title" className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 font-serif text-lg font-semibold dark:border-stone-700 dark:bg-stone-950" />
            </div>
          </section>
          <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950" aria-labelledby="article-setup-heading">
            <div><h4 id="article-setup-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-stone-700 dark:text-stone-200">Article setup</h4><p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Required publishing context and byline.</p></div>

          {/* WORKFLOW STEP 1: SPORT */}
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                1. Select Sport Discipline *
              </label>
              <select
                value={sportSlug}
                onChange={(e) => {
                  setSportSlug(e.target.value);
                  setEventSlug('');
                  setEditionYear(undefined);
                }}
                className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              >
                {sports.map((s) => (
                  <option key={s.id} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* WORKFLOW STEP 2: IS IT ABOUT AN EVENT? */}
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                2. Association Scope *
              </label>
              <div className="flex items-center gap-4 text-xs mt-2">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="isEvent"
                    checked={isAboutEvent}
                    onChange={() => setIsAboutEvent(true)}
                  />
                  <span>Specific Championship / Event</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="isEvent"
                    checked={!isAboutEvent}
                    onChange={() => {
                      setIsAboutEvent(false);
                      setEventSlug('');
                      setEditionYear(undefined);
                    }}
                  />
                  <span>General Sport Guide (e.g. Rules/Scoring)</span>
                </label>
              </div>
            </div>
          </div>

          {/* WORKFLOW STEP 3 & 4: EVENT & EDITION (IF APPLICABLE) */}
          {isAboutEvent && (
            <div className="grid min-w-0 grid-cols-1 gap-4 rounded-lg border border-stone-200 bg-stone-100/70 p-4 dark:border-stone-800 dark:bg-stone-950/60 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                  3. Select Permanent Event
                </label>
                <select
                  value={eventSlug}
                  onChange={(e) => {
                    setEventSlug(e.target.value);
                    setEditionYear(undefined);
                  }}
                  className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                >
                  <option value="">-- Choose Event --</option>
                  {availableEvents.map((e) => (
                    <option key={e.id} value={e.slug}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                  4. Select Staging Year / Edition (Optional)
                </label>
                <select
                  value={editionYear || ''}
                  onChange={(e) => setEditionYear(e.target.value ? Number(e.target.value) : undefined)}
                  className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                >
                  <option value="">-- All Editions / Permanent Event Level --</option>
                  {availableEditions.map((ed) => (
                    <option key={ed.id} value={ed.year}>
                      {ed.year} Edition ({ed.title})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* WORKFLOW STEP 5: ARTICLE TYPE */}
          <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                5. Select Article Type *
              </label>
              <select
                value={articleType}
                onChange={(e) => setArticleType(e.target.value as ArticleType)}
                className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-medium"
              >
                {ARTICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Byline Author *
              </label>
              <select
                value={authorId}
                onChange={(e) => setAuthorId(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              >
                {authors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.roleTitle})
                  </option>
                ))}
              </select>
            </div>
          </div>
          </section>

          {/* WORKFLOW STEP 6: WRITE */}
          <section className="space-y-4 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950" aria-labelledby="article-basics-heading">
            <div><h4 id="article-basics-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-stone-700 dark:text-stone-200">Article basics & content</h4><p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400"><span className="text-rose-600">*</span> Required fields. Write the visible article before running the full SEO check.</p></div>
            <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                  Subtitle / Deck
                </label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Secondary editorial deck for headline context..."
                  className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                  URL Slug * (Short, lowercase, hyphenated)
                </label>
                <div className="flex items-center gap-1 text-xs text-stone-500 font-mono dark:text-stone-400">
                  <span>/</span>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="schedule"
                    id="article-slug" className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Editorial Excerpt / Summary (Used in cards & meta description) *
              </label>
              <textarea
                rows={2}
                required
                value={excerpt}
                onChange={(e) => setExcerpt(e.target.value)}
                placeholder="1–2 sentence summary of this dossier or guide..."
                id="article-excerpt" className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">Article body *</span>
              <p className="mb-2 text-[11px] text-stone-500 dark:text-stone-400">Select text, then choose Text size or Text color in the toolbar. First-letter and featured-image controls are below.</p>
              <RichTextEditor key={editorKey} initialDoc={bodyDoc} onChange={doc => setBodyDoc(previous => ({ ...doc, ...(previous.attrs ? { attrs: previous.attrs } : {}) }))} />
            </div>

            <div>
              <span className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">Featured image</span>
              <div id="featured-image" tabIndex={-1} className="flex flex-wrap items-center gap-3 p-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900">
                {featuredMedia ? (
                  <>
                    <img src={thumbnailUrl(featuredMedia)} alt={featuredMedia.altText} className="w-28 aspect-video object-cover rounded" />
                    <div className="min-w-0 text-xs space-y-1">
                      <div className="font-semibold">{featuredMedia.title}</div>
                      <div className="truncate text-stone-500 dark:text-stone-400">Alt: {featuredMedia.altText || 'Missing'}</div>
                      <div className="truncate text-stone-500 dark:text-stone-400">{featuredMedia.filename || featuredMedia.url}</div>
                      <ReviewBadge state={featuredMedia.copyrightReview} />
                    </div>
                  </>
                ) : (
                  <div className="flex min-h-20 flex-1 items-center justify-center rounded-md border border-dashed border-stone-300 text-xs text-stone-500 dark:border-stone-700 dark:text-stone-400">{featuredImage ? `Legacy image: ${featuredImage}` : 'Choose an approved image from the Media Library.'}</div>
                )}
                <div className="ml-auto flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => setPickingFeatured(true)}>{featuredMedia ? 'Change' : 'Choose from library'}</Button>
                  {featuredMedia && <Button type="button" size="sm" variant="ghost" onClick={() => setFeaturedMediaId(null)}>Remove</Button>}
                </div>
              </div>
              {pickingFeatured && (
                <MediaPicker
                  onSelect={(item) => { setFeaturedMediaId(item.id); setFeaturedImage(item.url); setPickingFeatured(false); }}
                  onClose={() => setPickingFeatured(false)}
                />
              )}
            </div>
            <ArticleAppearanceEditor value={bodyDoc.attrs || {}} caption={featuredMedia?.caption} credit={featuredMedia?.credit} onChange={attrs => setBodyDoc(previous => ({ ...previous, attrs }))}/>
          </section>
          </div>

          <aside className="cms-seo-sidebar min-w-0 space-y-4 break-words" aria-label="Publishing and SEO sidebar">

          {/* WORKFLOW STEP 7: SEO CHECK */}
          <section className="space-y-4 rounded-xl border border-amber-300 bg-white p-4 shadow-sm dark:border-amber-800 dark:bg-stone-950" aria-labelledby="seo-intelligence-heading">
            <div>
              <h4 id="seo-intelligence-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-400">SEO intelligence</h4>
              <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Requirements and recommendations for this unsaved {articleType} draft.</p>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
              <div className="rounded-md bg-emerald-50 p-2 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"><strong className="block text-base">{severityCounts?.passed ?? '—'}</strong>Passed</div>
              <div className="rounded-md bg-rose-50 p-2 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300"><strong className="block text-base">{severityCounts?.blocking ?? '—'}</strong>Blocking</div>
              <div className="rounded-md bg-amber-50 p-2 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"><strong className="block text-base">{severityCounts?.warning ?? '—'}</strong>Warnings</div>
              <div className="rounded-md bg-sky-50 p-2 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300"><strong className="block text-base">{severityCounts?.info ?? '—'}</strong>Info</div>
            </div>
            <details open className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
              <summary className="cursor-pointer text-xs font-bold text-stone-800 dark:text-stone-200">SEO metadata</summary>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-1 flex justify-between gap-2"><label htmlFor="seo-title" className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">SEO title</label><span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{(metaTitle || title).length} characters</span></div>
                <input
                  id="seo-title"
                  type="text"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder={title || 'Page Title'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div>
                <div className="mb-1 flex justify-between gap-2"><label htmlFor="seo-description" className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">Meta description</label><span className="text-[10px] tabular-nums text-stone-500 dark:text-stone-400">{(metaDescription || excerpt).length} characters</span></div>
                <textarea
                  id="seo-description"
                  rows={3}
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder={excerpt || 'Meta Description'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div><div className="mb-1 flex justify-between gap-2"><label className="text-[11px] font-semibold text-stone-600 dark:text-stone-300">URL slug</label><span className="text-[10px] text-stone-500 dark:text-stone-400">Edit under Article basics</span></div><code className="block truncate rounded bg-stone-100 p-2 text-[10px] dark:bg-stone-900">/{sportSlug}/{eventSlug ? `${eventSlug}/${editionYear || 'edition'}/` : ''}{slug || 'article-slug'}/</code></div>
              <p className="text-[10px] text-stone-500 dark:text-stone-400">Length guidance comes from the active SEO rules when you run a check; counts are informational.</p>
            </div>
            </details>
            <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800" aria-label="Search preview">
              <h5 className="text-[11px] font-bold uppercase tracking-wider text-stone-500 dark:text-stone-400">Search preview</h5>
              <p className="mt-2 text-xs text-stone-600 dark:text-stone-300">SportingSpy</p>
              <p className="break-all text-[11px] leading-relaxed text-emerald-700">sportingspy.com › {sportSlug} › {slug || 'article'}</p>
              <p className="mt-1 break-words text-base leading-snug text-blue-700 dark:text-blue-400">{metaTitle || title || 'Article title preview'}</p>
              <p className="mt-1 line-clamp-2 text-xs text-stone-600 dark:text-stone-400">{metaDescription || excerpt || 'Add a concise description to preview how this page may appear in search.'}</p>
              <p className="mt-1 text-[10px] text-stone-500 dark:text-stone-400">Preview only — search engines may render the result differently.</p>
            </div>
            <div className="space-y-2 pt-1">
              <Button type="button" size="sm" className="w-full" onClick={runSeoCheck} isLoading={checkingSeo}>Check SEO</Button>
              <p className="text-[11px] text-stone-500 dark:text-stone-400">Checks this unsaved article draft. It does not save or publish changes.</p>
            </div>
            {seoCheck && (
              <div className="space-y-3 border-t border-stone-200 dark:border-stone-800 pt-3" aria-label="Article SEO diagnostics">
                <p className="text-xs font-semibold">
                  {seoCheck.checklist.filter((item) => item.passed).length} checks passed · {seoCheck.checklist.filter((item) => !item.passed).length} need attention
                </p>
                <ul className="space-y-2">
                  {seoCheck.checklist.map((item) => (
                    <li key={item.ruleKey} className="rounded border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-900 p-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><p className="font-semibold">{item.name}</p><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${item.passed ? 'bg-emerald-100 text-emerald-800' : item.severity === 'blocking' ? 'bg-rose-100 text-rose-800' : item.severity === 'warning' ? 'bg-amber-100 text-amber-800' : 'bg-sky-100 text-sky-800'}`}>{item.passed ? 'Passed' : item.severity}</span></div>
                      {!item.passed && <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400"><strong>Why:</strong> {item.why}</p>}
                      {!item.passed && item.issues.map((issue, i) => <div key={i} className="mt-1 text-stone-600 dark:text-stone-400"><p><strong>What:</strong> {issue.message}</p><p><strong>Action:</strong> {issue.fix}</p></div>)}
                      {!item.passed && ['meta-description', 'title-length'].includes(item.ruleKey) && <button type="button" className="mt-2 text-amber-700 font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-amber-500" onClick={() => focusField(item.ruleKey === 'meta-description' ? 'seo-description' : 'seo-title')}>{item.ruleKey === 'meta-description' ? 'Add meta description' : 'Edit SEO title'}</button>}
                      {!item.passed && item.ruleKey === 'featured-image' && <button type="button" className="mt-2 text-amber-700 font-semibold hover:underline dark:text-amber-500" onClick={() => setPickingFeatured(true)}>Choose image</button>}
                    </li>
                  ))}
                </ul>
                <div className="grid grid-cols-1 gap-3 text-xs">
                  <section className="rounded border border-stone-200 p-2 dark:border-stone-800"><h5 className="font-semibold">Internal link opportunities</h5>{seoCheck.suggestions.internalLinks.length ? <ul className="mt-2 space-y-2">{seoCheck.suggestions.internalLinks.map((x) => <li key={x.url} className="border-t border-stone-100 pt-2 first:border-0 first:pt-0 dark:border-stone-800"><a href={x.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-700 underline dark:text-amber-500">{x.title}</a><p className="text-[11px] text-stone-500 dark:text-stone-400">{x.reason}</p><button type="button" className="mt-1 font-semibold text-stone-700 underline dark:text-stone-300" onClick={() => focusField('article-body')}>Select text, then use Insert Link</button></li>)}</ul> : <p className="mt-1 text-stone-500 dark:text-stone-400">No relevant published articles found.</p>}</section>
                  <section className="rounded border border-stone-200 p-2 dark:border-stone-800"><h5 className="font-semibold">Official source</h5>{seoCheck.suggestions.externalSources.length ? <ul className="mt-2 space-y-2">{seoCheck.suggestions.externalSources.map((x) => <li key={x.url}><span className="mr-1 text-amber-700 dark:text-amber-500">△ Recommended</span><a href={x.url} target="_blank" rel="noopener noreferrer" className="block font-semibold text-amber-700 underline dark:text-amber-500">Open {x.label}</a><p className="text-[11px] text-stone-500 dark:text-stone-400">Use the verified Event/Edition source; the editor decides where to cite it.</p></li>)}</ul> : <p className="mt-1 text-stone-500 dark:text-stone-400">No official-source opportunity is available for this context.</p>}</section>
                  <section className="rounded border border-stone-200 p-2 dark:border-stone-800"><h5 className="font-semibold">Event coverage</h5>{seoCheck.suggestions.coverage.length ? <ul className="mt-2 space-y-1">{seoCheck.suggestions.coverage.map((x) => <li key={`${x.edition}-${x.type}`}><span className="text-amber-700 dark:text-amber-500">△</span> {x.type} <span className="text-stone-500 dark:text-stone-400">— missing for {x.edition}</span></li>)}</ul> : <p className="mt-1 text-stone-500 dark:text-stone-400">No coverage gaps found for this edition.</p>}<p className="mt-2 text-[10px] text-stone-500 dark:text-stone-400">Suggestions only — the editor decides what to create.</p></section>
                </div>
                <div className="rounded border border-stone-200 dark:border-stone-800 p-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2"><strong>AI content assistant</strong><Button type="button" size="sm" variant="outline" onClick={runAssistant} isLoading={runningAssistant} disabled={!seoCheck.assistant.configured}>Get suggestions</Button></div>
                  {!seoCheck.assistant.configured && <p className="text-stone-500 dark:text-stone-400">Not configured. {seoCheck.assistant.reason}</p>}
                  {assistantResult && <div className="grid grid-cols-1 sm:grid-cols-2 gap-2"><SuggestionList title="Missing topics" empty="None suggested." items={assistantResult.missingTopics.map((x) => <span>{x}</span>)} /><SuggestionList title="Missing entities" empty="None suggested." items={assistantResult.missingEntities.map((x) => <span>{x}</span>)} /><SuggestionList title="Facts to verify" empty="None suggested." items={assistantResult.factsToVerify.map((x) => <span>{x}</span>)} /><SuggestionList title="Section ideas" empty="None suggested." items={assistantResult.sectionIdeas.map((x) => <span>{x}</span>)} /></div>}
                  <p className="text-[11px] text-stone-500 dark:text-stone-400">Suggestions only. Nothing is inserted, saved or published automatically.</p>
                </div>
              </div>
            )}
          </section>

          {/* SOCIAL METADATA (Open Graph / Twitter-X share previews) */}
          <details className="rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950">
              <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.16em] text-stone-700 dark:text-stone-200">
                Social Metadata
              </summary>
              <p className="text-[11px] text-stone-500 mt-1 dark:text-stone-400">
                Used when the article is shared on social platforms. Leave empty to reuse the SEO title, meta description and featured image.
              </p>
            <div className="mt-3 grid grid-cols-1 gap-4">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1 dark:text-stone-400">Social Title</label>
                <input
                  type="text"
                  value={ogTitle}
                  maxLength={200}
                  onChange={(e) => setOgTitle(e.target.value)}
                  placeholder={metaTitle || title || 'Defaults to SEO title'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1 dark:text-stone-400">Social Image URL</label>
                <input
                  type="text"
                  value={ogImage}
                  onChange={(e) => setOgImage(e.target.value)}
                  placeholder={featuredImage || 'Defaults to featured image'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1 dark:text-stone-400">Social Description</label>
                <input
                  type="text"
                  value={ogDescription}
                  maxLength={500}
                  onChange={(e) => setOgDescription(e.target.value)}
                  placeholder={metaDescription || excerpt || 'Defaults to meta description'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
            </div>
          </details>

          <section className="rounded-xl border border-stone-200 bg-white p-4 text-xs dark:border-stone-800 dark:bg-stone-950" aria-labelledby="freshness-heading">
            <h4 id="freshness-heading" className="font-bold uppercase tracking-[0.16em] text-stone-700 dark:text-stone-200">Freshness</h4>
            <p className={`mt-2 font-semibold ${editingArticle?.reviewedAt ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>{editingArticle?.reviewedAt ? `Recently reviewed ${new Date(editingArticle.reviewedAt).toLocaleDateString()}` : 'Review recommended'}</p>
            <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Confirming review records editorial verification without changing the content update timestamp.</p>
            {editingArticle && <Button type="button" size="sm" variant="outline" className="mt-3 w-full" onClick={() => confirmFreshness(editingArticle)}>Mark as reviewed</Button>}
          </section>

          {/* WORKFLOW STEP 8: PUBLISH STATUS & ACTION */}
          <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 dark:border-stone-800 dark:bg-stone-950" aria-labelledby="publish-readiness-heading">
            <h4 id="publish-readiness-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-stone-700 dark:text-stone-200">Publish readiness</h4>
            <ul className="space-y-1 text-[11px]">
              <li className={title && slug && excerpt && authorId ? 'text-emerald-700' : 'text-rose-700'}>{title && slug && excerpt && authorId ? '✓' : '×'} Required editorial fields</li>
              <li className={featuredMediaId || featuredImage ? 'text-emerald-700' : 'text-amber-700 dark:text-amber-500'}>{featuredMediaId || featuredImage ? '✓' : '△'} Featured image</li>
              <li className={metaTitle || title ? 'text-emerald-700' : 'text-amber-700 dark:text-amber-500'}>{metaTitle || title ? '✓' : '△'} SEO title</li>
              <li className={metaDescription || excerpt ? 'text-emerald-700' : 'text-amber-700 dark:text-amber-500'}>{metaDescription || excerpt ? '✓' : '△'} Meta description</li>
              <li className={severityCounts?.blocking ? 'text-rose-700' : seoCheck ? 'text-emerald-700' : 'text-stone-500 dark:text-stone-400'}>{seoCheck ? (severityCounts?.blocking ? `× ${severityCounts.blocking} blocking SEO issue(s)` : '✓ No blocking SEO issue') : '○ Run SEO check for rule-based readiness'}</li>
              {!!severityCounts?.warning && <li className="text-amber-700 dark:text-amber-500">△ {severityCounts.warning} SEO warning(s); warnings do not prevent publishing</li>}
            </ul>
            <label className="block text-[11px] font-semibold text-stone-600 dark:text-stone-300">Publishing state
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="mt-1 w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 font-semibold"
              >
                <option value="published">Published (Live)</option>
                <option value="draft">Draft (Private)</option>
                <option value="preview">Preview Only</option>
                <option value="scheduled">Scheduled</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                Discard
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={handlePreview} disabled={saving || (willBeLive && !editingId)} title={willBeLive ? 'Shows the last saved version; does not save or publish.' : 'Saves as ' + status + ' and opens the preview.'}>
                Preview
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => saveAs('draft')} disabled={saving}>
                Save draft
              </Button>
              <Button type="button" size="sm" onClick={() => saveAs('published')} isLoading={saving}>
                Publish
              </Button>
            </div>
            <button type="submit" className="w-full text-center text-[11px] font-semibold text-stone-500 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-stone-400">Save using selected state ({status})</button>
          </section>
          </aside>
          </div>
        </form>
      )}

      {/* ARTICLES REPOSITORY: searched, filtered and paged on the server (PHASE E). */}
      {!isCreating && (
        <ArticleRepository
          reloadKey={articles}
          sports={sports}
          authors={authors}
          onView={(url) => navigate(url)}
          onEdit={(id) => { const art = articles.find((a) => a.id === id); if (art) startEdit(art); else setFeedback('This article is still loading. Please try again in a moment.'); }}
          onReview={(id) => { const art = articles.find((a) => a.id === id); if (art) confirmFreshness(art); }}
          onDelete={(id, title) => { if (confirm(`Delete "${title}"?`)) deleteArticle(id); }}
        />
      )}
    </div>
  );
};

const STATUS_BADGE: Record<string, string> = {
  published: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300',
  draft: 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300',
  preview: 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300',
  scheduled: 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300',
  archived: 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300',
};
const filterClass = 'rounded-lg border border-stone-300 bg-white p-2 text-xs dark:border-stone-700 dark:bg-stone-950';

/** Article list with keyword search (title/body/id/slug) and filters, one server page at a time. */
function ArticleRepository({ reloadKey, sports, authors, onView, onEdit, onReview, onDelete }: {
  reloadKey: unknown;
  sports: { id: string; slug: string; name: string }[];
  authors: { id: string; slug: string; name: string }[];
  onView: (url: string) => void;
  onEdit: (id: string) => void;
  onReview: (id: string) => void;
  onDelete: (id: string, title: string) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sport, setSport] = useState('');
  const [type, setType] = useState('');
  const [author, setAuthor] = useState('');
  const [date, setDate] = useState('');
  const [sort, setSort] = useState('relevance');
  const [page, setPage] = useState(1);
  const { data, loading, error } = useArticleSearch({ q, status, sport, type, author, date, sort, page, limit: 25 }, { reloadKey });
  const set = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setter(e.target.value); setPage(1); };
  const filtered = !!(q || status || sport || type || author || date);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2" role="search" aria-label="Search articles">
        <label className="min-w-[14rem] flex-1 text-[11px] font-semibold text-stone-500 dark:text-stone-400">Search
          <input type="search" value={q} onChange={set(setQ)} placeholder="Title, text, slug or article ID…" className={`mt-1 block w-full ${filterClass}`} />
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Status
          <select value={status} onChange={set(setStatus)} className={`mt-1 block ${filterClass}`}>
            <option value="">All statuses</option>
            {['draft', 'preview', 'scheduled', 'published', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Sport
          <select value={sport} onChange={set(setSport)} className={`mt-1 block ${filterClass}`}>
            <option value="">All sports</option>
            {sports.map((s) => <option key={s.id} value={s.slug}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Type
          <select value={type} onChange={set(setType)} className={`mt-1 block ${filterClass}`}>
            <option value="">All types</option>
            {ARTICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Author
          <select value={author} onChange={set(setAuthor)} className={`mt-1 block ${filterClass}`}>
            <option value="">All authors</option>
            {authors.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Date
          <select value={date} onChange={set(setDate)} className={`mt-1 block ${filterClass}`}>
            <option value="">Any time</option><option value="today">Today</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="year">This year</option>
          </select>
        </label>
        <label className="text-[11px] font-semibold text-stone-500 dark:text-stone-400">Sort
          <select value={sort} onChange={set(setSort)} className={`mt-1 block ${filterClass}`}>
            <option value="relevance">{q ? 'Relevance' : 'Newest'}</option>
            {q && <option value="newest">Newest</option>}
            <option value="oldest">Oldest</option>
          </select>
        </label>
        {filtered && <button type="button" onClick={() => { setQ(''); setStatus(''); setSport(''); setType(''); setAuthor(''); setDate(''); setSort('relevance'); setPage(1); }} className="pb-2 text-xs font-semibold text-amber-700 hover:underline dark:text-amber-500">Clear</button>}
      </div>

      <p className="text-[11px] text-stone-500 dark:text-stone-400" aria-live="polite">
        {error ? <span className="text-rose-600">{error}</span> : data ? `${data.total} article${data.total === 1 ? '' : 's'}${data.mode === 'fuzzy' ? ' (close matches)' : ''}` : 'Loading…'}
        {loading && data ? ' · updating…' : ''}
      </p>

      <div className={`overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800 ${loading && data ? 'opacity-60' : ''}`}>
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase tracking-wider text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Title & Hierarchy</th>
              <th className="p-3">Discipline</th>
              <th className="p-3">Format</th>
              <th className="p-3">Status</th>
              <th className="p-3">Date</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800/80">
            {data && data.items.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-stone-500 dark:text-stone-400">{filtered ? 'No articles match this search.' : 'No articles yet.'}</td></tr>
            )}
            {data?.items.map((art) => (
              <tr key={art.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                <td className="p-3 max-w-xs">
                  <p className="font-semibold text-stone-900 dark:text-stone-100 truncate">{art.title}</p>
                  <p className="text-[11px] text-stone-500 truncate font-mono dark:text-stone-400">
                    {art.eventSlug ? `${art.eventSlug}${art.editionYear ? ` (${art.editionYear})` : ''} / ` : ''}{art.slug}
                  </p>
                </td>
                <td className="p-3 font-medium text-stone-800 dark:text-stone-200">{art.sportName}</td>
                <td className="p-3 text-stone-500 dark:text-stone-400">{art.articleType}</td>
                <td className="p-3"><span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${STATUS_BADGE[art.status]}`}>{art.status}</span></td>
                <td className="p-3 text-stone-500 tabular-nums dark:text-stone-400">
                  <span className="block">Published {new Date(art.publishedAt).toLocaleDateString()}</span>
                  <span className="block text-[10px]">Reviewed {art.reviewedAt ? new Date(art.reviewedAt).toLocaleDateString() : 'never'}</span>
                </td>
                <td className="p-3 text-right space-x-2 whitespace-nowrap">
                  <button onClick={() => onView(art.url)} className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold">View</button>
                  <button onClick={() => onEdit(art.id)} className="text-amber-700 dark:text-amber-400 font-semibold hover:underline">Edit</button>
                  <button type="button" onClick={() => onReview(art.id)} className="text-sky-700 dark:text-sky-400 font-semibold hover:underline" title="Confirm that time-sensitive facts were checked; does not change updatedAt">Mark reviewed</button>
                  <button onClick={() => onDelete(art.id, art.title)} className="text-rose-600 dark:text-rose-400 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <nav aria-label="Article pages" className="flex items-center justify-between text-xs">
          <Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</Button>
          <span className="text-stone-500 dark:text-stone-400">Page {data.page} of {data.totalPages}</span>
          <Button type="button" size="sm" variant="outline" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
        </nav>
      )}
    </div>
  );
}
