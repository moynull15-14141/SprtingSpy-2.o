/**
 * SportingSpy Authors & Editorial Staff Management
 * Manages byline correspondents, beats, bios, and credentials.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Author } from '../../types';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

export const AdminAuthors: React.FC = () => {
  const { authors, articles, addAuthor, updateAuthor, navigate } = useApp();
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [roleTitle, setRoleTitle] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [twitter, setTwitter] = useState('');
  const [email, setEmail] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setSlug('');
    setRoleTitle('');
    setBio('');
    setAvatar('');
    setTwitter('');
    setEmail('');
    setIsCreating(false);
    setEditingId(null);
  };

  const startEdit = (author: Author) => {
    setEditingId(author.id);
    setIsCreating(true);
    setName(author.name);
    setSlug(author.slug);
    setRoleTitle(author.roleTitle);
    setBio(author.bio);
    setAvatar(author.avatar);
    setTwitter(author.twitter || '');
    setEmail(author.email || '');
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;

    if (editingId) {
      updateAuthor(editingId, {
        name,
        slug,
        roleTitle,
        bio,
        avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
        twitter: twitter.trim() || undefined,
        email: email.trim() || undefined,
      });
      setFeedback(`Author profile "${name}" updated.`);
    } else {
      addAuthor({
        name,
        slug,
        roleTitle,
        bio,
        avatar: avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&h=200&q=80',
        twitter: twitter.trim() || undefined,
        email: email.trim() || undefined,
      });
      setFeedback(`New correspondent "${name}" registered.`);
    }

    resetForm();
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Editorial Staff & Byline Correspondents ({authors.length})
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Section 17: Maintain individual author profiles, beats, and bio credentials. Avoid universal admin attribution.
          </p>
        </div>
        {!isCreating && (
          <Button onClick={() => setIsCreating(true)} size="sm">
            + Add New Correspondent
          </Button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleSave} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
          <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
            {editingId ? 'Edit Author Profile' : 'Register Editorial Correspondent'}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Author Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editingId && !slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                }}
                placeholder="e.g. Alistair Vance"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">URL Slug *</label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="alistair-vance"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Beat / Role Title *</label>
              <input
                type="text"
                required
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                placeholder="e.g. Chief Tennis Correspondent"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Avatar Image URL</label>
              <input
                type="text"
                value={avatar}
                onChange={(e) => setAvatar(e.target.value)}
                placeholder="https://"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Twitter / X Handle</label>
              <input
                type="text"
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="@AlistairVanceTennis"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Contact Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="a.vance@sportingspy.com"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
          </div>

          <div className="text-xs">
            <label className="block font-semibold mb-1">Journalist Bio & Credentials *</label>
            <textarea
              rows={3}
              required
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Background, tournament beats covered, sports credentials..."
              className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {editingId ? 'Save Updates' : 'Register Author'}
            </Button>
          </div>
        </form>
      )}

      {/* AUTHORS LIST */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">Author</th>
              <th className="p-3">Beat Coverage</th>
              <th className="p-3">Contact</th>
              <th className="p-3">Articles</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {authors.map((author) => {
              const count = articles.filter((a) => a.authorId === author.id).length;
              return (
                <tr key={author.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                  <td className="p-3">
                    <div className="flex items-center gap-3">
                      <Avatar src={author.avatar} name={author.name} className="w-8 h-8 rounded-full object-cover shrink-0" />
                      <div>
                        <span className="font-semibold text-stone-900 dark:text-stone-100 block">
                          {author.name}
                        </span>
                        <span className="font-mono text-stone-500 text-[10px] dark:text-stone-400">
                          /author/{author.slug}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="p-3 font-medium text-stone-700 dark:text-stone-300">
                    {author.roleTitle}
                  </td>
                  <td className="p-3 text-stone-500 dark:text-stone-400">
                    {author.twitter || author.email || '—'}
                  </td>
                  <td className="p-3 font-mono tabular-nums">
                    {count} published
                  </td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => navigate(`/author/${author.slug}`)}
                      className="text-stone-600 hover:text-amber-600 dark:text-stone-400 font-semibold cursor-pointer"
                    >
                      Dossier
                    </button>
                    <button
                      onClick={() => startEdit(author)}
                      className="text-amber-700 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
                    >
                      Edit
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
