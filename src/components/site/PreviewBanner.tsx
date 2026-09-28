'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSite } from '../../context/SiteContext';

/** Shown only to an editor previewing unpublished Site Experience drafts. */
export function PreviewBanner() {
  const { apiCall } = useSite();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-3 bg-violet-700 px-4 py-2 text-sm font-semibold text-white">
      <span>Draft preview — you are seeing unpublished Site Experience changes. Visitors do not see this.</span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => { setBusy(true); const result = await apiCall('/api/site-experience/preview', { method: 'POST', body: { enabled: false } }); if (result.data) router.refresh(); setBusy(false); }}
        className="rounded-md bg-white px-3 py-1 text-xs font-bold text-violet-800 hover:bg-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-60"
      >
        Exit preview
      </button>
    </div>
  );
}
