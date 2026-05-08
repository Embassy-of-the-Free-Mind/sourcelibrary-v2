'use client';

/**
 * Unified BPH catalogue. The partner mockup folds the previous
 * /catalog (table of all 27,706 works) and /catalog?view=books (grid of
 * 2,280 digitised+translated covers) into a single page with a
 * segmented toggle:
 *
 *   Show all                       → list view, full bph_works table
 *   Show digitised & translated    → grid view, MongoDB books with covers
 *
 * The toggle and the list/grid icons drive the same state — they are
 * two ways to express the same mode. Switching modes navigates so each
 * mode keeps its own URL params (so the URL bar reflects what's actually
 * filtered, matching the rule established in #1640).
 *
 * The component renders the shell (heading, toggle, counter, view icons)
 * and the catalogue table when mode='all'. When mode='digitized' it
 * only renders the shell; SharedLibraryView renders the books grid
 * underneath because that grid is fed by server-side data.
 */

import { useState } from 'react';
import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';
import { useEmbedHref } from '@/lib/EmbedContext';

export type CatalogueMode = 'all' | 'digitized';

interface Props {
  /** "all" → list view, catalogue table. "digitized" → grid view, books with covers. */
  mode: CatalogueMode;
  /** Total works in bph_works (denominator for the counter, regardless of mode). */
  catalogTotal: number;
  /** When mode='digitized', the count of digitised+translated SL books (server-fetched).
      When mode='all', this is ignored — the catalogue table reports its own filtered count. */
  digitizedTotal: number;
  /** basePath for embed/link construction (e.g. "/embed/bph"). */
  basePath: string;
  /** UBN → {id, slug} map for the catalogue browser's "digitised copy" hyperlinks. */
  digitizedUbns: Record<string, { id: string; slug: string }>;
  /** Tenant slug for nested book URLs. */
  tenantSlug?: string;
}

export default function BphUnifiedCatalogue({
  mode,
  catalogTotal,
  digitizedTotal,
  basePath,
  digitizedUbns,
  tenantSlug,
}: Props) {
  const embedHref = useEmbedHref();

  // Each mode keeps its own URL params; switching modes drops the other set.
  const allHref = embedHref(`${basePath}?view=catalog`);
  const digitizedHref = embedHref(`${basePath}?view=books`);

  // For mode='all' the catalogue table owns its own filtered count
  // (the count drops as the user types in search). Hoist it up via a
  // callback so the unified header can show "X of 27,706 works".
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  const visibleTotal =
    mode === 'all' ? (filteredTotal ?? catalogTotal) : digitizedTotal;

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl text-primary font-display">
          Library Catalogue
        </h2>
        <p className="text-sm text-muted mt-1">
          Complete catalogue of the Bibliotheca Philosophica Hermetica.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <SegmentedToggle mode={mode} allHref={allHref} digitizedHref={digitizedHref} />

        <div className="flex items-center ml-auto gap-3">
          <span className="text-sm text-muted">
            <span className="font-medium text-primary">{visibleTotal.toLocaleString()}</span>{' '}
            of {catalogTotal.toLocaleString()} works
          </span>
          <ViewIcons mode={mode} allHref={allHref} digitizedHref={digitizedHref} />
        </div>
      </div>

      {mode === 'all' && (
        <BphCatalogBrowser
          basePath={basePath}
          digitizedUbns={digitizedUbns}
          tenantSlug={tenantSlug}
          onTotalChange={setFilteredTotal}
          hideInlineCount
        />
      )}
      {/* mode='digitized': SharedLibraryView renders the books grid below us. */}
    </>
  );
}

function SegmentedToggle({
  mode,
  allHref,
  digitizedHref,
}: {
  mode: CatalogueMode;
  allHref: string;
  digitizedHref: string;
}) {
  const base =
    'px-4 py-2 text-sm font-medium transition-colors';
  const active = 'bg-primary text-white';
  const inactive = 'bg-white text-secondary hover:bg-warm';
  return (
    <div className="inline-flex border border-border-light rounded-md overflow-hidden">
      <Link href={allHref} className={`${base} ${mode === 'all' ? active : inactive}`}>
        Show all
      </Link>
      <Link
        href={digitizedHref}
        className={`${base} -ml-px ${mode === 'digitized' ? active : inactive}`}
      >
        Show digitised &amp; translated
      </Link>
    </div>
  );
}

function ViewIcons({
  mode,
  allHref,
  digitizedHref,
}: {
  mode: CatalogueMode;
  allHref: string;
  digitizedHref: string;
}) {
  const base =
    'inline-flex items-center justify-center w-9 h-9 transition-colors border border-border-light';
  const active = 'bg-primary text-white border-primary';
  const inactive = 'bg-white text-muted hover:text-primary hover:bg-warm';
  return (
    <div className="inline-flex">
      <Link
        href={allHref}
        title="List view (all 27,706 works)"
        aria-label="List view"
        className={`${base} rounded-l-md ${mode === 'all' ? active : inactive}`}
      >
        <List className="w-4 h-4" />
      </Link>
      <Link
        href={digitizedHref}
        title="Grid view (digitised & translated)"
        aria-label="Grid view"
        className={`${base} rounded-r-md -ml-px ${mode === 'digitized' ? active : inactive}`}
      >
        <LayoutGrid className="w-4 h-4" />
      </Link>
    </div>
  );
}
