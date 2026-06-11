import SiteHeader from '@/components/layout/SiteHeader';

// Mirrors the loaded page's layout (header + full-viewport black hero +
// dark metadata band) so rapid prev/next paging doesn't flash a light
// background between artworks.
export default function ArtworkLoading() {
  return (
    <div className="min-h-screen bg-stone-900">
      <SiteHeader variant="light" />

      {/* Hero skeleton — same black, viewport-height box as ArtworkHero */}
      <div className="bg-black flex items-center justify-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
        <div className="w-8 h-8 border-2 border-stone-800 border-t-stone-600 rounded-full animate-spin" />
      </div>

      {/* Metadata band skeleton — matches the stone-800→900 gradient header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 sm:py-10 space-y-4">
          <div className="h-8 w-2/3 bg-stone-700/60 rounded animate-pulse" />
          <div className="h-5 w-1/3 bg-stone-700/60 rounded animate-pulse" />
          <div className="flex gap-4">
            <div className="h-4 w-20 bg-stone-800 rounded animate-pulse" />
            <div className="h-4 w-32 bg-stone-800 rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
