import { collectionModel, dataFile } from './data';
import { PICTURE_TYPE_MAP, TEXT_TYPE_MAP } from './standards';
import type { SubjectRow, Pic } from '../_components/SubjectsBrowser';

/*
 * Periods and Languages for the prototype, from _tools/snapshot-axes.mjs (public API output).
 * Each century and each language with a saved snapshot gets its own page, like a subject.
 */

interface Axes { centuries: { slug: string; name: string; total: number; from: number; to: number }[]; languages: { slug: string; name: string; total: number }[] }
type Group = SubjectRow & { narrower: SubjectRow[] };
const n = (v: number) => v.toLocaleString('en-GB');
const axes = () => dataFile<Axes>('snap/_axes') ?? { centuries: [], languages: [] };
const picsOf = (slug: string): Pic[] => (collectionModel(slug)?.plates ?? []).map((p) => ({ src: p.src, aspect: p.w && p.h ? p.w / p.h : null }));
const ord = (k: number) => `${k}${k % 100 >= 11 && k % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][k % 10] ?? 'th')}`;
/** "16th century" for 1500–1599; "5th century BCE" for 500–401 BCE. */
export const centuryName = (from: number) => (from < 0 ? `${ord(-from / 100)} century BCE` : `${ord(Math.floor(from / 100) + 1)} century`);

const PERIOD_BANDS: { id: string; label: string; test: (from: number) => boolean }[] = [
  { id: 'bce', label: 'Before the Common Era', test: (f) => f < 0 },
  { id: 'first', label: '1 to 999', test: (f) => f >= 0 && f < 1000 },
  { id: 'second', label: '1000 to 1499', test: (f) => f >= 1000 && f < 1500 },
  { id: 'third', label: '1500 to 1999', test: (f) => f >= 1500 },
];

export function periodGroups(): { groups: Group[]; books: number; count: number } {
  const cs = axes().centuries.sort((a, b) => a.from - b.from);
  const row = (c: Axes['centuries'][number]): SubjectRow => ({ id: c.slug, label: c.name, href: `/revamp/p/${c.slug}`, alt: [centuryName(c.from), c.from >= 0 ? `${c.from}s` : ''].filter(Boolean), pics: picsOf(c.slug), note: `${centuryName(c.from)} · ${n(c.total)} ${c.total === 1 ? 'book' : 'books'}`, home: true });
  const groups = PERIOD_BANDS.map((b) => {
    const narrower = cs.filter((c) => b.test(c.from)).map(row);
    return { id: b.id, label: b.label, alt: [], pics: narrower.flatMap((x) => x.pics.slice(0, 3)).slice(0, 14), narrower };
  }).filter((g) => g.narrower.length);
  return { groups, books: cs.reduce((s, c) => s + c.total, 0), count: cs.length };
}

/* Languages. The site stores free text: names, ISO 639 codes and the odd sentence. Codes are matched
 * to their language here (ISO 639-1/-2/-3); anything that can't be matched with certainty is listed
 * on its own, unmerged. */
const CODES: Record<string, string> = {
  de: 'German', ger: 'German', fr: 'French', it: 'Italian', ita: 'Italian', ar: 'Arabic', nl: 'Dutch', gmh: 'Middle High German', he: 'Hebrew',
  en: 'English', 'english.': 'English', grc: 'Ancient Greek', lat: 'Latin', la: 'Latin', es: 'Spanish', ru: 'Russian', tr: 'Turkish', cs: 'Czech',
  el: 'Greek', gre: 'Greek', lv: 'Latvian', ga: 'Irish', qu: 'Quechua', am: 'Amharic', nds: 'Low German', frm: 'Middle French', dum: 'Middle Dutch',
  yid: 'Yiddish', ota: 'Ottoman Turkish', arc: 'Aramaic', hrv: 'Croatian', slv: 'Slovenian', roh: 'Romansh', lb: 'Luxembourgish', geez: "Ge'ez",
};
const FAMILY: Record<string, string> = {};
const fam = (f: string, names: string) => names.split(', ').forEach((x) => { FAMILY[x] = f; });
fam('Indo-European', 'Latin, German, English, French, Greek, Ancient Greek, Italian, Dutch, Sanskrit, Spanish, Russian, Persian, Armenian, Classical Armenian, Pali, Middle English, Portuguese, Old French, Middle High German, Danish, Hindi, Polish, Yiddish, Old Norse, Low German, Middle Dutch, Swedish, Avestan, Middle French, Czech, Marathi, Bengali, Urdu, Punjabi, Old English, Anglo-Saxon, Welsh, Catalan, Norwegian, Gothic, Icelandic, Irish, Romanian, Occitan, Provençal, Croatian, Slovenian, Romansh, Luxembourgish, Latvian, Bulgarian, Church Slavonic, Anglo-Norman, Law French, Early New High German, Old Spanish, Prakrit, Ardhamagadhi Prakrit, Prakrit languages');
fam('Sino-Tibetan', 'Chinese, Classical Chinese, Tibetan, Burmese, Tangut');
fam('Afro-Asiatic', "Hebrew, Arabic, Syriac, Egyptian, Egyptian hieroglyphs, Demotic, Coptic, Ge'ez, Ethiopic, Akkadian, Aramaic, Samaritan Hebrew, Samaritan, Hausa, Amharic");
fam('Japonic', 'Japanese'); fam('Koreanic', 'Korean'); fam('Dravidian', 'Tamil, Telugu, Kannada, Malayalam');
fam('Austronesian', 'Javanese, Old Javanese, Malay, Maori, Hawaiian, Samoan, Malagasy, Balinese, Sundanese, Bugis');
fam('Turkic', 'Ottoman Turkish, Turkish'); fam('Uralic', 'Finnish, Hungarian'); fam('Kartvelian', 'Georgian'); fam('Austroasiatic', 'Vietnamese');
fam('Mayan', "Yucatec Maya, Kaqchikel, K'iche' Maya, Quiché Maya, Q'eqchi', Maya hieroglyphs, Maya Hieroglyphic Script");
fam('Uto-Aztecan', 'Nahuatl'); fam('Quechuan', 'Quechua'); fam('Niger-Congo', 'Yoruba, Swahili, Zulu, Xhosa, Igbo');
fam('Language isolate', 'Sumerian, Purépecha, Haida');
fam('Oto-Manguean', 'Mixtec'); fam('Na-Dene', 'Navajo'); fam('Nilo-Saharan', 'Kanuri');

const LANG_BANDS = ['Indo-European', 'Sino-Tibetan', 'Afro-Asiatic', 'Other language families', 'Not yet matched to a language'];

export function languageGroups(): { groups: Group[]; books: number; named: number; values: number; unmatched: number } {
  const raw = dataFile<{ languages: { name: string; book_count: number }[]; total_books: number }>('snap/_languages') ?? { languages: [], total_books: 0 };
  const pages = new Map(axes().languages.map((l) => [l.name, l.slug]));
  const merged = new Map<string, { count: number; from: string[] }>();
  for (const l of raw.languages) {
    const name = CODES[l.name.toLowerCase()] ?? l.name;
    const e = merged.get(name) ?? { count: 0, from: [] };
    e.count += l.book_count;
    if (name !== l.name) e.from.push(l.name);
    merged.set(name, e);
  }
  const rows = [...merged.entries()].sort((a, b) => b[1].count - a[1].count).map(([name, e]) => {
    const family = FAMILY[name];
    const band = !family ? LANG_BANDS[4] : LANG_BANDS.includes(family) ? family : LANG_BANDS[3];
    const slug = pages.get(name);
    const row: SubjectRow = {
      id: `lang-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, label: name, href: slug ? `/revamp/l/${slug}` : undefined, alt: e.from,
      pics: slug ? picsOf(slug) : [], home: true, bare: true,
      note: [band === LANG_BANDS[3] ? family : '', `${n(e.count)} ${e.count === 1 ? 'book' : 'books'}`, e.from.length ? `includes ${e.from.join(', ')}` : ''].filter(Boolean).join(' · '),
    };
    return { band, row };
  });
  const groups = LANG_BANDS.map((b) => {
    const narrower = rows.filter((r) => r.band === b).map((r) => r.row);
    return { id: b.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label: b, alt: [], pics: narrower.flatMap((x) => x.pics.slice(0, 3)).slice(0, 14), narrower };
  }).filter((g) => g.narrower.length);
  const unmatched = rows.filter((r) => r.band === LANG_BANDS[4]).length;
  return { groups, books: raw.total_books, named: rows.length - unmatched, values: raw.languages.length, unmatched };
}

/** The week's featured period or language: one with enough pictures to fill the hero, in turn. */
export function featuredOf(slugs: string[]) {
  const ok = slugs.map((s) => collectionModel(s)).filter((m): m is NonNullable<typeof m> => !!m && m.heroTiles.length >= 8).sort((a, b) => a.slug.localeCompare(b.slug));
  if (!ok.length) return null;
  return ok[Math.floor(Date.now() / (7 * 24 * 3600 * 1000)) % ok.length];
}
export const axisSlugs = () => { const a = axes(); return { periods: a.centuries.map((c) => c.slug), languages: a.languages.map((l) => l.slug) }; };
export const centuryOfSlug = (slug: string) => axes().centuries.find((c) => c.slug === slug);

/* Types: picture types (the gallery's) and text types (the site's form tags), as pages. */
interface Types { pictures: { id: string; slug: string; total: number }[]; texts: { id: string; slug: string; total: number }[] }
const types = (): Types => { const t = dataFile<Types>('snap/_types') ?? { pictures: [], texts: [] }; return { pictures: t.pictures.filter((x) => x.total > 0), texts: t.texts.filter((x) => x.total > 0) }; };
export function typeGroups(): { groups: Group[]; pictures: number; texts: number } {
  const t = types();
  const pic = (kind: string) => PICTURE_TYPE_MAP.filter((x) => x.kind === kind).flatMap((x) => {
    const s = t.pictures.find((p) => p.id === x.ours);
    return s ? [{ id: s.slug, label: x.label, href: `/revamp/t/${s.slug}`, alt: x.terms.map((y) => y.label), pics: picsOf(s.slug), note: `${n(s.total)} pictures`, home: true }] : [];
  });
  const textRows = TEXT_TYPE_MAP.flatMap((x) => {
    const s = t.texts.find((p) => p.id === x.ours);
    if (!s) return [];
    const m = collectionModel(s.slug);
    const covers = (m?.all ?? []).map((b) => b.thumbnail_blob || b.thumbnail).filter(Boolean).map((src) => ({ src: src as string }));
    return [{ id: s.slug, label: x.label, href: `/revamp/t/${s.slug}`, alt: x.terms.map((y) => y.label), pics: covers, note: `${n(s.total)} books`, home: true }];
  });
  const band = (id: string, label: string, narrower: SubjectRow[]) => ({ id, label, alt: [], pics: narrower.flatMap((x) => x.pics.slice(0, 3)).slice(0, 14), narrower });
  const groups = [band('technique', 'Pictures: technique', pic('technique')), band('shows', 'Pictures: what they show', pic('what it shows')), band('place', 'Pictures: place in the book', pic('place in the book')), band('texts', 'Texts', textRows)].filter((g) => g.narrower.length);
  return { groups, pictures: t.pictures.reduce((a, b) => a + b.total, 0), texts: t.texts.reduce((a, b) => a + b.total, 0) };
}
export function typeOfSlug(slug: string) {
  const t = types();
  const p = t.pictures.find((x) => x.slug === slug);
  if (p) return { kind: 'picture' as const, total: p.total, map: PICTURE_TYPE_MAP.find((x) => x.ours === p.id)! };
  const x = t.texts.find((y) => y.slug === slug);
  if (x) return { kind: 'text' as const, total: x.total, map: TEXT_TYPE_MAP.find((y) => y.ours === x.id)! };
  return null;
}
export const typeSlugs = () => { const t = types(); return [...t.pictures, ...t.texts].map((x) => x.slug); };
