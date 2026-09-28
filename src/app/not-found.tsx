import type { Metadata } from 'next';
import Link from 'next/link';

// Rendered for notFound() and unmatched URLs with a real HTTP 404 status.
export const metadata: Metadata = {
  title: { absolute: 'Page Not Found | SportingSpy' },
};

export default function NotFound() {
  return (
    <div className="py-20 text-center max-w-lg mx-auto space-y-4">
      <h1 className="font-serif text-4xl font-bold text-stone-900 dark:text-stone-100">404</h1>
      <p className="text-base text-stone-600 dark:text-stone-400">
        The requested sports dossier or URL was not found in the SportingSpy registry.
      </p>
      <div className="pt-4">
        <Link
          href="/"
          className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm font-semibold hover:bg-amber-800 transition-colors inline-block"
        >
          Return to SportingSpy Home
        </Link>
      </div>
    </div>
  );
}
