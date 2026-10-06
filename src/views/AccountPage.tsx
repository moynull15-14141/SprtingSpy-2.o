'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSite } from '../context/SiteContext';
import { TwoFactorSettings } from './TwoFactorSettings';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import type { AccountProfile, AccountSession } from '../types';

const inputClass = 'mt-1 block w-full rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-950 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500';
const cardClass = 'rounded-2xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] p-5 sm:p-7 space-y-5';

export const AccountPage: React.FC = () => {
  const { authLoading, isAuthenticated, currentUser, login, accountLanguage, features, navigate } = useSite();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const t = (en: string, bn: string) => accountLanguage === 'bn' ? bn : en;
  if (authLoading) return <p role="status">{t('Checking session…', 'সেশন যাচাই করা হচ্ছে…')}</p>;
  if (isAuthenticated) return <AccountDetails key={currentUser.id} />;
  // Reader accounts are launch-disabled: /account is a staff-only page, so
  // anonymous visitors get no public sign-in form here.
  if (!features.readerAccounts) return <div className="max-w-md mx-auto py-10">
    <div className={cardClass}>
      <h1 className="font-serif text-2xl font-bold">Staff account</h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">SportingSpy does not offer reader accounts. Staff can sign in through the editorial CMS.</p>
      <Button type="button" onClick={() => navigate('/admin')}>Go to staff sign-in</Button>
    </div>
  </div>;
  return <div className="max-w-md mx-auto py-10">
    <form className={cardClass} onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      const result = await login(email, password); setBusy(false); setPassword('');
      if (!result.success) setError(result.error || 'Sign in failed.');
    }}>
      <h1 className="font-serif text-2xl font-bold">{t('Sign in to your account', 'আপনার অ্যাকাউন্টে সাইন ইন করুন')}</h1>
      <label className="block text-sm">{t('Email', 'ইমেইল')}<input className={inputClass} type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="block text-sm">{t('Password', 'পাসওয়ার্ড')}<input className={inputClass} type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <Button isLoading={busy} type="submit">{t('Sign in', 'সাইন ইন')}</Button>
    </form>
  </div>;
};

const AccountDetails: React.FC = () => {
  const router = useRouter();
  const { apiCall, updateAccountIdentity, logout, themePreference, setThemePreference, accountLanguage, setAccountLanguage, features } = useSite();
  const t = (en: string, bn: string) => accountLanguage === 'bn' ? bn : en;
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [sessionError, setSessionError] = useState('');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [bio, setBio] = useState('');
  const [authorAvatar, setAuthorAvatar] = useState('');
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [retry, setRetry] = useState(0);
  const date = (value: string) => new Date(value).toLocaleString(accountLanguage === 'bn' ? 'bn-BD' : 'en-GB');
  const loadSessions = async () => {
    const result = await apiCall<{ sessions: AccountSession[] }>('/api/auth/sessions');
    if (result.data) { setSessions(result.data.sessions); setSessionError(''); }
    else { setSessions([]); setSessionError(result.error || 'Could not load sessions.'); }
  };
  useEffect(() => {
    let active = true;
    (async () => {
      const result = await apiCall<{ user: AccountProfile }>('/api/auth/me');
      if (!active) return;
      if (!result.data) { setError(result.error || 'Could not load account.'); return; }
      const user = result.data.user;
      setProfile(user); setName(user.name); setAvatar(user.avatar);
      setAuthorName(user.authorProfile?.name || ''); setBio(user.authorProfile?.bio || ''); setAuthorAvatar(user.authorProfile?.avatar || '');
      await loadSessions();
    })();
    return () => { active = false; };
  }, [retry]);
  const begin = (action: string) => { setBusy(action); setError(''); setSuccess(''); };
  // Device upload goes through the media library pipeline (type/size checks,
  // re-encoding); its URL is a library path the profile validator accepts.
  // The field still takes a pasted link. Save profile persists either.
  const uploadImage = async (file: File | undefined, apply: (url: string) => void) => {
    if (!file) return;
    begin('upload');
    const form = new FormData();
    form.append('title', `Profile photo – ${name || profile?.email || 'staff'}`.slice(0, 200));
    form.append('altText', name.slice(0, 300));
    form.append('file', file);
    const csrf = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];
    try {
      const res = await fetch('/api/media/upload', { method: 'POST', body: form, credentials: 'include', headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {} });
      const json = await res.json().catch(() => ({ error: `Upload failed (HTTP ${res.status}).` }));
      // The same file already in the library: reuse it instead of a copy.
      const url: string | undefined = res.ok ? json.url : res.status === 409 ? json.duplicateOf?.url : undefined;
      if (!url) { setError(json.error || t('Upload failed.', 'আপলোড ব্যর্থ হয়েছে।')); return; }
      apply(url);
      setSuccess(t('Image uploaded. Click Save profile to apply it.', 'ছবি আপলোড হয়েছে। প্রয়োগ করতে প্রোফাইল সংরক্ষণ করুন।'));
    } catch { setError(t('Upload failed: network error.', 'আপলোড ব্যর্থ: নেটওয়ার্ক ত্রুটি।')); }
    finally { setBusy(''); }
  };
  const canUpload = profile?.role !== 'Reader';
  const uploadButton = (label: string, apply: (url: string) => void) => canUpload && <label className={`mt-1 inline-flex shrink-0 cursor-pointer items-center rounded-lg border border-stone-300 dark:border-stone-700 px-3 py-2.5 text-sm font-medium hover:bg-stone-100 dark:hover:bg-stone-800 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
    {busy === 'upload' ? t('Uploading…', 'আপলোড হচ্ছে…') : t('Upload from device', 'ডিভাইস থেকে আপলোড')}
    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" className="sr-only" aria-label={label} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void uploadImage(file, apply); }} />
  </label>;
  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault(); begin('profile');
    const result = await apiCall<{ user: AccountProfile }>('/api/auth/me', { method: 'PATCH', body: {
      name, avatar, ...(profile?.authorProfile ? { authorProfile: { name: authorName, bio, avatar: authorAvatar } } : {}),
    } });
    setBusy('');
    if (!result.data) { setError(result.error || 'Could not save profile.'); return; }
    setProfile(result.data.user); updateAccountIdentity(result.data.user);
    setSuccess(t('Profile saved.', 'প্রোফাইল সংরক্ষিত হয়েছে।')); router.refresh();
  };
  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault(); begin('password');
    if (passwords.newPassword !== passwords.confirmPassword) { setError(t('New passwords do not match.', 'নতুন পাসওয়ার্ড মেলেনি।')); setBusy(''); return; }
    const result = await apiCall<{ success: boolean }>('/api/auth/change-password', { method: 'POST', body: passwords });
    setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' }); setBusy('');
    if (!result.data) { setError(result.error || 'Could not change password.'); return; }
    setSuccess(t('Password changed. All other sessions have been signed out.', 'পাসওয়ার্ড পরিবর্তিত হয়েছে। অন্য সব সেশন থেকে সাইন আউট করা হয়েছে।'));
    await loadSessions();
  };
  const revoke = async (reference?: string) => {
    begin(reference || 'others');
    const result = await apiCall<{ success: boolean }>(reference ? `/api/auth/sessions/${reference}` : '/api/auth/sessions/revoke-others', { method: reference ? 'DELETE' : 'POST', body: {} });
    setBusy('');
    if (!result.data) { setError(result.error || 'Could not revoke session.'); return; }
    setSuccess(t('Selected sessions signed out.', 'নির্বাচিত সেশন থেকে সাইন আউট করা হয়েছে।')); await loadSessions();
  };
  if (!profile) return <div className="max-w-xl mx-auto py-12" role="status">{error ? <><p role="alert">{error}</p><Button onClick={() => { setError(''); setRetry(v => v + 1); }}>{t('Retry', 'আবার চেষ্টা করুন')}</Button></> : t('Loading account…', 'অ্যাকাউন্ট লোড হচ্ছে…')}</div>;
  return <div className="max-w-4xl mx-auto space-y-6" lang={accountLanguage}>
    <div><p className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-500">SportingSpy</p><h1 className="mt-2 font-serif text-3xl font-bold">{t('My account & settings', 'আমার অ্যাকাউন্ট ও সেটিংস')}</h1><p className="mt-2 text-sm text-stone-500 dark:text-stone-400">{t('Your profile, security and reading preferences.', 'আপনার প্রোফাইল, নিরাপত্তা ও পড়ার পছন্দ।')}</p></div>
    <nav aria-label={t('Account sections', 'অ্যাকাউন্ট বিভাগ')} className="flex flex-wrap gap-4 text-sm text-amber-700 dark:text-amber-400"><a href="#profile">{t('Profile', 'প্রোফাইল')}</a><a href="#security">{t('Security', 'নিরাপত্তা')}</a><a href="#preferences">{t('Preferences', 'পছন্দ')}</a></nav>
    {error && <p role="alert" className="rounded-lg border border-rose-300 p-4 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
    {success && <p role="status" className="rounded-lg border border-emerald-300 p-4 text-sm text-emerald-700 dark:text-emerald-300">{success}</p>}
    <section id="profile" className={cardClass}>
      <h2 className="font-serif text-xl font-bold">{t('Profile', 'প্রোফাইল')}</h2>
      <dl className="grid sm:grid-cols-2 gap-4 text-sm break-words">
        <div><dt className="text-stone-500 dark:text-stone-400">{t('Email (read-only)', 'ইমেইল (পরিবর্তনযোগ্য নয়)')}</dt><dd>{profile.email}</dd></div>
        <div><dt className="text-stone-500 dark:text-stone-400">{t('Role / status', 'ভূমিকা / অবস্থা')}</dt><dd>{profile.role} / {profile.status}</dd></div>
        <div><dt className="text-stone-500 dark:text-stone-400">{t('Joined', 'যোগদানের তারিখ')}</dt><dd>{date(profile.joinedAt)}</dd></div>
        <div><dt className="text-stone-500 dark:text-stone-400">{t('Account updated', 'অ্যাকাউন্ট হালনাগাদ')}</dt><dd>{profile.updatedAt ? date(profile.updatedAt) : '—'}</dd></div>
      </dl>
      <p className="text-xs text-stone-500 dark:text-stone-400">{t('Contact an administrator for changes to your sign-in email or account access.', 'সাইন ইন ইমেইল বা অ্যাকাউন্টের অনুমতি পরিবর্তনের জন্য প্রশাসকের সাথে যোগাযোগ করুন।')}</p>
      <form onSubmit={saveProfile} className="space-y-4"><fieldset disabled={!!busy} className="space-y-4">
        <label className="block text-sm">{t('Display name', 'প্রদর্শিত নাম')}<input className={inputClass} autoComplete="name" required maxLength={150} value={name} onChange={e => setName(e.target.value)} /></label>
        <div className="flex items-center gap-3"><Avatar src={avatar} name={name} className="h-12 w-12 rounded-full object-cover" /><div className="flex flex-1 items-end gap-2"><label className="block flex-1 text-sm">{t('Avatar image URL', 'প্রোফাইল ছবির URL')}<input className={inputClass} maxLength={2048} value={avatar} onChange={e => setAvatar(e.target.value)} /></label>{uploadButton(t('Upload avatar image', 'প্রোফাইল ছবি আপলোড'), setAvatar)}</div></div>
        {profile.authorProfile && <fieldset className="space-y-4 border-t border-stone-200 dark:border-stone-800 pt-4">
          <legend className="font-semibold text-sm">{t('Public author profile', 'লেখকের প্রকাশ্য প্রোফাইল')}</legend>
          <p className="text-xs text-stone-500 dark:text-stone-400">{profile.authorProfile.roleTitle} · /author/{profile.authorProfile.slug}</p>
          <label className="block text-sm">{t('Byline name', 'লেখকের নাম')}<input className={inputClass} required maxLength={150} value={authorName} onChange={e => setAuthorName(e.target.value)} /></label>
          <label className="block text-sm">{t('Author bio', 'লেখকের পরিচিতি')}<textarea className={inputClass} rows={4} maxLength={3000} value={bio} onChange={e => setBio(e.target.value)} /></label>
          <div className="flex items-end gap-2"><label className="block flex-1 text-sm">{t('Author image URL', 'লেখকের ছবির URL')}<input className={inputClass} maxLength={2048} value={authorAvatar} onChange={e => setAuthorAvatar(e.target.value)} /></label>{uploadButton(t('Upload author image', 'লেখকের ছবি আপলোড'), setAuthorAvatar)}</div>
        </fieldset>}
        <Button type="submit" isLoading={busy === 'profile'}>{t('Save profile', 'প্রোফাইল সংরক্ষণ করুন')}</Button>
      </fieldset></form>
    </section>
    <section id="security" className={cardClass}>
      <h2 className="font-serif text-xl font-bold">{t('Security', 'নিরাপত্তা')}</h2>
      <form onSubmit={changePassword}><fieldset disabled={!!busy} className="space-y-4">
        <legend className="font-semibold text-sm mb-2">{t('Change password', 'পাসওয়ার্ড পরিবর্তন')}</legend>
        <p className="text-sm text-stone-500 dark:text-stone-400">{t('Use 8–200 characters. Changing your password signs out all other sessions; this session stays active.', '৮–২০০ অক্ষর ব্যবহার করুন। পাসওয়ার্ড পরিবর্তন করলে এই সেশন ছাড়া অন্য সব সেশন থেকে সাইন আউট হবে।')}</p>
        {(['currentPassword', 'newPassword', 'confirmPassword'] as const).map((key, index) => <label key={key} className="block text-sm">{[t('Current password', 'বর্তমান পাসওয়ার্ড'), t('New password', 'নতুন পাসওয়ার্ড'), t('Confirm new password', 'নতুন পাসওয়ার্ড নিশ্চিত করুন')][index]}<input className={inputClass} type="password" required minLength={index ? 8 : 1} maxLength={200} autoComplete={index ? 'new-password' : 'current-password'} value={passwords[key]} onChange={e => setPasswords(previous => ({ ...previous, [key]: e.target.value }))} /></label>)}
        <Button type="submit" isLoading={busy === 'password'}>{t('Update password', 'পাসওয়ার্ড হালনাগাদ করুন')}</Button>
      </fieldset></form>
      <TwoFactorSettings />
      <div className="border-t border-stone-200 dark:border-stone-800 pt-5 space-y-4">
        <h3 className="font-semibold">{t('Active sessions', 'সক্রিয় সেশন')}</h3>
        <p className="text-xs text-stone-500 dark:text-stone-400">{t('Sessions are identified by their start time. Device, location and last activity are not collected.', 'সেশন শুরুর সময় দিয়ে চিহ্নিত করা হয়। ডিভাইস, অবস্থান বা সর্বশেষ কার্যকলাপ সংগ্রহ করা হয় না।')}</p>
        {sessionError ? <p role="alert">{sessionError}</p> : <ul className="divide-y divide-stone-200 dark:divide-stone-800">{sessions.map(session => <li key={session.reference} className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm"><div><p className="font-medium">{session.current ? t('Current session', 'বর্তমান সেশন') : t('Other session', 'অন্য সেশন')}</p><p>{t('Started', 'শুরু')} {date(session.createdAt)}</p><p className="text-xs text-stone-500 dark:text-stone-400">{t('Expires', 'মেয়াদ শেষ')} {date(session.expiresAt)}</p></div>{!session.current && <Button variant="outline" size="sm" disabled={!!busy} onClick={() => revoke(session.reference)}>{t('Revoke session', 'সেশন বাতিল করুন')}</Button>}</li>)}</ul>}
        <div className="flex flex-wrap gap-3"><Button variant="outline" disabled={!!busy} onClick={loadSessions}>{t('Refresh sessions', 'সেশন রিফ্রেশ করুন')}</Button><Button variant="outline" disabled={!!busy || !sessions.some(s => !s.current)} onClick={() => revoke()}>{t('Sign out other sessions', 'অন্য সেশন থেকে সাইন আউট')}</Button><Button variant="danger" disabled={!!busy} onClick={async () => { begin('logout'); await logout(); setBusy(''); }}>{t('Sign out', 'সাইন আউট')}</Button></div>
      </div>
    </section>
    <section id="preferences" className={cardClass}>
      <h2 className="font-serif text-xl font-bold">{t('Preferences', 'পছন্দ')}</h2>
      <p className="text-sm text-stone-500 dark:text-stone-400">{t('Saved in this browser. Language applies to the account area; theme applies across the site.', 'এই ব্রাউজারে সংরক্ষিত। ভাষা অ্যাকাউন্ট বিভাগে এবং থিম পুরো সাইটে প্রযোজ্য।')}</p>
      <label className="block text-sm">{t('Theme', 'থিম')}<select aria-label={t('Theme', 'থিম')} className={inputClass} value={themePreference} onChange={e => setThemePreference(e.target.value === 'light' || e.target.value === 'dark' ? e.target.value : 'system')}><option value="system">{t('System', 'সিস্টেম')}</option><option value="light">{t('Light', 'হালকা')}</option><option value="dark">{t('Dark', 'গাঢ়')}</option></select></label>
      {features.readerAccounts && <label className="block text-sm">{t('Account language', 'অ্যাকাউন্টের ভাষা')}<select aria-label={t('Account language', 'অ্যাকাউন্টের ভাষা')} className={inputClass} value={accountLanguage} onChange={e => setAccountLanguage(e.target.value === 'bn' ? 'bn' : 'en')}><option value="en">English</option><option value="bn">বাংলা</option></select></label>}
    </section>
  </div>;
};
