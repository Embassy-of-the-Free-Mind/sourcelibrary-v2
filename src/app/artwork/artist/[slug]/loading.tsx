import SiteHeader from '@/components/layout/SiteHeader';

export default function ArtworkArtistLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 py-8">
        {/* Artist name */}
        <div className="h-10 w-64 bg-stone-200 rounded animate-pulse mb-2" />
        {/* Subtitle */}
        <div className="h-4 w-40 bg-stone-100 rounded animate-pulse mb-8" />

        {/* Artwork grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-3/4 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
