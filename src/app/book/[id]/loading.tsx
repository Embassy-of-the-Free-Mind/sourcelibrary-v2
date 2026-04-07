import SiteHeader from '@/components/layout/SiteHeader';

export default function BookDetailLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb skeleton */}
        <div className="h-4 w-48 bg-stone-200 rounded animate-pulse mb-6" />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column: cover + metadata */}
          <div className="space-y-4">
            <div className="aspect-[3/4] bg-stone-200 rounded-lg animate-pulse" />
            <div className="space-y-2">
              <div className="h-3 w-full bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-2/3 bg-stone-200 rounded animate-pulse" />
            </div>
          </div>

          {/* Right column: title, author, description */}
          <div className="lg:col-span-2 space-y-4">
            <div className="h-10 w-3/4 bg-stone-200 rounded animate-pulse" />
            <div className="h-5 w-1/3 bg-stone-200 rounded animate-pulse" />
            <div className="h-4 w-1/4 bg-stone-100 rounded animate-pulse" />

            <div className="mt-8 space-y-3">
              <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
              <div className="h-4 w-5/6 bg-stone-200 rounded animate-pulse" />
              <div className="h-4 w-4/6 bg-stone-200 rounded animate-pulse" />
            </div>

            {/* Page thumbnails skeleton */}
            <div className="mt-8">
              <div className="h-6 w-32 bg-stone-200 rounded animate-pulse mb-4" />
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
