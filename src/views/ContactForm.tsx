'use client';

import React, { useState } from 'react';
import { Button } from '../components/ui/Button';
import { CONTACT_LIMITS } from '../lib/contact';

const TOPICS = ['Editorial correction / fact-check', 'Tournament credential inquiry', 'Licensing & syndication', 'Sponsorship / partnership', 'General inquiry'];
const inputClass = 'w-full text-sm p-2.5 rounded-lg border border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900 text-stone-900 dark:text-stone-100 focus:outline-none focus:ring-2 focus:ring-amber-500';
const labelClass = 'block text-xs font-semibold text-stone-700 dark:text-stone-300 mb-1';

const readCsrf = () => document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/)?.[1];

/**
 * Contact form (PHASE H). Messages are sent to POST /api/contact and stored
 * for the editorial team's CMS inbox. Success is shown only after the server
 * confirms the message was saved; no e-mail is sent.
 */
export function ContactForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '', website: '' });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === 'sending') return;
    setError(null);
    setState('sending');
    try {
      const csrf = readCsrf();
      const res = await fetch('/api/contact', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}) },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201 && data.ok) {
        setState('sent');
        return;
      }
      const reference = res.headers.get('x-request-id');
      setError(data.error && res.status < 500 ? data.error : `Your message could not be saved. Please try again later${reference ? ` (reference ${reference.slice(0, 8)})` : ''}.`);
    } catch {
      setError('Your message could not be sent. Check your connection and try again.');
    }
    setState('idle');
  };

  if (state === 'sent') {
    return (
      <div role="status" className="p-6 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-sm">
        <h2 className="font-semibold text-base mb-1">Message received</h2>
        <p>Thank you — your message has been saved for the editorial team. If a reply is needed, we will write to the email address you gave.</p>
        <button type="button" onClick={() => { setForm({ name: '', email: '', subject: '', message: '', website: '' }); setState('idle'); }} className="mt-3 text-xs font-semibold underline hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded">
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false} aria-labelledby="contact-form-heading" aria-busy={state === 'sending'} aria-describedby={error ? 'contact-error' : undefined} className="p-6 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-[#121417] space-y-4">
      <h2 id="contact-form-heading" className="font-semibold text-base text-stone-900 dark:text-stone-100">Send a message</h2>
      {error && (
        <p id="contact-error" role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="contact-name" className={labelClass}>Your name</label>
          <input id="contact-name" name="name" type="text" required autoComplete="name" minLength={CONTACT_LIMITS.name.min} maxLength={CONTACT_LIMITS.name.max} value={form.name} onChange={set('name')} className={inputClass} placeholder="e.g. Jane Doe" />
        </div>
        <div>
          <label htmlFor="contact-email" className={labelClass}>Email address</label>
          <input id="contact-email" name="email" type="email" required autoComplete="email" maxLength={CONTACT_LIMITS.email.max} value={form.email} onChange={set('email')} className={inputClass} placeholder="you@example.com" />
        </div>
      </div>
      <div>
        <label htmlFor="contact-subject" className={labelClass}>Subject</label>
        <input id="contact-subject" name="subject" type="text" required list="contact-topics" minLength={CONTACT_LIMITS.subject.min} maxLength={CONTACT_LIMITS.subject.max} value={form.subject} onChange={set('subject')} className={inputClass} placeholder="Choose a topic or type your own" />
        <datalist id="contact-topics">{TOPICS.map((t) => <option key={t} value={t} />)}</datalist>
      </div>
      <div>
        <label htmlFor="contact-message" className={labelClass}>Message</label>
        <textarea id="contact-message" name="message" rows={6} required minLength={CONTACT_LIMITS.message.min} maxLength={CONTACT_LIMITS.message.max} value={form.message} onChange={set('message')} className={inputClass} placeholder="Include the article URL and your source for corrections." aria-describedby="contact-message-count" />
        <p id="contact-message-count" className="mt-1 text-right text-[11px] tabular-nums text-stone-500 dark:text-stone-400">{form.message.length} / {CONTACT_LIMITS.message.max}</p>
      </div>
      {/* Honeypot for automated submissions: hidden from people and assistive technology. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} />
      </div>
      <p className="text-[11px] text-stone-500 dark:text-stone-400">Your message is stored for the editorial team to read. See the <a href="/privacy-policy/" className="underline hover:text-amber-700 dark:hover:text-amber-400">privacy policy</a>.</p>
      <Button type="submit" size="md" className="w-full" isLoading={state === 'sending'} disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  );
}
