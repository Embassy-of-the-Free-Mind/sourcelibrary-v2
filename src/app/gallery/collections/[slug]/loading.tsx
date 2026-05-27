import SiteHeader from '@/components/layout/SiteHeader';

export default function GalleryCollectionDetailLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <SiteHeader variant="dark" breadcrumbs={[{ label: 'Gallery', href: '/gallery' }]} />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Description skeleton */}
        <div className="mb-8 max-w-3xl space-y-2">
          <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-4/5 bg-stone-200 rounded animate-pulse" />
        </div>

        {/* Image grid skeleton */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="rounded-lg overflow-hidden">
              <div className="aspect-square bg-stone-200 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
