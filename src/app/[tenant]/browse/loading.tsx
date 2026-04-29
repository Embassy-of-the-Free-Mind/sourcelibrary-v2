import SiteHeader from '@/components/layout/SiteHeader';

export default function BrowseLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-4xl mx-auto px-6 md:px-12 py-12 md:py-20">
        <div className="h-10 w-48 bg-stone-200 rounded animate-pulse mb-2" />
        <div className="h-5 w-80 bg-stone-100 rounded animate-pulse mb-12" />

        {/* By Title section */}
        <div className="mb-10">
          <div className="h-6 w-24 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 26 }).map((_, i) => (
              <div key={i} className="h-8 w-8 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
        </div>

        {/* By Author section */}
        <div className="mb-10">
          <div className="h-6 w-28 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 26 }).map((_, i) => (
              <div key={i} className="h-8 w-8 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
        </div>

        {/* By Artist section */}
        <div className="mb-10">
          <div className="h-6 w-24 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 26 }).map((_, i) => (
              <div key={i} className="h-8 w-8 bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
        </div>

        {/* By Period section */}
        <div>
          <div className="h-6 w-28 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-stone-200 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
