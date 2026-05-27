import SiteHeader from '@/components/layout/SiteHeader';

export default function EncyclopediaEntryLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        {/* Entity name + type badge */}
        <div className="h-10 w-1/2 bg-stone-200 rounded animate-pulse mb-2" />
        <div className="h-5 w-20 bg-stone-100 rounded-full animate-pulse mb-6" />

        {/* Description */}
        <div className="space-y-3 mb-10">
          <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-3/4 bg-stone-200 rounded animate-pulse" />
        </div>

        {/* Books section */}
        <div className="h-7 w-40 bg-stone-200 rounded animate-pulse mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
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
