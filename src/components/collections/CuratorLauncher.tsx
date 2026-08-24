'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { SlidersHorizontal } from 'lucide-react';
import CollectionImageCurator from './CollectionImageCurator';

/**
 * Shows the "Curate images" affordance to editors and above, and nobody else.
 * Rendered on the collection page beside the gallery; the API behind it is
 * gated independently, so this is presentation rather than the security
 * boundary.
 */
export default function CuratorLauncher({ slug }: { slug: string }) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [open, setOpen] = useState(false);
  if (!(role === 'editor' || role === 'admin' || role === 'superadmin')) return null;
  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border transition-colors"
        style={{ color: '#6b6560', borderColor: '#d4cfc4' }}>
        <SlidersHorizontal className="w-3.5 h-3.5" /> Curate images
      </button>
      {open && <CollectionImageCurator slug={slug} onClose={() => setOpen(false)} />}
    </>
  );
}
