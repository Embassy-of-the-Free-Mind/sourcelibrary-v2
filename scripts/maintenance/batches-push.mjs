#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/pipeline-now-push.mjs and work-board-push.mjs — the pattern copied (a box writes one
// ops_reports document, an admin page renders it); they report cron lines, stops and jobs, not batches of books.
// scripts/audit/pipeline-next-step-audit.mjs — books and pages per hold reason daily, no stages, lane or decision.
// scripts/audit/archive-coverage.mjs — the RECORD tier per campaign, by hand, one campaign a run.
/**
 * batches push (/admin/pipeline/batches, v3#269): one row per batch of books, with the count at each stage and what
 * blocks the next one. A batch is a hold (`pipeline_auto.hold.reason`) with its books, or an `acquisition_campaign`
 * whose books carry no hold any more. Holds of under 20 books placed on books that already had a status
 * (containments) share one "contained" row. Hourly on main; writes ONE document, `ops_reports` `batches:latest`.
 * It calls no model and writes nothing else. Nothing reads the document but the admin page.
 *
 * WHERE EACH NUMBER COMES FROM
 *   books, pages imported   books.pages_count (the manifest count; a manifest-only book has no page records)
 *   pages read / translated books.pages_ocr / pages_translated, the counters sync-worker restamps every 2 h. Checked
 *                           against the pages for three batches on v3#269 (within 0.4%).
 *   image archived          the RECORD tier of archive-coverage.md: pages whose `archived_photo` is an R2 URL
 *                           (classifyPageRecord MASTER_OR_DERIVATIVE). Not FILE, not MASTER. books.pages_archived is
 *                           not used: it lies (#4190). A page-level count, so it is the slow part: each run measures
 *                           the batches measured longest ago until --budget-sec is spent, carries the rest forward,
 *                           and stamps every row with its own `images.as_of`.
 *   books public            visible && pages_count > 0 (the live filter)
 *   24 h movement           pages whose ocr.updated_at / translation.updated_at is in the last 24 h (indexed; a
 *                           rewrite counts), mapped to their book's batch server-side
 *   lanes                   scripts/gpu/ocr-filler-routes.tsv for the GPU routes, with gex45's live on/off from its
 *                           pipeline-now document; scripts/lib/lanes.mjs LANES + CRON_ROWS for the cron lanes
 *   decisions               the hold's release_when when it is a decision, and DECISION / default lines in the last
 *                           comments of the hold's issue (work-board-push decisionLines)
 *
 * COST. Every query is an aggregation that returns counts; no page text leaves Atlas. One books scan (~40 s), two
 * indexed 24 h page windows, and at most --budget-sec of page-level image counts. Bytes per run: under 2 MB.
 *
 *   node --env-file=.env.production.local scripts/maintenance/batches-push.mjs             # write
 *   node --env-file=.env.production.local scripts/maintenance/batches-push.mjs --dry-run   # print, write nothing
 *   ... --budget-sec 240     seconds of page-level image counting this run (default 240)
 *   ... --full               measure every batch's images this run (no budget; for a by-hand check)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decisionLines, firstLine, redact } from './work-board-push.mjs';
import { CRON_ROWS, LANES } from '../lib/lanes.mjs';
import { isNotAcquiredReason, SIKU_LANE_HOLDS } from '../lib/hold-reasons.mjs';
import {
  BOOK_LIST_MAX, CONTAINED_ISSUE, REPOS, assertShape, isContained, issueRepo, lanesForHold, parseRoutes, sortBatches,
} from '../lib/batches.mjs';

export const COLLECTION = 'ops_reports';
export const DOC_ID = 'batches:latest';
export const TYPE = 'batches';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROUTES_FILE = path.resolve(HERE, '../gpu/ocr-filler-routes.tsv');
const R2_RE = '^https://images\\.sourcelibrary\\.org/';
const GEX45_FRESH_MIN = 180;

/**
 * Route frames narrower than the hold: the books of the hold a route actually reads. Only the Sanskrit print route
 * narrows by language today (scripts/lib/surya-print-lane.mjs saFrameQuery: Sanskrit-language books of the hold,
 * pages_count > 0). Pages owed = pages_count − pages_ocr (counters), against the lane's own pages-with-no-text count.
 */
export const ROUTE_FRAMES = {
  'sanskrit-print-surya-95': { language: '^Sanskrit', rule: 'Sanskrit-language books under the hold with pages (saFrameQuery); pages with no text by the counters' },
};

const arg = (name, d) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : d; };
const flag = (name) => process.argv.includes(name);

// ───────────────────────────────────────────── pure assembly (unit-tested through batches.test.ts)

/** A decision line as shown: without the `DECISION:` lead and the trailing default (shown apart). */
export const decisionText = (line) => String(line).replace(/^DECISION:\s*/i, '').replace(/\s*[—–-]+\s*default\s*[:=].*$/i, '').trim();

/** Group key of a facet row: hold:<reason> or campaign:<name>. */
export const keyOf = (g) => `${g.kind}:${g.name}`;

/**
 * Turn the facet groups into rows. `groups`: [{ kind: 'hold'|'campaign', name, books, pages, read, translated,
 * public_books, held_from_status, held_since, issue, release, release_when, campaigns, list, frames }].
 * `moved`: Map key → { read, translated }. `images`: Map key → { pages, as_of, ms } | { why }. `gh`: Map
 * 'v2#123' → { state, recent, decisions }. `laneCtx`: lanesForHold's context.
 */
export function assembleRows(groups, { moved = new Map(), images = new Map(), gh = new Map(), laneCtx = {}, minCampaignBooks = 20 } = {}) {
  const rows = [];
  const contained = [];
  for (const g of groups) {
    if (g.kind === 'campaign' && g.books < minCampaignBooks) continue;
    if (g.kind === 'hold' && isContained(g, isNotAcquiredReason)) { contained.push(g); continue; }
    const key = keyOf(g);
    const repo = g.kind === 'hold' ? issueRepo(g.issue, g.held_since) : null;
    const ghIssue = repo ? gh.get(`${repo}#${g.issue}`) : null;
    const rw = g.release_when ?? null;
    const relRepo = rw?.kind === 'issue' ? issueRepo(rw.ref, g.held_since) : null;
    const decisions = [];
    if (rw?.kind === 'decision') decisions.push({ text: `the hold's release decision: "${rw.ref}"`, default: null, url: null, source: 'release_when' });
    for (const d of ghIssue?.decisions ?? []) decisions.push({ text: decisionText(d.line), default: d.default, url: d.url, source: 'issue comment', at: d.at });
    const mv = moved.get(key) ?? { read: 0, translated: 0 };
    // A queued GPU route whose batch was read in the last 24 h is the one the filler is running (the routes above it
    // have no pages left): call it on.
    const lanes = (g.kind === 'hold' ? lanesForHold(g.name, laneCtx) : []).map((l) => (l.kind === 'gpu-route' && l.state === 'queued' && mv.read > 0
      ? { ...l, state: 'on', why: `${mv.read.toLocaleString('en-US')} pages of this batch read in the last 24 h; ranked ${l.why}` } : l));
    const frames = lanes.filter((l) => ROUTE_FRAMES[l.name] && g.frames?.[l.name])
      .map((l) => ({ route: l.name, rule: ROUTE_FRAMES[l.name].rule, ...g.frames[l.name] }));
    rows.push({
      key, kind: g.kind, name: g.name,
      books: g.books, pages: g.pages, read: g.read, translated: g.translated, public_books: g.public_books,
      images: images.get(key) ?? { pages: null, why: 'not yet measured' },
      moved_24h: mv,
      not_acquired: g.kind === 'hold' && isNotAcquiredReason(g.name),
      hold: g.kind === 'hold' ? {
        reason: g.name, issue: g.issue ?? null, issue_repo: repo, held_since: g.held_since ?? null,
        release: g.release ? redact(g.release, 300) : null, release_when: rw,
        release_issue_state: relRepo ? gh.get(`${relRepo}#${rw.ref}`)?.state ?? null : null,
      } : null,
      issue: repo ? { repo, number: g.issue, state: ghIssue?.state ?? null } : null,
      recent: ghIssue?.recent ?? [],
      campaigns: (g.campaigns ?? []).filter(Boolean).slice(0, 5),
      lanes, frames, decisions: decisions.slice(0, 4),
      books_list: (g.list ?? []).slice(0, BOOK_LIST_MAX),
    });
  }
  if (contained.length) {
    const sum = (f) => contained.reduce((a, g) => a + (g[f] ?? 0), 0);
    const mvs = contained.map((g) => moved.get(keyOf(g)) ?? { read: 0, translated: 0 });
    const imgs = contained.map((g) => images.get(keyOf(g)));
    const allImg = imgs.every((i) => i?.pages != null);
    rows.push({
      key: 'contained', kind: 'contained', name: 'contained',
      books: sum('books'), pages: sum('pages'), read: sum('read'), translated: sum('translated'), public_books: sum('public_books'),
      images: allImg ? { pages: imgs.reduce((a, i) => a + i.pages, 0), as_of: imgs.map((i) => String(i.as_of)).sort()[0] } : { pages: null, why: 'some of its holds not yet measured' },
      moved_24h: { read: mvs.reduce((a, m) => a + m.read, 0), translated: mvs.reduce((a, m) => a + m.translated, 0) },
      not_acquired: false, hold: null, issue: { ...CONTAINED_ISSUE, state: null }, recent: [], campaigns: [], lanes: [], frames: [], decisions: [],
      members: contained.sort((a, b) => b.books - a.books).map((g) => ({ reason: g.name, books: g.books, pages: g.pages, issue: g.issue ?? null, issue_repo: issueRepo(g.issue, g.held_since) })),
      books_list: contained.flatMap((g) => g.list ?? []).sort((a, b) => (b.pages ?? 0) - (a.pages ?? 0)).slice(0, BOOK_LIST_MAX),
    });
  }
  return sortBatches(rows);
}

/**
 * Which batches to measure images for this run: never measured first, then oldest `as_of`, until the estimated
 * seconds reach the budget (always at least one). `est(g)` = last measured ms, else a guess from its pages.
 */
export function pickImageBatches(groups, prevImages, budgetSec, { full = false } = {}) {
  const guessMs = (g) => Math.max(500, (g.read ?? 0) / 3.5 + (g.pages ?? 0) / 150);
  const ranked = groups.map((g) => ({ g, prev: prevImages.get(keyOf(g)) }))
    .sort((a, b) => (a.prev?.as_of ? Date.parse(a.prev.as_of) : 0) - (b.prev?.as_of ? Date.parse(b.prev.as_of) : 0));
  if (full) return ranked.map((x) => x.g);
  const out = [];
  let ms = 0;
  for (const { g, prev } of ranked) {
    const e = prev?.ms ?? guessMs(g);
    if (out.length && ms + e > budgetSec * 1000) continue;
    out.push(g);
    ms += e;
  }
  return out;
}

// ───────────────────────────────────────────── reads

const HELD_OR_CAMPAIGN = { $or: [{ 'pipeline_auto.hold': { $exists: true } }, { acquisition_campaign: { $exists: true, $nin: [null, ''] } }] };

/** One books scan: per hold reason and per campaign (books without a hold), the counters, the hold, the largest books. */
async function bookGroups(db) {
  const frameSums = {};
  for (const [route, f] of Object.entries(ROUTE_FRAMES)) {
    const inFrame = { $and: [{ $regexMatch: { input: { $ifNull: ['$language', ''] }, regex: f.language } }, { $gt: ['$pc', 0] }] };
    frameSums[`f_${route}_books`] = { $sum: { $cond: [inFrame, 1, 0] } };
    frameSums[`f_${route}_owed`] = { $sum: { $cond: [inFrame, { $max: [0, { $subtract: ['$pc', '$po'] }] }, 0] } };
  }
  const rows = await db.collection('books').aggregate([
    { $match: HELD_OR_CAMPAIGN },
    { $project: {
      id: 1, title: 1, language: 1, visible: 1,
      reason: '$pipeline_auto.hold.reason', camp: '$acquisition_campaign',
      pc: { $ifNull: ['$pages_count', 0] }, po: { $ifNull: ['$pages_ocr', 0] }, pt: { $ifNull: ['$pages_translated', 0] },
      from: '$pipeline_auto.hold.held_from_status', held_at: '$pipeline_auto.hold.held_at', issue: '$pipeline_auto.hold.issue',
      rw: '$pipeline_auto.hold.release_when', release: '$pipeline_auto.hold.release',
    } },
    { $addFields: { live: { $and: [{ $eq: ['$visible', true] }, { $gt: ['$pc', 0] }] } } },
    { $group: {
      _id: { $cond: [{ $ifNull: ['$reason', false] }, { k: 'hold', n: '$reason' }, { k: 'campaign', n: '$camp' }] },
      books: { $sum: 1 }, pages: { $sum: '$pc' }, read: { $sum: '$po' }, translated: { $sum: '$pt' },
      public_books: { $sum: { $cond: ['$live', 1, 0] } },
      held_from_status: { $sum: { $cond: [{ $ifNull: ['$from', false] }, 1, 0] } },
      held_since: { $min: '$held_at' }, issue: { $max: '$issue' }, rw: { $first: '$rw' }, release: { $first: '$release' },
      campaigns: { $addToSet: '$camp' },
      list: { $topN: { n: BOOK_LIST_MAX, sortBy: { pc: -1 }, output: { id: '$id', title: { $substrCP: [{ $ifNull: ['$title', ''] }, 0, 110] }, pages: '$pc', read: '$po', translated: '$pt', live: '$live' } } },
      ...frameSums,
    } },
  ], { maxTimeMS: 300_000, allowDiskUse: true }).toArray();
  return rows.map((r) => {
    const frames = {};
    for (const route of Object.keys(ROUTE_FRAMES)) frames[route] = { books: r[`f_${route}_books`] ?? 0, pages_owed: r[`f_${route}_owed`] ?? 0 };
    return {
      kind: r._id.k, name: r._id.n, books: r.books, pages: r.pages, read: r.read, translated: r.translated, public_books: r.public_books,
      held_from_status: r.held_from_status, held_since: r.held_since ?? null, issue: Number.isInteger(r.issue) ? r.issue : null,
      release: r.release ?? null, release_when: r.rw ?? null, campaigns: (r.campaigns ?? []).slice(0, 10), list: r.list ?? [], frames,
    };
  });
}

/** Pages written in the last 24 h, per batch key. `field` = 'ocr' | 'translation'. */
async function movedSince(db, field, since) {
  const rows = await db.collection('pages').aggregate([
    { $match: { [`${field}.updated_at`]: { $gte: since } } },
    { $group: { _id: '$book_id', n: { $sum: 1 } } },
    { $lookup: { from: 'books', localField: '_id', foreignField: 'id', as: 'b', pipeline: [{ $project: { _id: 0, r: '$pipeline_auto.hold.reason', c: '$acquisition_campaign' } }] } },
    { $group: { _id: { r: { $first: '$b.r' }, c: { $first: '$b.c' } }, n: { $sum: '$n' } } },
  ], { hint: { [`${field}.updated_at`]: -1 }, maxTimeMS: 240_000 }).toArray();
  const out = new Map();
  for (const r of rows) {
    const key = r._id.r ? `hold:${r._id.r}` : r._id.c ? `campaign:${r._id.c}` : null;
    if (key) out.set(key, (out.get(key) ?? 0) + r.n);
  }
  return out;
}

/** Pages whose archived_photo is an R2 URL (RECORD tier), for a set of batches of one kind. One aggregation. */
async function imagePages(db, kind, names, maxTimeMS) {
  const match = kind === 'hold'
    ? { 'pipeline_auto.status': 'held', 'pipeline_auto.hold.reason': { $in: names } }
    : { acquisition_campaign: { $in: names }, 'pipeline_auto.hold': { $exists: false } };
  const rows = await db.collection('books').aggregate([
    { $match: match },
    { $project: { _id: 0, id: 1, k: kind === 'hold' ? '$pipeline_auto.hold.reason' : '$acquisition_campaign' } },
    { $lookup: { from: 'pages', localField: 'id', foreignField: 'book_id', as: 'p', pipeline: [
      { $match: { archived_photo: { $regex: R2_RE } } }, { $count: 'n' }] } },
    { $group: { _id: '$k', pages: { $sum: { $ifNull: [{ $first: '$p.n' }, 0] } } } },
  ], { maxTimeMS }).toArray();
  return new Map(rows.map((r) => [r._id, r.pages]));
}

/** Last comments of each issue (both repos), with decisions asked and the first lines of the last three. Map 'v2#123' → {...}. */
function githubIssues(refs) {
  const out = new Map();
  const errors = [];
  for (const repoKey of ['v2', 'v3']) {
    const nums = [...new Set(refs.filter((r) => r.repo === repoKey).map((r) => r.number))];
    const [owner, name] = REPOS[repoKey].split('/');
    for (let k = 0; k < nums.length; k += 20) {
      const chunk = nums.slice(k, k + 20);
      const q = `{ repository(owner: "${owner}", name: "${name}") { ${chunk.map((n) => `i${n}: issueOrPullRequest(number: ${n}) { ... on Issue { number state comments(last: 5) { nodes { createdAt url body } } } ... on PullRequest { number state comments(last: 5) { nodes { createdAt url body } } } }`).join('\n')} } }`;
      try {
        let raw;
        // gh exits non-zero when any alias fails (a number that is neither issue nor PR); the rest is still in stdout.
        try { raw = execFileSync('gh', ['api', 'graphql', '-f', `query=${q}`], { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { if (!e.stdout) throw e; raw = e.stdout; errors.push(`${repoKey} issues ${chunk[0]}…: ${redact(String(e.stderr || e.message), 160)}`); }
        const d = JSON.parse(raw).data?.repository ?? {};
        for (const n of chunk) {
          const x = d[`i${n}`];
          if (!x) continue;
          const nodes = x.comments?.nodes ?? [];
          const decisions = [];
          for (const c of [...nodes].reverse()) for (const dl of decisionLines(c.body)) {
            if (decisions.length < 3 && !decisions.some((e) => e.line === dl.line)) decisions.push({ ...dl, url: c.url, at: c.createdAt });
          }
          out.set(`${repoKey}#${n}`, {
            state: x.state, decisions,
            recent: nodes.slice(-3).reverse().map((c) => ({ at: c.createdAt, url: c.url, first_line: firstLine(c.body, 200) })),
          });
        }
      } catch (e) { errors.push(`${repoKey} issues ${chunk[0]}…: ${redact(String(e.stderr || e.message), 160)}`); }
    }
  }
  return { issues: out, errors };
}

// ───────────────────────────────────────────── main

async function main() {
  const dry = flag('--dry-run');
  const budgetSec = Number(arg('--budget-sec', 240));
  const full = flag('--full');
  const started = Date.now();
  const now = new Date();
  const timings = {};
  const errors = [];
  const time = async (name, fn) => { const t = Date.now(); try { return await fn(); } finally { timings[name] = Date.now() - t; } };

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const reports = db.collection(COLLECTION);
    const prev = await reports.findOne({ _id: DOC_ID }, { projection: { image_cache: 1 } });
    const prevImages = new Map(Object.entries(prev?.image_cache ?? {}));

    const groups = await time('books_scan', () => bookGroups(db));
    const heldBooks = groups.filter((g) => g.kind === 'hold').reduce((a, g) => a + g.books, 0);

    const since = new Date(now.getTime() - 24 * 3600_000);
    const [mr, mt] = await time('moved_24h', () => Promise.all([movedSince(db, 'ocr', since), movedSince(db, 'translation', since)]));
    const moved = new Map();
    for (const k of new Set([...mr.keys(), ...mt.keys()])) moved.set(k, { read: mr.get(k) ?? 0, translated: mt.get(k) ?? 0 });

    // Images: rotate under the budget. Campaign groups below the row threshold are never shown, so never measured.
    const shown = groups.filter((g) => g.kind === 'hold' || g.books >= 20);
    const picked = pickImageBatches(shown, prevImages, budgetSec, { full });
    const cache = new Map([...prevImages].filter(([k]) => shown.some((g) => keyOf(g) === k)));
    await time('images', async () => {
      // Batches of one kind go together, a few at a time, so a slow one costs only its chunk.
      for (const kind of ['hold', 'campaign']) {
        const mine = picked.filter((g) => g.kind === kind);
        for (let i = 0; i < mine.length; i += 6) {
          const chunk = mine.slice(i, i + 6);
          if (!full && Date.now() - started > (budgetSec + 120) * 1000) break;
          const t = Date.now();
          try {
            const got = await imagePages(db, kind, chunk.map((g) => g.name), full ? 1_800_000 : Math.max(60_000, budgetSec * 1000));
            const per = Math.round((Date.now() - t) / chunk.length);
            for (const g of chunk) cache.set(keyOf(g), { pages: got.get(g.name) ?? 0, as_of: new Date().toISOString(), ms: per });
          } catch (e) {
            errors.push(`images ${kind} ${chunk.map((g) => g.name).join(',')}: ${redact(String(e.message), 160)}`);
          }
        }
      }
    });
    const images = new Map([...cache].map(([k, v]) => [k, v]));

    // Lanes: the repo's routes table, and gex45's live off-list when its push is fresh.
    let routes = [];
    try { routes = parseRoutes(fs.readFileSync(ROUTES_FILE, 'utf8')); } catch (e) { errors.push(`routes tsv: ${e.message}`); }
    const gex = await reports.findOne({ _id: 'pipeline-now:gex45' }, { projection: { generated_at: 1, stops: 1 } });
    const gexAgeMin = gex?.generated_at ? (now - new Date(gex.generated_at)) / 60000 : null;
    const offRoutes = gexAgeMin != null && gexAgeMin <= GEX45_FRESH_MIN
      ? new Set((gex.stops ?? []).filter((s) => s.kind === 'route-off').map((s) => s.key)) : null;
    const laneCtx = { routes, offRoutes, lanes: LANES, cronRows: CRON_ROWS, sikuHolds: SIKU_LANE_HOLDS };

    // GitHub: the hold's issue and its release issue.
    const refs = [];
    for (const g of groups) {
      if (g.kind !== 'hold') continue;
      const repo = issueRepo(g.issue, g.held_since);
      if (repo) refs.push({ repo, number: g.issue });
      if (g.release_when?.kind === 'issue') { const r = issueRepo(g.release_when.ref, g.held_since); if (r) refs.push({ repo: r, number: g.release_when.ref }); }
    }
    const gh = await time('github', async () => githubIssues(refs));
    errors.push(...gh.errors);

    const batches = assembleRows(groups, { moved, images, gh: gh.issues, laneCtx });
    const doc = {
      _id: DOC_ID, type: TYPE, generated_at: now, generated_by: 'scripts/maintenance/batches-push.mjs', host: os.hostname(),
      run_seconds: Math.round((Date.now() - started) / 1000), timings,
      sources: {
        routes: offRoutes ? `gex45 live off-list (pushed ${Math.round(gexAgeMin)} min before) over the repo's ocr-filler-routes.tsv` : 'the repo copy of ocr-filler-routes.tsv (gex45 not fresh)',
        images_measured_this_run: picked.length, image_budget_sec: full ? null : budgetSec,
        held_books: heldBooks, hold_reasons: groups.filter((g) => g.kind === 'hold').length,
      },
      image_cache: Object.fromEntries(cache),
      batches, errors,
    };
    assertShape(doc, { heldBooks });
    doc.run_seconds = Math.round((Date.now() - started) / 1000);
    if (dry) {
      console.log(JSON.stringify({ ...doc, image_cache: undefined, batches: batches.map((b) => ({ ...b, books_list: b.books_list.length })) }, null, 1));
      return;
    }
    await writeSnapshot(reports, doc);
    const back = await reports.findOne({ _id: DOC_ID });
    assertShape(back, { heldBooks });
    if (back.batches.length !== batches.length || +new Date(back.generated_at) !== +now) throw new Error('read-back differs from what was written');
    console.log(`${now.toISOString()} batches-push: ${batches.length} rows, ${heldBooks} held books, images measured for ${picked.length}, ${doc.run_seconds}s, ${errors.length} errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  } finally {
    await client.close();
  }
}

/** The one write: the snapshot document. */
async function writeSnapshot(reports, doc) {
  await reports.replaceOne({ _id: doc._id }, doc, { upsert: true });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`batches-push failed: ${e.stack || e.message}`); process.exit(1); });
}
