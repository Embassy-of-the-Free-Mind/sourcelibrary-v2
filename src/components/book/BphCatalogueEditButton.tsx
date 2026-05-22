'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { AuthCheck } from '@/components/auth/AuthCheck';
import BphCatalogueEditModal, { type BphWorkEditable } from './BphCatalogueEditModal';

/**
 * Client wrapper that adds an "Edit cataloguer fields" button to a server-
 * rendered BPH catalogue view. Visible only to users with `bph_librarian`
 * rights (BPH-tenant editor or global admin). Opens the modal that writes
 * Supabase `bph_works`.
 *
 * Kept as a thin shell so the server component (BphCatalogueRecord) doesn't
 * need to become client-side.
 */
export default function BphCatalogueEditButton({ work, variant = 'inline' }: {
  work: BphWorkEditable;
  /** 'inline' for the inline catalogue record (book detail page),
   *  'header' for the standalone catalogue detail page. */
  variant?: 'inline' | 'header';
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // Slightly different styling per surface so the inline (dark) and header
  // (light) backgrounds both stay legible.
  const buttonCls =
    variant === 'header'
      ? 'inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-accent-rust/40 text-accent-rust hover:bg-accent-rust/10 transition-colors'
      : 'inline-flex items-center gap-1.5 text-sm text-accent-gold hover:text-accent-gold transition-colors';

  return (
    <AuthCheck role="bph_librarian">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonCls}
        title="Edit BPH catalogue fields (Supabase bph_works)"
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        Edit cataloguer fields
      </button>

      {open && (
        <BphCatalogueEditModal
          work={work}
          onClose={() => setOpen(false)}
          onSave={() => {
            // Re-fetch the server component data so the updated values show
            // without a full reload.
            router.refresh();
          }}
        />
      )}
    </AuthCheck>
  );
}
