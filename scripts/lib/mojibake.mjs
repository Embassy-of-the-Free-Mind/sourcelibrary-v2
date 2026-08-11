/**
 * Narrow repair for transcoding damage that arrives in *upstream* catalogue metadata (#3705).
 *
 * The case that motivated this: seven Aldine Greek editions carried `L·` where the
 * transliteration wants `ē`, so a public title read `exL·gL·sis` instead of `exēgēsis`.
 * The damage is NOT ours — `https://archive.org/metadata/bub_gb_53bpjY1fnuMC` serves
 * `rhL·torōn` in its own `title` field, and our importers copied it faithfully. So there
 * is no importer bug to fix; there is a dirty source to normalise on the way in.
 *
 * ## Why the table is this small, and must stay this small
 *
 * A mojibake "fixer" that guesses is far more dangerous than the damage it repairs,
 * because it corrupts *correct* text silently and at scale. Two rules keep this safe:
 *
 * 1. **Match multi-character sequences, never a single suspicious character.** U+00B7
 *    (MIDDLE DOT) appears legitimately in 12,010 live book titles — it is the standard
 *    separator in the Chinese corpus (`本草綱目·卷上之中`). Only the exact bigram
 *    `L` + U+00B7 is damage. Rewriting the bare middle dot would have wrecked every one
 *    of those titles.
 * 2. **Only add a rule you have confirmed against the upstream record.** Each entry below
 *    cites the evidence that the sequence is damage rather than text. If you cannot point
 *    at a source record where the sequence is wrong, it does not belong here.
 *
 * The same discipline is why this repairs *metadata* only. Do not run it over OCR or
 * translation text: a page image genuinely can contain `L·`, and page text is evidence.
 */

/**
 * Confirmed damage sequences. Each entry: [pattern, replacement, evidence].
 *
 * Keep `pattern` a plain string (not a regex) so a reviewer can see exactly what matches.
 */
export const MOJIBAKE_RULES = [
  {
    from: 'L·',
    to: 'ē',
    // Confirmed 2026-08-11 against archive.org/metadata for bub_gb_53bpjY1fnuMC and
    // bub_gb_ix1nGZJQNhgC — IA's own `title` carries `rhL·torōn` / `exL·gL·sis`. The same
    // titles encode `ō` and `ē` correctly elsewhere, so this is a partial substitution,
    // not a wholesale encoding mismatch.
    evidence: 'IA metadata for bub_gb_* Aldines; #3705',
  },
];

/**
 * Repair confirmed mojibake in a metadata string.
 *
 * Returns the input unchanged (same reference) when nothing matched, so callers can cheaply
 * test `repaired !== original` to decide whether a write is warranted.
 *
 * @param {unknown} value
 * @returns {unknown} the repaired string, or `value` untouched if not a string
 */
export function repairMojibake(value) {
  if (typeof value !== 'string' || value.length === 0) return value;
  let out = value;
  for (const rule of MOJIBAKE_RULES) {
    if (out.includes(rule.from)) out = out.split(rule.from).join(rule.to);
  }
  return out;
}

/**
 * Report which rules fire on a string, without rewriting it. For detectors and dry runs.
 *
 * @param {unknown} value
 * @returns {{ from: string, to: string, count: number }[]}
 */
export function findMojibake(value) {
  if (typeof value !== 'string' || value.length === 0) return [];
  const hits = [];
  for (const rule of MOJIBAKE_RULES) {
    const count = value.split(rule.from).length - 1;
    if (count > 0) hits.push({ from: rule.from, to: rule.to, count });
  }
  return hits;
}

/**
 * Book fields safe to normalise: bibliographic metadata we author or copy from a
 * catalogue. Deliberately excludes anything derived from page images.
 */
export const REPAIRABLE_BOOK_FIELDS = [
  'title',
  'display_title',
  'english_title',
  'author',
  'description',
  'subtitle',
];
