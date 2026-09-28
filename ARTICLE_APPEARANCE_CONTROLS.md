# Article appearance controls

Admin → Articles → Edit now includes **Image caption & article appearance**, immediately below the featured image.

- Caption and credit inherit Media Library text by default. Uncheck **Use Media Library text** to customize either for this article. Empty overrides hide that text; empty caption and credit hide the caption bar. Rechecking restores library inheritance. The shared image metadata is unchanged.
- **Show large first letter (drop cap)** controls the first top-level body paragraph. Three sizes and six color options are available, with a live example. Existing articles retain their automatic medium amber drop cap until edited.
- The editor toolbar includes **Text size** (default, small, large, extra large) and **Text color** (default, amber, blue, green, red, purple). Select text before applying formatting; **Clear formatting** removes it. Named colors adapt to light/dark mode.
- Save the article to persist these controls. Draft Preview saves the draft and renders the same template as the public article. For published articles, Preview shows the last saved version, as before.

Presentation is stored in the existing rich document JSON. Caption/credit overrides and first-letter settings are allow-listed document attributes; inline size/color are a constrained mark. Server validation rejects invalid sizes/colors and limits caption/credit lengths. Plain-text search/reading time, media references, ownership checks and preview authorization keep using the existing pipeline. No database migration is required.

Validation: TypeScript and production build; extended Phase C API/Chrome checks for persistence, explicit hiding, inheritance, unchanged shared media, unsafe values, selection formatting and public rendering without JavaScript; existing newsroom editor checks. Actual localhost verified with the existing sports-viewing-guide article on desktop and 390/375 px mobile, without saving changes to it. Temporary fixtures and verification sessions are removed.

Results: Phase C **18 PASS**, newsroom editor **7 PASS**, article workspace UI **5 PASS**; TypeScript/build and actual localhost checks passed. Phase C confirmed original database row hashes, stored media files and protected files were unchanged after cleanup.

Screenshots are in `verification/article-appearance/`.
