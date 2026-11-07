import HomeLayouts, { type HomeFeature } from '../_components/HomeLayouts';
import { collectionModel, dataFile, indexItems } from '../_lib/data';

interface Sorted { source: string; slug: string; proposed: string }
import { getBookThumbnailUrl } from '@/lib/utils';

export default function Page() {
  const s = dataFile<{ entries: { collection: string }[] }>('schedule');
  const features: HomeFeature[] = (s?.entries ?? []).flatMap((e) => {
    const m = collectionModel(e.collection);
    if (!m) return [];
    return [{
      slug: m.slug, name: m.name, deck: m.deck,
      plates: m.plates.slice(0, 12).flatMap((p) => { const src = (Array.isArray(p.fallback) ? p.fallback[0] : p.fallback) || p.src; return src ? [{ src, ratio: p.w && p.h ? p.w / p.h : 0.75 }] : []; }),
      works: m.stats.works, images: m.stats.images, years: m.stats.years, firstTranslations: m.stats.firstTranslations,
      books: m.books.slice(0, 16).flatMap((b) => { const cover = getBookThumbnailUrl(b); return cover ? [{ id: b.id as string, href: `/book/${b.slug || b.id}`, cover, title: b.display_title || b.title, author: b.author || '', year: b.year }] : []; }),
    }];
  });
  /* No weekly figures exist yet, so this order is a stand-in. */
  const sorted = (dataFile<{ records: Sorted[] }>('sorting')?.records ?? []).filter((r) => r.source === 'collection');
  const popular = indexItems(new Map(sorted.map((r) => [r.slug, r.proposed]))).filter((i) => i.thumbs.length >= 4 && i.books > 0).slice(0, 10);
  return (
    <>
      <HomeLayouts features={features} popular={popular} />
      <p className="max-w-3xl mx-auto px-6 py-6 text-sm text-muted">The collections are real, but the order under Popular this week is a stand-in until there are weekly figures.</p>
    </>
  );
}
