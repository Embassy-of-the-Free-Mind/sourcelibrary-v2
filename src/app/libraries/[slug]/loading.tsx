import SiteHeader from '@/components/layout/SiteHeader';

export default function LibraryDetailLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />

      {/* Hero */}
      <div className="bg-dark overflow-hidden">
        <div className="bg-gradient-to-b from-black/70 via-black/40 to-transparent">
          <div className="max-w-[1500px] mx-auto px-6 pt-8 pb-12 sm:pb-16">
            <div className="h-4 w-20 bg-white/10 rounded animate-pulse mb-6" />
            <div className="h-14 sm:h-16 w-2/3 bg-white/15 rounded-lg animate-pulse mb-3" />
            <div className="h-5 w-48 bg-white/10 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Gallery strip */}
      <div className="bg-warm border-b border-border-light">
        <div className="max-w-[1500px] mx-auto px-6 py-6">
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square bg-stone-200 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>

      {/* Book grid */}
      <div className="max-w-[1500px] mx-auto px-6 py-10">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 10 }).map((_, i) => (
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
