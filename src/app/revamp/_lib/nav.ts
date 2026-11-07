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
  return {
    subjects, picks,
    featured: f ? { slug: f.slug, name: f.name, img: f.plates[0]?.src || f.heroImage } : null,
    libraries: LIBS.map(([name, count]) => ({ name, count })),
  };
}
