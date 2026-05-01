import SiteHeader from '@/components/layout/SiteHeader';

export default function GalleryImageLoading() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="dark" />

      {/* Image hero */}
      <div className="bg-stone-900">
        <div className="max-w-3xl mx-auto py-4 sm:py-8">
          <div className="aspect-[3/4] bg-stone-800 rounded animate-pulse flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-stone-600 border-t-stone-400 rounded-full animate-spin" />
          </div>
        </div>
        <div className="border-t border-stone-800">
          <div className="max-w-4xl mx-auto px-6 md:px-12 py-3">
            <div className="h-3 w-64 bg-stone-800 rounded animate-pulse" />
          </div>
        </div>
      </div>

      {/* Info section */}
      <div className="max-w-4xl mx-auto px-6 md:px-12 py-8 space-y-4">
        <div className="h-8 w-2/3 bg-stone-200 rounded animate-pulse" />
        <div className="h-5 w-1/3 bg-stone-200 rounded animate-pulse" />
        <div className="mt-6 space-y-3">
          <div className="h-4 w-full bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-stone-200 rounded animate-pulse" />
          <div className="h-4 w-3/4 bg-stone-200 rounded animate-pulse" />
        </div>
      </div>
    </div>
  );
}
