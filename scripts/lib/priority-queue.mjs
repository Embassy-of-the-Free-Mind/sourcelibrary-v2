// PRIOR ART: .claude/docs/pipeline-next-step.md "Queue rank: priority as data" — designed `scripts/lib/queue-rank.mjs`
// (tiers as predicates with a reason, top 50 on /admin/pipeline) and never built; this is that file under Derek's
// 2026-11-10/15 order instead of the translate-next-5467 order it proposed. scripts/batch/cli-ocr-lane.mjs
// byFinishFirst / isFinishBook — the finish lane's own sort (tier 1 only, share first); kept as the fallback order.
// FINISH_MIN_SHARE now lives here and FIRST_READ_HOLDS in hold-reasons.mjs, so this file imports no lane. scripts/lib/agy-pools.mjs FINISH FIRST — a reserve, not
// an order. pipeline-next-step.mjs — says WHAT a book needs next, not in which order. None is one ranked list.
/**
 * The priority queue (v3#461): one ranked list of the visible books that still owe a reader English, computed from
 * Derek's order, that the agy lanes take from and anyone can read.
 *
 * DEREK'S ORDER (v2#8482 2026-11-10, v3#380 2026-11-15, v3#383 2026-11-15):
 *   1 finish   — books already >= 80% translated (FINISH_MIN_SHARE) and not complete: their missing pages.
 *   2 first    — first reads of unread visible books, and translation of pages that have OCR but no English.
 *   3 re-read  — quality re-reads and re-translations of pages that already have text. Page cohorts, not books:
 *                no book is ranked here; the lanes that do it (latin-first, `stale`) yield to 1 and 2 by reserve.
 * Inside a tier: a reader request (processing_priority >= 90) first, then the book that needs the fewest pages to
 * get there (tier 1: pages to complete; tier 2: pages to the readable bar), then the larger share in English, then
 * id. Fewest pages first is the most books a reader can open in English per page spent.
 *
 * WHO IS IN IT. Visible books with pages (`visible && pages_count > 0`), stamped with translation_state, and either
 * unheld or held under a hold the agy lanes serve while it stays (FIRST_READ_HOLDS: "published as scans"). Every
 * other hold keeps a book out of the queue and out of every lane; those are listed by hold, with who owns the
 * release (heldSummary). English originals owe reads, never translation (translation-state.md english_original).
 *
 * The counters are translation_state's (page-counts.mjs, one denominator): `translatable` already leaves out blank,
 * plate, never-translated and health-blocked pages (#378), so "owed" here is what the reader is missing, not what a
 * lane could try.
 *
 * Pure. scripts/workers/priority-queue.mjs computes it and writes ops_reports; lanes read the ranks document through
 * queueRankOrder.
 */
import { FIRST_READ_HOLDS } from './hold-reasons.mjs';

/** A book at or over this share of its translatable pages translated is a FINISH book (tier 1; #8482). Read by
 * cli-ocr-lane.mjs isFinishBook too: one copy. */
export const FINISH_MIN_SHARE = 0.8;

export const QUEUE_VERSION = 1;
export const QUEUE_REPORT_ID = 'priority-queue:latest';
export const QUEUE_RANKS_ID = 'priority-queue:ranks';
export const QUEUE_TYPE = 'priority-queue';
/** A ranks document older than this is not used: the lane falls back to its own order and says so. */
export const QUEUE_MAX_AGE_H = 6;
/** The readable bar (translation-state.md: the only two bars are 90% and 100%). */
export const READABLE_BAR = 0.9;
export const REQUEST_PRIORITY = 90;

export const TIERS = Object.freeze([
  { tier: 1, key: 'finish', label: 'Finish books 80%+ in English' },
  { tier: 2, key: 'first', label: 'First reads and first translations' },
  { tier: 3, key: 'reread', label: 'Re-reads and re-translations' },
]);

/** The book projection the queue needs (stored fields only, no pages read). */
export const QUEUE_BOOK_PROJECTION = Object.freeze({
  _id: 0, id: 1, title: 1, language: 1, visible: 1, pages_count: 1, processing_priority: 1, translation_state: 1,
  'pipeline_auto.status': 1, 'pipeline_auto.held': 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.hold.issue': 1, 'pipeline_auto.hold.release_when': 1,
});

/** The counters a book's place depends on, from translation_state; `adjust` takes back writes (for a past moment). */
export function bookCounts(book, adjust = null) {
  const s = book?.translation_state ?? {};
  const english = s.english_original === true;
  const translatable = Number(s.translatable) || 0, whole = Number(s.whole) || 0;
  const translated = Math.max(0, (Number(s.translated) || 0) - (adjust?.translated ?? 0));
  const ocr = Math.max(0, (Number(s.ocr) || 0) - (adjust?.ocr ?? 0));
  const owed = english ? 0 : Math.max(0, translatable - translated);
  const unread = Math.max(0, whole - ocr);
  const share = translatable > 0 ? Math.min(1, translated / translatable) : 0;
  // Page operations to the readable bar: reads to 90% coverage, translations to 90% of translatable.
  const toReadable = Math.max(0, Math.ceil(READABLE_BAR * whole) - ocr) + (english ? 0 : Math.max(0, Math.ceil(READABLE_BAR * translatable) - translated));
  // A book the window's own translations completed was not complete at the window's start.
  const rung = s.rung === 'complete' && (adjust?.translated ?? 0) > 0 && owed > 0 ? 'translating' : s.rung ?? null;
  return { english, translatable, translated, whole, ocr, owed, unread, share, toReadable, rung };
}

/** Does a hold keep this book out of the queue? Null when it is unheld or held under a hold the lanes serve. */
export function blockingHold(book, served = FIRST_READ_HOLDS) {
  const h = book?.pipeline_auto?.hold;
  if (!h && book?.pipeline_auto?.status !== 'held' && book?.pipeline_auto?.held !== true) return null;
  const reason = h?.reason ?? 'held-without-marker';
  return served.includes(reason) ? null : reason;
}

/**
 * A book's place: { tier, key, sort, reason, ...counts }, { held: reason } for a book a hold keeps out, or null for a
 * book that owes a reader nothing (or is not a visible text).
 */
export function placeBook(book, { adjust = null, served = FIRST_READ_HOLDS } = {}) {
  if (!book?.visible || !(book.pages_count > 0)) return null;
  const c = bookCounts(book, adjust);
  if (!c.rung || c.rung === 'no_pages') return null;
  if (c.owed === 0 && c.unread === 0) return null;
  const held = blockingHold(book, served);
  if (held) return { held, ...c };
  const asked = (book.processing_priority ?? 0) >= REQUEST_PRIORITY;
  const pct = `${Math.floor(100 * c.share)}%`;
  const unreadNote = c.unread ? `, ${c.unread} not yet read` : '';
  if (!c.english && c.share >= FINISH_MIN_SHARE && c.rung !== 'complete' && c.owed > 0) {
    return { tier: 1, key: 'finish', asked, sort: c.owed, ...c,
      reason: `${asked ? 'asked for; ' : ''}finish: ${pct} of ${c.translatable} pages in English, ${c.owed} to go${unreadNote}` };
  }
  const what = c.ocr === 0 ? `no text yet, ${c.unread} pages to read` : c.english ? `English original, ${c.unread} pages to read`
    : `${pct} in English, ${c.toReadable} page steps to readable${unreadNote}`;
  return { tier: 2, key: 'first', asked, sort: c.toReadable || c.owed + c.unread, ...c,
    reason: `${asked ? 'asked for; ' : ''}${book.pipeline_auto?.hold?.reason ? `held as scans (${book.pipeline_auto.hold.reason}, lanes read it); ` : ''}first: ${what}` };
}

/** Queue order: tier, asked for, fewest pages, larger share, id. */
export const byQueue = (a, b) => a.tier - b.tier || (b.asked ? 1 : 0) - (a.asked ? 1 : 0) || a.sort - b.sort
  || b.share - a.share || String(a.id).localeCompare(String(b.id));

/** Who releases a hold, from its release_when (pipeline-hold.mjs RELEASE_WHEN_KINDS). `derek` marks a decision he owns. */
export function holdOwner(rw) {
  if (!rw?.kind) return { owner: 'no release condition', derek: false };
  if (rw.kind === 'decision') return { owner: `Derek (decision: ${rw.ref})`, derek: true };
  if (rw.kind === 'issue') return { owner: `#${rw.ref} closing`, derek: false };
  if (rw.kind === 'test') return { owner: `a passing check: ${rw.ref}`, derek: false };
  if (rw.kind === 'date') return { owner: `the date ${rw.ref}`, derek: false };
  return { owner: String(rw.kind), derek: false };
}

/**
 * Build the queue from book documents. Returns { ranked, held, tiers } where `ranked` is every queued book in order
 * (each with rank), `held` the blocking holds by reason (books, owed, unread, owner), `tiers` per-tier totals.
 */
export function buildQueue(books, { adjustFor = null, served = FIRST_READ_HOLDS } = {}) {
  const ranked = [], heldBy = new Map();
  for (const b of books) {
    const p = placeBook(b, { adjust: adjustFor?.get?.(b.id) ?? null, served });
    if (!p) continue;
    if (p.held) {
      const r = heldBy.get(p.held) ?? { reason: p.held, books: 0, owed: 0, unread: 0, issue: b.pipeline_auto?.hold?.issue ?? null, release_when: b.pipeline_auto?.hold?.release_when ?? null };
      r.books++; r.owed += p.owed; r.unread += p.unread;
      heldBy.set(p.held, r);
      continue;
    }
    ranked.push({ id: b.id, title: b.title ?? null, language: b.language ?? null, ...p });
  }
  ranked.sort(byQueue);
  ranked.forEach((r, i) => { r.rank = i + 1; });
  const tiers = TIERS.filter((t) => t.tier < 3).map((t) => {
    const rows = ranked.filter((r) => r.tier === t.tier);
    return { ...t, books: rows.length, owed: rows.reduce((s, r) => s + r.owed, 0), unread: rows.reduce((s, r) => s + r.unread, 0) };
  });
  const held = [...heldBy.values()].map((h) => ({ ...h, ...holdOwner(h.release_when) })).sort((a, b) => b.books - a.books);
  return { ranked, held, tiers };
}

/** Page writes are counted by the agy lanes only: the pools the queue spends. */
export const AGY_OCR_LANE = 'agy-flash-ocr';
export const AGY_TRANSLATE_LANE = 'agy-flash-translate';
const REREAD_PIPELINE = /reread|correct/i;
const RETRANSLATE_CALL = /retranslat|stale/i;

/**
 * What one stored page write was, for the share: { stage: 'ocr'|'translation', kind: 'first'|'again' } or null when no
 * agy lane wrote it. `again` = a re-read (ocr.pipeline names a re-read or correction lane) or a re-translation (the
 * read call or job names the stale/re-translate lane): tier 3 whatever the book.
 */
export function classifyWrite(stage, page) {
  if (stage === 'ocr') {
    if (page?.ocr?.lane !== AGY_OCR_LANE) return null;
    return { stage, kind: REREAD_PIPELINE.test(page.ocr.pipeline ?? '') ? 'again' : 'first' };
  }
  if (page?.translation?.lane !== AGY_TRANSLATE_LANE) return null;
  const run = page.translation.engine?.run ?? {};
  return { stage, kind: RETRANSLATE_CALL.test(`${run.read_call ?? ''} ${run.job_id ?? ''}`) ? 'again' : 'first' };
}

/**
 * Share of agy page writes per priority. `writes`: [{ book_id, stage, kind }]; `placeOf(book_id)`: the book's place
 * at the start of the window (placeBook with the window's first writes taken back), or null. Buckets: finish, first,
 * reread (any `again` write), held (a hold keeps the book out), other (hidden, complete, or not in the queue).
 */
export function shareByPriority(writes, placeOf) {
  const out = {};
  const add = (bucket, stage) => {
    out[bucket] ??= { ocr: 0, translation: 0, total: 0 };
    out[bucket][stage]++; out[bucket].total++;
  };
  for (const w of writes) {
    if (w.kind === 'again') { add('reread', w.stage); continue; }
    const p = placeOf(w.book_id);
    add(p?.held ? 'held' : p?.key ?? 'other', w.stage);
  }
  const total = Object.values(out).reduce((s, r) => s + r.total, 0);
  for (const r of Object.values(out)) r.share = total ? r.total / total : 0;
  return { total, buckets: out };
}

/** Days to clear `owed` at `perDay`, or null when nothing was done. */
export const daysToClear = (owed, perDay) => (perDay > 0 ? owed / perDay : null);

/**
 * A lane's comparator from the ranks document: queued books by rank, then books the queue does not rank in `fallback`
 * order. Returns { order, note }: order null (and a note saying why) when the document is missing, stale or of another
 * version, so the lane keeps its own order and its log says so.
 */
export function queueRankOrder(doc, fallback, { now = Date.now(), maxAgeH = QUEUE_MAX_AGE_H } = {}) {
  if (!doc?.ids?.length) return { order: null, note: 'priority queue: no ranks document; own order' };
  if (doc.version !== QUEUE_VERSION) return { order: null, note: `priority queue: ranks version ${doc.version}, want ${QUEUE_VERSION}; own order` };
  const age = (now - Date.parse(doc.generated_at)) / 3600e3;
  if (!(age <= maxAgeH)) return { order: null, note: `priority queue: ranks ${Number.isFinite(age) ? `${age.toFixed(1)} h` : 'of unknown age'} old (max ${maxAgeH} h); own order` };
  const rank = new Map(doc.ids.map((id, i) => [id, i]));
  const order = (a, b) => {
    const ra = rank.get(a.id), rb = rank.get(b.id);
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return fallback(a, b);
  };
  return { order, rank, note: `priority queue: ranks of ${doc.generated_at} (${age.toFixed(1)} h old, ${doc.ids.length} books)` };
}

/** The ranks document from ops_reports (or null). Lanes pass it to queueRankOrder. */
export async function readQueueRanks(db) {
  return db.collection('ops_reports').findOne({ _id: QUEUE_RANKS_ID }, { projection: { ids: 1, version: 1, generated_at: 1 } });
}
