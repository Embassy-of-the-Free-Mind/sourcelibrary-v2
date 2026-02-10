export default function BookLibrarySkeleton() {
  return (
    <>
      {/* Search & Filter Bar Skeleton */}
      <div className="flex flex-col lg:flex-row gap-4 mb-8">
        <div className="flex-1 flex gap-2">
          <div className="flex-1 h-12 bg-white/60 rounded-full animate-pulse" />
          <div className="w-24 h-12 bg-white/60 rounded-full animate-pulse" />
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="w-36 h-12 bg-white/60 rounded-full animate-pulse" />
          <div className="w-44 h-12 bg-white/60 rounded-full animate-pulse" />
          <div className="w-28 h-12 bg-white/60 rounded-full animate-pulse" />
        </div>
      </div>

      {/* Topic Chips Skeleton */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded-full bg-white/60 animate-pulse"
              style={{ width: `${70 + Math.random() * 60}px` }}
            />
          ))}
        </div>
      </div>

      {/* Count Skeleton */}
      <div className="mb-8">
        <div className="h-5 w-48 bg-white/60 rounded animate-pulse" />
      </div>

      {/* Book Grid Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 md:gap-8">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <div className="aspect-[3/4] bg-white/60 rounded-lg animate-pulse" />
            <div className="space-y-2">
              <div className="h-4 bg-white/60 rounded animate-pulse w-4/5" />
              <div className="h-3 bg-white/60 rounded animate-pulse w-3/5" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
