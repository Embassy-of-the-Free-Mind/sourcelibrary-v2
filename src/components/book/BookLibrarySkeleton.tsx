export default function BookLibrarySkeleton() {
  return (
    <>
      {/* Heading Skeleton */}
      <div className="mb-8">
        <div className="h-10 md:h-12 w-72 bg-white/60 rounded animate-pulse" />
        <div className="h-5 w-56 bg-white/60 rounded animate-pulse mt-2" />
      </div>

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

      {/* Collections Grid Skeleton */}
      <div className="grid gap-4 sm:gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[4/3] bg-white/60 rounded-lg animate-pulse" />
        ))}
      </div>
    </>
  );
}
