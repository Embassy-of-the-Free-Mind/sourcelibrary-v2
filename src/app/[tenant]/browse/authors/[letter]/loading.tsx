import SiteHeader from '@/components/layout/SiteHeader';

export default function BrowseAuthorsLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-10 w-64 bg-stone-200 rounded animate-pulse mb-6" />

        {/* Letter nav */}
        <div className="flex gap-2 flex-wrap mb-8">
          {Array.from({ length: 26 }).map((_, i) => (
            <div key={i} className="h-8 w-8 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>

        {/* Author list */}
        <div className="space-y-3">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <div className="h-5 w-1/3 bg-stone-200 rounded animate-pulse" />
              <div className="h-3 w-1/5 bg-stone-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
