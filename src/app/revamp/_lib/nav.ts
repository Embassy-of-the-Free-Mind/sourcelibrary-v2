import { dataFile, collectionModel, snapshotSlugs } from './data';
import type { NavData, NavSubject } from '../_components/RevampHeader';

interface S { id: string; label: string; level: number; parents: string[] }
const LIBS = [['Heidelberg University Library', 3804], ['Bibliotheca Philosophica Hermetica', 2354], ['British Library', 1460], ['Harvard Houghton Library', 889], ['Vatican Apostolic Library', 770]] as const;

export function navData(): NavData {
  const list = dataFile<{ subjects: S[] }>('subjects')?.subjects ?? [];
  const subjects: NavSubject[] = list.filter((s) => s.level === 1).map((s) => ({
    id: s.id, label: s.label,
    narrower: list.filter((n) => n.level === 2 && n.parents.includes(s.id)).map((n) => ({ id: n.id, label: n.label })),
  }));
  const sched = dataFile<{ entries: { collection: string }[] }>('schedule');
  const f = sched?.entries[0] ? collectionModel(sched.entries[0].collection) : null;
  const picks = ['harmony-east-west', 'sibyls', 'sacred-plants', 'druids-megaliths']
    .filter((s) => snapshotSlugs().includes(s))
    .map((s) => { const m = collectionModel(s)!; return { slug: s, name: m.name, img: m.heroImage || m.heroTiles[0] }; });
  // One picture per way in, chosen by eye from the saved pages and plates: whole, never cropped.
  const ways: Record<string, string> = {
    Subjects: 'https://images.sourcelibrary.org/gallery/69b4c0556248be021e01eeda/69b4c0556248be021e01eee4-1-thumb.jpg?v=1789875101080',
    Centuries: 'https://images.sourcelibrary.org/gallery/6970e3759b09d309d780a2aa/6974fcf8f12f12c69a4b2dbf-0-thumb.jpg?v=1781131483542',
    Languages: 'https://images.sourcelibrary.org/pages/6992f3d4dc69844b023ff228/0001-thumb.jpg',
    Places: 'https://images.sourcelibrary.org/gallery/69a5d8d3a63a00aaae8aab0d/69a5d8d3a63a00aaae8aac70-0-thumb.jpg',
    'Types of texts': 'https://images.sourcelibrary.org/cropped/699ef9fe16733aa5a290e3d6/699efb4e39bee1d6074dc4d8.jpg',
    'Types of pictures': 'https://images.sourcelibrary.org/gallery/6a21984bf11c08f10b202651/6a21984bf11c08f10b202677-0-thumb.jpg?v=1790911979129',
    Collections: picks[0]?.img ?? '',
  };
  return {
    subjects, picks, ways,
    featured: f ? { slug: f.slug, name: f.name, img: f.plates[0]?.src || f.heroImage } : null,
    libraries: LIBS.map(([name, count]) => ({ name, count })),
  };
}
