import SiteHeader from '@/components/layout/SiteHeader';

export default function TopicDetailLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />

      {/* Hero */}
      <div className="relative overflow-hidden text-white py-12">
        <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        <div className="relative max-w-5xl mx-auto px-6">
          <div className="h-4 w-20 bg-white/10 rounded animate-pulse mb-6" />
          <div className="h-10 sm:h-12 w-2/3 bg-white/15 rounded-lg animate-pulse mb-3" />
          <div className="h-5 w-32 bg-white/10 rounded animate-pulse" />
        </div>
      </div>

      {/* Content with sidebar */}
      <div className="max-w-5xl mx-auto px-6 py-10">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Main content */}
          <div className="flex-1">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex gap-3 p-3 rounded-lg">
                  <div className="w-12 h-16 bg-stone-200 rounded animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-4 w-3/4 bg-stone-200 rounded animate-pulse" />
                    <div className="h-3 w-1/2 bg-stone-100 rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Sidebar */}
          <div className="lg:w-64 space-y-3">
            <div className="h-5 w-20 bg-stone-200 rounded animate-pulse mb-2" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 w-full bg-stone-100 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
