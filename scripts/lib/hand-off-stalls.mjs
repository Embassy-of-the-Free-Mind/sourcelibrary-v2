// PRIOR ART: scripts/lib/lanes.mjs judgeCronLine (#8283) judges a cron LINE (unregistered, idle 7 days); nothing judges
// the HAND-OFF between two stages (a stage that stopped receiving what the one before it produced). Looked in
// scripts/lib/, scripts/audit/ and `gh issue list --search "stall hand-off"`: only #8482, whose part C this is.
/**
 * Hand-off stall rule (#8482 part C). A pipeline is a chain of pull-based lanes; each lane is healthy on its own
 * dashboard while the NEXT one starves. On 2026-11-09 three hand-offs were stalled at once and nothing paged.
 *
 * A stall on an edge is: the downstream stage wrote 0 in the last 24 h while the upstream stage produced >0 in the
 * 72 h before that (or the downstream queue is known to be non-empty). Pure: counts in, flags out, no clock, no db.
 */

/** UTC windows the counts are taken over, relative to `now`: last24h = (now-24h, now], prev72h = (now-96h, now-24h]. */
export const WINDOW_HOURS = Object.freeze({ last24h: 24, prev72h: 72 });
export const PAGE_EVERY_HOURS = 24;

/** GPU draft lanes (ocr.lane, else ocr.source): the bare reads the agy correction pass picks up. */
export const GPU_DRAFT_LANE_RE = /^(?:paddle-zh|lightonocr|pero)/;
/** The lane an agy correction of a GPU draft is written under (lanes.mjs `writes: 'agy-flash-ocr'`). */
export const ARMC_LANE = 'agy-flash-ocr';

/** The hand-off edges: [id, upstream stage, downstream stage, what the page line says]. */
export const EDGES = Object.freeze([
  { id: 'gpu_draft->armc_correct', up: 'gpu_draft', down: 'armc_correct', label: 'GPU drafts are not being corrected by agy' },
  { id: 'translate->enrich', up: 'translate', down: 'enrich', label: 'translated books are not being enriched' },
  { id: 'ft_search->ft_ingest', up: 'ft_search', down: 'ft_ingest', label: 'first-translation searches are not being ingested' },
]);

/** Which window a timestamp falls in at `now`, or null (older than 96 h, or in the future). */
export function windowOf(ts, now) {
  const age = (now.getTime() - new Date(ts).getTime()) / 36e5;
  if (!(age >= 0)) return null;
  if (age <= WINDOW_HOURS.last24h) return 'last24h';
  if (age <= WINDOW_HOURS.last24h + WINDOW_HOURS.prev72h) return 'prev72h';
  return null;
}

/** Fold OCR-lane window counts ([{lane, window, pages}]) into the gpu_draft and armc_correct stage counts. */
export function ocrStageWindows(rows) {
  const out = { gpu_draft: { last24h: 0, prev72h: 0 }, armc_correct: { last24h: 0, prev72h: 0 } };
  for (const r of rows ?? []) {
    if (!(r.window in out.gpu_draft)) continue;
    if (GPU_DRAFT_LANE_RE.test(r.lane)) out.gpu_draft[r.window] += r.pages;
    else if (r.lane === ARMC_LANE) out.armc_correct[r.window] += r.pages;
  }
  return out;
}

/**
 * Evaluate every edge. `windows`: { stage: { last24h, prev72h } } (a missing stage is UNKNOWN, never zero: an edge
 * with an unread side is reported `unknown`, not `stalled`). `queues`: optional { stage: n } of the downstream's
 * waiting work; a non-empty downstream queue stands in for upstream activity.
 */
export function evaluateStalls(windows, queues = {}) {
  return EDGES.map(e => {
    const up = windows?.[e.up], down = windows?.[e.down];
    const base = { edge: e.id, label: e.label, upstream_prev72h: up?.prev72h ?? null, downstream_last24h: down?.last24h ?? null, queue: queues[e.down] ?? null };
    if (!up || !down) return { ...base, stalled: false, unknown: true };
    const fed = up.prev72h > 0 || (queues[e.down] ?? 0) > 0;
    return { ...base, stalled: down.last24h === 0 && fed, unknown: false };
  });
}

/**
 * Edges to page now: stalled, and not paged in the last PAGE_EVERY_HOURS. `previous`: the earlier report's stalls
 * ({edge, last_paged_at}). Returns the edges to page; the caller records last_paged_at only after the page went out.
 */
export function edgesToPage(stalls, previous, now) {
  const last = new Map((previous ?? []).filter(s => s?.last_paged_at).map(s => [s.edge, s.last_paged_at]));
  return stalls.filter(s => {
    if (!s.stalled) return false;
    const at = last.get(s.edge);
    return !at || (now.getTime() - new Date(at).getTime()) / 36e5 >= PAGE_EVERY_HOURS;
  });
}

/** Carry last_paged_at onto the new stalls: `paged` edges get `now`, the rest keep what the earlier report had. */
export function recordPaged(stalls, previous, paged, now) {
  const last = new Map((previous ?? []).filter(s => s?.last_paged_at).map(s => [s.edge, s.last_paged_at]));
  const pagedIds = new Set(paged.map(s => s.edge));
  return stalls.map(s => ({ ...s, last_paged_at: pagedIds.has(s.edge) ? now.toISOString() : (last.get(s.edge) ?? null) }));
}

/** One ntfy line for the edges being paged. */
export function pageText(paged) {
  return `${paged.length} pipeline hand-off${paged.length === 1 ? '' : 's'} stalled: ${paged.map(s =>
    `${s.edge} (${s.label}; upstream ${s.upstream_prev72h} in the 72 h before, downstream 0 in 24 h)`).join('; ')}. /admin/pipeline/now (#8482)`;
}
