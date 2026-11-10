/**
 * Each of our type, format, period and picture-type values against the library and museum standards.
 * Every link was looked up on 2026-11-10 at id.loc.gov (LCGFT: Library of Congress Genre/Form Terms)
 * and vocab.getty.edu (AAT: Getty Art & Architecture Thesaurus). Nothing here is guessed: where no
 * term was found, `terms` is empty and the note says so.
 * match: exact = same meaning; close = near, but ours is wider or narrower; none = no term found.
 */
export type Match = 'exact' | 'close' | 'none';
export interface Term { scheme: 'LCGFT' | 'AAT'; label: string; uri: string }
export interface Mapping { ours: string; label: string; match: Match; terms: Term[]; note?: string }

const lc = (label: string, id: string): Term => ({ scheme: 'LCGFT', label, uri: `http://id.loc.gov/authorities/genreForms/${id}` });
const aat = (label: string, id: string): Term => ({ scheme: 'AAT', label, uri: `http://vocab.getty.edu/aat/${id}` });

/** Type of text. Libraries use LCGFT for this. */
export const TEXT_TYPE_MAP: Mapping[] = [
  { ours: 'treatise', label: 'Treatise', match: 'close', terms: [aat('treatises', '300026681')], note: 'LCGFT has no Treatises term. AAT does.' },
  { ours: 'encyclopedia', label: 'Encyclopaedia or compendium', match: 'close', terms: [lc('Encyclopedias', 'gf2014026092')], note: 'No LCGFT term for compendium.' },
  { ours: 'commentary', label: 'Commentary', match: 'exact', terms: [lc('Commentaries', 'gf2025026014')], note: 'Narrower terms exist: Religious commentaries (gf2025026002), Law commentaries.' },
  { ours: 'manual', label: 'Manual or recipe book', match: 'close', terms: [lc('Handbooks and manuals', 'gf2014026109'), lc('Recipes', 'gf2014026162')], note: 'Ours joins two LCGFT terms; they could be split.' },
  { ours: 'letters', label: 'Letters', match: 'exact', terms: [lc('Correspondence', 'gf2025026080')], note: 'Narrower: Personal correspondence (gf2014026141).' },
  { ours: 'poetry', label: 'Poetry and literature', match: 'close', terms: [lc('Poetry', 'gf2014026481'), lc('Literature', 'gf2014026415')], note: 'Ours also covers fiction and drama: LCGFT keeps them apart (Fiction gf2014026339).' },
  { ours: 'dialogue', label: 'Dialogue', match: 'exact', terms: [lc('Dialogues (Literature)', 'gf2014026285')] },
  { ours: 'anthology', label: 'Anthology', match: 'close', terms: [lc('Anthologies', 'gf2026026016')], note: 'Ours also includes collected works (opera omnia), which are not anthologies.' },
  { ours: 'polemic', label: 'Polemic', match: 'exact', terms: [lc('Polemics', 'gf2026026027')] },
  { ours: 'scripture', label: 'Sacred text', match: 'exact', terms: [lc('Sacred works', 'gf2015026045')] },
  { ours: 'biography', label: 'Life', match: 'exact', terms: [lc('Biographies', 'gf2014026049'), lc('Hagiographies', 'gf2015026032')], note: "Hagiographies covers saints' lives." },
  { ours: 'history', label: 'History or chronicle', match: 'close', terms: [lc('Annals and chronicles', 'gf2014026045')], note: 'LCGFT has no general Histories term; this covers chronicles only.' },
  { ours: 'catalog', label: 'Catalogue', match: 'exact', terms: [lc('Catalogs', 'gf2014026057'), lc('Bibliographies', 'gf2014026048')] },
];

/** Printed or manuscript. Library records already split these (MARC record type: a = printed, t = manuscript). */
export const FORMAT_MAP: Mapping[] = [
  { ours: 'book', label: 'Printed', match: 'close', terms: [aat('books', '300028051')], note: 'LCGFT has no general Printed books term. AAT books covers manuscripts too. Incunabula (gf2022026095) exists for books printed before 1501.' },
  { ours: 'manuscript', label: 'Manuscript', match: 'exact', terms: [lc('Manuscripts', 'gf2022026088'), aat('manuscripts (documents)', '300028569')], note: 'AAT also has codices (bound manuscripts), 300224200.' },
];

/** Picture type. Museums use AAT; LCGFT has terms for some. Technique and what it shows are separate in both. */
export const PICTURE_TYPE_MAP: (Mapping & { kind: 'technique' | 'what it shows' | 'place in the book' })[] = [
  { ours: 'engraving', label: 'Engraving', kind: 'technique', match: 'exact', terms: [aat('engravings (prints)', '300041340'), lc('Engravings', 'gf2017027232')] },
  { ours: 'woodcut', label: 'Woodcut', kind: 'technique', match: 'exact', terms: [aat('woodcuts (prints)', '300041405'), lc('Woodcuts', 'gf2017027269')] },
  { ours: 'diagram', label: 'Diagram', kind: 'what it shows', match: 'exact', terms: [aat('diagrams', '300015387')] },
  { ours: 'emblem', label: 'Emblem', kind: 'what it shows', match: 'exact', terms: [aat('emblems (allegorical pictures)', '300123040')], note: 'For whole books: LCGFT Emblem books (gf2014026091).' },
  { ours: 'portrait', label: 'Portrait', kind: 'what it shows', match: 'exact', terms: [aat('portraits', '300015637'), lc('Portraits', 'gf2017027254')] },
  { ours: 'frontispiece', label: 'Frontispiece', kind: 'place in the book', match: 'exact', terms: [aat('frontispieces (illustrations)', '300083021')] },
  { ours: 'map', label: 'Map', kind: 'what it shows', match: 'exact', terms: [aat('maps (documents)', '300028094'), lc('Maps', 'gf2011026387')] },
  { ours: 'decorative', label: 'Decoration', kind: 'what it shows', match: 'close', terms: [aat('decorations (ornamental works)', '300379003')] },
  { ours: 'symbol', label: 'Symbol', kind: 'what it shows', match: 'close', terms: [aat('symbols', '300055878')], note: 'AAT symbols is a concept, not a kind of picture.' },
];

/** Periods. AAT period names are mostly European; FAST uses plain date spans instead. */
export const PERIOD_MAP: Mapping[] = [
  { ours: 'ancient', label: 'Ancient', match: 'none', terms: [], note: 'No general AAT term: only by culture (Ancient Chinese, Ancient European…). Classical (300020093) is Greek and Roman only.' },
  { ours: 'late-antique', label: 'Late Antique', match: 'exact', terms: [aat('Late Antique', '300020666')] },
  { ours: 'medieval', label: 'Medieval', match: 'close', terms: [aat('Medieval (European)', '300020756')], note: 'European only: wrong for Chinese, Indian or Islamic works of the same dates.' },
  { ours: 'renaissance', label: 'Renaissance', match: 'close', terms: [aat('Renaissance', '300021140')], note: 'European only.' },
  { ours: 'early-modern', label: 'Early modern', match: 'none', terms: [], note: 'No AAT period term found.' },
  { ours: 'enlightenment', label: 'Enlightenment', match: 'close', terms: [aat('Enlightenment (18th-century western movement)', '300055781')], note: 'A movement, not a period, and western only.' },
  { ours: 'modern', label: 'Modern', match: 'none', terms: [], note: 'No AAT term with that name found.' },
];
