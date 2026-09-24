/**
 * PRIOR ART: scripts/import/ia-ocr-ingest.mjs `leafTexts()` walks the SAME `<OBJECT>/<PARAGRAPH>/
 * <LINE>/<WORD>` tree but keeps only the word TEXT and throws the `x-confidence` attribute away,
 * and its `.leaves.json` cache stores strings, so confidence cannot be recovered from the cache —
 * hence a second parser rather than a flag on that one. scripts/lib/ia-ocr-meta.mjs reports what
 * the Archive says about its engine and the text's date, never about a page. scripts/lib/
 * ocr-plausibility.mjs scores a page against the BOOK'S OWN model-read vocabulary, so it needs a
 * paid reference; this file needs none, which is the whole point. scripts/lib/ia-ocr-agreement.mjs
 * compares two readings; this reads one.
 *
 * ia-ocr-confidence — what the Archive's own OCR engine thought of its reading, per leaf.
 *
 * WHY. The free-text lane currently admits a book by agreeing with OUR model's reading of the same
 * leaves, so every candidate book must first be given a paid OCR sample. `ocr-plausibility.mjs`
 * names this file's signal as the thing it cannot see:
 *
 *     "The signal that class does carry is the engine's own per-word confidence (`x_wconf` in the
 *      Archive's hOCR file), which this helper does not read; see #4784."
 *
 * It is cheaper than that note implies. The confidence is **already in the `_djvu.xml` the
 * ingester downloads**, as `x-confidence` on every `<WORD>` (verified 2026-09-24: 34,578 of them
 * in one cached file), so reading it costs no extra request — only a second pass over bytes
 * already on disk.
 *
 * WHAT IT IS NOT. This is the engine's SELF-REPORT, and a confidently wrong engine is exactly the
 * failure this cannot catch — `ocr-plausibility.mjs` measured a word-shaped-junk page from an
 * out-of-focus scan that no cheap text statistic separates with margin. Nothing here should gate a
 * write until it has been scored against hand-graded pages
 * (`scripts/eval/ia-confidence-vs-gate.mjs`). It is a candidate instrument, not a verdict.
 *
 * THE STATISTICS, and why more than one. Mean confidence is the obvious summary and the weakest:
 * a page of solid text with one garbled column keeps a respectable mean. The share of words BELOW
 * a floor moves on exactly that case, and a low decile moves on a page whose damage is localised.
 * They are reported together so the calibration can choose rather than this file assuming.
 */

/** A word is too short to carry a meaningful confidence; ABBYY reports 0–100. */
const MIN_WORD_CHARS = 2;
/** "Low" for `lowShare`. ABBYY's scale is 0–100; below ~70 a word is usually visibly wrong. */
export const LOW_CONFIDENCE = 70;
/** Below this many scored words a leaf's statistics are noise, so it abstains (null). */
export const MIN_WORDS = 10;

/**
 * Per-leaf confidence statistics from an Archive `_djvu.xml`.
 *
 * Leaf k of the returned array is `<OBJECT>` k, the SAME indexing `leafTexts()` produces, so a
 * caller can line the two up positionally. (The ingester's offset search settled at 0 for every
 * item — see #4790 / `lesson_ia_leaf_offset_is_always_zero` — but this function does not assume
 * that; it just preserves the file's own order.)
 *
 * @param {string} xml  the raw `_djvu.xml`
 * @returns {Array<{words:number, mean:number, p10:number, lowShare:number}|null>}
 *   one entry per leaf; `null` where the leaf has fewer than `MIN_WORDS` scored words, which is
 *   an ABSTENTION and must not be read as a bad page (a blank leaf and an unreadable leaf are
 *   different findings — see `lesson_absence_is_not_failure_no_silent_skips`).
 */
export function leafConfidence(xml) {
  const out = [];
  for (const o of String(xml).split(/<OBJECT\b/).slice(1)) {
    const confs = [];
    for (const m of o.matchAll(/<WORD\b([^>]*)>([\s\S]*?)<\/WORD>/g)) {
      const text = m[2].replace(/<[^>]*>/g, '').trim();
      if (text.length < MIN_WORD_CHARS) continue;
      const c = /x-confidence="(\d+(?:\.\d+)?)"/.exec(m[1]);
      if (!c) continue;
      confs.push(+c[1]);
    }
    out.push(summarize(confs));
  }
  return out;
}

/** The same statistics over an arbitrary confidence list; exported so the eval can pool leaves. */
export function summarize(confs) {
  if (confs.length < MIN_WORDS) return null;
  const sorted = [...confs].sort((a, b) => a - b);
  const mean = confs.reduce((a, b) => a + b, 0) / confs.length;
  return {
    words: confs.length,
    mean: round(mean),
    p10: round(sorted[Math.floor(sorted.length * 0.1)]),
    lowShare: round(confs.filter((c) => c < LOW_CONFIDENCE).length / confs.length),
  };
}

/**
 * Does this XML carry confidence at all? Not every derivative does, and a file without it must be
 * distinguishable from a file whose words all scored badly — the same absence/failure split as
 * above. Returns the share of scored-length words that carry an `x-confidence` attribute.
 */
export function confidenceCoverage(xml) {
  let withAttr = 0, total = 0;
  for (const m of String(xml).matchAll(/<WORD\b([^>]*)>([\s\S]*?)<\/WORD>/g)) {
    if (m[2].replace(/<[^>]*>/g, '').trim().length < MIN_WORD_CHARS) continue;
    total++;
    if (/x-confidence="/.test(m[1])) withAttr++;
  }
  return { total, withAttr, share: total ? round(withAttr / total) : null };
}

const round = (n) => Math.round(n * 1000) / 1000;
