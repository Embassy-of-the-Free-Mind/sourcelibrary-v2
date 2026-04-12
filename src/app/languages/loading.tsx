import SiteHeader from '@/components/layout/SiteHeader';

export default function LanguagesLoading() {
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

      <div className="max-w-[var(--container-standard)] mx-auto px-6 py-12">
        {/* Major languages grid */}
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[4/3] bg-stone-200 rounded-xl animate-pulse" />
          ))}
        </div>

        {/* Other languages chips */}
        <div className="mt-10">
          <div className="h-6 w-36 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-7 w-20 bg-stone-200 rounded-full animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
