/** Shown while a new search/filter/page is rendered on the server. */
export default function Loading() {
  return (
    // At least a screen tall: the results replace it without pulling the footer up into view (layout shift).
    <div className="min-h-screen space-y-6" role="status" aria-label="Loading search results">
      <div className="h-8 w-40 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
      <div className="h-14 animate-pulse rounded-xl bg-stone-200 dark:bg-stone-800" />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="hidden h-72 animate-pulse rounded-2xl bg-stone-200 dark:bg-stone-800 lg:block" />
        <div className="space-y-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="hidden aspect-video w-40 animate-pulse rounded-lg bg-stone-200 dark:bg-stone-800 sm:block" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
                <div className="h-5 w-3/4 animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
                <div className="h-3 w-full animate-pulse rounded bg-stone-200 dark:bg-stone-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading search results…</span>
    </div>
  );
}
