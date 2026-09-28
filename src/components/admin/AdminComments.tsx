/**
 * SportingSpy Admin Comment Moderation Console
 * Allows editorial staff to approve, reject, or remove reader discussion posts.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';

export const AdminComments: React.FC = () => {
  const { comments, articles, moderateComment, deleteComment } = useApp();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Reader Discussion Moderation
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Review community submissions to maintain verified, civil sports discourse.
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Author</th>
              <th className="p-3">Comment Text</th>
              <th className="p-3">Target Article</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Moderation Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {comments.map((comment) => {
              const article = articles.find((a) => a.id === comment.articleId);

              return (
                <tr key={comment.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                  <td className="p-3 font-semibold text-stone-900 dark:text-stone-100 whitespace-nowrap">
                    {comment.userName}
                    <span className="block text-[10px] text-stone-500 font-normal dark:text-stone-400">
                      Role: {comment.userRole || 'Reader'}
                    </span>
                  </td>
                  <td className="p-3 max-w-sm">
                    <p className="text-stone-700 dark:text-stone-300 leading-snug">{comment.content}</p>
                    <span className="text-[10px] text-stone-500 tabular-nums dark:text-stone-400">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </td>
                  <td className="p-3 text-stone-600 dark:text-stone-400 max-w-[160px] truncate">
                    {article?.title || comment.articleId}
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        comment.status === 'approved'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : comment.status === 'pending'
                          ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                          : 'bg-rose-100 dark:bg-rose-950 text-rose-800 dark:text-rose-300'
                      }`}
                    >
                      {comment.status}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-2 whitespace-nowrap">
                    {comment.status !== 'approved' && (
                      <button
                        onClick={() => moderateComment(comment.id, 'approved')}
                        className="text-emerald-600 dark:text-emerald-400 font-semibold hover:underline"
                      >
                        Approve
                      </button>
                    )}
                    {comment.status !== 'rejected' && (
                      <button
                        onClick={() => moderateComment(comment.id, 'rejected')}
                        className="text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 hover:underline dark:text-stone-400"
                      >
                        Reject
                      </button>
                    )}
                    <button
                      onClick={() => deleteComment(comment.id)}
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
