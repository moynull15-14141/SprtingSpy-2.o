'use client';

/**
 * PHASE U — Public reader registration.
 * Gated on the reader-accounts feature flag (the API also returns 404 while
 * off). On success the account exists but is unverified; the reader is told to
 * check their e-mail. No role is ever sent — the server assigns 'Reader'.
 */

import React, { useState } from 'react';
import { useSite } from '../context/SiteContext';
import { Button } from '../components/ui/Button';

const input = 'w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500';

export function RegisterForm() {
  const { apiCall, features, isAuthenticated } = useSite();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await apiCall<{ message: string }>('/api/auth/register', { method: 'POST', body: { name: name.trim(), email: email.trim(), password } });
    setBusy(false);
    if (res.data) setMessage(res.data.message); else setError(res.error);
  };

  return (
    <div className="max-w-sm mx-auto py-16">
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 shadow-sm space-y-4">
        <h1 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">Create a reader account</h1>
        {!features.readerAccounts ? (
          <p className="text-sm text-stone-600 dark:text-stone-400">Reader accounts are not available yet. Please check back later.</p>
        ) : isAuthenticated ? (
          <p role="status" className="text-sm text-stone-700 dark:text-stone-300">You are already signed in. <a href="/account" className="font-semibold text-amber-700 hover:underline dark:text-amber-400">Go to your account</a>.</p>
        ) : message ? (
          <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">{message} Open the link in that e-mail to finish creating your account. If it doesn&rsquo;t arrive, check your spam folder.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-stone-500 dark:text-stone-400">Join the discussion. We&rsquo;ll send a link to confirm your e-mail address.</p>
            <label className="block text-xs font-semibold">Name
              <input type="text" required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-xs font-semibold">Email
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} mt-1`} />
            </label>
            <label className="block text-xs font-semibold">Password (at least 8 characters)
              <input type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} mt-1`} />
            </label>
            {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <Button type="submit" isLoading={busy} className="w-full justify-center">Create account</Button>
            <p className="text-center text-[11px] text-stone-500 dark:text-stone-400">Already have an account? Sign in from the account menu in the top bar.</p>
          </form>
        )}
      </div>
    </div>
  );
}
