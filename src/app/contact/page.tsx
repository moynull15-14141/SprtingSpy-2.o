import type { Metadata } from 'next';
import { publishedPageMetadata, renderPublishedPage } from '../../lib/pageRoute';

// PHASE PAGES: Contact is a CMS page (Admin → Pages); this route keeps its URL.
const SLUG = 'contact';

export const generateMetadata = (): Promise<Metadata> => publishedPageMetadata(SLUG);

export default function Page() {
  return renderPublishedPage(SLUG);
}
