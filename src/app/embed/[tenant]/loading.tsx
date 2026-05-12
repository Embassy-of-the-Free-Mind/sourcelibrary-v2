/**
 * Suspense fallback for /embed/[tenant] cold loads and intra-iframe navigation.
 *
 * Aligned with the catalogue render path (the dominant view on BPH and other
 * partner subdomains via `?view=catalog`): heading + search row + table.
 *
 * The hero band, Illustrations strip, and Selected Books row are intentionally
 * omitted. On `?view=catalog` / `?view=books` they don't render at all, so any
 * placeholder for them would flash and disappear. On the bare-root landing
 * they DO render, but they live above the catalogue — the real content drops
 * in above the skeleton as SSR completes, mirroring the existing hero pop-in.
 *
 * Column proportions match BphCatalogBrowser's table (Title 5, Author 3,
 * Year 1, Place 2, Shelfmark 1 — responsive cols collapse on narrow screens
 * just like the real table).
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

                {/* Table — header row + 10 data rows matching column proportions */}
                <div className="border border-border-light rounded-lg overflow-hidden bg-white">
                    <div className="grid grid-cols-12 gap-3 px-3 py-2.5 border-b border-border-light bg-warm animate-pulse">
                        <div className="col-span-5 h-3.5 bg-border-light rounded" />
                        <div className="col-span-3 h-3.5 bg-border-light rounded hidden sm:block" />
                        <div className="col-span-1 h-3.5 bg-border-light rounded" />
                        <div className="col-span-2 h-3.5 bg-border-light rounded hidden md:block" />
                        <div className="col-span-1 h-3.5 bg-border-light rounded hidden md:block" />
                    </div>
                    {Array.from({ length: 10 }).map((_, i) => (
                        <div
                            key={i}
                            className="grid grid-cols-12 gap-3 px-3 py-3 border-b border-border-light last:border-b-0 animate-pulse"
                        >
                            <div className="col-span-5 h-4 bg-warm rounded" />
                            <div className="col-span-3 h-4 bg-warm rounded hidden sm:block" />
                            <div className="col-span-1 h-4 bg-warm rounded" />
                            <div className="col-span-2 h-4 bg-warm rounded hidden md:block" />
                            <div className="col-span-1 h-4 bg-warm rounded hidden md:block" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
