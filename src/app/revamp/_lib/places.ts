import type { SubjectRow } from '../_components/SubjectsBrowser';
import type { Mapping } from './standards';
import { subjectPictures } from './subject-pics';

/**
 * Places: where a text comes from. Not recorded in the catalogue yet (it is part of the catalogue round),
 * so these have no counts or pages. Every name was checked on Wikidata on 2026-11-13; Getty's Thesaurus of
 * Geographic Names (TGN) and FAST geographic headings get added in the catalogue round.
 */
const wd = (label: string, id: string) => ({ scheme: 'Wikidata' as const, label, uri: `http://www.wikidata.org/entity/${id}` });

// [our name, Wikidata label, Wikidata id, subjects whose pictures dress the band (decoration only)]
const REGIONS: { id: string; label: string; q: string; pics: string[]; places: [string, string][] }[] = [
  { id: 'europe', label: 'Europe', q: 'Q46', pics: ['christian-mysticism', 'greek-religion', 'christian-liturgy'], places: [['Western Europe', 'Q27496'], ['Northern Europe', 'Q27479'], ['Southern Europe', 'Q27449'], ['Eastern Europe', 'Q27468']] },
  { id: 'asia', label: 'Asia', q: 'Q48', pics: ['chinese-art', 'indian-epics', 'tibetan-buddhism', 'persian-literature', 'japanese-art'], places: [['Middle East', 'Q7204'], ['Central Asia', 'Q27275'], ['South Asia', 'Q771405'], ['East Asia', 'Q27231'], ['Southeast Asia', 'Q11708']] },
  { id: 'africa', label: 'Africa', q: 'Q15', pics: ['eastern-christianity', 'arabic-literature'], places: [['North Africa', 'Q27381'], ['Sub-Saharan Africa', 'Q132959']] },
  { id: 'americas', label: 'The Americas', q: 'Q828', pics: ['indigenous-traditions'], places: [['North America', 'Q49'], ['Latin America', 'Q12585'], ['South America', 'Q18']] },
  { id: 'oceania', label: 'Oceania', q: 'Q55643', pics: [], places: [] },
];

export const PLACE_MAP: Mapping[] = REGIONS.flatMap((r) => [
  { ours: r.id, label: r.label, match: 'exact' as const, terms: [wd(r.label, r.q)] },
  ...r.places.map(([label, q]) => ({ ours: label.toLowerCase().replace(/[^a-z]+/g, '-'), label, match: 'exact' as const, terms: [wd(label, q)] })),
]);

export function placeGroups() {
  const pics = subjectPictures();
  return REGIONS.map((r) => {
    const narrower: SubjectRow[] = (r.places.length ? r.places : [[r.label, r.q] as [string, string]]).map(([label]) => ({
      id: `place-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`, label, href: `#g-${r.id}`, alt: [], pics: [], bare: true, note: 'Not recorded yet',
    }));
    return { id: r.id, label: r.label, alt: [], pics: r.pics.flatMap((s) => (pics[s] ?? []).filter((p) => p.src).slice(0, 4)), narrower };
  });
}
