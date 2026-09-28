import React from 'react';
import { highlightParts } from '../../lib/searchText';

/** Renders `text` with words matching the query wrapped in <mark>. Text nodes only — never HTML. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = highlightParts(text, query);
  return (
    <>
      {parts.map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-amber-200/70 px-0.5 text-inherit dark:bg-amber-500/30">{part.text}</mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}
