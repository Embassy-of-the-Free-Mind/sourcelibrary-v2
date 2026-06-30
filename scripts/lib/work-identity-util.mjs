/**
 * Shared helpers for work_id resolver tooling (probe / merge / gold-set).
 * Single source of truth for normalization + the SERIES GUARD, so the harness
 * and the merge tool can't drift. (Issue #2909.)
 */

export function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const STOP = new Set(['the', 'and', 'with', 'from', 'vol', 'volume', 'part', 'tome', 'band', 'book', 'der', 'die',
  'des', 'von', 'und', 'of', 'les', 'la', 'le', 'el', 'für', 'mit', 'thor', 'bu', 'sogs', 'rnam', 'pa', 'ba']);

/** Significant title tokens: ≥4 chars, non-stopword. (Drops numbers/short words.) */
export function sig(s) {
  return [...new Set(norm(s).split(' ').filter((t) => t.length >= 4 && !STOP.has(t)))];
}

export function surname(a) {
  return norm(a).split(' ').filter(Boolean).pop() || '';
}

// ── SERIES GUARD ─────────────────────────────────────────────────────────────
// The over-split false-positive class: distinct texts that share a generic base
// title and differ only by a SERIES DISTINGUISHER the `sig()` tokenizer drops —
// "Proverbs: collection 10" vs "11", "A Balbale to Inana" vs "…for Šu-Suen",
// pecha "…rgyud mi" vs "…rgyud phi", "Bodleian MS Barocci 6" sub-texts. We pull
// the distinguishing tokens out of the RAW title (before sig() eats them):
//   - small integers 1–999 (series/collection/section numbers) — but NOT 4-digit
//     edition YEARS (1450–2099), which legitimately vary across editions of one
//     work and must NOT split it;
//   - roman numerals (i–xxx range, lowercased);
//   - single Latin/Tibetan section letters in a "rgyud X" / "tome X" position is
//     covered by the integer/roman cases above for Latin; pure single-letter
//     pecha markers are handled by requiring the distinguishers to MATCH.
// Two titles can be "the same work" only if their series-distinguisher multisets
// are equal. Returns a stable string key of the distinguishers.
const ROMAN = /\b(x{0,3})(ix|iv|v?i{0,3})\b/;
export function seriesKey(title) {
  const t = norm(title);
  const toks = t.split(' ').filter(Boolean);
  const out = [];
  toks.forEach((tok, idx) => {
    // integer, optionally with a part-letter suffix: "10", "13a", "11b"
    const m = tok.match(/^(\d{1,3})([a-z]?)$/);
    if (m) { const n = +m[1]; if (!(n >= 1450 && n <= 2099) && n >= 1) out.push(`n${m[1]}${m[2]}`); return; }
    if (/^\d+$/.test(tok)) return; // 4-digit+ (edition year / large id) — ignore
    if (tok.length <= 4 && ROMAN.test(tok) && /[ivx]/.test(tok) && tok === (tok.match(ROMAN) || [])[0]) { out.push(`r${tok}`); return; } // roman volume/part
    // trailing single-letter catalog siglum: "...Šulgi O" vs "...Šulgi E" (ETCSL).
    // Only the LAST token, only a lone a–z, only if the title has real content.
    if (idx === toks.length - 1 && /^[a-z]$/.test(tok) && toks.length >= 3) out.push(`s${tok}`);
  });
  return out.sort().join('+');
}

/**
 * Two titles are series-compatible (could be the same work) iff their series
 * distinguishers match. "Proverbs collection 10" vs "11" → 'n10' ≠ 'n11' → false.
 * "Horologium (1673)" vs "Horologium" → '' == '' → true (year ignored).
 */
export function sameSeries(titleA, titleB) {
  return seriesKey(titleA) === seriesKey(titleB);
}
