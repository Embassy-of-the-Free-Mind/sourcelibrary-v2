import SiteHeader from '@/components/layout/SiteHeader';

export default function GalleryLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <SiteHeader variant="light" />

      <div className="px-4 sm:px-6 lg:px-8 py-6">
        {/* Search & filter bar skeleton */}
        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 mb-6">
          <div className="flex-1 min-w-0 sm:min-w-[200px] max-w-md h-9 bg-stone-200 rounded-lg animate-pulse" />
          <div className="min-w-0 sm:min-w-[200px] max-w-sm flex-1 h-9 bg-stone-200 rounded-lg animate-pulse" />
          <div className="h-9 w-24 bg-stone-200 rounded-lg animate-pulse" />
        </div>

        {/* Featured collections skeleton */}
        <div className="mb-8">
          <div className="h-6 w-48 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex-shrink-0 w-56 rounded-xl overflow-hidden">
                <div className="aspect-[4/3] bg-stone-200 animate-pulse" />
                <div className="p-3 space-y-1.5">
                  <div className="h-4 w-3/4 bg-stone-200 rounded animate-pulse" />
                  <div className="h-3 w-1/3 bg-stone-100 rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Image grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden">
              <div className="aspect-square bg-stone-200 animate-pulse" />
              <div className="p-2 space-y-1.5">
                <div className="h-3 w-full bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-2/3 bg-stone-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
