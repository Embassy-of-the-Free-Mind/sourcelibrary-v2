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
 * All four together say: the source carries a clause across the break and the translation
 * does not. That is a MOVED clause or a DROPPED one; both leave N+1 without its opening. The
 * anchor check (numerals and capitalised words from the fragment, found verbatim in N's tail
 * and not in N+1's head) separates the two only when the fragment has anchors to find.
 *
 * Deliberately NOT caught: a German/Dutch fragment opening on a capitalised noun (reads as a
 * sentence start), a fragment with no full stop within FRAGMENT_WINDOW chars, caseless scripts.
 * Recall is traded for precision: a parser that rejects on this re-translates pages.
 */

export const MIN_FRAGMENT_LETTERS = 20;

/**
 * The block prompt's page-boundary instruction, shared by the realtime worker and the batch
 * lane so the two stay byte-identical. Appended after the tag template.
 */
export const PAGE_BOUNDARY_RULE = '\n**Each page\'s translation must contain exactly the text of that page, no more and no less. If a page ends in the middle of a sentence, end its translation at the same point (mark the break with "…") and begin the next page\'s translation with the rest of that sentence. Never finish a sentence on one page with words that are printed on the next.**\n';
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

/**
 * Judge one in-block boundary. `ocrPrev` is kept in the signature for callers that
 * log context; the decision reads the next page's source and both translations.
 * Returns { drift, fragment, anchors, anchorVerdict } — drift=false carries a `reason`.
 */
export function detectBlockDrift({ ocrNext, trPrev, trNext }) {
  const fragment = continuationFragment(ocrNext);
  if (!fragment) return { drift: false, reason: 'source N+1 opens on a sentence (or no claim)' };
  const trNextHead = dropLeadingFurniture(translationProse(trNext));
  const trPrevTail = dropTrailingFurniture(translationProse(trPrev));
  if (!trNextHead || !trPrevTail) return { drift: false, reason: 'a translation is empty' };
  if (TR_ELLIPSIS_HEAD.test(trNextHead)) return { drift: false, reason: 'translation N+1 marks the continuation' };
  const first = trNextHead.match(/[\p{L}\p{N}]/u)?.[0];
  if (!first || (CASED.test(first) && first === first.toLowerCase())) {
    return { drift: false, reason: 'translation N+1 opens mid-sentence' };
  }
  if (TR_ELLIPSIS_TAIL.test(trPrevTail) || !TR_TERMINAL.test(trPrevTail)) {
    return { drift: false, reason: 'translation N leaves its last sentence open' };
  }
  const anchors = anchorsOf(fragment);
  const tail = trPrevTail.slice(-600), head = trNextHead.slice(0, 400);
  const inTail = anchors.filter(a => tail.includes(a)), inHead = anchors.filter(a => head.includes(a));
  const anchorVerdict = !anchors.length ? 'no-anchors'
    : inTail.length > inHead.length ? 'moved'
      : inHead.length > inTail.length ? 'at-head'
        : 'unknown';
  // A fragment whose anchors are all at the head of N+1 was translated where it belongs.
  if (anchorVerdict === 'at-head') return { drift: false, reason: 'fragment anchors found at the head of N+1', fragment, anchors };
  return { drift: true, fragment, anchors, anchorVerdict };
}

/**
 * Every drifted boundary inside one parsed block. `pages` in block order (page_number,
 * ocr.data); `translations` is the parser's Map<page_number, text>. Returns an array of
 * { prev, next, fragment, anchorVerdict } — empty when the block is clean.
 */
export function blockDriftBoundaries(pages, translations) {
  const found = [];
  for (let i = 0; i + 1 < pages.length; i++) {
    const a = pages[i], b = pages[i + 1];
    const trPrev = translations.get(a.page_number), trNext = translations.get(b.page_number);
    if (!trPrev || !trNext) continue;
    const r = detectBlockDrift({ ocrNext: b.ocr?.data, trPrev, trNext });
    if (r.drift) found.push({ prev: a.page_number, next: b.page_number, fragment: r.fragment, anchorVerdict: r.anchorVerdict });
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
