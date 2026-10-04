/**
 * SportingSpy Staff User & Role-Based Access Control (RBAC) Management
 * Manages Admin, Editor, Author, and Reader staff accounts.
 *
 * PHASE 1 (Authentication & Staff Identity): "Add Staff User" now creates a
 * real, persisted account with a hashed password via POST /api/users — the
 * previous version only ever updated local React state and silently lost
 * everything on refresh. The old "Simulate This Role" button (a client-side
 * role-preview trick, not real access) has been removed; the server enforces
 * every permission against the real logged-in session regardless of what
 * this screen displays.
 */

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Role } from '../../types';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';

export const AdminUsers: React.FC = () => {
  const { users, currentUser, createStaffUser, updateUserRole, updateUserStatus, deleteStaffUser, features, apiCall, showNotification, refreshData } = useApp();
  // PHASE R: a reset link is shown once to the Admin, who delivers it to the person.
  const [resetLink, setResetLink] = useState<{ name: string; url: string } | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('Author');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const resetForm = () => {
    setName('');
    setEmail('');
    setRole('Author');
    setPassword('');
    setFormError(null);
    setIsCreating(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || password.length < 8) {
      setFormError('Name, email, and a password of at least 8 characters are required.');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);
    const success = await createStaffUser({ name: name.trim(), email: email.trim(), role, password });
    setIsSubmitting(false);

    if (success) {
      setFeedback(`Staff account "${name}" registered with ${role} privileges.`);
      resetForm();
      setTimeout(() => setFeedback(null), 4000);
    } else {
      setFormError('Could not create account — the email may already be registered.');
    }
  };

  const handleToggleStatus = (id: string, currentStatus?: string) => {
    updateUserStatus(id, currentStatus === 'inactive' ? 'active' : 'inactive');
  };

  const issueResetLink = async (id: string, name: string) => {
    if (!window.confirm(`Create a password reset link for ${name}? It works once and expires in 24 hours.`)) return;
    const res = await apiCall<{ url: string }>(`/api/auth/admin/users/${id}/reset-link`, { method: 'POST', body: {} });
    if (res.data) setResetLink({ name, url: res.data.url });
  };

  const resetTwoFactor = async (id: string, name: string) => {
    if (!window.confirm(`Remove two-factor authentication for ${name} (lost device)? Their sessions are signed out.`)) return;
    const res = await apiCall(`/api/auth/totp/admin/${id}/reset`, { method: 'POST', body: {} });
    if (res.data) { showNotification(`Two-factor authentication removed for ${name}.`, 'success'); void refreshData(); }
  };

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`Permanently delete the staff account "${name}"? This cannot be undone.`)) {
      deleteStaffUser(id);
    }
  };

  return (
    <div className="space-y-6">
      {resetLink && (
        <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-semibold">Reset link for {resetLink.name} (shown once, valid 24 hours, single use). Send it privately:</p>
          <input readOnly value={resetLink.url} onFocus={(e) => e.currentTarget.select()} className="mt-2 w-full rounded border border-stone-300 bg-white p-2 font-mono text-[11px] dark:border-stone-700 dark:bg-stone-950" />
          <button type="button" onClick={() => setResetLink(null)} className="mt-2 font-semibold underline">Done</button>
        </div>
      )}
      <div className="flex items-center justify-between pb-4 border-b border-stone-200 dark:border-stone-800">
        <div>
          <h2 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">
            Staff Accounts & Roles ({users.length})
          </h2>
          <p className="text-xs text-stone-500 mt-1 dark:text-stone-400">
            Section 20: Role-Based Access Control (Admin, Editor, Author, Reader). Every action here is
            enforced by the server against the real logged-in session — see PROJECT_BRAIN.md Phase 1.
          </p>
        </div>
        {!isCreating && currentUser.role === 'Admin' && (
          <Button onClick={() => setIsCreating(true)} size="sm">
            + Add Staff User
          </Button>
        )}
      </div>

      {feedback && (
        <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
          {feedback}
        </div>
      )}

      {isCreating && (
        <form onSubmit={handleCreate} className="p-5 rounded-xl border border-stone-200 dark:border-stone-800 bg-stone-50 dark:bg-stone-900/60 space-y-4">
          <h3 className="font-serif text-base font-bold text-stone-900 dark:text-stone-100">
            Register Staff Account
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block font-semibold mb-1">Full Name *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. David Campbell"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Email Address *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="d.campbell@sportingspy.com"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950"
              />
            </div>
            <div>
              <label className="block font-semibold mb-1">Role / Privilege *</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-semibold"
              >
                <option value="Admin">Admin (Full Control)</option>
                <option value="Editor">Editor (Publish / Moderate)</option>
                <option value="Author">Author (Create / Edit Own)</option>
                {features.readerAccounts && <option value="Reader">Reader (Discussion Only)</option>}
              </select>
            </div>
            <div>
              <label className="block font-semibold mb-1">Temporary Password * (min. 8 characters)</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Issue a temporary password"
                className="w-full p-2 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-950 font-mono"
              />
            </div>
          </div>

          {formError && <p className="text-xs text-rose-600 dark:text-rose-400">{formError}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Cancel
            </Button>
            <Button type="submit" size="sm" isLoading={isSubmitting}>
              Create User Account
            </Button>
          </div>
        </form>
      )}

      {/* USERS TABLE */}
      <div className="overflow-x-auto rounded-xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-stone-50 dark:bg-stone-900/60 uppercase text-stone-500 border-b border-stone-200 dark:border-stone-800 dark:text-stone-400">
            <tr>
              <th className="p-3">User</th>
              <th className="p-3">Email</th>
              <th className="p-3">Assigned Role</th>
              <th className="p-3">Status</th>
              <th className="p-3">Joined Date</th>
              {currentUser.role === 'Admin' && <th className="p-3 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {users.map((u) => {
              const status = u.status || 'active';
              return (
                <tr key={u.id} className="hover:bg-stone-50 dark:hover:bg-stone-900/40">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar src={u.avatar} name={u.name} className="w-7 h-7 rounded-full object-cover shrink-0" />
                      <span className="font-semibold text-stone-900 dark:text-stone-100">
                        {u.name}
                        {u.id === currentUser.id && (
                          <span className="ml-1.5 text-[10px] text-amber-700 font-normal dark:text-amber-500">(You)</span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td className="p-3 text-stone-500 font-mono dark:text-stone-400">{u.email}</td>
                  <td className="p-3">
                    {currentUser.role === 'Admin' ? (
                      <select
                        value={u.role}
                        onChange={(e) => updateUserRole(u.id, e.target.value as Role)}
                        className="p-1 rounded border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-900 text-xs font-semibold"
                      >
                        <option value="Admin">Admin</option>
                        <option value="Editor">Editor</option>
                        <option value="Author">Author</option>
                        {(features.readerAccounts || u.role === 'Reader') && (
                          <option value="Reader" disabled={!features.readerAccounts}>
                            {features.readerAccounts ? 'Reader' : 'Reader (disabled for launch)'}
                          </option>
                        )}
                      </select>
                    ) : (
                      <span className="font-semibold text-stone-800 dark:text-stone-200">{u.role}</span>
                    )}
                  </td>
                  <td className="p-3">
                    <span
                      className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                        status === 'active'
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300'
                          : 'bg-stone-200 dark:bg-stone-800 text-stone-600'
                      }`}
                    >
                      {status}
                    </span>
                  </td>
                  <td className="p-3 text-stone-500 tabular-nums dark:text-stone-400">{new Date(u.joinedAt).toLocaleDateString()}</td>
                  {currentUser.role === 'Admin' && (
                    <td className="p-3 text-right space-x-3 whitespace-nowrap">
                      <button
                        onClick={() => handleToggleStatus(u.id, status)}
                        className="text-amber-700 dark:text-amber-400 hover:underline font-semibold cursor-pointer"
                      >
                        {status === 'active' ? 'Deactivate' : 'Reactivate'}
                      </button>
                      <button onClick={() => void issueResetLink(u.id, u.name)} className="text-stone-700 dark:text-stone-300 hover:underline font-semibold cursor-pointer">Reset link</button>
                      {(u as { totpEnabled?: boolean }).totpEnabled && <button onClick={() => void resetTwoFactor(u.id, u.name)} className="text-stone-700 dark:text-stone-300 hover:underline font-semibold cursor-pointer">Reset 2FA</button>}
                      <button
                        onClick={() => handleDelete(u.id, u.name)}
                        className="text-rose-600 dark:text-rose-400 hover:underline font-semibold cursor-pointer"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
