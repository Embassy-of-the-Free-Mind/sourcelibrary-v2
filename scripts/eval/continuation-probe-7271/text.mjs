// PRIOR ART: scripts/eval/ai-exposure-r3-6038.mjs (exact-passage presence in crawls, cleans OCR into 8-word windows;
// no continuation and no shared-run scoring); scripts/eval/experiments/2026-10-01-translation-recitation-pilot-5523.md
// (12+ word shared runs between a served translation and a published one). Neither turns a page into a prefix and a
// reference continuation, so the cleaning and the two scores for #7271 live here, in one file the draw, the probe and
// the scorer all import.
/**
 * text.mjs — page text → running words, and the two continuation scores (#7271).
 *
 *   cleanStored(s)   stored OCR/translation → running text: drops the metadata tags the OCR prompt writes
 *                    (<scan-quality>, <language>, <page-num>, <header>, <footer>, <note>, <image-desc>, <margin>, …)
 *                    WITH their content, strips every
 *                    other tag but keeps its text, drops markdown marks, joins hyphenated line ends, collapses space.
 *   words(s)         whitespace tokens of the cleaned text (the prefix and the truth are cut on these).
 *   norm(s)          the comparison form: NFC, long s → s, lower case, punctuation and symbols removed, so a word
 *                    is compared without its case or its stops (the brief's rule; u/v and i/j are NOT folded).
 *   score(out, truth) { longest_run, shingle8, n_truth_shingles }: the longest run of consecutive normalised words
 *                    shared by the model's output and the true next 200 words, and the share of the truth's 8-word
 *                    shingles that occur anywhere in the output.
 */
const META = ['scan-quality', 'language', 'script', 'page-type', 'page-num', 'header', 'footer', 'signature', 'sig',
  'catchword', 'running-head', 'folio', 'notes', 'note-meta', 'note', 'meta', 'vocab', 'keywords', 'summary',
  'image-desc', 'columns', 'warning', 'margin', 'sup'];

export function cleanStored(s) {
  let t = String(s || '');
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const m of META) t = t.replace(new RegExp(`<${m}\\b[^>]*>[\\s\\S]*?</${m}>`, 'gi'), ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t.replace(/^\s*\|?\s*:?-{3,}.*$/gm, ' ');            // markdown table rule rows
  t = t.replace(/\[?\(?continues? (from|on) (the )?(previous|next) page\)?\]?:?/gi, ' ');
  t = t.replace(/\[\^?\d+\]/g, ' ');                 // footnote markers
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '').replace(/\*\*|__|`/g, '').replace(/^\s*[-*]{3,}\s*$/gm, ' ');
  t = t.replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/\|/g, ' '));
  t = t.replace(/(\p{L})[-¬⸗]\s*\n\s*(\p{Ll})/gu, '$1$2'); // a word broken across a line end
  return t.replace(/\s+/g, ' ').trim();
}

// A page whose words are mostly not words (lacunae, sigla, numbers) cannot be continued or scored.
export const wordy = (ws) => ws.filter((w) => /\p{L}{2,}/u.test(w)).length / Math.max(1, ws.length);
export const words = (s) => String(s || '').split(/\s+/).filter(Boolean);

export function norm(s) {
  return String(s || '').normalize('NFC').replace(/ſ/g, 's').toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const nwords = (s) => words(norm(s));

export function longestRun(a, b) {
  // classic DP over word arrays, O(|a|·|b|), both ≤ a few hundred words
  let best = 0; let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
    prev = cur;
  }
  return best;
}

export function score(output, truth, k = 8) {
  const o = nwords(output), t = nwords(truth);
  const os = new Set(); for (let i = 0; i + k <= o.length; i++) os.add(o.slice(i, i + k).join(' '));
  let hit = 0, n = 0; for (let i = 0; i + k <= t.length; i++) { n++; if (os.has(t.slice(i, i + k).join(' '))) hit++; }
  return { longest_run: longestRun(o, t), shingle8: n ? hit / n : 0, n_truth_shingles: n, output_words: o.length };
}
