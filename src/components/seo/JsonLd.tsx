/**
 * Server-rendered JSON-LD. `<` is escaped so editor-controlled strings can
 * never close the script element (PHASE 0.1 XSS fix, kept).
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\u003c') }}
    />
  );
}
