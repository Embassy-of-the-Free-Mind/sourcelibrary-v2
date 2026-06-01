import SiteHeader from '@/components/layout/SiteHeader';

export default function CuratedLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="bg-warm border-b border-border-light">
        <div className="max-w-[1500px] mx-auto px-6 pt-8 pb-10 sm:pb-12">
          <div className="h-14 sm:h-16 w-72 bg-stone-300/30 rounded-lg animate-pulse mb-3" />
          <div className="h-5 w-96 max-w-full bg-stone-300/20 rounded animate-pulse" />
        </div>
      </div>

      {/* Collection cards */}
      <div className="max-w-[1500px] mx-auto px-6 py-10">
        <div className="grid gap-6 grid-cols-1 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden aspect-[3/2] bg-stone-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
