#!/usr/bin/env node
/**
 * Split over-merged work_ids from a reviewed list (#8293).
 *
 * PRIOR ART: scripts/maintenance/apply-verified-work-merges.mjs — same backup +
 * sweep_log + log-collection shape, but it can only MERGE; nothing in the repo
 * moves books OUT of a work. scripts/lib/work-id-remint.mjs knows a split must
 * not alias the old id but plans no moves. The planner is scripts/lib/work-split-plan.mjs.
 *
 * Input: scripts/eval/work-recall/split-reviewed-8293.jsonl — one row per cluster
 * a reader judged different_work, naming the odd books and their destination.
 * Only `bar: "clear"` rows unless --include-arguable.
 *
 *   # 1. dry run (default): plan + full before-state backup + reader report, no writes
 *   node --env-file=.env.production.local scripts/maintenance/apply-reviewed-work-splits.mjs \
 *     scripts/eval/work-recall/split-reviewed-8293.jsonl [--include-arguable] [--plan-out <plan.json>]
 *   # 2. apply THAT plan (re-reads every carrier; refuses a cluster that changed since)
 *   node --env-file=.env.production.local scripts/maintenance/apply-reviewed-work-splits.mjs --apply <plan.json>
 *   # 3. undo
 *   node --env-file=.env.production.local scripts/maintenance/apply-reviewed-work-splits.mjs --revert <sweep> [--apply]
 * After --apply / --revert --apply: node --env-file=.env.production.local scripts/workers/sync-books-catalog.mjs
 *
 * Log: one row per cluster in `work_id_splits` (NOT work_id_merges: every reader of
 * that collection treats a row as winner <- losers — the overmerge audit frames it
 * as a merge route and the admin merge count adds it; a split row there would be
 * counted as a merge), plus one sweep_log row per moved book.
 * Moved books get work_id_source 'work-split:reviewed', which the nightly
 * `mint-local-work-ids --remint-local` (rewrites only 'local-mint') leaves alone.
 * Stayers are never written.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { planSplits, identityOf, SPLIT_SOURCE, SPLIT_CONFIDENCE } from '../lib/work-split-plan.mjs';
import { isCompletedCopyOf, COMPLETED_COPY_STATUSES } from '../workers/lib/work-copy-dedup.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const val = (f) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : null);
const APPLY_PLAN = val('--apply');
const REVERT = val('--revert');
const ISSUE = 8293;
const SWEEP = `reviewed-work-splits-${new Date().toISOString().slice(0, 10)}`;
const ID_FIELDS = { _id: 0, id: 1, work_id: 1, work_title: 1, work_slug: 1, work_id_aliases: 1, work_id_source: 1, work_id_confidence: 1,
  author: 1, author_id: 1, visible: 1, hidden: 1, title: 1, pages_count: 1, pages_ocr: 1, edition_key: 1, 'pipeline_auto.status': 1 };

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

async function carriersOf(ids, projection = ID_FIELDS) {
  const m = new Map();
  for (let i = 0; i < ids.length; i += 1000) for (const b of await books.find({ work_id: { $in: ids.slice(i, i + 1000) } }, { projection }).toArray()) {
    if (!m.has(b.work_id)) m.set(b.work_id, []);
    m.get(b.work_id).push(b);
  }
  return m;
}

try {
  if (REVERT) await revert(REVERT, flag('--apply'));
  else if (APPLY_PLAN) await apply(APPLY_PLAN);
  else await dryRun();
} finally { await client.close(); }

async function dryRun() {
  const file = argv.find((a) => a.endsWith('.jsonl'));
  if (!file) { console.error('usage: apply-reviewed-work-splits.mjs <reviewed.jsonl> [--include-arguable] [--plan-out f] | --apply <plan.json> | --revert <sweep> [--apply]'); process.exit(2); }
  const bars = flag('--include-arguable') ? ['clear', 'arguable'] : ['clear'];
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.label === 'different_work' && bars.includes(r.bar) && r.moves?.length);
  const sources = [...new Set(rows.map((r) => r.work_id))];
  const targets = [...new Set(rows.flatMap((r) => r.moves.map((m) => m.to)).filter((t) => t !== 'new'))];
  const carriers = await carriersOf([...new Set([...sources, ...targets])]);
  // every name in use (distinct() returns one 16 MB document; ~400K ids overflow it)
  const names = async (field) => {
    const s = new Set();
    const pipe = [{ $match: { [field]: { $exists: true, $ne: null } } }, { $project: { v: `$${field}` } }, ...(field === 'work_id_aliases' ? [{ $unwind: '$v' }] : []), { $group: { _id: '$v' } }];
    for await (const d of books.aggregate(pipe, { allowDiskUse: true })) s.add(d._id);
    return s;
  };
  const taken = { ids: await names('work_id'), slugs: await names('work_slug'), aliases: await names('work_id_aliases') };
  const { clusters, refused } = planSplits(rows, carriers, taken);

  // full before-docs of every book that moves: the backup
  const movingIds = clusters.flatMap((c) => c.moves.flatMap((m) => m.books.map((b) => b.id)));
  const backup = [];
  for (let i = 0; i < movingIds.length; i += 1000) backup.push(...await books.find({ id: { $in: movingIds.slice(i, i + 1000) } }).toArray());
  const identity = Object.fromEntries(clusters.map((c) => [c.work_id, (carriers.get(c.work_id) || []).map(identityOf).sort()]));

  const report = await readers(clusters, carriers);
  const moving = clusters.flatMap((c) => c.moves.flatMap((m) => m.books));
  const newIds = clusters.flatMap((c) => c.moves.filter((m) => !m.to_existed));
  const summary = {
    rows: rows.length, bars, clusters: clusters.length, refused: refused.length,
    books_moving: moving.length, not_visible_moving: moving.filter((b) => b.visible === false).length,
    hidden_flag_moving: moving.filter((b) => b.hidden === true).length,
    move_groups: clusters.reduce((n, c) => n + c.moves.length, 0),
    to_existing: clusters.reduce((n, c) => n + c.moves.filter((m) => m.to_existed).length, 0),
    new_ids: newIds.length, restored_retired_ids: newIds.filter((m) => m.restored).length,
    aliases_kept_on_movers: moving.reduce((n, b) => n + b.after.work_id_aliases.length, 0),
    aliases_dropped_from_movers: moving.reduce((n, b) => n + b.aliases_dropped.length, 0),
    source_id_aliased: 0, // by construction: the planner never adds the source id
    ...report.counts,
  };
  const out = val('--plan-out') || path.join(new URL('../output/', import.meta.url).pathname, `work-splits-plan-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ issue: ISSUE, made_at: new Date(), reviewed_from: file, bars, summary, refused, clusters, identity, readers: report.detail, backup }, null, 1));
  console.log(JSON.stringify(summary, null, 2));
  for (const r of refused) console.log(`  refused ${r.work_id}: ${r.why}`);
  console.log(`plan + before-state -> ${out}\nDRY RUN — nothing written. Apply with: --apply ${out}`);
}

/** Every reader of work_id that will notice the move (step 3 map, #8293). */
async function readers(clusters, carriers) {
  const src = clusters.map((c) => c.work_id);
  const moved = clusters.flatMap((c) => c.moves.flatMap((m) => m.books.map((b) => ({ ...b, source: c.work_id, to: m.to }))));
  // FT cards are keyed by work_id: the card stays with the source id, moved books lose it
  const ft = await db.collection('work_translation_history').find({ _id: { $in: src } }, { projection: { _id: 1 } }).toArray();
  // canon-works.ts static workIds that name a source id (the canon page keeps the stayers only)
  const canonSrc = fs.readFileSync(new URL('../../src/lib/canon-works.ts', import.meta.url), 'utf8');
  const canon = src.filter((w) => canonSrc.includes(`'${w}'`));
  // pending merge-queue pairs citing a source id: they were computed on the fused cluster
  const queue = await db.collection('work_merge_queue').countDocuments({ status: 'pending', $or: [{ a: { $in: src } }, { b: { $in: src } }] });
  // orchestrator copy-dedup: a moved book with no full text that a stayer stood in for
  // becomes eligible for OCR/translation after the move = SPEND
  const spend = [];
  for (const c of clusters) {
    const sibs = (carriers.get(c.work_id) || []).filter((b) => c.stays.includes(b.id) && b.hidden !== true && b.pages_count > 0
      && COMPLETED_COPY_STATUSES.includes(b.pipeline_auto?.status));
    for (const m of c.moves) for (const mb of m.books) {
      const b = (carriers.get(c.work_id) || []).find((x) => x.id === mb.id);
      // a book already past the pipeline, or hidden, is not a candidate whatever its work
      if (b.hidden === true || !(b.pages_count > 0) || COMPLETED_COPY_STATUSES.includes(b.pipeline_auto?.status)) continue;
      if (sibs.some((s) => isCompletedCopyOf(b, s))) spend.push({ id: b.id, source: c.work_id, status: b.pipeline_auto?.status ?? null, pages_count: b.pages_count, pages_ocr: b.pages_ocr ?? 0, visible: b.visible ?? null });
    }
  }
  // /work pages that change (revalidate) and new multi-edition works (sitemap gains them)
  const visibleMoves = moved.filter((b) => b.visible !== false);
  const workPaths = new Set([...src, ...moved.map((b) => b.to)]);
  const newMulti = clusters.flatMap((c) => c.moves.filter((m) => !m.to_existed && m.books.filter((b) => b.visible !== false).length >= 2));
  return {
    counts: {
      ft_cards_on_source_ids: ft.length, canon_entries_on_source_ids: canon.length, pending_queue_rows_citing_source: queue,
      copy_dedup_unblocked: spend.length, copy_dedup_unblocked_ocr_pages: spend.reduce((n, s) => n + Math.max(0, (s.pages_count || 0) - (s.pages_ocr || 0)), 0),
      copy_dedup_unblocked_pages_total: spend.reduce((n, s) => n + (s.pages_count || 0), 0),
      visible_books_moving: visibleMoves.length, work_pages_to_revalidate: workPaths.size, book_pages_to_revalidate: visibleMoves.length,
      new_multi_edition_works: newMulti.length,
    },
    detail: { ft_cards: ft.map((f) => f._id), canon, copy_dedup_unblocked: spend },
  };
}

async function apply(planFile) {
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const srcIds = plan.clusters.map((c) => c.work_id);
  const targets = [...new Set(plan.clusters.flatMap((c) => c.moves.filter((m) => m.to_existed).map((m) => m.to)))];
  const newIds = plan.clusters.flatMap((c) => c.moves.filter((m) => !m.to_existed).map((m) => m.to));
  const now = await carriersOf([...new Set([...srcIds, ...targets, ...newIds])]);
  const t0 = new Date();
  let moved = 0, stale = 0;
  const skipped = [];
  for (const c of plan.clusters) {
    const cur = (now.get(c.work_id) || []).map(identityOf).sort();
    if (JSON.stringify(cur) !== JSON.stringify(plan.identity[c.work_id])) { skipped.push([c.work_id, 'a carrier changed since the plan']); continue; }
    const gone = c.moves.find((m) => (m.to_existed ? !(now.get(m.to) || []).length : (now.get(m.to) || []).length));
    if (gone) { skipped.push([c.work_id, gone.to_existed ? `target ${gone.to} no longer carried` : `new id ${gone.to} now taken`]); continue; }
    const log = { work_id: c.work_id, stays: c.stays, moves: [], issue: ISSUE, sweep: SWEEP, reviewed_from: plan.reviewed_from, plan: planFile, applied_at: t0, reverted_at: null };
    for (const m of c.moves) {
      const done = [];
      for (const b of m.books) {
        await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'work-id-split',
          detail: { from: c.work_id, to: m.to, to_existed: m.to_existed, slug_from: b.before.work_slug, slug_to: m.work_slug, aliases_dropped: b.aliases_dropped, issue: ISSUE, plan: planFile } });
        const r = await books.updateOne({ id: b.id, work_id: c.work_id }, { $set: {
          work_id: m.to, work_title: m.title, work_slug: m.work_slug, work_id_aliases: b.after.work_id_aliases,
          work_id_source: SPLIT_SOURCE, work_id_confidence: SPLIT_CONFIDENCE, updated_at: t0 } });
        if (r.matchedCount) { moved++; done.push(b.id); } else stale++;
      }
      log.moves.push({ to: m.to, to_existed: m.to_existed, restored: m.restored, title: m.title, work_slug: m.work_slug, books: done, why: m.why });
    }
    log.before = plan.backup.filter((d) => c.moves.some((m) => m.books.some((b) => b.id === d.id)))
      .map((d) => ({ id: d.id, work_id: d.work_id ?? null, work_title: d.work_title ?? null, work_slug: d.work_slug ?? null, work_id_aliases: d.work_id_aliases ?? null,
        work_id_source: d.work_id_source ?? null, work_id_confidence: d.work_id_confidence ?? null }));
    await db.collection('work_id_splits').insertOne(log);
  }
  for (const [w, why] of skipped) console.log(`  skipped ${w}: ${why}`);
  console.log(`APPLIED sweep ${SWEEP} — ${moved} books moved, ${stale} stale, ${skipped.length} clusters skipped. Now run scripts/workers/sync-books-catalog.mjs; revert with --revert ${SWEEP} --apply.`);
}

async function revert(sweep, really) {
  const rows = await db.collection('work_id_splits').find({ sweep, reverted_at: null }).toArray();
  let restored = 0, moved_on = 0;
  for (const row of rows) {
    for (const m of row.moves) for (const id of m.books) {
      const before = row.before.find((b) => b.id === id);
      const cur = await books.findOne({ id }, { projection: { work_id: 1, work_id_source: 1 } });
      // only undo a book still where the split put it; anything moved since is someone else's edit
      if (!before || cur?.work_id !== m.to || cur?.work_id_source !== SPLIT_SOURCE) { moved_on++; continue; }
      const set = { updated_at: new Date() }, unset = {};
      for (const f of ['work_id', 'work_title', 'work_slug', 'work_id_aliases', 'work_id_source', 'work_id_confidence']) {
        if (before[f] === null) unset[f] = ''; else set[f] = before[f];
      }
      if (really) {
        await recordSweepAction(db, { sweep: `${sweep}-revert`, book_id: id, action: 'work-id-split-reverted', detail: { from: m.to, to: before.work_id, issue: ISSUE } });
        await books.updateOne({ id, work_id: m.to }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
      }
      restored++;
    }
    if (really) await db.collection('work_id_splits').updateOne({ _id: row._id }, { $set: { reverted_at: new Date() } });
  }
  console.log(`${really ? 'REVERTED' : 'DRY RUN revert'} ${sweep}: ${rows.length} clusters, ${restored} books restored, ${moved_on} left (moved since).${really ? ' Now run sync-books-catalog.mjs.' : ' Pass --apply to write.'}`);
}
