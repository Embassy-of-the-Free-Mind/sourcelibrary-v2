import SiteHeader from '@/components/layout/SiteHeader';

export default function CollectionLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />

      {/* Hero skeleton */}
      <div className="relative bg-dark overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-transparent" />
        <div className="relative max-w-7xl mx-auto px-6 pt-8 pb-12 sm:pb-16">
          <div className="h-4 w-16 bg-white/10 rounded mb-8 animate-pulse" />
          <div className="h-12 sm:h-14 w-2/3 bg-white/15 rounded-lg mb-3 animate-pulse" />
          <div className="h-6 w-1/2 bg-white/10 rounded mb-4 animate-pulse" />
          <div className="flex gap-4 mt-6">
            <div className="h-5 w-24 bg-white/10 rounded animate-pulse" />
            <div className="h-5 w-32 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Description skeleton */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="max-w-3xl space-y-3">
          <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-4/6 bg-stone-200 rounded animate-pulse" />
        </div>

        {/* Book grid skeleton */}
        <div className="mt-12">
          <div className="h-8 w-48 bg-stone-200 rounded mb-6 animate-pulse" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <div className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-3/4 bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
