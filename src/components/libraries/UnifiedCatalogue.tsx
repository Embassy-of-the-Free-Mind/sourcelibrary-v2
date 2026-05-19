'use client';

// Generic tenant catalogue shell, modelled on BphUnifiedCatalogue. Hosts the
// Library Catalogue heading + the segmented "Show all / Show digitised &
// translated" toggle + the list/grid view icons, and renders CatalogBrowser
// for the actual table or covers grid.
//
// FILTER (view)        Show all (catalog)  vs  Show digitised & translated (books)
// DISPLAY (display)    List  vs  Grid

import Link from 'next/link';
import { LayoutGrid, List } from 'lucide-react';
import CatalogBrowser from '@/components/libraries/CatalogBrowser';
import { useEmbedHref } from '@/lib/EmbedContext';

export type CatalogueMode = 'all' | 'digitized';
export type CatalogueDisplay = 'list' | 'grid';

interface Props {
  /** Tenant slug — used for the API path `/api/catalog/${tenant}`. */
  tenant: string;
  /** "all" → no filter, full catalogue. "digitized" → SL-digitised subset only. */
  mode: CatalogueMode;
  /** "list" → catalogue table. "grid" → covers grid. Independent of mode. */
  display: CatalogueDisplay;
  /** Total catalogue rows for this tenant. Denominator for the counter. */
  catalogTotal: number;
  /** basePath for embed/link construction (e.g. "/embed/kloss-collection"). */
  basePath: string;
  /** catalog_id → {id, slug} map for digitised books (live-Mongo override). */
  digitizedIds: Record<string, { id: string; slug: string }>;
  /** Tenant slug for nested book URLs (defaults to tenant). */
  tenantSlug?: string;
  /** Library name shown in the catalogue heading subtitle. */
  libraryName: string;
  /** Optional curated subject-keyword dropdown options. */
  keywordOptions?: Array<{ value: string; label: string }>;
}

function makeHref(basePath: string, view: 'catalog' | 'books', display: CatalogueDisplay) {
  return `${basePath}?view=${view}&display=${display}`;
}

export default function UnifiedCatalogue({
  tenant,
  mode,
  display,
  catalogTotal,
  basePath,
  digitizedIds,
  tenantSlug,
  libraryName,
  keywordOptions,
}: Props) {
  const embedHref = useEmbedHref();

  // "Show all" forces list display: grid only renders rows with thumbnails
  // (the digitised subset). The grid icon is the inverse case — grid only
  // makes sense on the digitised subset, so clicking grid lands on view=books.
  const allHref = embedHref(makeHref(basePath, 'catalog', 'list'));
  const digitizedHref = embedHref(makeHref(basePath, 'books', display));
  const listHref = embedHref(makeHref(basePath, mode === 'digitized' ? 'books' : 'catalog', 'list'));
  const gridHref = embedHref(makeHref(basePath, 'books', 'grid'));

  const toggleNode = (
    <SegmentedToggle mode={mode} allHref={allHref} digitizedHref={digitizedHref} />
  );
  const viewIconsNode = (
    <ViewIcons display={display} listHref={listHref} gridHref={gridHref} />
  );

  // Grid view shows only the digitised subset (covers only exist for
  // SL-backed books). Lock the catalogue filter to digitised so the count
  // reflects what's visible.
  const effectiveLockDigitized = mode === 'digitized' || display === 'grid';

  return (
    <>
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl text-primary font-display">
          Library Catalogue
        </h2>
        <p className="text-sm text-muted mt-1">
          Complete catalogue of the {libraryName}.
        </p>
      </div>

      <CatalogBrowser
        key={`cat-${tenant}-${mode}-${display}`}
        tenant={tenant}
        digitizedIds={digitizedIds}
        tenantSlug={tenantSlug}
        hideInlineCount
        searchRowSlot={toggleNode}
        resultsHeaderSlot={viewIconsNode}
        catalogTotal={catalogTotal}
        lockDigitized={effectiveLockDigitized}
        display={display}
        keywordOptions={keywordOptions}
      />
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
  const base = 'px-4 py-2 text-sm font-medium transition-colors';
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
  const base = 'inline-flex items-center justify-center w-9 h-9 transition-colors border border-border-light';
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
