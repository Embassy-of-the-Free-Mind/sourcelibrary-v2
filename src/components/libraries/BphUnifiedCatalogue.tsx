'use client';

/**
 * Unified BPH catalogue. Two independent dimensions:
 *
 *   FILTER (view)        Show all (catalog)  vs  Show digitised & translated (books)
 *   DISPLAY (display)    List  vs  Grid
 *
 * The segmented toggle changes FILTER. "Show digitised" preserves the
 * user's display choice; "Show all" forces list because grid can't actually
 * represent the full catalogue (thumbnails only exist for the digitised
 * subset). The list/grid icons change DISPLAY only — preserving the filter.
 *
 * Render matrix:
 *   filter=all     + display=list  → BphCatalogBrowser (full 27,706 works)
 *   filter=all     + display=grid  → covers grid (renders below; only the
 *                                    digitised subset has thumbnails, so
 *                                    a small note explains the gap — reached
 *                                    via the grid icon, not the filter toggle)
 *   filter=digitised + display=grid  → covers grid (digitised subset)
 *   filter=digitised + display=list  → BphCatalogBrowser locked to digitised='sl'
 *
 * The covers grid (display=grid) is rendered by SharedLibraryView's books
 * branch — we only render the unified header here. The BphCatalogBrowser
 * for display=list is rendered inside this component.
 */

import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';
import { useEmbedHref } from '@/lib/EmbedContext';
import { useState } from 'react';

export type CatalogueMode = 'all' | 'digitized';
export type CatalogueDisplay = 'list' | 'grid';

interface Props {
  /** "all" → no filter, full catalogue. "digitized" → SL-digitised subset only. */
  mode: CatalogueMode;
  /** "list" → catalogue table. "grid" → covers grid. Independent of mode. */
  display: CatalogueDisplay;
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

/** Build a `?view=…&display=…` URL preserving the other dimension's value. */
function makeHref(basePath: string, view: 'catalog' | 'books', display: CatalogueDisplay) {
  return `${basePath}?view=${view}&display=${display}`;
}

export default function BphUnifiedCatalogue({
  mode,
  display,
  catalogTotal,
  digitizedTotal,
  basePath,
  digitizedUbns,
  tenantSlug,
}: Props) {
  const embedHref = useEmbedHref();

  // "Show all" forces list display: grid only renders books with thumbnails
  // (the digitised subset), so preserving grid here would make the toggle a
  // visual no-op — the very bug a user reported as "Show all doesn't show
  // all". List is the only display that can faithfully show the full 27,706
  // works. "Show digitised" preserves display since both modes work for that
  // subset. View-icons toggle still preserves the current filter.
  const allHref = embedHref(makeHref(basePath, 'catalog', 'list'));
  const digitizedHref = embedHref(makeHref(basePath, 'books', display));
  const listHref = embedHref(makeHref(basePath, mode === 'digitized' ? 'books' : 'catalog', 'list'));
  const gridHref = embedHref(makeHref(basePath, mode === 'digitized' ? 'books' : 'catalog', 'grid'));

  // For display='list' the catalogue table owns its own filtered count
  // (the count drops as the user types in search). Hoist it up via a
  // callback so the unified header can show "X of 27,706 works".
  const [filteredTotal, setFilteredTotal] = useState<number | null>(null);
  const visibleTotal =
    display === 'list' ? (filteredTotal ?? catalogTotal) : digitizedTotal;

  const toggleNode = (
    <SegmentedToggle mode={mode} allHref={allHref} digitizedHref={digitizedHref} />
  );
  const viewIconsNode = (
    <ViewIcons display={display} listHref={listHref} gridHref={gridHref} />
  );
  const counterNode = (
    <span className="text-sm text-muted">
      <span className="font-medium text-primary">{visibleTotal.toLocaleString()}</span>{' '}
      of {catalogTotal.toLocaleString()} works
    </span>
  );

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

      {display === 'list' ? (
        // List view: BphCatalogBrowser owns the search row and now hosts both
        // the toggle (inline with filters) and the view icons (in the
        // results-header row alongside count + sort) — matching the partner
        // mockup row grouping. When mode='digitized', lock the underlying
        // browser to digitized='sl' so the table reflects the chosen filter.
        <BphCatalogBrowser
          // Remount when the filter toggles. BphCatalogBrowser seeds its
          // `adv.digitized` state from `lockDigitized` once in `useState`,
          // and has no effect to reset it when the prop flips — so without a
          // key the table keeps the previous filter and "Show all" appears
          // not to work.
          key={`bph-cat-${mode}`}
          basePath={basePath}
          digitizedUbns={digitizedUbns}
          tenantSlug={tenantSlug}
          onTotalChange={setFilteredTotal}
          hideInlineCount
          searchRowSlot={toggleNode}
          resultsHeaderSlot={viewIconsNode}
          catalogTotal={catalogTotal}
          lockDigitized={mode === 'digitized'}
        />
      ) : (
        // Grid view: the covers grid lives in SharedLibraryView (fed by
        // server-side data). Render the same row chrome ourselves so the
        // layout matches the mockup. Counter on the left, view icons on the
        // right (sort lives in CollectionFilters above the grid). When
        // mode='all' the grid still only shows the digitised subset (it's
        // the only data with thumbnails) — surface that explicitly so the
        // user understands why the count differs from "27,706 works".
        <>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            {toggleNode}
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-2">
            {counterNode}
            <div className="ml-auto">{viewIconsNode}</div>
          </div>
          {mode === 'all' && (
            <p className="text-xs text-muted mb-4">
              Grid view shows the {digitizedTotal.toLocaleString()} books with digitised scans.
              Switch to list view to browse the full catalogue.
            </p>
          )}
        </>
      )}
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
  display,
  listHref,
  gridHref,
}: {
  display: CatalogueDisplay;
  listHref: string;
  gridHref: string;
}) {
  const base =
    'inline-flex items-center justify-center w-9 h-9 transition-colors border border-border-light';
  const active = 'bg-primary text-white border-primary';
  const inactive = 'bg-white text-muted hover:text-primary hover:bg-warm';
  return (
    <div className="inline-flex">
      <Link
        href={listHref}
        title="List view"
        aria-label="List view"
        className={`${base} rounded-l-md ${display === 'list' ? active : inactive}`}
      >
        <List className="w-4 h-4" />
      </Link>
      <Link
        href={gridHref}
        title="Grid view"
        aria-label="Grid view"
        className={`${base} rounded-r-md -ml-px ${display === 'grid' ? active : inactive}`}
      >
        <LayoutGrid className="w-4 h-4" />
      </Link>
    </div>
  );
}
