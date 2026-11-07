// PRIOR ART: none — the word-diff truth for anchor survival is new with #5942 Part A; it was inline in measure-a.mts
// and moved here so Part B's rewrite test (robustness.mjs) judges anchors by the same rule.
/** Where did an anchor's words go after a rewrite? The word diff (jsdiff) is the ground truth. */
import { diffWordsWithSpace } from 'diff';

/** Old-text offset → new-text offset, for characters the word diff keeps; and the share kept. */
export function alignment(a, b) {
  const map = new Int32Array(a.length + 1).fill(-1);
  let i = 0, j = 0, same = 0;
  for (const part of diffWordsWithSpace(a, b)) {
    const n = part.value.length;
    if (part.added) { j += n; continue; }
    if (part.removed) { i += n; continue; }
    for (let k = 0; k < n; k++) map[i + k] = j + k;
    i += n; j += n; same += n;
  }
  map[a.length] = b.length;
  return { map, similarity: same / Math.max(1, a.length, b.length) };
}

/** Where the anchor truly went, by the diff: [s, e] in the new text, or null when its words did not survive. */
export function truthOf(map, a) {
  if (a.start === a.end) {
    // A point: the characters on both sides must survive, side by side.
    const l = a.start > 0 ? map[a.start - 1] : -1, r = map[a.start];
    if (a.start > 0 && l < 0) return null;
    if (r < 0) return null;
    if (a.start > 0 && r !== l + 1) return null;
    return [r, r];
  }
  for (let k = a.start; k < a.end; k++) if (map[k] < 0 || (k > a.start && map[k] !== map[k - 1] + 1)) return null;
  return [map[a.start], map[a.end - 1] + 1];
}

/** One anchor after a rewrite: resolved (and how), orphaned (words gone or still there), or misplaced. */
export function classify(r, truth) {
  if (r && truth) {
    const overlap = r.start < truth[1] + (truth[0] === truth[1] ? 1 : 0) && truth[0] < r.end + (r.start === r.end ? 1 : 0);
    return overlap ? `resolved:${r.how}` : 'MISPLACED (diff disagrees)';
  }
  if (r && !truth) return 'resolved, diff lost the words (read by eye)';
  if (!r && truth) return 'orphan, words still there';
  return 'orphan, words gone';
}
