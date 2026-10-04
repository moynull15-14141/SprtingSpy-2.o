'use client';

/**
 * Two-factor authentication (TOTP) for the signed-in staff member (PHASE R,
 * Spec §24.1). Setup shows the secret (and otpauth link) once; it becomes
 * active only after a valid code proves the authenticator works. Turning it
 * off needs the password and a current code.
 */

import React, { useEffect, useState } from 'react';
import { useSite } from '../context/SiteContext';
import { Button } from '../components/ui/Button';

const input = 'mt-1 w-full rounded-lg border border-stone-300 bg-white p-2 text-sm dark:border-stone-700 dark:bg-stone-950';

export function TwoFactorSettings() {
  const { apiCall } = useSite();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const res = await apiCall<{ enabled: boolean }>('/api/auth/totp/status');
    if (res.data) setEnabled(res.data.enabled);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const run = async (path: string, body: Record<string, unknown>) => {
    setBusy(true); setError(null); setMessage(null);
    const res = await apiCall<Record<string, unknown>>(path, { method: 'POST', body });
    setBusy(false);
    if (!res.data) setError(res.error);
    return res.data;
  };

  return (
    <div className="border-t border-stone-200 dark:border-stone-800 pt-5 space-y-3" id="two-factor">
      <h3 className="font-semibold">Two-factor authentication</h3>
      <p className="text-xs text-stone-500 dark:text-stone-400">Adds a 6-digit code from an authenticator app (any TOTP app) to every sign-in. Recommended for Admin and Editor accounts.</p>
      {enabled === null ? <p className="text-sm text-stone-500">Loading…</p> : enabled ? (
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await run('/api/auth/totp/disable', { password, code }); if (r) { setEnabled(false); setMessage('Two-factor authentication is off.'); setPassword(''); setCode(''); } }}>
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">On</p>
          <label className="block text-sm">Password<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={input} /></label>
          <label className="block text-sm">Current code<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={input} /></label>
          <Button type="submit" variant="outline" isLoading={busy}>Turn off two-factor authentication</Button>
        </form>
      ) : setup ? (
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await run('/api/auth/totp/enable', { code }); if (r) { setEnabled(true); setSetup(null); setCode(''); setMessage('Two-factor authentication is on. You will be asked for a code at every sign-in.'); } }}>
          <p className="text-sm">1. Add this key to your authenticator app (enter it manually, type: time-based):</p>
          <code className="block break-all rounded bg-stone-100 p-2 font-mono text-sm tracking-wider dark:bg-stone-900" data-testid="totp-secret">{setup.secret}</code>
          <p className="text-xs text-stone-500 break-all">Or open this link on the device with the app: <a href={setup.otpauthUri} className="underline">{setup.otpauthUri}</a></p>
          <label className="block text-sm">2. Enter the 6-digit code it shows<input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} className={input} /></label>
          <div className="flex gap-2"><Button type="submit" isLoading={busy}>Verify and turn on</Button><Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button></div>
        </form>
      ) : (
        <Button variant="outline" isLoading={busy} onClick={async () => { const r = await run('/api/auth/totp/setup', {}); if (r) setSetup(r as { secret: string; otpauthUri: string }); }}>Set up two-factor authentication</Button>
      )}
      {message && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  );
}
