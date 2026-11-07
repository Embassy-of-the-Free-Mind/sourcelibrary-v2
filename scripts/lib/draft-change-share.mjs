// PRIOR ART: scripts/eval/gpu-flash-vs-opus-7263/triggers.py (#7263) — T3, the measure this ports: the share of the
// draft's folded words the corrector did not keep, on Python's difflib.SequenceMatcher(autojunk=False). Its p90 on the
// Latin TEST (27%) is the check-flag threshold Derek adopted, so the measure must be the same one, not a near one.
// scripts/batch/cli-ocr.mjs changedUnits — counts changed whitespace tokens with an LCS (alignSyllables), unfolded and
// with tag lines kept: a different number on the same pair (it is the 25% refuse guard of correct mode, not T3).
/**
 * draft-change-share — how much of a GPU draft an agy correction changed (#7263 T3).
 *
 *   changeShare(draft, corrected) -> share in [0, 1] of the draft's words that are not in a matching block
 *
 * words(): metadata tag lines out (<scan-quality>, <language>, <script>, <page-type>, <vocab>, <meta>, <warning>,
 * <columns>, <page-num>, <sig>, <header>, <image-desc>), other tags replaced by a space, split on whitespace, each word
 * NFC, lower case, ſ -> s, every non-word character removed, empty words dropped. Exactly triggers.py `words`.
 * matchedCount(): the total size of difflib's matching blocks (find_longest_match, recursively left and right of each
 * block; no junk, no autojunk), the same blocks Python returns.
 */

const TAGLINE = /^\s*<(scan-quality|language|script|page-type|vocab|meta|warning|columns|page-num|sig|header|image-desc)\b[^>]*>.*<\/\1>\s*$/i;

/** The folded words of a transcription, as triggers.py `words` makes them. */
export function words(t) {
  const body = String(t ?? '').split('\n').filter((l) => !TAGLINE.test(l)).join('\n').replace(/<[^>]+>/g, ' ');
  // Python's `[^\w]` with re.UNICODE: letters and numbers (any script) and the underscore are word characters; combining marks are not (str.isalnum).
  return body.split(/\s+/).map((w) => w.normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean);
}

/** difflib.SequenceMatcher(None, a, b, autojunk=False): the summed size of get_matching_blocks(). */
export function matchedCount(a, b) {
  const b2j = new Map();
  b.forEach((x, j) => { if (!b2j.has(x)) b2j.set(x, []); b2j.get(x).push(j); });
  const longest = (alo, ahi, blo, bhi) => {
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of b2j.get(a[i]) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = next;
    }
    // No junk, so difflib's junk-extension loops are no-ops; the popular-element pass is off with autojunk=False.
    return [besti, bestj, bestsize];
  };
  let total = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    total += k;
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  return total;
}

/** Share of the draft's words the corrected text did not keep (triggers.py `unmatched`): 1 for an empty draft. */
export function changeShare(draft, corrected) {
  const a = words(draft);
  if (!a.length) return 1;
  return 1 - matchedCount(a, words(corrected)) / a.length;
}

/** The check flag Derek adopted (2026-10-28): Flash changed >= 27% of the draft's words (T3 p90, Latin TEST). */
export const CHECK_FLAG_SHARE = 0.27;
