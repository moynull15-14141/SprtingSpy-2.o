'use client';

/**
 * Staff password reset (PHASE R, Spec §24.1).
 * Without a token: request a link by e-mail (always the same answer, so the
 * form never reveals whether an account exists). With ?token=: choose a new
 * password; every session of the account is signed out afterwards.
 */

import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSite } from '../context/SiteContext';
import { Button } from '../components/ui/Button';

const input = 'w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500';

export function ResetPasswordForm() {
  const { apiCall } = useSite();
  const token = useSearchParams().get('token') || '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [valid, setValid] = useState<boolean | null>(token ? null : false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    void apiCall<{ valid: boolean }>(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`).then((r) => setValid(!!r.data?.valid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const request = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    const res = await apiCall<{ message: string }>('/api/auth/password-reset/request', { method: 'POST', body: { email } });
    setBusy(false);
    if (res.data) setMessage(res.data.message); else setError(res.error);
  };

  const confirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('The passwords do not match.'); return; }
    setBusy(true); setError(null);
    const res = await apiCall<{ success: boolean }>('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: password, confirmPassword: confirm } });
    setBusy(false);
    if (res.data?.success) setDone(true); else setError(res.error);
  };

  return (
    <div className="max-w-sm mx-auto py-16">
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 shadow-sm space-y-4">
        <h1 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">Reset your password</h1>
        {done ? (
          <>
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">Your password has been changed and every session of the account was signed out.</p>
            <a href="/admin/" className="block text-center text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400">Sign in</a>
          </>
        ) : token ? (
          valid === null ? <p className="text-sm text-stone-500">Checking the link…</p> : !valid ? (
            <>
              <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">This reset link is invalid, already used or expired.</p>
              <a href="/reset-password/" className="text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400">Request a new link</a>
            </>
          ) : (
            <form onSubmit={confirmReset} className="space-y-3">
              <label className="block text-xs font-semibold">New password (at least 8 characters)
                <input type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} mt-1`} />
              </label>
              <label className="block text-xs font-semibold">Repeat the new password
                <input type="password" required minLength={8} maxLength={200} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={`${input} mt-1`} />
              </label>
              {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
              <Button type="submit" isLoading={busy} className="w-full justify-center">Set new password</Button>
            </form>
          )
        ) : message ? (
          <p role="status" className="text-sm text-stone-700 dark:text-stone-300">{message} If no e-mail arrives, ask an Admin to issue a reset link.</p>
        ) : (
          <form onSubmit={request} className="space-y-3">
            <p className="text-xs text-stone-500 dark:text-stone-400">Enter the e-mail address of your staff account. If it exists, a reset link valid for 30 minutes is sent.</p>
            <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
            {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <Button type="submit" isLoading={busy} className="w-full justify-center">Send reset link</Button>
          </form>
        )}
      </div>
    </div>
  );
}
