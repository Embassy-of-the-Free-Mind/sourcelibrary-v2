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
 * catalogue, plus derived prose that quotes it. Deliberately excludes page text.
 *
 * Dotted paths are supported and resolved against nested objects.
 *
 * **This list was wrong once, and the way it was wrong is the point.** The first pass
 * guessed six top-level fields, reported CLEAN, and left the damaged title rendering on
 * the live page — because the AI-written `summary.data` quotes the title, and nobody had
 * thought of it. Never trust a guessed field list: `findMojibakeInDocument()` below walks
 * the whole document, and that is what the detector uses. This list only governs what the
 * repairer WRITES.
 */
export const REPAIRABLE_BOOK_FIELDS = [
  'title',
  'display_title',
  'english_title',
  'author',
  'description',
  'subtitle',
  // Derived prose that embeds the title. This is what rendered the damage to readers
  // after every "real" metadata field had already been fixed.
  'summary.data',
  // Top-level work title (distinct from source_work_dates[].work_title).
  'work_title',
];

/**
 * Paths that record WHAT AN EXTERNAL SOURCE SAID, and must therefore keep the damage.
 *
 * `catalog_metadata.creator` and `author_link_provenance[].matched` are provenance: their
 * whole job is to preserve the upstream string as received, so that a later question
 * ("what did the catalogue actually give us?") has an answer. Repairing them would make
 * the record lie about its own source — and would erase the evidence that the damage is
 * upstream, which is the single most important fact about this defect.
 *
 * Same reasoning keeps the damaged string in a merged author's `variants[]`: it is a
 * lookup key for records that still carry the old spelling, not a display value.
 */
export const PROVENANCE_PATHS = [
  /^catalog_metadata\./,
  /^author_link_provenance\[/,
  /^variants\[/,
  /^variant_slugs\[/,
  /_provenance(\.|\[)/,
  /^source_fingerprint$/,
];

/** True when a walked path records an external source rather than our own display value. */
export function isProvenancePath(path) {
  return PROVENANCE_PATHS.some((re) => re.test(path));
}

/**
 * Walk an entire document and return every path holding a damaged string.
 *
 * Paths use `a.b[0].c` form. Array indices are preserved so a caller can address the
 * exact element. This exists so a detector never depends on someone having remembered a
 * field name.
 *
 * @param {unknown} doc
 * @returns {{ path: string, value: string }[]}
 */
export function findMojibakeInDocument(doc) {
  const out = [];
  const visit = (node, path) => {
    if (typeof node === 'string') {
      if (findMojibake(node).length > 0) out.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => visit(v, `${path}[${i}]`));
      return;
    }
    // Plain objects only — skip ObjectId, Date, Binary and friends.
    if (node && typeof node === 'object' && node.constructor === Object) {
      for (const [k, v] of Object.entries(node)) visit(v, path ? `${path}.${k}` : k);
    }
  };
  visit(doc, '');
  return out;
}
