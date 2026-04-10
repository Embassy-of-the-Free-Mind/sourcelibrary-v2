import SiteHeader from '@/components/layout/SiteHeader';

export default function CollectionsIndexLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="relative overflow-hidden text-white py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="h-12 w-64 bg-white/15 rounded-lg animate-pulse mb-3" />
          <div className="h-6 w-96 bg-white/10 rounded animate-pulse" />
        </div>
      </div>

      {/* Collection grid */}
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden">
              <div className="aspect-[16/9] bg-stone-200 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-5 w-3/4 bg-stone-200 rounded animate-pulse" />
                <div className="h-3 w-full bg-stone-100 rounded animate-pulse" />
                <div className="h-3 w-1/3 bg-stone-100 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
