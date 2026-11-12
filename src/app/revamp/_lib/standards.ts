/**
 * Each of our type, format, period and picture-type values against the library and museum standards.
 * Every link was looked up on 2026-11-10 at id.loc.gov (LCGFT: Library of Congress Genre/Form Terms)
 * and vocab.getty.edu (AAT: Getty Art & Architecture Thesaurus). Nothing here is guessed: where no
 * term was found, `terms` is empty and the note says so.
 * match: exact = same meaning; close = near, but ours is wider or narrower; none = no term found.
 */
export type Match = 'exact' | 'close' | 'none';
export interface Term { scheme: 'LCGFT' | 'AAT' | 'Wikidata'; label: string; uri: string }
export interface Mapping { ours: string; label: string; match: Match; terms: Term[]; note?: string }

const lc = (label: string, id: string): Term => ({ scheme: 'LCGFT', label, uri: `http://id.loc.gov/authorities/genreForms/${id}` });
const aat = (label: string, id: string): Term => ({ scheme: 'AAT', label, uri: `http://vocab.getty.edu/aat/${id}` });
const wd = (label: string, id: string): Term => ({ scheme: 'Wikidata', label, uri: `http://www.wikidata.org/entity/${id}` });

/** Type of text. Libraries use LCGFT for this. */
export const TEXT_TYPE_MAP: Mapping[] = [
  { ours: 'treatise', label: 'Treatise', match: 'close', terms: [aat('treatises', '300026681')], note: 'LCGFT has no Treatises term. AAT does.' },
  { ours: 'encyclopedia', label: 'Encyclopaedia', match: 'close', terms: [lc('Encyclopedias', 'gf2014026092')], note: 'No LCGFT term for compendium.' },
  { ours: 'commentary', label: 'Commentary', match: 'exact', terms: [lc('Commentaries', 'gf2025026014')], note: 'Narrower terms exist: Religious commentaries (gf2025026002), Law commentaries.' },
  { ours: 'manual', label: 'Handbook or manual', match: 'close', terms: [lc('Handbooks and manuals', 'gf2014026109'), lc('Recipes', 'gf2014026162')], note: 'Ours joins two LCGFT terms; they could be split.' },
  { ours: 'letters', label: 'Correspondence', match: 'exact', terms: [lc('Correspondence', 'gf2025026080')], note: 'Narrower: Personal correspondence (gf2014026141).' },
  { ours: 'poetry', label: 'Poetry and literature', match: 'close', terms: [lc('Poetry', 'gf2014026481'), lc('Literature', 'gf2014026415')], note: 'Ours also covers fiction and drama: LCGFT keeps them apart (Fiction gf2014026339).' },
  { ours: 'dialogue', label: 'Dialogue', match: 'exact', terms: [lc('Dialogues (Literature)', 'gf2014026285')] },
  { ours: 'anthology', label: 'Anthology', match: 'close', terms: [lc('Anthologies', 'gf2026026016')], note: 'Ours also includes collected works (opera omnia), which are not anthologies.' },
  { ours: 'polemic', label: 'Polemic', match: 'exact', terms: [lc('Polemics', 'gf2026026027')] },
  { ours: 'scripture', label: 'Sacred work', match: 'exact', terms: [lc('Sacred works', 'gf2015026045')] },
  { ours: 'biography', label: 'Biography', match: 'exact', terms: [lc('Biographies', 'gf2014026049'), lc('Hagiographies', 'gf2015026032')], note: "Hagiographies covers saints' lives." },
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
  { ours: 'ancient', label: 'Ancient', match: 'close', terms: [wd('ancient history', 'Q41493')], note: 'No general AAT term: only by culture (Ancient Chinese, Ancient European…). Classical (300020093) is Greek and Roman only. Wikidata’s ancient history runs to the start of the Middle Ages.' },
  { ours: 'late-antique', label: 'Late Antique', match: 'exact', terms: [aat('Late Antique', '300020666')] },
  { ours: 'medieval', label: 'Medieval', match: 'close', terms: [aat('Medieval (European)', '300020756')], note: 'European only: wrong for Chinese, Indian or Islamic works of the same dates.' },
  { ours: 'renaissance', label: 'Renaissance', match: 'close', terms: [aat('Renaissance', '300021140')], note: 'European only.' },
  { ours: 'early-modern', label: 'Early modern', match: 'close', terms: [wd('early modern period', 'Q5308718')], note: 'No AAT period term. Wikidata’s early modern period is c.1500 to c.1800; ours is 1600 to 1750.' },
  { ours: 'enlightenment', label: 'Enlightenment', match: 'close', terms: [aat('Enlightenment (18th-century western movement)', '300055781')], note: 'A movement, not a period, and western only.' },
  { ours: 'modern', label: 'Modern', match: 'close', terms: [wd('late modern period', 'Q6495391')], note: 'No AAT term. Wikidata’s late modern period runs from c.1800; ours from 1850.' },
];

/** What a text is written on. Looked up 2026-11-12 in the Getty AAT full display and on Wikidata. */
export const FORM_MAP: Mapping[] = [
  { ours: 'printed-book', label: 'Printed book', match: 'close', terms: [aat('books', '300028051'), wd('book', 'Q571')], note: 'AAT books covers manuscripts too.' },
  { ours: 'manuscript-book', label: 'Manuscript book', match: 'exact', terms: [aat('codices (bound manuscripts)', '300224200'), wd('manuscript', 'Q87167')] },
  { ours: 'scroll', label: 'Scroll', match: 'exact', terms: [aat('scrolls (information artifacts)', '300028629'), wd('scroll', 'Q720106')] },
  { ours: 'clay-tablet', label: 'Clay tablet', match: 'close', terms: [aat('tablets (information artifacts)', '300028879'), wd('clay tablet', 'Q1570005')], note: 'AAT has no clay tablets term; tablets covers wax and wooden ones too. Wikidata matches exactly.' },
  { ours: 'papyrus', label: 'Papyrus', match: 'exact', terms: [aat('papyri (manuscripts)', '300055047'), wd('papyrus', 'Q125576')], note: 'Wikidata papyrus is the material.' },
  { ours: 'palm-leaf-manuscript', label: 'Palm-leaf manuscript', match: 'exact', terms: [aat('palm-leaf manuscripts', '300451691'), wd('palm-leaf manuscript', 'Q1641020')] },
  { ours: 'inscription', label: 'Inscription', match: 'exact', terms: [aat('inscriptions', '300028702'), wd('inscription', 'Q1640824')] },
];

/** Wikidata for every kind, checked one by one on 2026-11-12. Wikidata carries the names in many languages. */
const WD: Record<string, [string, string]> = {
  treatise: ['treatise', 'Q384515'], encyclopedia: ['encyclopedia', 'Q5292'], commentary: ['commentary', 'Q1749541'], manual: ['handbook', 'Q1338914'],
  letters: ['correspondence (literary genre)', 'Q1784733'], poetry: ['poetry', 'Q482'], anthology: ['anthology', 'Q105420'], polemic: ['polemic', 'Q27406'],
  scripture: ['religious text', 'Q179461'], biography: ['biography', 'Q36279'], history: ['chronicle', 'Q185363'], catalog: ['catalog', 'Q2352616'],
  book: ['book', 'Q571'], manuscript: ['manuscript', 'Q87167'],
  engraving: ['engraving', 'Q11835431'], woodcut: ['woodcut print', 'Q18219090'], diagram: ['diagram', 'Q959962'], emblem: ['emblem', 'Q112110'],
  portrait: ['portrait', 'Q134307'], frontispiece: ['frontispiece', 'Q583866'], map: ['map', 'Q4006'], decorative: ['ornament', 'Q335261'], symbol: ['symbol', 'Q80071'],
};
for (const m of [...TEXT_TYPE_MAP, ...FORMAT_MAP, ...PICTURE_TYPE_MAP]) { const w = WD[m.ours]; if (w && !m.terms.some((t) => t.scheme === 'Wikidata')) m.terms.push(wd(w[0], w[1])); }
