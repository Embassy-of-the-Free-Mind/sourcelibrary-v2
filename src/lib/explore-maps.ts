// PRIOR ART: sourcelibrary-atlas src/lib/themes.ts — the same entries, copied for the maps that have moved to
//   /explore/maps (#4922). Looked in src/lib for an existing maps/theme registry: none (map-* files are the entity map).
// One entry per timeline map on /explore/maps/<slug>. Its data files are copied build artifacts in
// public/data/maps/ (scripts/maintenance/import-atlas-maps.mjs): <slug>.json, and optionally
// <slug>-l2.json (level 2: summaries, key terms, passages) and lens-<slug>.json (concept lens).

export type MapTheme = {
  slug: string;
  word: string;            // the italicised word in the title
  title: string;           // "A Map of <word>"
  short: string;           // card blurb
  eyebrow: string;
  lede: string;
  figLabels: [string, string, string, string];
  adjacentLabel?: string;
  method: string;
  limits: string;
  level2?: boolean;
  l2Topic?: string;        // "What it says about <topic>" in the catalogue (default: the mind)
  lens?: boolean;
  detailHint?: string;
};

const METHOD_COMMON =
  'Seven parallel surveys of the full catalogue (113,276 records), one per tradition, searching each canonical work by original title, transliteration variants, and the titles of its known translations and editions; then a normalisation pass that assigned each held record to a canonical work and gave each work a conventional composition date. “Readable” means at least one held edition is visible and at least 80% translated (or an English edition at least 80% transcribed). Composition dates are conventional scholarly dates of the text as transmitted, not of the edition.';
const LIMITS_COMMON =
  'Hidden bulk-imported records with no transcription are counted as held. Some records carry mislabelled languages or duplicated entries; the surveys flagged these but did not repair them. Absences were tested by title search only, so a work held inside an uncatalogued anthology may be reported as missing.';

export const MAP_THEMES: MapTheme[] = [
  {
    slug: 'consciousness', word: 'Consciousness', title: 'A Map of Consciousness',
    short: 'What people across traditions thought the mind is: soul, self, perception, dreams and trance, from the Egyptian ba and the Māṇḍūkya Upaniṣad to Avicenna, Descartes, the Abhidharma and William James.',
    eyebrow: 'Surveyed 9 September 2026 · holdings re-checked 16 October 2026',
    lede: 'What did people think the mind is? Each mark is one work on the soul or the mind (its powers, perception, memory, sleep, dreams, trance), placed by tradition and by when it was written. Filled marks you can read in English now; rings the library holds but you cannot read yet; dashed rings it does not hold. Click a filled mark to see what the work says about the mind, its key terms, and passages to start reading.',
    figLabels: ['works you can read in English now', 'works the library holds but you cannot read yet', 'works the library does not hold, each with a place to find it', 'editions listed below, {readable} of them readable'],
    method: METHOD_COMMON + ' The work panel: for each readable work, a script took candidate pages from its best readable edition, chosen by words about the mind, by the edition’s own indexed terms and by the work’s subject. Claude chose two or three passages and wrote the summary; Gemini re-read each passage and removed any that were not the work’s own words about the mind; every quote was matched word for word against its page. Readable and held marks were re-checked against the catalogue on 16 October 2026.',
    limits: LIMITS_COMMON + ' The summaries are written by a language model from the pages it was shown and can be wrong. The passages come from the library’s machine translations (or from the English original) and link to their page, so you can check them. Editions that are held but not yet public are named without a link.',
    level2: true, lens: true,
    detailHint: 'Click a filled mark, or a title in the catalogue below, to see what the work says about the mind and where to start reading.',
  },
  {
    slug: 'harmony', word: 'Harmony', title: 'A Map of Harmony',
    short: 'What people across traditions took harmony and resonance to be: ratio and consonance, unlike things joined in one whole, balance, concord, and strings that answer each other, from the Ṛgveda and Yanzi’s soup to Kepler, Zhu Zaiyu and Helmholtz.',
    eyebrow: 'Canon written and holdings checked 22 October 2026',
    lede: 'What did people think harmony is? Each mark is one work about harmony, concord or resonance (things answering their like), placed by tradition and by when it was written. Filled marks you can read in English now; rings the library holds but you cannot read yet; dashed rings it does not hold. Click a mark to see what the work holds, where to start reading and, for most works, a reader’s notes on it.',
    figLabels: ['works you can read in English now', 'works the library holds but you cannot read yet', 'works the library does not hold, each with a place to find it', 'editions listed below, {readable} of them readable'],
    method: 'A canon of 199 works was written by hand for this map, starting from the 105 author pages of a reader’s notes on harmony and adding the works of each tradition those notes had not reached. A script matched each work against the whole catalogue (154,301 records on 22 October 2026) by title, and one model pass (Claude) checked every matched record and dropped those that hold a different work. “Readable” means at least one held edition is public and at least 80% translated (or an English edition at least 80% transcribed). The work panel: where the reader studied the work, the panel gives those notes, condensed, with the passages the reader checked against the page. Otherwise a script took candidate pages from the best readable edition, Claude Sonnet chose two or three passages and wrote the summary, and Claude Opus re-read each passage and removed any that were not the work’s own words on harmony. Every passage was matched word for word against its page on 22 October 2026.',
    limits: 'The canon is a selection, and its weight falls where the library is strongest: Europe and China. Absences were tested by title only, so a text held inside an uncatalogued anthology may be reported as missing, and complete-works editions count as holding each work they contain. Summaries written by a model can be wrong. The passages come from the library’s machine translations (or from the English original) and link to their page, so you can check them. Editions that are held but not yet public are named without a link.',
    level2: true, l2Topic: 'harmony',
    detailHint: 'Click a mark, or a title in the catalogue below, to see what the work holds about harmony and where to start reading.',
  },
];

export const mapThemeBySlug = (slug: string) => MAP_THEMES.find((t) => t.slug === slug);
