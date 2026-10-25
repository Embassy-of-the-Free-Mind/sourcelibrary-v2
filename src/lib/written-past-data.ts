/**
 * "How much of the written past can anyone read today?" — the growing-scale
 * chart on /about (ported from the /talks/ai-case-study gap slide).
 *
 * Europe rows: snapshot from translation_census_by_language (Supabase), May 2026,
 * the same numbers as /research/translation-gap. Denominator = USTC distinct
 * works printed before 1700; numerator = works with a known English translation
 * in the 30-source federated catalogue.
 *
 * Beyond Europe the traditions are counted in other units (manuscript copies,
 * titles), so those rows are estimates and say so in their unit line:
 *   Tibetan: BDRC catalogue, 30,437 works, 822 translated (SL census).
 *   Arabic script: 3–4 million surviving manuscripts (Roper; Déroche).
 *   India: ~10 million manuscripts (National Mission for Manuscripts).
 *   Chinese: ~200,000 titles / >500,000 editions catalogued to 1912
 *     (Zhongguo guji zongmu) — a floor, so the bar runs off the scale.
 */

export type WrittenPastRow = {
  key: string;
  name: string;
  /** Size of the body of texts, in `unit`. */
  n: number;
  /** Works with an English translation, where counted. */
  translated: number | null;
  unit: string;
  /** First step at which the row appears. */
  step: number;
  highlight?: boolean;
  estimate?: boolean;
  /** Bar runs off the end of the axis: the true size is uncounted. */
  open?: boolean;
  /** No estimate at all: a dashed row with words only. */
  none?: boolean;
  /** The row's own hue. Solid = translated, a tint of it = untranslated. */
  color?: string;
};

const PRINTED = 'works printed before 1700';

export const WRITTEN_PAST_ROWS: WrittenPastRow[] = [
  { key: 'la', name: 'Latin', n: 444120, translated: 8644, unit: PRINTED, step: 0, highlight: true, color: '#aa442b' },
  { key: 'nl', name: 'Dutch', n: 82651, translated: 462, unit: PRINTED, step: 1, color: '#488acb' },
  { key: 'de', name: 'German', n: 295566, translated: 419, unit: PRINTED, step: 1, color: '#437224' },
  { key: 'fr', name: 'French', n: 194874, translated: 1615, unit: PRINTED, step: 1, color: '#bf6aa5' },
  { key: 'en', name: 'English', n: 149462, translated: 553, unit: PRINTED, step: 1, color: '#4160a7' },
  { key: 'it', name: 'Italian', n: 101335, translated: 576, unit: PRINTED, step: 1, color: '#c0851f' },
  { key: 'es', name: 'Spanish', n: 76472, translated: 340, unit: PRINTED, step: 1, color: '#008478' },
  { key: 'tib', name: 'Tibetan', n: 30437, translated: 822, unit: 'works in the BDRC catalogue', step: 2, color: '#6a499b' },
  { key: 'ara', name: 'Arabic script', n: 3500000, translated: null, unit: 'surviving manuscripts (estimate); the works themselves are uncounted', step: 2, estimate: true, color: '#cc5e6b' },
  { key: 'ind', name: 'India', n: 10000000, translated: null, unit: 'manuscripts (national estimate)', step: 3, estimate: true, color: '#006d95' },
  { key: 'chi', name: 'Chinese', n: 10000000, translated: null, unit: '200,000 titles and 500,000 editions catalogued to 1912, before manuscripts and local printing. The true size is uncounted.', step: 4, open: true, color: '#5e9f50' },
  { key: 'rest', name: 'Not yet counted', n: 10000000, translated: null, unit: 'Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek, medieval Latin…', step: 4, none: true },
];

export const WRITTEN_PAST_STEPS: { name: string; caption: string }[] = [
  { name: 'Latin', caption: '444,120 works were printed in Latin before 1700, the language of the Renaissance and of early science. 1.95% of them have an English translation.' },
  { name: 'Europe', caption: 'Add the rest of Europe and it comes to 1.39 million works, of which about 0.9% can be read in English.' },
  { name: 'Arabic', caption: '3 to 4 million Arabic-script manuscripts survive, counted in copies, not works. Europe’s print is already a thin strip.' },
  { name: 'India', caption: 'India estimates 10 million manuscripts, the largest figure anyone has published. The Dutch bar is now a hairline.' },
  { name: 'China', caption: 'China is almost certainly larger than any of these, and nobody has counted it. Nor most of the rest of the world.' },
];
