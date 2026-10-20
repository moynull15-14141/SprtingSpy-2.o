'use client';

/**
 * PHASE U — Reader e-mail verification landing page. Opened from the link in
 * the verification e-mail (/verify-email/?token=…). Confirms the token with the
 * server and reports the outcome. The raw token stays in the URL only.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useSite } from '../context/SiteContext';

export function VerifyEmailForm() {
  const { apiCall } = useSite();
  const token = useSearchParams().get('token') || '';
  const [state, setState] = useState<'checking' | 'ok' | 'bad'>(token ? 'checking' : 'bad');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true; // confirm at most once
    void apiCall<{ success: boolean }>('/api/auth/verify-email', { method: 'POST', body: { token } }).then((r) => setState(r.data?.success ? 'ok' : 'bad'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="max-w-sm mx-auto py-16">
      <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 shadow-sm space-y-4">
        <h1 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">Confirm your e-mail</h1>
        {state === 'checking' ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">Confirming your e-mail address…</p>
        ) : state === 'ok' ? (
          <>
            <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">Your e-mail address is confirmed. You can now sign in and join the discussion.</p>
            <a href="/account" className="block text-center text-sm font-semibold text-amber-700 hover:underline dark:text-amber-400">Go to your account</a>
          </>
        ) : (
          <>
            <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">This confirmation link is invalid, already used or expired.</p>
            <p className="text-xs text-stone-500 dark:text-stone-400">Sign in and request a new confirmation link from your account, or register again.</p>
          </>
        )}
      </div>
    </div>
  );
}
