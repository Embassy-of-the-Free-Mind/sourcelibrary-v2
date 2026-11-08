// PRIOR ART: scripts/lib/reread-lane-gate.mjs (a per-BOOK Opus verdict that lifts cli-ocr's 40% shared-words floor; it
// needs 30 judged pages a book, and #5309's residual is ~11K pages in ~300 books, mostly a few pages each) and cli-ocr's
// --by-eye rows (a person or session opened each page: not a model-free check, and not what this is). The 40% floor
// compares a re-read with the text it replaces; on a page stranded by the #3368 image repair that text is ANOTHER LEAF's
// by construction, so the floor refuses exactly the reads that fix it. This gate asks the neighbours instead.
/**
 * stranded-leaf-gate (#5309) — may a re-read replace the text of a page the #3368 image repair stranded?
 *
 * The image beside a stranded page is right (it was repaired); its text was read from the shifted image, so it is the
 * text of the leaf `d` pages away. A neighbour re-read since the repair holds its own leaf's text; a neighbour still
 * stranded holds the leaf beyond it. Two kinds of evidence, both model-free and from the book's own pages:
 *
 *   A  stored-is-neighbour: the stored text shares >= 0.4 of its words with ONE neighbour that is not stranded (its own
 *      leaf's text), beating every other neighbour by >= 0.15 — the stored text is that leaf's, so it is not this
 *      page's; and the re-read shares < 0.4 with that neighbour (it did not read the same leaf again).
 *   B  read-is-shifted-neighbour: the re-read shares >= 0.4 with ONE neighbour that is itself stranded (still holding
 *      the text read from the shifted image), beating every other neighbour by >= 0.15 — the read is the leaf whose
 *      text the shift parked on that neighbour, which is this page's leaf; and it matches no non-stranded neighbour.
 *
 * A alone proves only that the STORED text is wrong, not that the read is right: on the pilot (2026-11-08) agy, failing
 * to open a 2765×3955 scan, wrote a Latin "Vita S. Hieronymi" onto a Spanish page about Datura, and A passed it. So A
 * also needs the read CORROBORATED: on a uniform shift d the page n−d once held leaf n's text (it still does if it is
 * stranded; its pre-repair read is in page_revisions if it was re-read), so the read must share >= 0.4 with the current
 * text or an earlier OCR revision of page n−d. B is its own corroboration.
 *
 * Neither is a quality check: a read that passes is still subject to every other cli-ocr guard, and the lane's own
 * spot check judges a sample against the image (scripts/eval/offleaf-5309/judge.mjs).
 */

export const STRANDED_SHARED_MIN = 0.4;
export const STRANDED_MARGIN = 0.15;
export const STRANDED_WINDOW = 8;

/** Distinct folded tokens: words of 5+ letters, or character trigrams where the script does not space words. */
export function leafTokens(t) {
  const s = String(t || '').replace(/<[^>]+>/g, ' ').replace(/-\n/g, '').toLowerCase().replace(/æ/g, 'ae').replace(/ſ/g, 's').replace(/v/g, 'u');
  const UNSPACED = /[぀-ヿ㐀-鿿가-힯ༀ-࿿]/gu;
  if ((s.match(UNSPACED) || []).length > 40) {
    const c = (s.match(UNSPACED) || []).join('');
    const g = new Set();
    for (let i = 0; i + 3 <= c.length; i++) g.add(c.slice(i, i + 3));
    return g;
  }
  return new Set(s.match(/\p{L}{5,}/gu) || []);
}

/** Share of a's tokens found in b. */
export function sharedShare(a, b) {
  if (!a.size) return 0;
  let k = 0;
  for (const w of a) if (b.has(w)) k++;
  return k / a.size;
}

/** The single best neighbour for `tok` among `neighbours` ({n, d, tok, stranded}) and whether it is decisive. */
export function bestNeighbour(tok, neighbours) {
  const s = neighbours.filter((x) => x.tok.size >= 15).map((x) => ({ ...x, s: sharedShare(tok, x.tok) })).sort((a, b) => b.s - a.s);
  const [best, second] = s;
  const decisive = !!best && best.s >= STRANDED_SHARED_MIN && best.s - (second?.s || 0) >= STRANDED_MARGIN;
  return { best, second, decisive, all: s };
}

/**
 * The gate. `stored` and `read` are texts; `neighbours` are the book's pages n-8 … n+8 (not n) as {n, d, id, text,
 * stranded, history?: [earlier OCR texts]}. Returns { lift: true, evidence } or { lift: false, why }.
 */
export function strandedLift({ stored, read, neighbours }) {
  const st = leafTokens(stored), rd = leafTokens(read);
  if (st.size < 20) return { lift: false, why: 'stored text too short to place' };
  if (rd.size < 20) return { lift: false, why: 'read too short to place' };
  const nb = neighbours.map((x) => ({ ...x, tok: leafTokens(x.text) }));
  const round = (x) => Number(x.toFixed(3));
  const settled = nb.filter((x) => !x.stranded);
  const a = bestNeighbour(st, settled);
  if (a.decisive) {
    const readVsRef = sharedShare(rd, a.best.tok);
    if (readVsRef >= STRANDED_SHARED_MIN) return { lift: false, why: `the read is the same leaf as page ${a.best.n} (${Math.round(readVsRef * 100)}%)` };
    const c = corroboration(rd, nb, -a.best.d);
    if (!c) return { lift: false, why: `nothing corroborates the read: page ${a.best.n - 2 * a.best.d} holds no earlier read of this leaf` };
    return { lift: true, evidence: { kind: 'stored-is-neighbour', ref_page: a.best.id, ref_n: a.best.n, d: a.best.d, stored_vs_ref: round(a.best.s), next_best: round(a.second?.s || 0), read_vs_ref: round(readVsRef), corroborated_by: c } };
  }
  const b = bestNeighbour(rd, nb);
  if (b.decisive && b.best.stranded) {
    const settledHit = settled.find((x) => sharedShare(rd, x.tok) >= STRANDED_SHARED_MIN);
    if (settledHit) return { lift: false, why: `the read also matches settled page ${settledHit.n}` };
    return { lift: true, evidence: { kind: 'read-is-shifted-neighbour', ref_page: b.best.id, ref_n: b.best.n, d: b.best.d, read_vs_ref: round(b.best.s), next_best: round(b.second?.s || 0) } };
  }
  return { lift: false, why: 'no neighbour places the stored text or the read' };
}

/** Does page n+dd (dd = −d, the page the shift parked leaf n's text on) hold, now or in an earlier OCR revision, a text
 * the read shares >= 0.4 with? Returns {page, n, d, shared, revision} or null. */
export function corroboration(rd, nb, dd) {
  const m = nb.find((x) => x.d === dd);
  if (!m) return null;
  // Its CURRENT text counts only while it is still stranded: once re-read it holds its own leaf, not this one.
  const texts = [...(m.stranded ? [{ t: m.tok, revision: false }] : []), ...(m.history || []).map((h) => ({ t: leafTokens(h), revision: true }))];
  let best = null;
  for (const x of texts) { if (x.t.size < 15) continue; const s = sharedShare(rd, x.t); if (!best || s > best.s) best = { s, revision: x.revision }; }
  if (!best || best.s < STRANDED_SHARED_MIN) return null;
  return { page: m.id, n: m.n, d: dd, shared: Number(best.s.toFixed(3)), revision: best.revision };
}
