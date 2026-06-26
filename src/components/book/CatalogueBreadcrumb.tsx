'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useEmbedHref } from '@/lib/EmbedContext';

/**
 * Breadcrumb shown at the top of book pages inside a tenant reading room
 * (EFM/BPH iframe or tenant subdomain) linking back to the full catalogue.
 *
 * The href is relative and routed through useEmbedHref so it resolves to the
 * tenant catalogue in every context: `/embed/<tenant>/?view=catalog` inside the
 * iframe and `/?view=catalog` on the tenant subdomain (where proxy.ts hides the
 * /embed/<tenant> prefix). Keeping it relative satisfies the Tenant Subdomain
 * Lockdown invariant — no absolute sourcelibrary.org href that would leak the
 * visitor off the partner's subdomain.
 */
export default function CatalogueBreadcrumb() {
  const embedHref = useEmbedHref();
  return (
    <nav aria-label="Breadcrumb" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 sm:pt-5">
      <Link
        href={embedHref('/?view=catalog')}
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-accent-rust transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to the full catalogue
      </Link>
    </nav>
  );
}
