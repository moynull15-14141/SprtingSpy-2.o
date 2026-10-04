/**
 * Marks the page type for real-user monitoring (PHASE R). Server-rendered,
 * no JavaScript: WebVitalsReporter reads it when it reports a measurement.
 */
export type RumPageTypeValue = 'home' | 'sport' | 'event' | 'edition' | 'article' | 'search' | 'latest' | 'events' | 'sports' | 'author' | 'faq' | 'static';

export function RumPageType({ type }: { type: RumPageTypeValue }) {
  return <span hidden data-ss-page-type={type} />;
}
