import SiteHeader from '@/components/layout/SiteHeader';

export default function ExploreLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-10 w-48 bg-stone-200 rounded animate-pulse mb-2" />
        <div className="h-5 w-96 bg-stone-100 rounded animate-pulse mb-8" />

        {/* Cards grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden border border-stone-200">
              <div className="aspect-[4/3] bg-stone-200 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-5 w-2/3 bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-full bg-stone-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
