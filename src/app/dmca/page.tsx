import type { Metadata } from 'next';
import { publishedPageMetadata, renderPublishedPage } from '../../lib/pageRoute';

// PHASE PAGES: DMCA is a CMS page (Admin → Pages); this route keeps its URL.
const SLUG = 'dmca';

export const generateMetadata = (): Promise<Metadata> => publishedPageMetadata(SLUG);

export default function Page() {
  return renderPublishedPage(SLUG);
}
