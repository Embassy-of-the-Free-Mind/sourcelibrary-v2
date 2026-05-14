/**
 * Suspense fallback for /embed/[tenant] cold loads and intra-iframe navigation.
 *
 * Scope: heading + search/filter row + results header only. The table itself
 * is intentionally NOT skeletoned here — BphCatalogBrowser is a client
 * component that fetches from /api/catalog/bph after hydration and renders
 * its own table-row skeleton while loading. Including a second table skeleton
 * here causes a visible flicker as the outer (`bg-warm` bars) is replaced by
 * the inner (`bg-border-light/40` bars inside a real <table> with real
 * column headers).
 *
 * Hero, Illustrations strip, and Selected Books row are also omitted. On
 * `?view=catalog` / `?view=books` they don't render; on the bare-root
 * landing they pop in above the catalogue when SSR completes, same way
 * the hero already did.
 */
export default function EmbedTenantLoading() {
    return (
        <div className="min-h-screen bg-cream" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading library…</span>

            <div className="max-w-7xl mx-auto px-6 py-10">
                {/* Heading block — "Library Catalogue" + description */}
                <div className="mb-6">
                    <div className="h-8 sm:h-9 w-56 bg-warm rounded animate-pulse" />
                    <div className="h-4 w-2/3 max-w-2xl bg-warm rounded mt-2 animate-pulse" />
                </div>

                {/* Search / filter row — search input, keyword select,
                    Show all / Show digitised segmented toggle, Advanced. */}
                <div className="flex flex-wrap items-center gap-3 mb-3">
                    <div className="h-10 flex-1 min-w-[14rem] max-w-xl bg-white border border-border-light rounded-md animate-pulse" />
                    <div className="h-10 w-32 bg-white border border-border-light rounded-md animate-pulse" />
                    <div className="h-10 w-64 bg-white border border-border-light rounded-md animate-pulse" />
                    <div className="h-10 w-28 bg-white border border-border-light rounded-md animate-pulse" />
                </div>

                {/* Results header — count on the left, sort + list/grid icons on the right */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="h-4 w-44 bg-warm rounded animate-pulse" />
                    <div className="flex items-center gap-3 ml-auto">
                        <div className="h-9 w-40 bg-white border border-border-light rounded-md animate-pulse" />
                        <div className="h-9 w-[72px] bg-white border border-border-light rounded-md animate-pulse" />
                    </div>
                </div>

                {/* Table is rendered by BphCatalogBrowser with its own internal
                    skeleton — see BphCatalogBrowser line ~569. No outer table
                    skeleton here on purpose. */}
            </div>
        </div>
    );
}
