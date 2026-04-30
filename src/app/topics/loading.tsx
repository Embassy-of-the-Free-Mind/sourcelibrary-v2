import SiteHeader from '@/components/layout/SiteHeader';

export default function TopicsLoading() {
  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="relative overflow-hidden text-white py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6">
          <div className="h-12 w-48 bg-white/15 rounded-lg animate-pulse mb-4" />
          <div className="h-6 w-96 max-w-full bg-white/10 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-[var(--container-standard)] mx-auto px-6 py-12 space-y-12">
        {/* Facet sections */}
        {Array.from({ length: 3 }).map((_, s) => (
          <div key={s}>
            <div className="h-7 w-40 bg-stone-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-64 bg-stone-100 rounded animate-pulse mb-4" />
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="h-5 w-3/4 bg-stone-200 rounded animate-pulse mb-2" />
                  <div className="h-3 w-1/3 bg-stone-100 rounded animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
