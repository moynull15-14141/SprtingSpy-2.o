/**
 * SportingSpy Article Comments Foundation
 * Supports verified user commenting, role indication, and editorial moderation states.
 */

'use client';

import React, { useState } from 'react';
import { useSite } from '../../context/SiteContext';
import { Button } from '../ui/Button';
import type { Comment } from '../../types';
import { Avatar } from '../ui/Avatar';

interface CommentsSectionProps {
  articleId: string;
  /** Approved comments, loaded on the server (only when comments are enabled). */
  initialComments: Comment[];
}

export const CommentsSection: React.FC<CommentsSectionProps> = ({ articleId, initialComments }) => {
  const { currentUser, isAuthenticated, apiCall, showNotification } = useSite();
  // The visitor's own submissions this visit, shown with their moderation state.
  const [ownComments, setOwnComments] = useState<Comment[]>([]);
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const articleComments = [...ownComments.filter((c) => c.userId === currentUser.id), ...initialComments];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSubmitting(true);
    const res = await apiCall<Comment>('/api/comments', { method: 'POST', body: { articleId, content: content.trim() } });
    setIsSubmitting(false);
    if (!res.data) return;
    setOwnComments((prev) => [res.data!, ...prev]);
    showNotification(res.data.status === 'approved' ? 'Comment published.' : 'Comment submitted for editorial review.', 'success');
    setContent('');

    if (currentUser.role === 'Reader') {
      setFeedback('Your comment has been submitted for editorial moderation.');
    } else {
      setFeedback('Comment published immediately under your staff credentials.');
    }

    setTimeout(() => setFeedback(null), 6000);
  };

  return (
    <section aria-labelledby="comments-heading" className="mt-12 pt-8 border-t border-stone-200 dark:border-stone-800">
      <div className="flex items-center justify-between mb-6">
        <h3 id="comments-heading" className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">
          Editorial Discussion ({articleComments.filter((c) => c.status === 'approved').length})
        </h3>
        <span className="text-xs text-stone-500 dark:text-stone-400">Moderated Sports Discourse</span>
      </div>

      {feedback && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {/* Submission Form — requires a real logged-in session (Phase 1); there
          is no public reader registration yet, so only staff accounts can
          currently comment. See server.ts's /api/comments comment block for
          the STAFF vs PUBLIC USER AUTHENTICATION distinction. */}
      {isAuthenticated ? (
        <form onSubmit={handleSubmit} className="mb-8 p-4 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800">
          <div className="flex items-center gap-3 mb-3">
            <Avatar src={currentUser.avatar} name={currentUser.name} className="w-7 h-7 rounded-full object-cover" />
            <div className="text-xs">
              <span className="font-semibold text-stone-900 dark:text-stone-100">{currentUser.name}</span>
              <span className="ml-2 text-stone-500 text-[11px] dark:text-stone-400">({currentUser.role})</span>
            </div>
          </div>

          <textarea
            rows={3}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Share your tactical observation, historical note, or tournament question..."
            className="w-full text-sm p-3 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500 resize-y"
            required
          />

          <div className="mt-2.5 flex items-center justify-between">
            <p className="text-[11px] text-stone-500 dark:text-stone-400">
              Comments adhere to SportingSpy Editorial Standards. No abusive or commercial content.
            </p>
            <Button type="submit" size="sm" isLoading={isSubmitting} disabled={!content.trim()}>
              Post Comment
            </Button>
          </div>
        </form>
      ) : (
        <div className="mb-8 p-4 rounded-xl bg-stone-50 dark:bg-stone-900/60 border border-stone-200 dark:border-stone-800 text-xs text-stone-600 dark:text-stone-400">
          Log in via the staff account menu in the top bar to join the discussion. Public reader accounts are not
          yet available (see PROJECT_BRAIN.md Phase 1).
        </div>
      )}

      {/* Comments List */}
      <div className="space-y-4">
        {articleComments.length === 0 ? (
          <p className="text-xs text-stone-500 italic py-4 dark:text-stone-400">
            No approved comments yet. Be the first to add your perspective.
          </p>
        ) : (
          articleComments.map((comment) => (
            <div
              key={comment.id}
              className={`p-4 rounded-xl border ${
                comment.status === 'pending'
                  ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/60'
                  : 'bg-white dark:bg-[#121417] border-stone-200 dark:border-stone-800'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {comment.userAvatar && (
                    <img
                      src={comment.userAvatar}
                      alt={comment.userName}
                      className="w-6 h-6 rounded-full object-cover"
                    />
                  )}
                  <span className="text-xs font-semibold text-stone-900 dark:text-stone-100">
                    {comment.userName}
                  </span>
                  {comment.userRole && comment.userRole !== 'Reader' && (
                    <span className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400">
                      [{comment.userRole}]
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {comment.status === 'pending' && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                      (Pending Review)
                    </span>
                  )}
                  <span className="text-[11px] text-stone-500 tabular-nums dark:text-stone-400">
                    {new Date(comment.createdAt).toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </span>
                </div>
              </div>
              <p className="text-xs text-stone-700 dark:text-stone-300 leading-relaxed pl-8">
                {comment.content}
              </p>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
