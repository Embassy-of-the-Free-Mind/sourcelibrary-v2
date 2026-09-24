// PRIOR ART: src/lib/page-continuity.ts — judges ONE page's edges (opens/ends mid-sentence)
// for quote hints; it is TypeScript for the web app, cannot be imported by a worker, and never
// compares a translation against its source, which is the whole test here. Its lessons are
// kept: strip furniture before judging an edge, caseless scripts make no claim.
// scripts/eval/translation-batch-continuity-ab.mjs ocrProse/assessSeam — the OCR-housekeeping
// strip is ported (it runs a CLI on import); assessSeam judges BLOCK seams, not in-block
// boundaries. scripts/lib/scholarly-typst.mjs endsMidSentence/startsMidSentence — joins two
// halves of a split sentence at print time; does not look at the source.
/**
 * block-drift — did a block translation move page N+1's opening onto page N? (#5021)
 *
 * The realtime worker and the batch lane translate up to 8 pages in one prompt and cut the
 * answer back into pages by `<translation page="N">` tags. When page N's source ends in the
 * middle of a sentence, the model sometimes FINISHES that sentence on page N — rendering the
 * opening clause of page N+1 there — and starts page N+1's translation at the next sentence.
 * Every text is healthy; the clause is simply on the wrong page. A reader of N+1 never sees
 * it, a citation of N+1 for it fails, and the seam-repair pass never looks at in-block pages.
 *
 * The test, all of it readable from text we already hold:
 *   1. the SOURCE of N+1 opens mid-sentence: after its furniture (page number, running head,
 *      scanner junk) the first prose letter is lowercase — a cased script only; caseless
 *      scripts make no claim, as in page-continuity.ts;
 *   2. that opening fragment — up to its first full stop — is more than a hyphen-completed
 *      word (MIN_FRAGMENT_LETTERS), so there is a clause to lose;
 *   3. the TRANSLATION of N+1 opens as a fresh sentence (capital or digit, no leading
 *      ellipsis) — the fragment is not at its head;
 *   4. the TRANSLATION of N ends on sentence-final punctuation (no trailing ellipsis or
 *      hyphen) — the sentence the source left open was closed on page N.
 *
 *   5. page N's last translated sentence grew by about the fragment's length
 *      (absorbedShare ≥ MIN_ABSORBED_SHARE), or the fragment's numerals/proper names sit in
 *      N's tail rather than N+1's head.
 *
 * Steps 1–4 alone flag every boundary where a translator re-opened N+1 with a capital (a
 * rephrase, a running head) — 6 of 20 hand-read flags were real. Step 5 is the move itself.
 *
 * MEASURED (2026-09-24, local mirror, #5021): 2.03% of in-block prose boundaries flagged;
 * on a fresh hand-read sample of 20 (one per book) 9 were real moves, 8 false, 3 unclear.
 * The single-page lane (prompt v2/v5), which cannot move text, flags 0.7–0.9% — that is the
 * floor; block-era prompts (v10/v11) flag 2.0–2.4%. A false positive costs a single-page
 * re-translation of two pages, never a wrong text, which is why ~50% precision is enough for
 * the parser to act on.
 *
 * The second shape, duplicatedAcrossBoundary(): N+1's opening on BOTH pages.
 *
 * Deliberately NOT caught: a German/Dutch fragment opening on a capitalised noun (reads as a
 * sentence start), a fragment with no full stop within FRAGMENT_WINDOW chars, caseless scripts.
 * Recall is traded for precision: a parser that rejects on this re-translates pages.
 */

export const MIN_FRAGMENT_LETTERS = 20;
export const FRAGMENT_WINDOW = 400;

const OCR_WRAPPERS = 'meta|vocab|language|lang|page-type|page-num|sig|scan-quality|script|columns|header|image-desc|folio|detected-images|catchword|warning|insert|margin|footnote|note';
const TR_WRAPPERS = 'meta|summary|keywords|vocab|warning|note|header|page-num|sig|margin|catchword|image-desc|footnote|folio';

/** Source text with housekeeping removed (ported from continuity-ab ocrProse, notes too). */
export function sourceProse(ocr) {
  return String(ocr || '')
    .replace(new RegExp(`<(${OCR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/->|<-/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

/** Translation body with editorial blocks removed. */
export function translationProse(tr) {
  return String(tr || '')
    .replace(new RegExp(`<(${TR_WRAPPERS})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi'), ' ')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/[*_#>`~|]/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

// A line that is furniture, not prose: no word of three letters (page numbers, signature
// marks, scanner debris like "E r ? . |"), or a short line with no lowercase letter at all
// (running heads, "19", "BOOK ONE").
const isFurnitureLine = (line) => {
  const t = line.trim();
  if (!t) return true;
  if (!/\p{L}{3,}/u.test(t)) return true;
  if (t.length <= 40 && !/\p{Ll}/u.test(t)) return true;
  return false;
};

function dropLeadingFurniture(text) {
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length && i < 6 && isFurnitureLine(lines[i])) i++;
  return lines.slice(i).join('\n').trim();
}

function dropTrailingFurniture(text) {
  const lines = text.split('\n');
  let j = lines.length;
  while (j > 0 && lines.length - j < 6 && isFurnitureLine(lines[j - 1])) j--;
  return lines.slice(0, j).join('\n').trim();
}

const CASED = /[\p{Ll}\p{Lu}]/u;
const FIRST_LETTER = /\p{L}/u;
// Full stops that close a sentence; ';' and ':' do not (they keep a clause going, and the
// Greek question mark is ';', so no claim there either).
const SENTENCE_END = /[.!?…](?:\s*[»”"'’)\]]+)?(?=\s|$)/u;
const TR_TERMINAL = /[.!?»”"'’)\]]$/u;
const TR_ELLIPSIS_TAIL = /(?:…|\.\s*\.\s*\.)\s*[»”"'’)\]]*$/u;
const TR_ELLIPSIS_HEAD = /^\s*[«“"'‘(\[]*\s*(?:…|\.\s*\.\s*\.)/u;

/**
 * An opening that is OCR noise, not prose: among the first six words, two or more that are a
 * lone letter ("f P Eine …") or shouting/garbled capitals ("va INDI GEO dARI"). A lowercase
 * first letter in debris says nothing about a sentence carried over.
 */
function looksLikeScanDebris(window) {
  const words = window.split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 6);
  const odd = words.filter(w => w.length === 1 || (w.length >= 2 && /\p{Lu}/u.test(w.slice(1)))).length;
  return odd >= 2;
}

/**
 * The clause a source page opens with when it continues the previous page, or null when
 * the page opens on a sentence (or the script is caseless, or there is no full stop soon).
 */
export function continuationFragment(ocrNext) {
  const head = dropLeadingFurniture(sourceProse(ocrNext));
  const window = head.slice(0, FRAGMENT_WINDOW);
  const firstLetter = window.match(FIRST_LETTER)?.[0];
  if (!firstLetter || !CASED.test(firstLetter)) return null;
  // Opening punctuation ("'mich", "‘riae") is fine; the first LETTER decides.
  const lead = window.slice(0, window.indexOf(firstLetter));
  if (/[\p{N}]/u.test(lead)) return null;
  if (firstLetter === firstLetter.toUpperCase()) return null;
  if (looksLikeScanDebris(window)) return null;
  const end = window.match(SENTENCE_END);
  if (!end) return null;
  const fragment = window.slice(0, end.index + end[0].length).replace(/\s+/g, ' ').trim();
  const letters = fragment.replace(/[^\p{L}]/gu, '').length;
  if (letters < MIN_FRAGMENT_LETTERS) return null;
  return fragment;
}

/** Numerals and capitalised words (not sentence-initial) — tokens that survive translation. */
export function anchorsOf(fragment) {
  const out = new Set();
  for (const m of fragment.matchAll(/\p{N}{2,}/gu)) out.add(m[0]);
  const words = fragment.split(/\s+/);
  words.forEach((w, i) => {
    const word = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (i > 0 && word.length >= 4 && /^\p{Lu}\p{Ll}/u.test(word)) out.add(word);
  });
  return [...out];
}

// Bracketed editorial blocks a translator puts at a page edge ("[The manuscript begins in the
// middle of a sentence …]", a trailing "[vocabulary: …]" list): not text of the page.
const stripEdgeBrackets = (t) => t.replace(/^\s*\[[^\]]{0,400}\]\s*/u, '').replace(/\s*\[[^\]]{0,3000}\]\s*$/u, '').trim();

const SENTENCE_ENDS = new RegExp(SENTENCE_END.source, 'gu');
const flat = (t) => t.replace(/\s+/g, ' ').trim();

/**
 * How much of the fragment's length page N's last translated sentence has absorbed.
 * P = the source's unfinished sentence at the foot of page N, T = the last sentence of page
 * N's translation, r = page N's translation/source length ratio. If the translation stopped
 * where the source stops, T ≈ r·P and the score is ≈ 0; if it carried on through the
 * fragment F, T ≈ r·(P + F) and the score is ≈ 1. Language-independent: lengths only.
 */
export function absorbedShare({ ocrPrev, trPrevTail, fragment }) {
  const src = flat(sourceProse(ocrPrev)), tr = flat(trPrevTail);
  if (!src || !tr) return 0;
  const srcEnds = [...src.matchAll(SENTENCE_ENDS)];
  const lastSrc = srcEnds[srcEnds.length - 1];
  const P = src.length - (lastSrc ? lastSrc.index + lastSrc[0].length : 0);
  const trEnds = [...tr.matchAll(SENTENCE_ENDS)];
  const prevEnd = trEnds.length >= 2 ? trEnds[trEnds.length - 2] : null;
  const T = tr.length - (prevEnd ? prevEnd.index + prevEnd[0].length : 0);
  const r = tr.length / src.length;
  return (T / r - P) / fragment.length;
}
export const MIN_ABSORBED_SHARE = 0.75;

const words = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Three consecutive words of the fragment's opening, verbatim in `text` (same-language books). */
function sharesOpening(fragment, text) {
  const f = words(fragment).slice(0, 10), t = ` ${words(text).join(' ')} `;
  for (let i = 0; i + 3 <= f.length; i++) if (t.includes(` ${f.slice(i, i + 3).join(' ')} `)) return true;
  return false;
}

/**
 * Judge one in-block boundary: page N (`ocrPrev`, `trPrev`) and page N+1 (`ocrNext`,
 * `trNext`). Returns { drift, fragment, absorbed, anchorVerdict } — drift=false carries a
 * `reason`.
 */
export function detectBlockDrift({ ocrPrev, ocrNext, trPrev, trNext, minAbsorbed = MIN_ABSORBED_SHARE }) {
  const fragment = continuationFragment(ocrNext);
  if (!fragment) return { drift: false, reason: 'source N+1 opens on a sentence (or no claim)' };
  const trNextHead = stripEdgeBrackets(dropLeadingFurniture(translationProse(trNext)));
  const trPrevTail = stripEdgeBrackets(dropTrailingFurniture(translationProse(trPrev)));
  if (!trNextHead || !trPrevTail) return { drift: false, reason: 'a translation is empty' };
  if (TR_ELLIPSIS_HEAD.test(trNextHead)) return { drift: false, reason: 'translation N+1 marks the continuation' };
  const first = trNextHead.match(/[\p{L}\p{N}]/u)?.[0];
  if (!first || (CASED.test(first) && first === first.toLowerCase())) {
    return { drift: false, reason: 'translation N+1 opens mid-sentence' };
  }
  if (TR_ELLIPSIS_TAIL.test(trPrevTail) || !TR_TERMINAL.test(trPrevTail)) {
    return { drift: false, reason: 'translation N leaves its last sentence open' };
  }
  // A translation that rephrases the opening with a capital ("The King showed … when he
  // forbade") keeps the clause where it belongs; in a same-language book the words show it.
  if (sharesOpening(fragment, trNextHead.slice(0, 400))) return { drift: false, reason: 'fragment opening found at the head of N+1', fragment };
  const anchors = anchorsOf(fragment);
  const tail = trPrevTail.slice(-600), head = trNextHead.slice(0, 400);
  const inTail = anchors.filter(a => tail.includes(a)), inHead = anchors.filter(a => head.includes(a));
  const anchorVerdict = !anchors.length ? 'no-anchors'
    : inTail.length > inHead.length ? 'moved'
      : inHead.length > inTail.length ? 'at-head'
        : 'unknown';
  if (anchorVerdict === 'at-head') return { drift: false, reason: 'fragment anchors found at the head of N+1', fragment, anchors };
  // The decisive test: did page N's last sentence grow by the fragment's length?
  const absorbed = ocrPrev == null ? null : absorbedShare({ ocrPrev, trPrevTail, fragment });
  if (absorbed != null && absorbed < minAbsorbed && anchorVerdict !== 'moved') {
    return { drift: false, reason: 'page N\'s last sentence did not grow by the fragment', fragment, absorbed };
  }
  return { drift: true, fragment, anchors, anchorVerdict, absorbed };
}

/** Longest run two strings share (40-char shingles of b, extended both ways). */
export function sharedRun(a, b) {
  const K = 40, idx = new Map();
  for (let i = 0; i + K <= b.length; i += 8) { const s = b.slice(i, i + K); if (!idx.has(s)) idx.set(s, i); }
  let best = 0, bestA = -1;
  for (let i = 0; i + K <= a.length; i++) {
    const j = idx.get(a.slice(i, i + K)); if (j == null) continue;
    let back = 0; while (i - back > 0 && j - back > 0 && a[i - back - 1] === b[j - back - 1]) back++;
    let L = K; while (i + L < a.length && j + L < b.length && a[i + L] === b[j + L]) L++;
    if (L + back > best) { best = L + back; bestA = i - back; }
    i += Math.max(0, L - K);
  }
  return { len: best, text: bestA >= 0 ? a.slice(bestA, bestA + Math.min(best, 200)) : '' };
}

export const DUPLICATE_MIN_CHARS = 150;
/**
 * The other shape of the same failure (#5021/#5026): page N+1's opening translated at the end
 * of page N AND again at the head of N+1. Measured on the corpus as a shared run between the
 * last 40% of N and the first 10% of N+1 — 7 of 7 such flags hand-read were real, and the
 * shape is absent from the single-page lane (prompt v2/v5), so it is a block artefact.
 */
export function duplicatedAcrossBoundary(trPrev, trNext) {
  const a = flat(translationProse(trPrev)), b = flat(translationProse(trNext));
  const tail = a.slice(Math.floor(a.length * 0.6)), head = b.slice(0, Math.max(600, Math.floor(b.length * 0.1)));
  const run = sharedRun(tail, head);
  return run.len >= DUPLICATE_MIN_CHARS ? run : null;
}

/**
 * Every drifted boundary inside one parsed block. `pages` in block order (page_number,
 * ocr.data); `translations` is the parser's Map<page_number, text>. Returns an array of
 * { prev, next, kind: 'moved'|'duplicated', fragment } — empty when the block is clean.
 */
export function blockDriftBoundaries(pages, translations) {
  const found = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], b = pages[i + 1];
    const trPrev = translations.get(a.page_number), trNext = translations.get(b.page_number);
    if (!trPrev || !trNext) continue;
    const dup = duplicatedAcrossBoundary(trPrev, trNext);
    if (dup) { found.push({ prev: a.page_number, next: b.page_number, kind: 'duplicated', fragment: dup.text }); continue; }
    const r = detectBlockDrift({ ocrPrev: a.ocr?.data, ocrNext: b.ocr?.data, trPrev, trNext });
    if (r.drift) found.push({ prev: a.page_number, next: b.page_number, kind: 'moved', fragment: r.fragment, anchorVerdict: r.anchorVerdict });
  }
  return found;
}

/**
 * Remove BOTH pages of every drifted boundary from a parsed block, so the caller's
 * existing "missing from batch" path re-translates them single-page, in order, each with the
 * previous page's translation as continuity. Mutates and returns `translations`.
 */
export function dropDriftedPages(pages, translations) {
  const drifted = blockDriftBoundaries(pages, translations);
  for (const d of drifted) { translations.delete(d.prev); translations.delete(d.next); }
  return { translations, drifted };
}
