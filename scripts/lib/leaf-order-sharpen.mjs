// PRIOR ART: scripts/lib/page-integrity.mjs — pageNumberBreaks (the break), duplicateScan /
// bigramDice (the copy test, fixed at Dice 0.9 and at N vs N+1/N+2) and pagesChain (the join) are
// imported from it; nothing there sorts a break it has already flagged, which is all this does.
// scripts/lib/page-break-devices.mjs resolvePageBreak — joins a split word for the translator;
// it has no "the word was NOT finished" verdict, so the seam test below reads the foot itself.
/**
 * leaf-order-sharpen — what IS each printed page-number break of #5059?
 *
 * The page-integrity walk flags a jump, back-step or repeat in a book's printed numbers unless a
 * Dice ≥ 0.9 copy sits beside it. Its hand-read (n = 20) found 9 real, 8 false, and the real ones
 * of two kinds: copies the 0.9 missed, and leaves that are not there. This sorts the list with
 * the evidence the stored text and the image URL already carry. Per break, in this order:
 *
 *   'gone'           a page of the pair is no longer in the book, or the pair is no longer a
 *                    break on the text stored now (re-OCR, a repair, a moved page)
 *   'misnumbered'    the two scans CHAIN (catchword, or a word broken across them), or the foot
 *                    ends on a catchword cut short that the head opens with ("Aspe-" | "Aspera")
 *   'duplicate'      a copy the 0.9 Dice missed: a scan within DUP_WINDOW of the break and another
 *                    at most DUP_MAX_GAP from it at Dice ≥ SHARP_DUP_DICE ('near'), or — for a
 *                    back-step or repeat — the scan after the break against an earlier scan
 *                    printed with the same number ('far', a section photographed twice)
 *   'leaf-skipped'   a jump whose two scans are NOT neighbours in the holding library's own
 *                    leaf order (the Archive's /page/nNN/): the leaf exists at the source and
 *                    our copy does not hold it. The cheapest repair: same item, known leaf.
 *   'text-breaks'    a jump between neighbouring scans where the foot ends on a hyphen-broken
 *                    word and the head does not finish it (not even after a running head set
 *                    in capitals): text is missing between them
 *   'far-off'        the numbers are too far apart to be one sequence (another counter, a new
 *                    work bound in, or a block of many leaves) — not judged
 *   'unresolved'     everything else. For a jump the row carries `sourceLeaves`: 'consecutive'
 *                    means the source scan has no leaf between the two — a printer's
 *                    misnumbering, or a leaf the library never photographed; reading decides.
 *
 * A sentence left open at the foot is NOT used: most pages end mid-sentence, with or without a
 * leaf missing after them (the 2026-09-24 walk's first 'misnumbered' rule failed on exactly this).
 * Unsegmented scripts and pages under DUP_MIN_CHARS cannot be Dice-compared; they fall through
 * with `dupJudged: false`, never as "no copy found" (non-latin-text-operations.md).
 */
import {
  pageNumberBreaks, parsePageNum, duplicateScan, sourceProse, foldWord, NON_TEXT_TYPES,
  PN_OTHER_COUNTER_MIN, PN_OTHER_COUNTER_SHARE,
} from './page-integrity.mjs';

export const SHARP_DUP_DICE = 0.8;
export const DUP_WINDOW = 1;      // a copy must involve a scan this close to the break (the walk's own rule)
export const DUP_MAX_GAP = 4;     // … and how far apart two compared scans may be
export const FAR_COPY_MAX = 8;    // earlier scans printed with the same number that are tried
export const VERDICTS = ['gone', 'misnumbered', 'duplicate', 'leaf-skipped', 'far-off', 'text-breaks', 'unresolved', 'no-text'];

const BREAK_HYPHEN_END = /\p{L}[-‐‑⸗¬=]$/u;

/** The foot of scan `from` and the head of scan `to`, as prose (for the seam test and the hand-read). */
export function seamText(pages, from, to, chars = 200) {
  const a = pages.find(r => r.p === from), b = pages.find(r => r.p === to);
  const foot = sourceProse(a?.ocr).replace(/[\s*_\]\)>]+$/u, '');
  const head = sourceProse(b?.ocr).replace(/^[^\p{L}\p{N}]+/u, '');
  return { foot: foot.slice(-chars).replace(/\s+/g, ' '), head: head.slice(0, chars).replace(/\s+/g, ' ') };
}

/** Best Dice between a scan AT the break (within DUP_WINDOW of it) and any scan up to
 *  DUP_MAX_GAP away; { judged, dice, page, copyOf } (page = the later scan of the pair). A copy
 *  further off sits beside some other boundary and explains nothing here. */
function nearCopy(pages, ia, ib) {
  let best = null, judged = false;
  const seen = new Set();
  for (let i = Math.max(0, ia - DUP_WINDOW); i <= Math.min(pages.length - 1, ib + DUP_WINDOW); i++) {
    for (let j = Math.max(0, i - DUP_MAX_GAP); j <= Math.min(pages.length - 1, i + DUP_MAX_GAP); j++) {
      const lo = Math.min(i, j), hi = Math.max(i, j);
      if (lo === hi || seen.has(`${lo}:${hi}`)) continue;
      seen.add(`${lo}:${hi}`);
      const d = duplicateScan(pages[lo].ocr, pages[hi].ocr);
      if (!d.judged) continue;
      judged = true;
      if (!best || d.dice > best.dice) best = { dice: d.dice, page: pages[hi].p, copyOf: pages[lo].p };
    }
  }
  return { judged, ...best };
}

/** The scan after a back-step or repeat against earlier scans printed with the same number. */
function farCopy(pages, ib, numbered, kind) {
  const b = pages[ib], v = parsePageNum(b.ocr);
  if (!v) return { judged: false };
  let best = null, judged = false, tried = 0;
  for (const e of numbered.get(`${kind}:${v.value}`) || []) {
    if (e >= ib - DUP_MAX_GAP) break;            // the near window owns those
    if (++tried > FAR_COPY_MAX) break;
    const d = duplicateScan(pages[e].ocr, b.ocr);
    if (!d.judged) continue;
    judged = true;
    if (!best || d.dice > best.dice) best = { dice: d.dice, page: b.p, copyOf: pages[e].p };
  }
  return { judged, ...best };
}

/**
 * Sort one book's listed breaks. `pages` = rows in scan order {p, ocr, type, leaf?}; `listed` =
 * rows of the leaf-order repair list for this book. Returns the listed rows, each with
 * { verdict, why?, dice?, page?, copyOf?, dupJudged, sourceLeaves?, leafGap? }.
 */
export function sharpenBook(pages, listed) {
  const idx = new Map(pages.map((r, i) => [r.p, i]));
  const now = new Map(pageNumberBreaks(pages).breaks.map(b => [`${b.numbering}:${b.from}:${b.to}`, b]));
  const numbered = new Map();
  pages.forEach((r, i) => {
    const v = parsePageNum(r.ocr);
    if (!v || v.kind === 'other') return;
    const k = `${v.kind}:${v.value}`;
    (numbered.get(k) || numbered.set(k, []).get(k)).push(i);
  });
  return listed.map((r) => {
    const { book: _book, ...row } = r;
    const ia = idx.get(r.from), ib = idx.get(r.to);
    if (ia == null || ib == null) return { ...row, verdict: 'gone', why: 'page-absent' };
    const cur = now.get(`${r.numbering}:${r.from}:${r.to}`);
    if (!cur) return { ...row, verdict: 'gone', why: 'no-longer-a-break' };
    if (cur.shape === 'misnumbered') return { ...row, verdict: 'misnumbered', why: 'chains' };
    if (!['jump', 'back', 'repeat'].includes(cur.shape)) return { ...row, verdict: 'gone', why: `now-${cur.shape}` };
    const out = { ...row, shape: cur.shape, d: cur.d, fromValue: cur.fromValue, toValue: cur.toValue, rate: cur.rate };

    // 1. a copy the 0.9 Dice missed
    const near = nearCopy(pages, ia, ib);
    const far = cur.shape === 'jump' ? { judged: false } : farCopy(pages, ib, numbered, r.numbering);
    out.dupJudged = near.judged || far.judged;
    const copy = [near, far].filter(c => c.dice != null).sort((x, y) => y.dice - x.dice)[0];
    if (copy) out.dice = copy.dice;
    if (copy && copy.dice >= SHARP_DUP_DICE) {
      return { ...out, verdict: 'duplicate', why: copy === far ? 'far' : 'near', page: copy.page, copyOf: copy.copyOf };
    }

    // 2. the holding library's own leaf order across a jump
    const between = pages.slice(ia + 1, ib);
    const textBetween = between.some(p => !NON_TEXT_TYPES.has(p.type) && sourceProse(p.ocr).length >= 200);
    if (cur.shape === 'jump') {
      const la = pages[ia].leaf, lb = pages[ib].leaf;
      if (Number.isInteger(la) && Number.isInteger(lb)) {
        const gap = lb - la - (ib - ia);
        out.sourceLeaves = gap > 0 ? 'gap' : gap === 0 ? 'consecutive' : 'out-of-order';
        if (gap > 0) return { ...out, verdict: 'leaf-skipped', leafGap: gap };
      }
    }

    // 3. a word broken at the foot that the head does not finish
    if (cur.shape === 'jump' && !textBetween) {
      const foot = sourceProse(pages[ia].ocr).replace(/[\s*_\]\)>]+$/u, '');
      const head = sourceProse(pages[ib].ocr).replace(/^[^\p{L}\p{N}]+/u, '');
      // A running head or a heading set in capitals above the text ("car-" | "INTRODUCTION.
      // rière; et, …") is not where the text resumes: look past it for the lowercase ending.
      const resumed = head.replace(/^(?:[^\p{Ll}\s]+\s+){1,8}(?=\p{Ll})/u, '');
      if (BREAK_HYPHEN_END.test(foot) && head && !/^\p{Ll}/u.test(head) && resumed === head) {
        // "Quin-" | "I. Quintò. Rursus", "Aspe-" | "Aspera componi": the fragment at the foot is
        // the CATCHWORD, cut short — the head opens with the word it begins, so the scans chain.
        const frag = foldWord((foot.match(/(\p{L}+)[-‐‑⸗¬=]$/u) || [])[1] || '');
        const opens = head.slice(0, 60).split(/[^\p{L}]+/u).filter(Boolean).slice(0, 3).map(foldWord);
        if (frag.length >= 2 && opens.some(w => w.length > frag.length && w.startsWith(frag))) return { ...out, verdict: 'misnumbered', why: 'catchword-fragment' };
        return { ...out, verdict: 'text-breaks', why: 'split-word-unfinished' };
      }
    }
    // 4. numbers too far apart to be one sequence
    const expected = cur.toValue - cur.d;
    if (Math.abs(cur.d) >= PN_OTHER_COUNTER_MIN && Math.abs(cur.d) > PN_OTHER_COUNTER_SHARE * Math.max(1, expected)) {
      return { ...out, verdict: 'far-off' };
    }

    return { ...out, verdict: 'unresolved', ...(textBetween ? { why: 'text-scans-between' } : {}) };
  });
}
