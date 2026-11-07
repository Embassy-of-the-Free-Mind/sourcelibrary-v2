import FeaturedPreview, { type FeaturedItem } from '../_components/FeaturedPreview';
import { collectionModel, dataFile } from '../_lib/data';
import type { CollectionBook } from '@/components/CollectionBookCard';

export default function Page() {
  const s = dataFile<{ entries: { collection: string; start: string; end: string }[] }>('schedule');
  const items: FeaturedItem[] = (s?.entries ?? []).flatMap((e) => {
    const m = collectionModel(e.collection);
    return m ? [{ slug: m.slug, name: m.name, deck: m.deck, start: e.start, end: e.end, tiles: m.heroTiles, books: m.books as unknown as CollectionBook[], plates: m.plates, total: m.stats.works }] : [];
  });
  return <div className="bg-cream min-h-screen"><FeaturedPreview items={items} /></div>;
}
