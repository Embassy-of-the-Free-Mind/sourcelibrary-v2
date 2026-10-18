import SiteHeader from '@/components/layout/SiteHeader';

// Shown the moment someone taps Library. The page reads its `collection`
// filter from the URL, so it renders on request; without this the click sat
// on the old page for the whole render (~5s measured 2026-10-18).
export default function CatalogLoading() {
  return (
    <>
      <SiteHeader variant="light" />
      <div className="max-w-[1500px] mx-auto px-6 md:px-12 py-12 md:py-20" aria-busy="true">
        <div className="h-10 w-40 bg-stone-200 animate-pulse mb-3" />
        <div className="h-5 w-64 bg-stone-100 animate-pulse mb-10" />
        <div className="h-11 w-full max-w-xl bg-stone-100 animate-pulse mb-8" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-[2/3] bg-stone-200 animate-pulse mb-3" />
              <div className="h-4 w-4/5 bg-stone-200 animate-pulse mb-2" />
              <div className="h-3 w-1/2 bg-stone-100 animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
