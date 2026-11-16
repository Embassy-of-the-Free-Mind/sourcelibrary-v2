// PRIOR ART: scripts/lib/lanes.mjs STOP_ROWS / judgeStops (every hold reason with its owner and review date, one row
// per STOP, no counts by stage and no lane per hold); scripts/audit/pipeline-next-step-audit.mjs `held` (books and pages
// per hold reason, daily, no stage strip, no lane, no decision); scripts/lib/pipeline-hold.mjs (the hold marker and its
// release_when, v2#7860) and scripts/lib/hold-reasons.mjs (not-acquired reasons, the Siku lane holds), both reused here.
// None says, per BATCH of books, how far it has got through the stages and what blocks the next one (v3#269).
//
// batches — the pure half of /admin/pipeline/batches (v3#269): the stage arithmetic, the blocker text, and which lane
// reads a hold. scripts/maintenance/batches-push.mjs computes the numbers hourly and writes one ops_reports document;
// the page renders it through stagesOf() and blockersOf() below, so wording can change without a re-push.
// No imports with side effects and no database handle: the admin page imports this file.

/** A hold with fewer books than this, placed on books that already had a status (a containment), joins the "contained" row. */
export const CONTAINED_MAX_BOOKS = 20;
/** The issue every containment hold rolls up to on the page (v3#99). */
export const CONTAINED_ISSUE = { repo: 'v3', number: 99 };
/** Held books listed per batch in the snapshot (largest first). */
export const BOOK_LIST_MAX = 30;
/** A stage counts as full at this fraction: counters lag the pages by a few per thousand (sync-worker, every 2 h). */
export const FULL_AT = 0.995;
/** The snapshot is shown red past this age. */
export const STALE_HOURS = 3;
/** v3 opened on 2026-11-12 (CLAUDE.md); a hold placed before then names a v2 issue. */
export const V3_SINCE = '2026-11-12';

export const REPOS = { v2: 'Embassy-of-the-Free-Mind/sourcelibrary-v2', v3: 'Embassy-of-the-Free-Mind/sourcelibrary-v3' };
export const issueUrl = (ref) => (ref?.number ? `https://github.com/${REPOS[ref.repo] ?? REPOS.v3}/issues/${ref.number}` : null);
export const issueLabel = (ref) => (ref?.number ? `${ref.repo === 'v2' ? 'v2#' : '#'}${ref.number}` : null);

/**
 * Which repository a hold's issue number lives in. Numbers past 1000 are v2's (v3 has a few hundred issues); a smaller
 * number is v3's when the hold was placed on or after V3_SINCE, else v2's.
 */
export function issueRepo(issue, heldSince) {
  if (!Number.isInteger(issue) || issue <= 0) return null;
  if (issue >= 1000) return 'v2';
  const d = heldSince instanceof Date ? heldSince.toISOString() : String(heldSince ?? '');
  return d && d.slice(0, 10) >= V3_SINCE ? 'v3' : 'v2';
}

/** Hold names in a routes-tsv `hold` cell ("none, or scans-only-publish-7270 (kept)" → ['scans-only-publish-7270']). */
export function routeHolds(cell) {
  return [...new Set(String(cell ?? '').replace(/\([^)]*\)/g, ' ').split(/[\s,]+/)
    .filter((w) => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(w)))];
}

/**
 * The routes of scripts/gpu/ocr-filler-routes.tsv, in rank order: [{ route, on, kind, issue, holds, rank }].
 * `on` is the first column as written (on | off | -). Comment and blank lines are not routes.
 */
export function parseRoutes(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [on, route, kind, issue, , hold] = line.split('\t');
    if (!route?.trim()) continue;
    out.push({ route: route.trim(), on: on.trim() === 'on', kind: (kind ?? '').trim(), issue: Number(issue) || null, holds: routeHolds(hold), rank: out.length + 1 });
  }
  return out;
}

/**
 * The lanes that read a hold's books, each with its state: on, off or queued.
 *   GPU routes (ocr-filler-routes.tsv, gex45): `offRoutes` is the set of routes gex45 last reported off (its
 *   pipeline-now document); null = not read, then the repo copy's first column decides and `why` says so. An on route
 *   below another on route is `queued`: the filler queues the first route with pages left.
 *   Cron lanes (scripts/lib/lanes.mjs): a lane whose `routes.hold` is this hold, and the Siku translation lane for its
 *   holds; on when one of its CRON_ROWS rows is current, off when they are all paused or retired.
 */
export function lanesForHold(reason, { routes = [], offRoutes = null, lanes = [], cronRows = [], sikuHolds = [], sikuLane = 'agy-flash-translate' } = {}) {
  const out = [];
  // gex45 reports only the routes it has OFF, so a route missing from that list may be on there or not installed
  // there at all: a route is on only when the repo says on and gex45 does not say off.
  const isOn = (r) => r.on && !offRoutes?.has(r.route);
  const onRoutes = routes.filter(isOn);
  for (const r of routes) {
    if (!r.holds.includes(reason)) continue;
    const on = isOn(r);
    const above = on ? onRoutes.filter((x) => x.rank < r.rank) : [];
    out.push({
      name: r.route, kind: 'gpu-route', box: 'gex45', issue: r.issue,
      state: !on ? 'off' : above.length ? 'queued' : 'on',
      why: !on ? (r.on ? 'switched off on gex45 (its live ocr-filler-routes.tsv)' : 'switched off in ocr-filler-routes.tsv')
        : above.length ? `behind ${above.map((x) => x.route).join(', ')}: the filler queues the first on route with pages left`
          : 'first on route on the gex45 GPU queue',
    });
  }
  const laneRows = (name) => cronRows.filter((c) => c.lane === name);
  const cronLane = (name, extra) => {
    const rows = laneRows(name).filter((c) => !extra || extra(c));
    const cur = rows.filter((c) => c.status === 'current');
    const paused = rows.find((c) => c.status === 'paused');
    return {
      name, kind: 'cron', box: [...new Set((cur.length ? cur : rows).map((c) => c.box))].join(', ') || null,
      issue: (cur[0] ?? paused ?? rows[0])?.issue ?? null,
      state: cur.length ? 'on' : 'off',
      why: cur.length ? `cron ${cur.map((c) => c.id).join(', ')}` : paused ? (paused.note ?? `cron ${paused.id} paused`) : 'no cron line runs it',
    };
  };
  for (const l of lanes) if (l.routes?.hold === reason) out.push(cronLane(l.name));
  if (sikuHolds.includes(reason)) out.push({ ...cronLane(sikuLane, (c) => /siku/.test(c.id)), name: 'siku-translate' });
  return out;
}

/** A small hold placed on books that already had a status: a containment of pages found wrong, not an import. */
export function isContained(g, notAcquired = () => false) {
  return g.books < CONTAINED_MAX_BOOKS && !notAcquired(g.name) && (g.held_from_status ?? 0) * 2 > g.books;
}

const num = (x) => (Number.isFinite(x) ? x : 0);

function fillOf(count, of) {
  if (count == null) return { fraction: null, fill: 'unknown' };
  if (!of || of <= 0) return { fraction: 0, fill: 'empty' };
  const fraction = Math.max(0, Math.min(1, count / of));
  return { fraction, fill: count <= 0 ? 'empty' : fraction >= FULL_AT ? 'full' : 'part' };
}

/**
 * The strip, left to right: imported · image archived · read · translated · public. Each: { key, label, count, of,
 * unit, fraction, fill: full|part|empty|unknown, note }. Pages for the first four (of = pages imported), books for the
 * last (of = books). A count that was not measured is null, with the reason in `note`.
 */
export function stagesOf(row) {
  const pages = num(row.pages), books = num(row.books);
  const img = row.images ?? null;
  return [
    { key: 'imported', label: 'Imported', count: pages, of: pages, unit: 'pages', ...fillOf(pages, pages), note: `${books.toLocaleString('en-US')} books` },
    { key: 'images', label: 'Image archived', count: img?.pages ?? null, of: pages, unit: 'pages', ...fillOf(img?.pages ?? null, pages),
      note: img?.pages == null ? `not measured${img?.why ? `: ${img.why}` : ''}` : null },
    { key: 'read', label: 'Read', count: num(row.read), of: pages, unit: 'pages', ...fillOf(num(row.read), pages), note: null },
    { key: 'translated', label: 'Translated', count: num(row.translated), of: pages, unit: 'pages', ...fillOf(num(row.translated), pages), note: null },
    { key: 'public', label: 'Public', count: num(row.public_books), of: books, unit: 'books', ...fillOf(num(row.public_books), books), note: null },
  ];
}

/** The first stage that is not full: where the batch is. null when every stage is full. */
export function currentStage(row) {
  return stagesOf(row).find((s) => s.fill !== 'full')?.key ?? null;
}

const day = (d) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

/**
 * What blocks the batch's next stage, in words, most urgent first: [{ tone: 'red'|'amber'|null, text, href? }].
 *   - a decision waiting on Derek (the hold's release_when names one, or its issue's recent comments ask one);
 *   - each lane that reads it, on / off / queued;
 *   - "no owner" when no lane is on or queued and no decision is asked: nothing scheduled moves it;
 *   - a lane on with nothing read or translated in 24 h;
 *   - the hold itself: reason, since, release condition, and whether the release is due.
 */
export function blockersOf(row, { now = new Date() } = {}) {
  const out = [];
  if (row.kind === 'contained') {
    out.push({ tone: null, text: `${row.members?.length ?? 0} containment holds of under ${CONTAINED_MAX_BOOKS} books each: pages found wrong are kept out of every lane until re-read.`, href: issueUrl(CONTAINED_ISSUE) });
    return out;
  }
  for (const d of row.decisions ?? []) {
    out.push({ tone: 'amber', text: `Waiting on you: ${d.text}${d.default ? ` (default: ${d.default})` : ''}`, href: d.url ?? null });
  }
  const lanes = row.lanes ?? [];
  for (const l of lanes) {
    const tone = l.state === 'off' ? 'amber' : null;
    out.push({ tone, text: `Lane ${l.name}${l.box ? ` (${l.box})` : ''}: ${l.state}. ${l.why}` });
  }
  const moving = lanes.some((l) => l.state === 'on' || l.state === 'queued');
  if (row.kind === 'campaign') {
    out.push({ tone: null, text: 'No hold: the router\'s lanes take these books like any other.' });
  } else if (!moving && !(row.decisions ?? []).length) {
    out.push({ tone: 'red', text: lanes.length ? 'No owner: every lane that reads it is off, and no decision is asked.' : 'No owner: no lane reads this hold and no decision is asked.' });
  }
  const moved = num(row.moved_24h?.read) + num(row.moved_24h?.translated);
  if (moving && moved === 0) out.push({ tone: 'amber', text: 'A lane is on but nothing was read or translated in the last 24 h.' });
  const h = row.hold;
  if (h) {
    if (row.not_acquired) out.push({ tone: null, text: 'Catalogue records: the pages were never fetched (not acquired, v2#7860 group 1).' });
    const rw = h.release_when;
    let due = null;
    if (rw?.kind === 'issue' && h.release_issue_state === 'CLOSED') due = `release is due: ${issueLabel({ repo: h.issue_repo, number: rw.ref })} is closed`;
    if (rw?.kind === 'date' && rw.ref && day(now) >= rw.ref) due = `release was due on ${rw.ref}`;
    if (due) out.push({ tone: 'red', text: `Hold ${h.reason}: ${due}.` });
    const cond = rw?.kind === 'decision' ? `by decision "${rw.ref}"` : rw?.kind === 'issue' ? `when ${issueLabel({ repo: h.issue_repo, number: rw.ref })} closes`
      : rw?.kind === 'date' ? `on ${rw.ref}` : rw?.kind === 'test' ? `when ${rw.ref} passes` : 'no testable condition';
    out.push({ tone: null, text: `Held ${h.reason} since ${day(h.held_since) ?? '?'}; released ${cond}. ${h.release ?? ''}`.trim() });
  }
  return out;
}

/** Rows largest first (books, then pages); the contained row last. */
export function sortBatches(rows) {
  return [...rows].sort((a, b) => (a.kind === 'contained') - (b.kind === 'contained') || num(b.books) - num(a.books) || num(b.pages) - num(a.pages));
}

/**
 * Throws when the document is not the shape the page reads (v3#269: a row count is not an integrity check).
 * `heldBooks` is the number of held books the facet saw: the hold rows and the contained row must add up to it.
 */
export function assertShape(doc, { heldBooks = null } = {}) {
  const fail = (m) => { throw new Error(`batches snapshot shape: ${m}`); };
  if (!doc || doc.type !== 'batches' || !doc._id) fail('no _id/type');
  if (!(doc.generated_at instanceof Date) && Number.isNaN(Date.parse(doc.generated_at))) fail('generated_at is not a date');
  if (!Array.isArray(doc.batches) || doc.batches.length === 0) fail('no batches');
  const keys = new Set();
  let held = 0;
  for (const r of doc.batches) {
    if (!r.key || keys.has(r.key)) fail(`missing or repeated key ${r.key}`);
    keys.add(r.key);
    if (!['hold', 'campaign', 'contained'].includes(r.kind)) fail(`${r.key}: kind ${r.kind}`);
    for (const f of ['books', 'pages', 'read', 'translated', 'public_books']) if (!Number.isFinite(r[f]) || r[f] < 0) fail(`${r.key}: ${f}=${r[f]}`);
    if (r.public_books > r.books) fail(`${r.key}: more public books than books`);
    if (r.images != null && r.images.pages != null && (!Number.isFinite(r.images.pages) || !r.images.as_of)) fail(`${r.key}: images without a count or an as_of`);
    if (!r.moved_24h || !Number.isFinite(r.moved_24h.read) || !Number.isFinite(r.moved_24h.translated)) fail(`${r.key}: moved_24h`);
    if (r.kind === 'hold' && !r.hold?.reason) fail(`${r.key}: hold row without a hold`);
    if (r.kind !== 'campaign') held += r.books;
  }
  if (heldBooks != null && held !== heldBooks) fail(`hold rows add up to ${held} books, the facet saw ${heldBooks}`);
  return true;
}
