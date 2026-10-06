/**
 * Staff page preview (PHASE PAGES): /admin/preview/page/<pageId>/
 *
 * Renders any CMS page (draft or published) with the same template as the
 * public route. Only active Admin/Editor sessions (the roles that manage
 * pages) see it; everyone else gets a real 404, so a draft's existence is
 * never revealed. noindex/nofollow, uncached, under robots-disallowed /admin.
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { CmsPageBody } from '../../../../../lib/pageRoute';

type Params = Promise<{ id: string }>;

async function authorizedPreview(id: string) {
  // Imported lazily so building the app never needs a database connection.
  const [{ resolveSessionIdentity }, { getPagePreview }] = await Promise.all([
    import('../../../../../../server/sessionLookup'),
    import('../../../../../../server/services/public/pages'),
  ]);
  const viewer = await resolveSessionIdentity((await cookies()).get('sid')?.value);
  if (!viewer || !['Admin', 'Editor'].includes(viewer.role) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  return getPagePreview(id);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const view = await authorizedPreview((await params).id);
  return {
    title: { absolute: view ? `Preview: ${view.page.title} | SportingSpy` : 'Page Not Found | SportingSpy' },
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Params }) {
  const view = await authorizedPreview((await params).id);
  if (!view) notFound();
  return <CmsPageBody view={view} preview />;
}
