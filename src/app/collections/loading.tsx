import SiteHeader from '@/components/layout/SiteHeader';

export default function CollectionsIndexLoading() {
  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="relative overflow-hidden text-white py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-standard)] mx-auto px-6">
          <div className="h-12 w-64 bg-white/15 rounded-lg animate-pulse mb-4" />
          <div className="h-6 w-96 max-w-full bg-white/10 rounded animate-pulse" />
        </div>
      </div>

      {/* Collection grid */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 py-12">
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden aspect-[4/3] bg-stone-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
