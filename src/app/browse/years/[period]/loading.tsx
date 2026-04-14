import SiteHeader from '@/components/layout/SiteHeader';

export default function BrowseYearsLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-10 w-72 bg-stone-200 rounded animate-pulse mb-6" />

        {/* Period nav */}
        <div className="flex gap-2 flex-wrap mb-8">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 w-24 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>

        {/* Book list */}
        <div className="space-y-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="flex gap-4 items-center">
              <div className="h-12 w-9 bg-stone-200 rounded animate-pulse flex-shrink-0" />
              <div className="flex-1 space-y-1">
                <div className="h-4 w-2/3 bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-stone-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
