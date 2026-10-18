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
];

export const mapThemeBySlug = (slug: string) => MAP_THEMES.find((t) => t.slug === slug);
