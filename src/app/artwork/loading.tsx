import SiteHeader from '@/components/layout/SiteHeader';

export default function ArtworkIndexLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="h-10 w-48 bg-stone-200 rounded animate-pulse mb-2" />
        <div className="h-5 w-96 max-w-full bg-stone-100 rounded animate-pulse mb-10" />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden border border-stone-200 bg-white">
              <div className="aspect-[16/9] bg-stone-200 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
