import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';

export default function CollectionDetailLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <ConditionalSiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <div className="h-4 w-32 bg-stone-200 rounded animate-pulse mb-6" />

        {/* Hero area */}
        <div className="mb-8">
          <div className="h-10 w-2/3 bg-stone-200 rounded animate-pulse mb-3" />
          <div className="h-5 w-full max-w-2xl bg-stone-100 rounded animate-pulse mb-2" />
          <div className="h-5 w-4/5 max-w-2xl bg-stone-100 rounded animate-pulse" />
        </div>

        {/* Book grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[3/4] bg-stone-200 rounded-lg animate-pulse" />
              <div className="h-3 w-3/4 bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
