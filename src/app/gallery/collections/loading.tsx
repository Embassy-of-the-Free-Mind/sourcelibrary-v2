import SiteHeader from '@/components/layout/SiteHeader';

export default function GalleryCollectionsLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <SiteHeader variant="dark" breadcrumbs={[{ label: 'Gallery', href: '/gallery' }]} />

      <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Intro skeleton */}
        <div className="text-center mb-10">
          <div className="h-7 w-64 bg-stone-200 rounded animate-pulse mx-auto mb-3" />
          <div className="h-4 w-96 max-w-full bg-stone-100 rounded animate-pulse mx-auto" />
        </div>

        {/* Collection cards skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl overflow-hidden aspect-[4/3] bg-stone-200 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
