/**
 * Renumber a book's pages into reading order, and every store that copies a page number (#5699).
 *
 * PRIOR ART: scripts/maintenance/reorder-rtl-split-pages.mjs (#4796) — swaps split halves and moves only
 * `pages.page_number` + `cover_page`; it leaves the Supabase copies, `entities.books[]`, `book_indexes`,
 * chapters and quotes pointing at the old numbers, and it has no explicit map, no read-back and no undo.
 * scripts/maintenance/repair-text-offset-segments.mjs moves TEXT between pages (the opposite operation:
 * here text, images and ids never move, only the number does). Nothing in scripts/lib remaps page
 * references; this file is the pure part (maps, per-store plans, the read-back engine) so tests can drive
 * it without a database. The CLI is scripts/maintenance/renumber-page-order.mjs.
 *
 * THE MODEL. A renumber is a permutation of page numbers inside one book: a list of moves
 * `{ page_id, old, new }` whose olds and news are the same set. Every store is rewritten through the same
 * function f (old → new, identity outside the moves), so applying the inverse moves is the undo. Two kinds
 * of value are not exactly invertible and are recorded instead (`restore` in the applied map):
 *   - a RANGE (entities `page_range`, `sectionSummaries` start/end) that straddles a moved block: its image
 *     under f is not contiguous, so it is widened to the smallest covering range (a coarse true claim);
 *   - `books.chapters`, whose `endPage` is DERIVED from the order of the starts (chapter-endpages.mjs) and
 *     is recomputed in the new order.
 * Undo puts those back from the record, and only if the current value is still the one we wrote.
 *
 * THE ENGINE. Stores run in a fixed order. For each store: read → plan → write → read back → compare with
 * the plan's expected values, keyed by document. Any difference throws RenumberMismatch, and the caller
 * stops the whole run: no further store of this book and no further book is written.
 */

export class RenumberMismatch extends Error {
  constructor(store, details) {
    const head = Array.isArray(details) ? details.slice(0, 5).map((d) => JSON.stringify(d)).join('; ') : String(details);
    super(`read-back mismatch in ${store}: ${head}${Array.isArray(details) && details.length > 5 ? ` (+${details.length - 5} more)` : ''}`);
    this.name = 'RenumberMismatch';
    this.store = store;
    this.details = details;
  }
}

// ---------------------------------------------------------------- maps

/**
 * Expand segment shorthand into explicit moves against the book's CURRENT pages.
 * pages: [{ id, page_number }] (positive page numbers only — soft-hidden spreads are not renumbered).
 * segments:
 *   { op: 'reverse', from, to }            n → from + to − n
 *   { op: 'pairswap', from, to }           (from, from+1), (from+2, from+3), … swap; to − from + 1 must be even
 *   { op: 'explicit', pairs: [[old, new], …] }
 * Throws if a segment names a page number the book does not have, or if segments overlap.
 */
export function expandSegments(pages, segments) {
  const byNum = new Map();
  for (const p of pages) {
    if (!(p.page_number >= 1)) continue;
    if (byNum.has(p.page_number)) throw new Error(`page_number ${p.page_number} is held by two pages (${byNum.get(p.page_number)}, ${p.id}): refuse`);
    byNum.set(p.page_number, String(p.id));
  }
  const olds = new Map();
  const put = (o, n) => {
    if (!byNum.has(o)) throw new Error(`segment names page ${o}, which this book does not have`);
    if (!byNum.has(n)) throw new Error(`segment maps to page ${n}, which this book does not have`);
    if (olds.has(o)) throw new Error(`page ${o} is named by two segments`);
    olds.set(o, n);
  };
  for (const s of segments) {
    if (s.op === 'reverse') {
      if (!(s.to > s.from)) throw new Error(`reverse ${s.from}-${s.to}: empty`);
      for (let n = s.from; n <= s.to; n++) put(n, s.from + s.to - n);
    } else if (s.op === 'pairswap') {
      if ((s.to - s.from + 1) % 2 !== 0) throw new Error(`pairswap ${s.from}-${s.to}: odd length`);
      for (let n = s.from; n <= s.to; n += 2) { put(n, n + 1); put(n + 1, n); }
    } else if (s.op === 'explicit') {
      for (const [o, n] of s.pairs) put(o, n);
    } else throw new Error(`unknown segment op ${s.op}`);
  }
  const moves = [];
  for (const [o, n] of olds) if (o !== n) moves.push({ page_id: byNum.get(o), old: o, new: n });
  moves.sort((a, b) => a.old - b.old);
  validateMoves(moves);
  return moves;
}

/** A move list must be a permutation: unique ids, unique olds, unique news, and news == olds as sets. */
export function validateMoves(moves) {
  const ids = new Set(), olds = new Set(), news = new Set();
  for (const m of moves) {
    if (!m.page_id || !Number.isInteger(m.old) || !Number.isInteger(m.new) || m.old < 1 || m.new < 1) throw new Error(`bad move ${JSON.stringify(m)}`);
    if (ids.has(m.page_id)) throw new Error(`page ${m.page_id} moved twice`);
    if (olds.has(m.old)) throw new Error(`old ${m.old} twice`);
    if (news.has(m.new)) throw new Error(`new ${m.new} twice`);
    ids.add(m.page_id); olds.add(m.old); news.add(m.new);
  }
  for (const n of news) if (!olds.has(n)) throw new Error(`not a permutation: ${n} is a target but no page leaves it`);
  return true;
}

export function invertMoves(moves) {
  return moves.map((m) => ({ page_id: m.page_id, old: m.new, new: m.old })).sort((a, b) => a.old - b.old);
}

/** f: number → number; identity outside the moved set and for non-integers. */
export function makeMapper(moves) {
  const m = new Map(moves.map((x) => [x.old, x.new]));
  return (n) => (Number.isInteger(n) && m.has(n) ? m.get(n) : n);
}

const isSorted = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);

/** Map an array of page numbers; keep it ascending if it was ascending. */
export function mapNumberArray(arr, f) {
  if (!Array.isArray(arr)) return arr;
  const out = arr.map((v) => (typeof v === 'number' ? f(v) : v));
  if (arr.every((v) => typeof v === 'number') && isSorted(arr)) out.sort((a, b) => a - b);
  return out;
}

/**
 * Map an inclusive range. exact = the image is the contiguous range [min, max] (then mapping the result
 * back through f⁻¹ returns the original range, so no record is needed).
 */
export function mapRange(start, end, f) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start > 20000) {
    return { start, end, exact: true, changed: false };
  }
  let lo = Infinity, hi = -Infinity;
  for (let n = start; n <= end; n++) { const v = f(n); if (v < lo) lo = v; if (v > hi) hi = v; }
  return { start: lo, end: hi, exact: hi - lo === end - start, changed: lo !== start || hi !== end };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Restore record lookup: { [store]: { [key]: { before, after } } }. */
function restoreFor(restore, store, key) {
  return restore?.[store]?.[key] || null;
}

// ---------------------------------------------------------------- per-store transforms (pure)

/** entities.books[] entries for this book. Returns { books, restore } or null if unchanged. */
export function remapEntityBooks(books, bookId, f, { restore, key, record }) {
  let touched = false;
  const out = books.map((b, i) => {
    if (b?.book_id !== bookId) return b;
    const nb = { ...b };
    if (Array.isArray(b.pages)) nb.pages = mapNumberArray(b.pages, f);
    if (b.page_range && Number.isInteger(b.page_range.start) && Number.isInteger(b.page_range.end)) {
      const rk = `${key}#${i}`;
      const r = restoreFor(restore, 'entities.page_range', rk);
      if (r && same(b.page_range, r.after)) nb.page_range = r.before;
      else {
        const m = mapRange(b.page_range.start, b.page_range.end, f);
        nb.page_range = { ...b.page_range, start: m.start, end: m.end };
        if (!m.exact) record('entities.page_range', rk, b.page_range, nb.page_range);
      }
    }
    if (!same(nb, b)) touched = true;
    return nb;
  });
  return touched ? out : null;
}

const INDEX_TERM_FIELDS = ['vocabulary', 'keywords', 'people', 'places', 'concepts'];

/** book_indexes document: term page arrays, pageSummaries.page, sectionSummaries ranges and quote pages. */
export function remapBookIndex(doc, f, pageNumberOf, { restore, record, key = '' }) {
  const set = {};
  for (const k of INDEX_TERM_FIELDS) {
    if (!Array.isArray(doc[k])) continue;
    const v = doc[k].map((t) => (t && Array.isArray(t.pages) ? { ...t, pages: mapNumberArray(t.pages, f) } : t));
    if (!same(v, doc[k])) set[k] = v;
  }
  if (Array.isArray(doc.pageSummaries)) {
    const v = doc.pageSummaries.map((s) => (s && typeof s.page === 'number' ? { ...s, page: f(s.page) } : s));
    if (!same(v, doc.pageSummaries)) set.pageSummaries = v;
  }
  if (Array.isArray(doc.sectionSummaries)) {
    const v = doc.sectionSummaries.map((s, i) => {
      if (!s) return s;
      const ns = { ...s };
      if (Number.isInteger(s.startPage) && Number.isInteger(s.endPage)) {
        const rk = `${key}:section#${i}`;
        const r = restoreFor(restore, 'book_indexes.sectionSummaries', rk);
        const cur = { startPage: s.startPage, endPage: s.endPage };
        if (r && same(cur, r.after)) { ns.startPage = r.before.startPage; ns.endPage = r.before.endPage; }
        else {
          const m = mapRange(s.startPage, s.endPage, f);
          ns.startPage = m.start; ns.endPage = m.end;
          if (!m.exact) record('book_indexes.sectionSummaries', rk, cur, { startPage: m.start, endPage: m.end });
        }
      }
      if (Array.isArray(s.quotes)) ns.quotes = s.quotes.map((q) => remapQuote(q, f, pageNumberOf));
      return ns;
    });
    if (!same(v, doc.sectionSummaries)) set.sectionSummaries = v;
  }
  return set;
}

/** A quote carrying { page, page_id }: the page follows its id when the id is in this book, else f(page). */
export function remapQuote(q, f, pageNumberOf) {
  if (!q || typeof q.page !== 'number') return q;
  const byId = q.page_id ? pageNumberOf(String(q.page_id)) : undefined;
  return { ...q, page: byId ?? f(q.page) };
}

/**
 * books.chapters. Starts follow their pageId (else f(pageNumber)); the list is re-sorted into the new
 * order and endPage recomputed (chapter-endpages.mjs). Recorded wholesale, restored wholesale on undo.
 */
export function remapChapters(chapters, f, pageNumberOf, totalPages, computeEndPages, { restore, record }) {
  if (!Array.isArray(chapters) || !chapters.length) return null;
  const r = restoreFor(restore, 'books.chapters', 'chapters');
  if (r && same(chapters, r.after)) return r.before;
  const next = chapters.map((c) => {
    const byId = c.pageId ? pageNumberOf(String(c.pageId)) : undefined;
    return { ...c, pageNumber: byId ?? f(c.pageNumber) };
  });
  if (next.every((c, i) => c.pageNumber === chapters[i].pageNumber)) return null;
  // Stable sort by the new start; a level-1 heading stays before its level-2 child on the same page.
  const order = next.map((c, i) => ({ c, i })).sort((a, b) => a.c.pageNumber - b.c.pageNumber || (a.c.level ?? 1) - (b.c.level ?? 1) || a.i - b.i).map((x) => x.c);
  const hadEnds = chapters.some((c) => c.endPage != null);
  if (hadEnds) computeEndPages(order, totalPages);
  record('books.chapters', 'chapters', chapters, order);
  return order;
}

// ---------------------------------------------------------------- engine

/**
 * Run the stores in order. Each store: { name, read(), plan(state) → { writes, expected, count },
 * write(writes), verify(stateAfter, expected) → mismatches[] }.
 * onStoreDone(name, info) is awaited after a store reads back clean (the caller records progress there).
 * Throws RenumberMismatch on the first store whose read-back differs; nothing after it runs.
 */
export async function runStores(stores, { apply, onStoreDone = async () => {}, log = () => {} } = {}) {
  const report = [];
  for (const s of stores) {
    const state = await s.read();
    const plan = s.plan(state);
    const row = { store: s.name, planned: plan.count ?? 0 };
    if (!apply || !plan.count) {
      report.push({ ...row, written: 0 });
      if (apply) await onStoreDone(s.name, row);
      log(`  ${s.name}: ${plan.count ?? 0} to change${apply ? ' (nothing to write)' : ''}`);
      continue;
    }
    const written = await s.write(plan.writes);
    const after = await s.read();
    const mismatches = s.verify(after, plan.expected, state);
    if (mismatches.length) throw new RenumberMismatch(s.name, mismatches);
    row.written = written;
    report.push(row);
    await onStoreDone(s.name, row);
    log(`  ${s.name}: ${plan.count} changed, read back clean`);
  }
  return report;
}

/**
 * Generic read-back for a keyed store: `after` and `expected` are Map(key → value). Every expected key
 * must hold exactly its expected value; every other key must still hold its value from `before`.
 */
export function verifyKeyed(after, expected, before) {
  const out = [];
  for (const [k, v] of expected) {
    if (!after.has(k)) out.push({ key: k, expected: v, got: '(missing)' });
    else if (!same(after.get(k), v)) out.push({ key: k, expected: v, got: after.get(k) });
  }
  if (before) {
    for (const [k, v] of before) {
      if (expected.has(k)) continue;
      if (!after.has(k)) out.push({ key: k, expected: v, got: '(missing)' });
      else if (!same(after.get(k), v)) out.push({ key: k, expected: v, got: after.get(k), untouched: true });
    }
  }
  return out;
}

/** Plan a store whose rows are { key → page_number } keyed by page id. */
export function planPageNumberCopy(state, moves) {
  const byId = new Map(moves.map((m) => [m.page_id, m.new]));
  const expected = new Map();
  let stale = 0;
  const oldById = new Map(moves.map((m) => [m.page_id, m.old]));
  for (const [k, pn] of state) {
    const pid = String(k).split('|')[0];
    if (!byId.has(pid)) continue;
    if (pn !== oldById.get(pid)) stale++;
    if (pn !== byId.get(pid)) expected.set(k, byId.get(pid));
  }
  return { writes: [...expected], expected, count: expected.size, stale };
}
