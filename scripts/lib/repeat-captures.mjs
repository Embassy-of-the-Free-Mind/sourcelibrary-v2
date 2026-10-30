/**
 * Plan which repeat captures to hide in a book (#5056): pure, no database.
 *
 * PRIOR ART: scripts/dedup-autoapply.mjs and scripts/dedup-apply-approved.mjs
 * (#1721) — they hide a duplicate page by making its page_number negative,
 * which renumbers the book and breaks every shortlink, `?page=N` and citation
 * made against it (the arbiter note on #5056). scripts/audit/page-repeat-images.mjs
 * finds the pairs but writes nothing. This plans the `repeat_of` hide, which
 * keeps every page_number and id.
 *
 * Input: pairs { pageId (the later capture), copyOfId (the earlier) } that the
 * detector scored as the same leaf, and the current page docs. Output: per
 * cluster of captures of one leaf, the page to keep and the pages to hide, or
 * an `ambiguous` verdict that hides nothing.
 *
 * Rules:
 *  - Pairs are joined into clusters (p2≈p4 and p4≈p6 are one leaf shot three
 *    times), so every hidden page points straight at the kept one: no chains.
 *    A page is hidden only if it was compared with the kept page directly;
 *    a cluster joined through a middle capture alone is ambiguous.
 *  - The kept page is never itself hidden, and a page already pointing
 *    elsewhere is left alone.
 *  - Keep the earliest capture, unless another holds clearly more text (a slip
 *    lifted, a fuller crop): then keep that one. "Clearly" is both a ratio and
 *    an absolute margin, so a 40-vs-52-word title page is not a winner.
 *  - Between "same" and "clearly more" is ambiguous: listed, nothing hidden.
 *    So is a cluster where an occlusion (a slip, a tissue guard, a fold-out)
 *    is named in a capture's OCR and the text counts give no clear winner —
 *    the arbiter sample found the slip on the earlier capture as often as on
 *    the later one.
 */

import { stripMarkupTags } from './strip-markup-tags.mjs';

/** The tokenizer of scripts/audit/page-repeat-images.mjs --rescore, on the shared tag strip (#5564). */
export function wordCount(text) {
  return (stripMarkupTags(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).length;
}

/**
 * Things a capture can hold that its twin lacks (a slip, a tissue guard, a fold-out), as the
 * OCR DESCRIBES them. Only the descriptive tags are read: the book's own words match
 * `obscur…` or `cover` all the time (Latin *obscura*, "did cover the earth"), and the first
 * cut of this rule held 456 clusters on exactly that.
 */
export const OCCLUSION_RE = /\b(slips?|obscur\w*|covered|covering|tissue|fold-?out|folded (?:plate|sheet|leaf)|pasted|overlay|overlaid|flap|bookmark|paper strip)\b/i;
const DESCRIPTIVE_TAG_RE = /<(warning|note|meta|image-desc)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** True iff the OCR's own description of the page names an occlusion. */
export function namesOcclusion(text) {
  for (const m of (text || '').matchAll(DESCRIPTIVE_TAG_RE)) if (OCCLUSION_RE.test(m[2])) return true;
  return false;
}

/** A later capture wins only with this much more text (ratio AND absolute words). */
export const CLEAR_RATIO = 1.25;
export const CLEAR_WORDS = 30;
/** Below this the counts are the same leaf read twice; between the two is ambiguous. */
export const SAME_RATIO = 1.1;
export const SAME_WORDS = 15;

/**
 * @param {Array<{pageId: string, copyOfId: string}>} pairs - one book's pairs
 * @param {Map<string, object>} pagesById - current docs: { id, book_id, page_number, repeat_of, ocr: { data } }
 * @returns {{ clusters: object[], skipped: object[] }}
 */
export function planBookRepeats(pairs, pagesById) {
  const skipped = [];
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const linked = new Set();
  let bookId = null;
  for (const pr of pairs) {
    const a = pagesById.get(pr.copyOfId), b = pagesById.get(pr.pageId);
    if (!a || !b) { skipped.push({ ...pr, why: 'page missing' }); continue; }
    if (a.book_id !== b.book_id) { skipped.push({ ...pr, why: 'different books' }); continue; }
    if (bookId && a.book_id !== bookId) throw new Error(`planBookRepeats: pairs span two books (${bookId}, ${a.book_id})`);
    bookId = a.book_id;
    if (!(a.page_number > 0) || !(b.page_number > 0)) { skipped.push({ ...pr, why: 'soft-hidden page (page_number <= 0)' }); continue; }
    if (pr.page != null && pr.copyOf != null && (a.page_number !== pr.copyOf || b.page_number !== pr.page)) {
      skipped.push({ ...pr, why: `renumbered since the scan (${pr.copyOf}->${a.page_number}, ${pr.page}->${b.page_number})` });
      continue;
    }
    for (const id of [a.id, b.id]) if (!parent.has(id)) parent.set(id, id);
    union(a.id, b.id);
    linked.add(pairKey(a.id, b.id));
  }

  const groups = new Map();
  for (const id of parent.keys()) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(pagesById.get(id));
  }

  const clusters = [];
  for (const members of groups.values()) {
    members.sort((x, y) => x.page_number - y.page_number);
    const info = members.map(p => ({
      id: p.id, page_number: p.page_number,
      words: wordCount(p.ocr?.data),
      occlusion: namesOcclusion(p.ocr?.data),
      repeat_of: p.repeat_of ?? null,
    }));
    const cluster = { book_id: bookId, members: info };
    // Already hidden by an earlier run: only consistent if all hidden ones name the same kept page in this cluster.
    const prior = info.filter(m => m.repeat_of != null);
    if (prior.length) {
      const targets = new Set(prior.map(m => m.repeat_of));
      const keptId = [...targets][0];
      const keptInCluster = info.find(m => m.id === keptId && m.repeat_of == null);
      if (targets.size === 1 && keptInCluster && prior.length === info.length - 1) {
        clusters.push({ ...cluster, verdict: 'done', keep: keptId, hide: [] });
      } else {
        clusters.push({ ...cluster, verdict: 'ambiguous', why: 'already partly hidden by another rule', keep: null, hide: [] });
      }
      continue;
    }

    const first = info[0];
    const other = info.slice(1).reduce((best, m) => (m.words > best.words ? m : best));
    const anyOcclusion = info.some(m => m.occlusion);
    const same = (big, small) => big.words / Math.max(1, small.words) < SAME_RATIO || big.words - small.words < SAME_WORDS;
    const clear = (big, small) => big.words / Math.max(1, small.words) >= CLEAR_RATIO && big.words - small.words >= CLEAR_WORDS;
    const ambiguous = (why) => clusters.push({ ...cluster, verdict: 'ambiguous', why, keep: null, hide: [] });

    let keep, why;
    if (other.words <= first.words) {
      // The earliest holds at least as much text. Keep it, unless the two read alike and
      // an occlusion is named: then which capture is clean is a question for the image.
      if (same(first, other) && anyOcclusion) { ambiguous('an occlusion is named in the OCR and the word counts give no winner'); continue; }
      keep = first; why = 'earliest';
    } else if (same(other, first)) {
      if (anyOcclusion) { ambiguous('an occlusion is named in the OCR and the word counts give no winner'); continue; }
      keep = first; why = 'earliest';
    } else if (clear(other, first)) {
      if (other.occlusion) { ambiguous('the fuller capture names an occlusion itself'); continue; }
      keep = other; why = `more text (${other.words} vs ${first.words} words)`;
    } else {
      ambiguous(`word counts differ but not clearly (${other.words} vs ${first.words})`);
      continue;
    }
    // Every page hidden must have been compared with the kept page itself. A cluster joined
    // through a middle capture (p154≈p158, p158≈p162: 154 and 162 never compared) goes to the
    // by-eye list instead.
    const unlinked = info.filter(m => m !== keep && !linked.has(pairKey(m.id, keep.id)));
    if (unlinked.length) { ambiguous(`joined through another capture: p.${unlinked.map(m => m.page_number).join(', p.')} never compared with p.${keep.page_number}`); continue; }
    clusters.push({ ...cluster, verdict: 'hide', keep: keep.id, keep_page: keep.page_number, why, hide: info.filter(m => m !== keep).map(m => ({ id: m.id, page_number: m.page_number })) });
  }

  // Chain safety, asserted rather than assumed: no kept page is hidden, no page is hidden twice.
  const kept = new Set(clusters.filter(c => c.keep).map(c => c.keep));
  const hidden = new Set();
  for (const c of clusters) for (const h of c.hide) {
    if (kept.has(h.id)) throw new Error(`planBookRepeats: page ${h.id} would be both kept and hidden`);
    if (hidden.has(h.id)) throw new Error(`planBookRepeats: page ${h.id} hidden twice`);
    hidden.add(h.id);
  }
  return { clusters, skipped };
}
