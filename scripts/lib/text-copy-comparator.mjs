/**
 * Text copy comparator (#4285 method, ported for #5689) — are two scans the SAME PRINTING?
 *
 * PRIOR ART: the #4285 pilot was session scratch and never committed (the issue body
 * documents the method; this is that method, now the single implementation).
 * scripts/identity-evidence/collection-copies-2026-10-03.method/5-text-check.mjs is a
 * word-set screen over one keeper mid page — a rough screen, not this comparator.
 * scripts/audit/dedup-shadow-agreement.mjs compares dedup decisions, not page text.
 *
 * Every dedup test we have judges metadata against metadata. This reads the pages.
 *
 * Method (fixed; change COMPARATOR_VERSION if you change any of it):
 *   - text: drop the OCR metadata blocks (language, page-type, meta, …) and the page
 *     apparatus (header, page-num, sig, catchword) CONTENT AND ALL — they repeat on every
 *     page and are not body text — then strip remaining tags, NFC, lowercase, keep \p{L}\p{N} only (never \w — it is
 *     ASCII-only and silently erases Greek, Hebrew, Arabic, CJK), other runs → one space;
 *   - character 4-gram SETS, Jaccard similarity per page pair;
 *   - samples at 25/40/55/70/85% of book A; for each, the best match among book B's
 *     pages inside ±(|ΔpageCount|+8) of the same relative position;
 *   - a sample COUNTS only when book A's sampled page AND at least one B page in the
 *     window have ≥200 normalized chars; otherwise it is recorded `insufficient`.
 *     Absence of text is no evidence — never a disagreement (a copy of Monas with empty
 *     OCR at the sampled pages first read as "not the same book");
 *   - the window is searched forward AND mirrored (reverse-ordered scans; see
 *     comparePageTexts) and the better orientation is kept and recorded;
 *   - score = median of the counting samples' best matches;
 *   - verdict: ≥0.5 `same_printing`, <0.3 `different`, between `gray`; fewer than
 *     MIN_SAMPLES counting samples → `insufficient` (one page is not a book).
 *
 * Calibration (#4285, 2026-08-27): true copies 0.55–0.9 (OCR noise keeps them off 1.0);
 * different editions of one work 0.04–0.38. Re-calibrated for #5689 on the 2026-10-03
 * by-eye pairs — see the comment on #5689.
 *
 * Pure functions + one Mongo loader. No writes, no model calls.
 */

import { stripMarkupTags } from './strip-markup-tags.mjs';

// Union of the blocks stripOcrMetadata (language-content-classify.mjs) and
// stripApparatusTags (ngram-normalize.mjs) drop content-and-all. Neither can be
// chained with the other: each ends by stripping every remaining tag.
const DROP_BLOCKS = /<(meta|summary|keywords|vocab|language|scan-quality|script|page-type|columns|warning|header|catchword|sig|page-num)[^>]*>[\s\S]*?<\/\1>/gi;

export const COMPARATOR_VERSION = 'text-copy-comparator/1';
export const SAMPLE_FRACTIONS = [0.25, 0.40, 0.55, 0.70, 0.85];
export const MIN_CHARS = 200;
export const MIN_SAMPLES = 2;
export const WINDOW_PAD = 8;
export const SAME_AT = 0.5;
export const DIFFERENT_BELOW = 0.3;

export function normalizeText(s) {
  return stripMarkupTags(String(s || '').replace(DROP_BLOCKS, ' '))
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function fourgrams(norm) {
  const chars = Array.from(norm); // code points, not UTF-16 units
  const out = new Set();
  for (let i = 0; i + 4 <= chars.length; i++) out.add(chars.slice(i, i + 4).join(''));
  return out;
}

export function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const g of small) if (big.has(g)) inter++;
  return inter / (a.size + b.size - inter);
}

export function verdictFor(score, samplesUsed) {
  if (score == null || samplesUsed < MIN_SAMPLES) return 'insufficient';
  if (score >= SAME_AT) return 'same_printing';
  if (score < DIFFERENT_BELOW) return 'different';
  return 'gray';
}

const median = (xs) => {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Compare two books given their page texts in reading order (arrays of raw strings).
 * Returns { score, samples_used, verdict, orientation, samples[] } — samples carry
 * per-sample status so a reader can see WHY a pair was insufficient.
 *
 * Orientation: some scans store their pages in REVERSE order (RTL-bound books, and
 * imports that numbered from the back cover). Measured on the 2026-10-03 pairs: Diogenes
 * Laertius, Ammonius, Aeschylus and a Mar Jacob volume matched at 0.8–0.96 page-for-page,
 * but at offsets running +316 → −413 across the five samples, so a forward window found
 * nothing and called them `different`. The window is therefore also searched around the
 * mirrored position (1−f), and the better orientation is kept and recorded.
 */
export function comparePageTexts(textsA, textsB) {
  const nA = textsA.length, nB = textsB.length;
  const cache = { a: new Map(), b: new Map() };
  const prep = (side, texts, i) => {
    let p = cache[side].get(i);
    if (!p) {
      const norm = normalizeText(texts[i]);
      p = { len: Array.from(norm).length, grams: null, norm };
      cache[side].set(i, p);
    }
    if (p.len >= MIN_CHARS && !p.grams) p.grams = fourgrams(p.norm);
    return p;
  };
  const win = Math.abs(nA - nB) + WINDOW_PAD;
  const run = (reversed) => {
    const samples = [];
    for (const f of SAMPLE_FRACTIONS) {
      if (!nA || !nB) { samples.push({ fraction: f, status: 'insufficient', reason: 'empty book' }); continue; }
      const ia = Math.min(nA - 1, Math.round(f * (nA - 1)));
      const a = prep('a', textsA, ia);
      if (a.len < MIN_CHARS) { samples.push({ fraction: f, a_index: ia, status: 'insufficient', reason: `A page ${a.len} chars` }); continue; }
      const center = Math.round((reversed ? 1 - f : f) * (nB - 1));
      let best = -1, bestIdx = null;
      for (let j = Math.max(0, center - win); j <= Math.min(nB - 1, center + win); j++) {
        const b = prep('b', textsB, j);
        if (b.len < MIN_CHARS) continue;
        const sc = jaccard(a.grams, b.grams);
        if (sc > best) { best = sc; bestIdx = j; }
      }
      if (bestIdx == null) { samples.push({ fraction: f, a_index: ia, status: 'insufficient', reason: 'no B page ≥200 chars in window' }); continue; }
      samples.push({ fraction: f, a_index: ia, b_index: bestIdx, best: +best.toFixed(4), status: 'counted' });
    }
    const counted = samples.filter((x) => x.status === 'counted').map((x) => x.best);
    return { score: counted.length ? +median(counted).toFixed(4) : null, samples_used: counted.length, samples };
  };
  const fwd = run(false);
  const rev = run(true);
  const useRev = rev.samples_used >= MIN_SAMPLES && rev.score != null
    && (fwd.score == null || fwd.samples_used < MIN_SAMPLES || rev.score > fwd.score);
  const pick = useRev ? rev : fwd;
  return {
    score: pick.score,
    samples_used: pick.samples_used,
    verdict: verdictFor(pick.score, pick.samples_used),
    orientation: useRev ? 'reversed' : 'forward',
    other_orientation_score: useRev ? fwd.score : rev.score,
    samples: pick.samples,
  };
}

/** Page OCR texts of one book in page order (pages.ocr.data). */
export async function loadBookPageTexts(db, bookId) {
  const pages = await db.collection('pages')
    .find({ book_id: bookId }, { projection: { _id: 0, page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 })
    .toArray();
  return pages.map((p) => p?.ocr?.data || '');
}

export async function compareBooks(db, idA, idB) {
  const [a, b] = await Promise.all([loadBookPageTexts(db, idA), loadBookPageTexts(db, idB)]);
  return { ...comparePageTexts(a, b), pages_a: a.length, pages_b: b.length, comparator_version: COMPARATOR_VERSION };
}
