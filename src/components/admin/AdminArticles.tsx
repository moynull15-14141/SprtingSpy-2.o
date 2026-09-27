/**
 * SportingSpy Editorial Article Workflow Component
 * Implements the required 10-step editorial progression:
 * New Article -> Select Sport -> Is Event? -> Select Event -> Select Edition? ->
 * Select Article Type -> Write -> Featured Image -> SEO Check -> Publish Status.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Article, ArticleType } from '../../types';
import { Button } from '../ui/Button';

export const AdminArticles: React.FC = () => {
  const { articles, sports, events, editions, authors, addArticle, updateArticle, deleteArticle, navigate } =
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
  const [content, setContent] = useState('');
  const [featuredImage, setFeaturedImage] = useState('');
  const [authorId, setAuthorId] = useState<string>(authors[0]?.id || '');
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'preview' | 'scheduled' | 'published' | 'archived'>('published');
  const [feedback, setFeedback] = useState<string | null>(null);

  const ARTICLE_TYPES: ArticleType[] = [
    'Event Guide',
    'Schedule',
    'Results',
    'Sports Viewing Guide',
    'Preview',
    'Update',
    'News',
    'Past Winners',
    'Records',
    'Prize Money',
    'Players',
    'Teams',
    'Venue',
    'Qualification',
    'Rules & Format',
    'History',
    'Analysis',
    'General Information',
    'Other',
  ];

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
    setContent('');
    setFeaturedImage('');
    setMetaTitle('');
    setMetaDescription('');
    setStatus('published');
    setIsCreating(false);
    setEditingId(null);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return;

    const articlePayload = {
      title,
      subtitle: subtitle.trim() || undefined,
      slug,
      sportSlug,
      eventSlug: isAboutEvent && eventSlug ? eventSlug : undefined,
      editionYear: isAboutEvent && eventSlug && editionYear ? editionYear : undefined,
      articleType,
      excerpt,
      content,
      featuredImage: featuredImage || 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?auto=format&fit=crop&w=1200&q=80',
      authorId,
      status,
      readingTimeMinutes: Math.max(1, Math.ceil(content.split(/\s+/).length / 200)),
      seo: {
        metaTitle: metaTitle || title,
        metaDescription: metaDescription || excerpt,
      },
    };

    if (editingId) {
      updateArticle(editingId, articlePayload);
      setFeedback(`Article "${title}" updated successfully.`);
    } else {
      addArticle(articlePayload);
      setFeedback(`Article "${title}" published to ${sportSlug}.`);
    }

    resetForm();
    setTimeout(() => setFeedback(null), 5000);
  };

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
    setContent(art.content);
    setFeaturedImage(art.featuredImage);
    setAuthorId(art.authorId);
    setMetaTitle(art.seo.metaTitle || '');
    setMetaDescription(art.seo.metaDescription || '');
    setStatus(art.status);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Article Editorial Management
          </h2>
          <p className="text-xs text-stone-500 mt-1">
            Publish guides, schedules, records, and tournament analysis.
          </p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} size="sm">
            + Create New Article
          </Button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {/* ARTICLE WORKFLOW FORM */}
      {isCreating && (
        <form onSubmit={handleSave} className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-6">
          <div className="flex items-center justify-between border-b border-stone-200 dark:border-stone-800 pb-3">
            <h3 className="font-serif text-lg font-bold text-stone-900 dark:text-stone-100">
              {editingId ? 'Edit Article Dossier' : 'New Article Guided Workflow'}
            </h3>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            >
              Cancel
            </button>
          </div>

          {/* WORKFLOW STEP 1: SPORT */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg bg-stone-100/70 dark:bg-stone-950/60 border border-stone-200 dark:border-stone-800">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

          {/* WORKFLOW STEP 6: WRITE */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Article Title (H1) *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder="e.g. 2027 French Open Schedule & Daily Philippe-Chatrier Order of Play"
                className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <div className="flex items-center gap-1 text-xs text-stone-500 font-mono">
                  <span>/</span>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="schedule"
                    className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
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
                className="w-full text-xs p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Editorial Body Content (Supports Markdown headers ###, lists, tables) *
              </label>
              <textarea
                rows={8}
                required
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Compose authoritative analysis or timetable explanation..."
                className="w-full text-sm font-mono p-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 leading-relaxed"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">
                Featured Photography Image URL
              </label>
              <input
                type="text"
                value={featuredImage}
                onChange={(e) => setFeaturedImage(e.target.value)}
                placeholder="/src/assets/images/... or verified asset URL"
                className="w-full text-xs p-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
          </div>

          {/* WORKFLOW STEP 7: SEO CHECK */}
          <div className="p-4 rounded-xl bg-stone-100 dark:bg-stone-950/80 border border-stone-200 dark:border-stone-800 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
              SEO & Social Metadata Check
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">SEO Title Tag</label>
                <input
                  type="text"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  placeholder={title || 'Page Title'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">Meta Description</label>
                <input
                  type="text"
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder={excerpt || 'Meta Description'}
                  className="w-full text-xs p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900"
                />
              </div>
            </div>
          </div>

          {/* WORKFLOW STEP 8: PUBLISH STATUS & ACTION */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-stone-200 dark:border-stone-800">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-stone-600 dark:text-stone-400">Publish State:</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="text-xs p-1.5 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 font-semibold"
              >
                <option value="published">Published (Live)</option>
                <option value="draft">Draft (Private)</option>
                <option value="preview">Preview Only</option>
                <option value="scheduled">Scheduled</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                Discard
              </Button>
              <Button type="submit" size="sm">
                {editingId ? 'Save Updates' : 'Publish Article'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* ARTICLES REPOSITORY TABLE */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase tracking-wider text-stone-500 border-b border-stone-200 dark:border-stone-800">
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
            {articles.map((art) => {
              const artSport = sports.find((s) => s.slug === art.sportSlug);
              const artEvent = events.find((e) => e.slug === art.eventSlug);

              const viewUrl =
                art.eventSlug && art.editionYear
                  ? `/${art.sportSlug}/${art.eventSlug}/${art.editionYear}/${art.slug}`
                  : `/${art.sportSlug}/${art.slug}`;

              return (
                <tr key={art.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                  <td className="p-3 max-w-xs">
                    <p className="font-semibold text-stone-900 dark:text-stone-100 truncate">{art.title}</p>
                    <p className="text-[11px] text-stone-400 truncate font-mono">
                      {artEvent ? `${artEvent.shortName} ${art.editionYear ? `(${art.editionYear})` : ''} / ` : ''}
                      {art.slug}
                    </p>
                  </td>
                  <td className="p-3 font-medium text-stone-800 dark:text-stone-200">{artSport?.name}</td>
                  <td className="p-3 text-stone-500">{art.articleType}</td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        art.status === 'published'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : art.status === 'draft'
                          ? 'bg-stone-200 dark:bg-stone-800 text-stone-700 dark:text-stone-300'
                          : art.status === 'preview'
                          ? 'bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300'
                          : art.status === 'scheduled'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          : 'bg-purple-100 dark:bg-purple-950 text-purple-800 dark:text-purple-300'
                      }`}
                    >
                      {art.status}
                    </span>
                  </td>
                  <td className="p-3 text-stone-500 tabular-nums">
                    {new Date(art.publishedAt).toLocaleDateString()}
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => navigate(viewUrl)}
                      className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold"
                    >
                      View
                    </button>
                    <button
                      onClick={() => startEdit(art)}
                      className="text-amber-600 dark:text-amber-400 font-semibold hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete "${art.title}"?`)) {
                          deleteArticle(art.id);
                        }
                      }}
                      className="text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
