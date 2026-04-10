import SiteHeader from '@/components/layout/SiteHeader';

export default function AuthorLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Breadcrumb */}
        <div className="h-4 w-40 bg-stone-200 rounded animate-pulse mb-6" />

        {/* Author name + dates */}
        <div className="h-10 w-2/3 bg-stone-200 rounded animate-pulse mb-2" />
        <div className="h-5 w-1/4 bg-stone-100 rounded animate-pulse mb-6" />

        {/* Bio */}
        <div className="max-w-3xl space-y-3 mb-10">
          <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-4/6 bg-stone-200 rounded animate-pulse" />
        </div>

        {/* Book grid */}
        <div className="h-7 w-32 bg-stone-200 rounded animate-pulse mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-3/4 bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
