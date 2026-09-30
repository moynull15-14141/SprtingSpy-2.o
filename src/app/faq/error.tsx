'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';

/** Friendly FAQ failure state (PHASE H). Error details are never shown to visitors. */
export default function FaqError({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  // The failure happened on the server, so retrying needs a fresh server render as well as a boundary reset.
  const retry = () => startTransition(() => { router.refresh(); reset(); });
  return (
    <div className="mx-auto max-w-md space-y-4 py-16 text-center" role="alert">
      <h1 className="font-serif text-2xl font-bold text-stone-900 dark:text-stone-100">The FAQ is temporarily unavailable</h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">Something went wrong while loading the questions. Please try again in a moment.</p>
      <button type="button" onClick={retry} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
        Try again
      </button>
    </div>
  );
}
