/**
 * Staff article preview (PHASE C): /admin/preview/<articleId>/
 *
 * Renders any article (draft, scheduled, …) with the SAME template as the
 * public article page. Access is decided on the server from the session
 * cookie using the same rules as the API (active staff account; Authors
 * only for their own articles). Everyone else gets a real 404, so the
 * existence of a draft is never revealed. Viewing never changes status.
 * The page is noindex/nofollow, uncached, and lives under /admin (robots-disallowed).
 */

import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArticlePage } from '../../../../views/ArticlePage';

type Params = Promise<{ id: string }>;

const STAFF = ['Admin', 'Editor', 'Author'];

async function authorizedPreview(id: string) {
  // Imported lazily so building the app never needs a database connection.
  const [{ resolveSessionIdentity }, { getArticlePreview }] = await Promise.all([
    import('../../../../../server/sessionLookup'),
    import('../../../../../server/services/public/content'),
  ]);
  const viewer = await resolveSessionIdentity((await cookies()).get('sid')?.value);
  if (!viewer || !STAFF.includes(viewer.role) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  return getArticlePreview(id, viewer);
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const data = await authorizedPreview((await params).id);
  return {
    title: { absolute: data ? `Preview: ${data.article.title} | SportingSpy` : 'Page Not Found | SportingSpy' },
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Params }) {
  const data = await authorizedPreview((await params).id);
  if (!data) notFound();
  return <ArticlePage data={data} comments={null} preview />;
}
