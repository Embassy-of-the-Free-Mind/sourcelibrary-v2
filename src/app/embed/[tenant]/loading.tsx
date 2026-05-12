/**
 * Suspense fallback for /embed/[tenant] cold loads and intra-iframe navigation.
 *
 * Mirrors the catalogue portion of {@link SharedLibraryView} so the visible
 * frame doesn't jump when real content arrives:
 *   - "Selected Books" placeholder row (6 covers)
 *   - Catalogue chrome (heading, search row with segmented toggle and
 *     list/grid icons, then table rows)
 *
 * The hero band is intentionally omitted — it only shows on the default
 * landing, and on list/grid views (no hero) a placeholder hero would cause
 * a visible band to flash during transitions. Cold load shows the catalogue
 * skeleton aligned at the page width; the real hero renders above when SSR
 * completes.
 */
export default function EmbedTenantLoading() {
    return (
        <div className="min-h-screen bg-cream" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading library…</span>

            <div className="max-w-7xl mx-auto px-6 py-10">
                {/* Selected Books row */}
                <div className="mb-10">
                    <div className="h-8 sm:h-9 w-48 bg-warm rounded animate-pulse" />
                    <div className="h-4 w-80 max-w-full bg-warm rounded mt-2 animate-pulse" />
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4 mt-4">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div
                                key={i}
                                className="aspect-[2/3] min-h-[180px] bg-warm border border-border-light rounded-lg animate-pulse"
                            />
                        ))}
                    </div>
                </div>

                {/* Library Catalogue */}
                <div className="mb-6">
                    <div className="h-8 sm:h-9 w-56 bg-warm rounded animate-pulse" />
                    <div className="h-4 w-2/3 max-w-2xl bg-warm rounded mt-2 animate-pulse" />
                </div>

                {/* Search row: input + segmented "Show all / Show digitised" toggle */}
                <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="h-10 flex-1 min-w-[220px] max-w-md bg-white border border-border-light rounded-md animate-pulse" />
                    <div className="h-10 w-64 bg-white border border-border-light rounded-md animate-pulse" />
                </div>

                {/* Results header: count + list/grid icons */}
                <div className="flex items-center justify-between mb-3">
                    <div className="h-4 w-40 bg-warm rounded animate-pulse" />
                    <div className="h-9 w-[72px] bg-white border border-border-light rounded-md animate-pulse" />
                </div>

                {/* Table rows */}
                <div className="border border-border-light rounded-md overflow-hidden bg-white">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <div
                            key={i}
                            className="grid grid-cols-12 gap-3 px-4 py-3 border-b border-border-light last:border-b-0 animate-pulse"
                        >
                            <div className="col-span-5 h-4 bg-warm rounded" />
                            <div className="col-span-3 h-4 bg-warm rounded" />
                            <div className="col-span-2 h-4 bg-warm rounded" />
                            <div className="col-span-1 h-4 bg-warm rounded" />
                            <div className="col-span-1 h-4 bg-warm rounded" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
