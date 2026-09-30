/** FAQ loading state (PHASE H): a page-height skeleton so the layout does not shift. */
export default function FaqLoading() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 min-h-[80vh]" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading frequently asked questions…</span>
      <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
      <div className="h-10 w-3/4 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" />
      <div className="divide-y divide-stone-200 dark:divide-stone-800 rounded-xl border border-stone-200 dark:border-stone-800">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="p-5"><div className="h-5 w-4/5 rounded bg-stone-200 dark:bg-stone-800 animate-pulse" /></div>
        ))}
      </div>
    </div>
  );
}
