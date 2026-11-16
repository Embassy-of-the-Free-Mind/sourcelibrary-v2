/**
 * Archive progress per host: pages archived per day, pages remaining, projected finish, and the
 * alarm for a lane that has archived nothing in 6 h while it still has work (#5448 step 6).
 *
 * PRIOR ART: scripts/audit/archive-coverage.mjs (the three-tier coverage question; sampled, and it
 * answers "how much is archived", never "how fast"); scripts/lib/archive-coverage.mjs (per-PAGE
 * classifiers; a manifest-only book has no pages for them to see); the archivers' own heartbeats
 * (per run and per process, gone with the log, and blind to a lane that is not running at all — the
 * Heidelberg lane spun for nine days at 0 pages and nothing said so). None gives a rate per host
 * that survives the process, or notices a lane that has gone quiet.
 *
 * HOW. Every archiver recounts the books it touches (recountBook), so `books.pages_archived` moves
 * when pages land; a manifest-only book's progress is its ledger's `n_done` (manifest-ledger.mjs;
 * its pages_archived is 0 by design). An hourly SNAPSHOT of those sums per provider goes to
 * `ops_reports` (`archive-progress:<YYYY-MM-DDTHH>`); pages/day is the difference between
 * snapshots. A rate from differences of a counter every writer maintains, rather than one more
 * per-run log, also sees work done by archivers outside the lane table (archive-ocr, archive-bulk).
 * Caveat, stated where it is read: sync-worker's recount can move a stale counter in either
 * direction, which reads as a one-hour spike or dip; the 24 h figure smooths it.
 */

import { LAZY_STATES } from './pages-state.mjs';

export const SNAPSHOT_TYPE = 'archive-progress';
export const ALARM_ID = 'archive-progress-alarm';
export const QUIET_HOURS = 6;

/** The goal the progress report counts toward (Derek, 2026-11-12, #58): books with every page archived. */
export const ARCHIVED_BOOKS_TARGET = 100_000;

/** The hold wave-import.mjs writes on a catalogue-only book (#7343). Releasing it means the book is wanted. */
export const CATALOGUE_ONLY_HOLD = 'manifest-only-lazy-pages';

/**
 * ARCHIVE SCOPE (#58). A catalogue-only book nobody has asked for is OUT of scope: it is still
 * manifest-only, still on its import hold, not visible, and has no page archived. The lanes do not
 * draw it (laneSelectionTiers) and it is not work remaining (measureByProvider). It comes back into
 * scope by itself when its hold is released for reading (pipeline-hold.mjs), when it is published,
 * or when a run names it with --book. A book a lane already started is finished, never left half
 * copied.
 *
 * Why: on 2026-11-12 the lanes copied ~500,000 pages a day, nearly all from the 387,235 untouched
 * catalogue-only books (83.2M pages, about $14 a month per million, for ever), while 148,423 books
 * were already fully archived against a goal of 100,000 and translation ran at ~21,000 pages a day.
 *
 * Two forms of ONE rule: a find() filter and an aggregation expression.
 * tests/integration/archive-progress.test.ts fails if they disagree on any book.
 */
export const CATALOGUE_ONLY_UNWANTED_FILTER = Object.freeze({
  'pages_state.state': { $in: [...LAZY_STATES] },
  'pipeline_auto.hold.reason': CATALOGUE_ONLY_HOLD,
  visible: { $ne: true },
  'archive_metadata.manifest_ledger.n_done': { $not: { $gt: 0 } },
});
export const CATALOGUE_ONLY_UNWANTED_EXPR = Object.freeze({ $and: [
  { $in: ['$pages_state.state', [...LAZY_STATES]] },
  { $eq: ['$pipeline_auto.hold.reason', CATALOGUE_ONLY_HOLD] },
  { $ne: ['$visible', true] },
  { $not: [{ $gt: [{ $ifNull: ['$archive_metadata.manifest_ledger.n_done', 0] }, 0] }] },
] });

const ROW_FIELDS = Object.freeze(['books', 'pages', 'archived', 'remaining', 'lazy_books', 'books_done', 'catalogue_only_books', 'catalogue_only_pages']);

/**
 * Per-provider sums: books, pages, archived (counter or ledger), remaining (pages owed by IN-SCOPE
 * books not yet complete), books_done (every page archived, or closed as complete), and the
 * catalogue-only books left out of scope with the pages they declare.
 */
export async function measureByProvider(db) {
  const lazy = { $in: ['$pages_state.state', [...LAZY_STATES]] };
  const total = { $cond: [lazy, { $ifNull: ['$archive_metadata.manifest_ledger.canvases', '$pages_count'] }, '$pages_count'] };
  const archived = { $cond: [lazy, { $ifNull: ['$archive_metadata.manifest_ledger.n_done', 0] }, { $ifNull: ['$pages_archived', 0] }] };
  const finished = { $in: [{ $ifNull: ['$archive_status', ''] }, ['archive_complete', 'archive_complete_with_gaps']] };
  const rows = await db.collection('books').aggregate([
    { $match: { pages_count: { $gt: 0 } } },
    { $project: { p: { $ifNull: ['$image_source.provider', 'none'] }, total, archived, finished, lazy, unwanted: CATALOGUE_ONLY_UNWANTED_EXPR } },
    { $group: {
      _id: '$p',
      books: { $sum: 1 },
      pages: { $sum: '$total' },
      archived: { $sum: '$archived' },
      remaining: { $sum: { $cond: [{ $or: ['$finished', '$unwanted'] }, 0, { $max: [0, { $subtract: ['$total', '$archived'] }] }] } },
      lazy_books: { $sum: { $cond: ['$lazy', 1, 0] } },
      books_done: { $sum: { $cond: [{ $or: ['$finished', { $gte: ['$archived', '$total'] }] }, 1, 0] } },
      catalogue_only_books: { $sum: { $cond: ['$unwanted', 1, 0] } },
      catalogue_only_pages: { $sum: { $cond: ['$unwanted', '$total', 0] } },
    } },
  ], { maxTimeMS: 240_000, allowDiskUse: true }).toArray();
  return Object.fromEntries(rows.map(r => [r._id, Object.fromEntries(ROW_FIELDS.map(f => [f, r[f]]))]));
}

/** Books with every page archived, summed over a snapshot's providers; null for a snapshot taken before #58. */
export function archivedBooksTotal(byProvider) {
  const rows = Object.values(byProvider ?? {});
  if (!rows.some(r => r.books_done != null)) return null;
  return rows.reduce((s, r) => s + (r.books_done || 0), 0);
}

/** provider → lane name from the lane table; unlisted providers group under `other:<provider>`. */
export function laneOfProvider(table) {
  const m = new Map();
  for (const l of table?.lanes ?? []) for (const p of l.providers ?? []) m.set(p, l.name);
  return (p) => m.get(p) ?? `other:${p}`;
}

/** Sum provider rows into lanes. */
export function byLane(byProvider, laneOf) {
  const out = {};
  for (const [p, v] of Object.entries(byProvider ?? {})) {
    const k = laneOf(p);
    const o = (out[k] ??= { ...Object.fromEntries(ROW_FIELDS.map(f => [f, 0])), providers: [] });
    for (const f of ROW_FIELDS) o[f] += v[f] || 0;
    o.providers.push(p);
  }
  return out;
}

/**
 * Rates from snapshots (oldest first). For each lane: archived in the last 24 h and in the last
 * QUIET_HOURS, the span actually covered, and a projected finish date at the 24 h rate.
 */
export function laneRates(snapshots, laneOf, { now = new Date() } = {}) {
  const snaps = [...snapshots].sort((a, b) => a.at - b.at);
  if (snaps.length === 0) return {};
  const latest = snaps[snaps.length - 1];
  const at = (hoursAgo) => {
    const cut = now.getTime() - hoursAgo * 3600e3;
    // The latest snapshot at or before the cut, else the oldest one we have.
    let best = snaps[0];
    for (const s of snaps) if (s.at.getTime() <= cut) best = s;
    return best;
  };
  const cur = byLane(latest.by_provider, laneOf);
  const d24 = at(24), d6 = at(QUIET_HOURS);
  const old24 = byLane(d24.by_provider, laneOf), old6 = byLane(d6.by_provider, laneOf);
  const out = {};
  for (const [lane, v] of Object.entries(cur)) {
    const span24 = (latest.at - d24.at) / 3600e3;
    const span6 = (latest.at - d6.at) / 3600e3;
    const added24 = v.archived - (old24[lane]?.archived ?? v.archived);
    const added6 = v.archived - (old6[lane]?.archived ?? v.archived);
    const perDay = span24 > 0 ? (added24 / span24) * 24 : null;
    const days = perDay && perDay > 0 ? v.remaining / perDay : null;
    out[lane] = {
      ...v, added_24h: added24, span_24h: +span24.toFixed(2), per_day: perDay == null ? null : Math.round(perDay),
      added_6h: added6, span_6h: +span6.toFixed(2),
      finish: days == null ? null : new Date(latest.at.getTime() + days * 86400e3).toISOString().slice(0, 10),
    };
  }
  return out;
}

/**
 * Lanes that archived nothing over a full QUIET_HOURS window while their books still owe pages.
 * `lanes` is the table's lanes (only lanes a box runs; `box: mac` lanes are not watched).
 */
export function quietLanes(rates, lanes) {
  return lanes
    .filter(l => l.box !== 'mac')
    .map(l => ({ lane: l.name, box: l.box, r: rates[l.name] }))
    .filter(x => x.r && x.r.span_6h >= QUIET_HOURS - 0.25 && x.r.added_6h <= 0 && x.r.remaining > 0)
    .map(x => ({ lane: x.lane, box: x.box, remaining: x.r.remaining }));
}

/**
 * Which quiet lanes to page about now, and the alarm state to store. Pages ONCE per quiet spell:
 * a lane stays in `alarmed` until it archives again, and only a lane newly quiet is returned.
 */
export function alarmTransition(prevAlarmed, quiet) {
  const prev = new Set(prevAlarmed ?? []);
  const nowQuiet = new Set(quiet.map(q => q.lane));
  return {
    fresh: quiet.filter(q => !prev.has(q.lane)),
    resumed: [...prev].filter(l => !nowQuiet.has(l)),
    alarmed: [...nowQuiet],
  };
}
