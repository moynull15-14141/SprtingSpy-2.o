/**
 * SportingSpy Admin Access Gate
 * ===============================
 * PHASE 3 — SECURITY & ANTI-BOT.
 *
 * Knowing the /admin URL must not be enough to see the Admin Panel. This
 * component is the frontend half of that requirement — it is UX, not
 * security (the API remains the authoritative authorization layer; every
 * mutation endpoint enforces its own role check server-side regardless of
 * what this component renders). Its job is simply to make sure the Admin
 * UI itself never mounts for a visitor who shouldn't be looking at it,
 * instead of relying on hidden buttons or CSS.
 *
 * Behavior:
 *   - Still resolving whether a session exists (`authLoading`) -> a neutral
 *     loading state, never the Admin Panel.
 *   - No session at all -> a login prompt, not the Admin Panel.
 *   - A real session, but role has no CMS access (Reader) -> Access Denied.
 *   - Admin / Editor / Author -> render the Admin Panel (`children`).
 */

import React, { useState } from 'react';
import { useSite } from '../../context/SiteContext';
import { Button } from '../ui/Button';

const STAFF_ROLES = ['Admin', 'Editor', 'Author'] as const;

export const AdminAccessGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { authLoading, isAuthenticated, currentUser, login, navigate } = useSite();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // PHASE R: second factor, asked for after a correct password.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const result = await login(email, password, totpRequired ? totpCode.trim() : undefined);
    setIsSubmitting(false);
    if (!result.success) {
      if (result.totpRequired) setTotpRequired(true);
      setError(result.totpRequired && !totpRequired ? null : result.error || 'Login failed.');
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-md mx-auto py-24 text-center text-sm text-stone-500 dark:text-stone-400">
        Checking session&hellip;
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-sm mx-auto py-16">
        <div className="rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-6 shadow-sm space-y-4">
          <div>
            <h1 className="font-serif text-xl font-bold text-stone-900 dark:text-stone-100">Staff Sign In Required</h1>
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              This area is restricted to SportingSpy staff. Sign in with your Admin, Editor, or Author account to continue.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-1 focus:ring-amber-500"
            />
            {totpRequired && (
              <div>
                <label htmlFor="admin-totp" className="block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1">Authentication code</label>
                <input id="admin-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required autoFocus value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" className="w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 tracking-widest" />
                <p className="mt-1 text-[11px] text-stone-500 dark:text-stone-400">Enter the code from your authenticator app.</p>
              </div>
            )}
            {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
            <Button type="submit" size="md" isLoading={isSubmitting} className="w-full justify-center">
              {totpRequired ? 'Verify and sign in' : 'Sign In'}
            </Button>
          </form>
          <a href="/reset-password/" className="block text-center text-xs font-semibold text-amber-700 hover:underline dark:text-amber-400">Forgot your password?</a>
          <button
            onClick={() => navigate('/')}
            className="w-full text-center text-xs text-stone-500 hover:text-stone-800 dark:hover:text-stone-200 dark:text-stone-400"
          >
            &larr; Back to the public site
          </button>
        </div>
      </div>
    );
  }

  if (!STAFF_ROLES.includes(currentUser.role as (typeof STAFF_ROLES)[number])) {
    return (
      <div className="max-w-md mx-auto py-24 text-center space-y-4">
        <h1 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">Access Denied</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Your account ({currentUser.email}, role: {currentUser.role}) does not have permission to view the Editorial CMS.
          Contact an Admin if you believe this is incorrect.
        </p>
        <Button onClick={() => navigate('/')} variant="outline" size="sm">
          Return to the public site
        </Button>
      </div>
    );
  }

  return <>{children}</>;
};
