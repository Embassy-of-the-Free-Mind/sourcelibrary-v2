import SiteHeader from '@/components/layout/SiteHeader';

export default function LibrariesLoading() {
  return (
    <div className="min-h-screen bg-stone-50">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="relative overflow-hidden text-white py-16 md:py-20">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-[var(--container-wide)] mx-auto px-6">
          <div className="h-12 w-64 bg-white/15 rounded-lg animate-pulse mb-4" />
          <div className="h-6 w-96 max-w-full bg-white/10 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-[var(--container-wide)] mx-auto px-6 py-12 space-y-8">
        {/* Hero library card */}
        <div className="aspect-[21/9] md:aspect-[3/1] bg-stone-200 rounded-xl animate-pulse" />

        {/* Featured card */}
        <div className="aspect-[21/9] bg-stone-200 rounded-xl animate-pulse" />

        {/* Digital sources grid */}
        <div>
          <div className="h-7 w-40 bg-stone-200 rounded animate-pulse mb-4" />
          <div className="grid gap-5 grid-cols-1 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="aspect-[4/3] bg-stone-200 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
