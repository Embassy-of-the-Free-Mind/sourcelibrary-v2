'use client';

/**
 * Unified BPH catalogue. Two independent dimensions:
 *
 *   FILTER (view)        Show all (catalog)  vs  Show digitised & translated (books)
 *   DISPLAY (display)    List  vs  Grid
 *
 * BphCatalogBrowser renders the same search/filter chrome in both displays so
 * the top of the page doesn't shift between views. In list mode it also renders
 * the catalogue table; in grid mode it renders a covers grid driven by the
 * same Supabase data, so search + Advanced filter the covers live.
 *
 * The two dimensions are independent. The List/Grid display toggle never
 * changes the filter — grid shows a placeholder tile for works that have no
 * cover, so it works on the full catalogue too. The only cross-link is a
 * convenience: applying "Show digitised & translated" from the full catalogue
 * switches to Grid once (see digitizedDisplay below).
 */

import { useRouter } from 'next/navigation';
import { LayoutGrid, List } from 'lucide-react';
import BphCatalogBrowser from '@/components/libraries/BphCatalogBrowser';
import { useEmbedHref } from '@/lib/EmbedContext';

export type CatalogueMode = 'all' | 'digitized';
export type CatalogueDisplay = 'list' | 'grid';

interface Props {
  /** "all" → no filter, full catalogue. "digitized" → SL-digitised subset only. */
  mode: CatalogueMode;
  /** "list" → catalogue table. "grid" → covers grid. Independent of mode. */
  display: CatalogueDisplay;
  /** Total works in bph_works (denominator for the counter, regardless of mode). */
  catalogTotal: number;
  /** basePath for embed/link construction (e.g. "/embed/bph"). */
  basePath: string;
  /** UBN → {id, slug} map for the catalogue browser's "digitised copy" hyperlinks. */
  digitizedUbns: Record<string, { id: string; slug: string }>;
  /** Tenant slug for nested book URLs. */
  tenantSlug?: string;
}

/** Build a `?view=…&display=…` URL while carrying every other param from the
    *current* `window.location.search` through. `BphCatalogBrowser` owns its
    own state — search (`cq`), sort (`csort`), keyword, advanced filters,
    offset — and persists it via `window.history.replaceState` to `c*`-prefixed
    params. That replaceState path bypasses Next's router, so `useSearchParams`
    in this parent stays at the *initial* URL the user landed on. Reading
    `window.location.search` at click time is the only way to capture the live
    in-flight search.

    SSR-safe: returns a no-param URL when `window` is unavailable, so a click
    handler that runs in the browser always wins over the render-time href. */
function makeHref(basePath: string, view: 'catalog' | 'books', display: CatalogueDisplay): string {
  const live = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : new URLSearchParams();
  live.set('view', view);
  live.set('display', display);
  return `${basePath}?${live.toString()}`;
}

export default function BphUnifiedCatalogue({
  mode,
  display,
  catalogTotal,
  basePath,
  digitizedUbns,
  tenantSlug,
}: Props) {
  const embedHref = useEmbedHref();
  const router = useRouter();

  // "Show all" forces list display: the full 27,706-work catalogue reads best
  // as a list, so entering it always lands on the table.
  //
  // Applying "Show digitised & translated" switches to Grid the FIRST time
  // only — i.e. on the transition from the full catalogue (mode 'all') into
  // the digitised subset. Once already in digitised, the toggle preserves the
  // user's current display so it never re-forces grid on a repeat click.
  //
  // The List/Grid icons change the DISPLAY only and preserve the current
  // filter (mode). Grid renders a placeholder tile for works without a cover,
  // so it no longer needs to force the digitised subset — selecting a display
  // never touches the filter.
  //
  // Hrefs are built fresh at render and at click time. Render-time hrefs
  // power middle-click and `view-source` correctly when the user lands on
  // a URL with `?cq=…` etc. baked in. Click-time hrefs (computed in
  // `navigateToggle`) cover the case where BphCatalogBrowser has updated
  // `window.location.search` via replaceState since the last render — that
  // mutation is invisible to Next's `useSearchParams`, so we read it
  // directly from `window.location.search` at click.
  const digitizedDisplay: CatalogueDisplay = mode === 'all' ? 'grid' : display;
  const toggleView: 'catalog' | 'books' = mode === 'digitized' ? 'books' : 'catalog';
  const allHref = embedHref(makeHref(basePath, 'catalog', 'list'));
  const digitizedHref = embedHref(makeHref(basePath, 'books', digitizedDisplay));
  const listHref = embedHref(makeHref(basePath, toggleView, 'list'));
  const gridHref = embedHref(makeHref(basePath, toggleView, 'grid'));

  const navigateToggle = (e: React.MouseEvent<HTMLAnchorElement>, view: 'catalog' | 'books', newDisplay: CatalogueDisplay) => {
    // Only intercept primary-button, unmodified clicks. Let middle-click,
    // cmd/ctrl-click, shift-click etc. follow the href so "open in new tab"
    // and similar still work — they use the render-time href, which is
    // already correct for the initial URL state.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    router.push(embedHref(makeHref(basePath, view, newDisplay)));
  };

  const toggleNode = (
    <SegmentedToggle
      mode={mode}
      digitizedDisplay={digitizedDisplay}
      allHref={allHref}
      digitizedHref={digitizedHref}
      onNavigate={navigateToggle}
    />
  );
  const viewIconsNode = (
    <ViewIcons
      display={display}
      toggleView={toggleView}
      listHref={listHref}
      gridHref={gridHref}
      onNavigate={navigateToggle}
    />
  );

  // The filter is locked to the digitised subset only when the user has
  // explicitly chosen it via "Show digitised & translated" (mode 'digitized').
  // Display no longer drives this — a grid in "Show all" shows the full
  // catalogue with placeholder tiles for works that have no cover.
  const effectiveLockDigitized = mode === 'digitized';

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

      <BphCatalogBrowser
        // Remount when filter or display flips so internal state (incl.
        // `adv.digitized` seeded from lockDigitized) resets cleanly.
        key={`bph-cat-${mode}-${display}`}
        basePath={basePath}
        digitizedUbns={digitizedUbns}
        tenantSlug={tenantSlug}
        hideInlineCount
        searchRowSlot={toggleNode}
        resultsHeaderSlot={viewIconsNode}
        catalogTotal={catalogTotal}
        lockDigitized={effectiveLockDigitized}
        display={display}
      />
    </>
  );
}

function SegmentedToggle({
  mode,
  digitizedDisplay,
  allHref,
  digitizedHref,
  onNavigate,
}: {
  mode: CatalogueMode;
  /** Display to land on when entering the digitised subset — 'grid' on the
      first transition from the full catalogue, otherwise the current display. */
  digitizedDisplay: CatalogueDisplay;
  allHref: string;
  digitizedHref: string;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, view: 'catalog' | 'books', newDisplay: CatalogueDisplay) => void;
}) {
  const base =
    'px-4 py-2 text-sm font-medium transition-colors';
  const active = 'bg-primary text-white';
  const inactive = 'bg-white text-secondary hover:bg-warm';
  return (
    <div className="inline-flex border border-border-light rounded-md overflow-hidden">
      <a
        href={allHref}
        onClick={(e) => onNavigate(e, 'catalog', 'list')}
        className={`${base} ${mode === 'all' ? active : inactive}`}
      >
        Show all
      </a>
      <a
        href={digitizedHref}
        onClick={(e) => onNavigate(e, 'books', digitizedDisplay)}
        className={`${base} -ml-px ${mode === 'digitized' ? active : inactive}`}
      >
        Show digitised &amp; translated
      </a>
    </div>
  );
}

function ViewIcons({
  display,
  toggleView,
  listHref,
  gridHref,
  onNavigate,
}: {
  display: CatalogueDisplay;
  /** The view both display icons preserve — switching display never changes
      the filter, so List and Grid stay on whichever filter is active. */
  toggleView: 'catalog' | 'books';
  listHref: string;
  gridHref: string;
  onNavigate: (e: React.MouseEvent<HTMLAnchorElement>, view: 'catalog' | 'books', newDisplay: CatalogueDisplay) => void;
}) {
  // Labeled segmented control rather than icon-only buttons. Icon-only
  // toggles read as decoration to readers who aren't already looking for
  // a view switcher, so we pair each icon with its label.
  const base =
    'inline-flex items-center gap-1.5 px-3 h-9 text-sm transition-colors border border-border-light';
  const active = 'bg-primary text-white border-primary';
  const inactive = 'bg-white text-muted hover:text-primary hover:bg-warm';
  return (
    <div className="inline-flex" role="group" aria-label="Display mode">
      <a
        href={listHref}
        onClick={(e) => onNavigate(e, toggleView, 'list')}
        aria-label="List view"
        aria-current={display === 'list' ? 'page' : undefined}
        className={`${base} rounded-l-md ${display === 'list' ? active : inactive}`}
      >
        <List className="w-4 h-4" />
        <span>List</span>
      </a>
      <a
        href={gridHref}
        onClick={(e) => onNavigate(e, toggleView, 'grid')}
        aria-label="Grid view"
        aria-current={display === 'grid' ? 'page' : undefined}
        className={`${base} rounded-r-md -ml-px ${display === 'grid' ? active : inactive}`}
      >
        <LayoutGrid className="w-4 h-4" />
        <span>Grid</span>
      </a>
    </div>
  );
}
