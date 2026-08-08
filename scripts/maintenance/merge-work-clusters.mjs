#!/usr/bin/env npx tsx
/**
 * merge-work-clusters.mjs — same-work cluster detection + merge for fragmented
 * work_ids (#3759). Successor to merge-duplicate-work-ids.mjs: adds the canon
 * registry as a gold seed, writes work_id_aliases for redirects + provenance,
 * and queues MEDIUM-confidence candidates for review instead of dropping them.
 *
 * Run with tsx (it imports src/lib/canon-works.ts):
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/maintenance/merge-work-clusters.mjs            # dry-run + plan/queue report
 *   npx tsx scripts/maintenance/merge-work-clusters.mjs --apply    # write HIGH merges (+backup)
 *
 * HIGH (auto-written with backup):
 *   - canon gold seeds: the hand-verified workIds arrays in canon-works.ts
 *     (minus combined-volume ids shared between entries);
 *   - identical-title clusters (author surname + identical normalized title).
 * MEDIUM (queued to `work_merge_queue`, status=pending — human review):
 *   - author-anchored title containment (the fit rule between clusters).
 *
 * Apply writes, per final cluster:
 *   - books with a loser work_id  → { work_id: winner, updated_at }
 *   - ALL books in the cluster    → $addToSet work_id_aliases (the loser ids)
 *     (aliases describe the WORK, so every edition carries them; /work/[id]
 *     resolves an alias via books.work_id_aliases and 307s to the winner)
 *   - a provenance doc in `work_id_merges`
 * plus an index on books.work_id_aliases, and a backup file with every book's
 * prior work_id (revert = replay the backup).
 *
 * After --apply, run the Supabase catalog sync (books_catalog carries work_id):
 *   node scripts/workers/sync-books-catalog.mjs
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonGoldClusters, identicalTitleClusters, containmentCandidates,
  unionMergeClusters,
} from '../lib/work-merge-lib.mjs';
import { norm as normTitle } from '../lib/work-identity-util.mjs';
// Dynamic import: node (24+) type-strips the .ts natively, but a STATIC import
// from an .mjs mis-detects its module format and drops the named exports.
const { CANON_WORKS } = await import(new URL('../../src/lib/canon-works.ts', import.meta.url).href);

const APPLY = process.argv.includes('--apply');
const OUT_DIR = path.join(process.cwd(), 'scripts', 'output');
const STAMP = new Date().toISOString().slice(0, 10);

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  // Every book carrying a work_id — merges must move hidden books too, or the
  // cluster stays split under the surface (and FT priors keep hiding in it).
  const all = await books
    .find({ work_id: { $exists: true, $nin: [null, ''] } })
    .project({ _id: 0, id: 1, work_id: 1, author: 1, author_id: 1, title: 1, work_title: 1, language: 1, visible: 1 })
    .toArray();

  // one representative per work_id (prefer a visible book — better titles),
  // plus the count of distinct normalized titles under the id: a rep can only
  // speak for a work_id whose books all share one title (see identicalTitleKey)
  const repByWid = new Map();
  const titleVariantsByWid = new Map();
  for (const b of all) {
    const cur = repByWid.get(b.work_id);
    if (!cur || (!cur.visible && b.visible)) repByWid.set(b.work_id, b);
    if (!titleVariantsByWid.has(b.work_id)) titleVariantsByWid.set(b.work_id, new Set());
    titleVariantsByWid.get(b.work_id).add(normTitle(b.title));
  }
  const reps = [...repByWid.values()].map((b) => ({ ...b, titleVariants: titleVariantsByWid.get(b.work_id).size }));
  console.log(`${all.length} books across ${repByWid.size} distinct work_ids`);

  // ── HIGH lanes ──
  const gold = canonGoldClusters(CANON_WORKS)
    // only ids that exist in the DB can be merged; a canon id with zero books
    // is stale registry data — report it, don't invent a merge around it.
    .map((c) => {
      const present = c.ids.filter((id) => repByWid.has(id));
      const missing = c.ids.filter((id) => !repByWid.has(id));
      return { ...c, ids: present, missing };
    })
    .filter((c) => c.ids.length >= 2);
  for (const c of gold.filter((g) => g.missing.length)) {
    console.log(`  note: canon "${c.slug}" ids not found on any book: ${c.missing.join(', ')}`);
  }

  const identical = identicalTitleClusters(reps);

  // cross-canon guard map (shared combined-volume ids resolve first-entry-wins;
  // any union spanning two canon entries is demoted, never auto-merged)
  const canonSlugByWorkId = new Map();
  for (const w of CANON_WORKS) for (const id of w.workIds) if (!canonSlugByWorkId.has(id)) canonSlugByWorkId.set(id, w.slug);

  const { merges, demoted } = unionMergeClusters([...gold, ...identical], canonSlugByWorkId);

  // ── MEDIUM lane (queue) ──
  // Skip pairs already unified by a HIGH merge.
  const finalRoot = new Map();
  for (const m of merges) for (const id of m.ids) finalRoot.set(id, m.winner);
  const candidates = containmentCandidates(reps).filter((p) => {
    const ra = finalRoot.get(p.a) || p.a;
    const rb = finalRoot.get(p.b) || p.b;
    return ra !== rb;
  });

  // ── plan ──
  const loserToWinner = new Map();
  for (const m of merges) for (const l of m.losers) loserToWinner.set(l, m.winner);
  const affected = all
    .filter((b) => loserToWinner.has(b.work_id))
    .map((b) => ({ book_id: b.id, old_work_id: b.work_id, new_work_id: loserToWinner.get(b.work_id), title: b.title }));

  console.log(`\n${APPLY ? 'APPLY' : 'DRY-RUN'} — ${merges.length} HIGH clusters (${loserToWinner.size} ids retired, ${affected.length} books rewritten), ${candidates.length} MEDIUM pairs queued, ${demoted.length} demoted`);
  for (const m of merges) {
    const rep = repByWid.get(m.winner);
    console.log(`  keep ${m.winner}  [${m.sources.join(', ')}]\n    + ${m.losers.join('\n    + ')}   "${(rep?.title || '').slice(0, 48)}"`);
  }
  if (demoted.length) {
    console.log('\nDEMOTED (span ≥2 canon entries — review by hand):');
    for (const d of demoted) console.log(`  ${d.ids.join(' + ')}  (${d.reason})`);
  }
  console.log('\nsample MEDIUM queue pairs:');
  for (const p of candidates.slice(0, 15)) {
    console.log(`  ${p.a} ~ ${p.b}  cont=${p.cont} inter=${p.inter}  "${p.titleA.slice(0, 36)}" ~ "${p.titleB.slice(0, 36)}"  (${p.author})`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const planPath = path.join(OUT_DIR, `work-merge-plan-${STAMP}.json`);
  fs.writeFileSync(planPath, JSON.stringify({ generated: new Date().toISOString(), apply: APPLY, merges, demoted, affected, queue: candidates }, null, 1));
  console.log(`\nplan/backup written: ${planPath}`);

  if (!APPLY) {
    console.log('\nDRY-RUN — pass --apply to write. Review the cluster list above first.');
    await client.close();
    return;
  }

  // ── apply ──
  // 1. alias lookup index (the /work/[id] 404-path query)
  await books.createIndex({ work_id_aliases: 1 }, { sparse: true, name: 'work_id_aliases_1' });

  // 2. rewrite losers → winner, and stamp aliases on every book in each cluster
  const now = new Date();
  const ops = [];
  for (const m of merges) {
    ops.push({
      updateMany: {
        filter: { work_id: { $in: m.losers } },
        update: { $set: { work_id: m.winner, updated_at: now }, $addToSet: { work_id_aliases: { $each: m.losers } } },
      },
    });
    // books already on the winner id get the aliases too (the redirect and the
    // provenance live on the work's editions, not just the moved ones)
    ops.push({
      updateMany: {
        filter: { work_id: m.winner, work_id_aliases: { $not: { $all: m.losers } } },
        update: { $set: { updated_at: now }, $addToSet: { work_id_aliases: { $each: m.losers } } },
      },
    });
  }
  let modified = 0;
  for (let i = 0; i < ops.length; i += 200) {
    const res = await books.bulkWrite(ops.slice(i, i + 200), { ordered: false });
    modified += res.modifiedCount;
  }

  // 3. provenance log
  if (merges.length) {
    await db.collection('work_id_merges').insertMany(merges.map((m) => ({
      winner: m.winner, losers: m.losers, sources: m.sources,
      books_rewritten: affected.filter((a) => a.new_work_id === m.winner).length,
      issue: 3759, backup: planPath, applied_at: now,
    })));
  }

  // 4. review queue (upsert; never clobber a reviewed row's status)
  let queued = 0;
  for (const p of candidates) {
    const [a, b] = [p.a, p.b].sort();
    const r = await db.collection('work_merge_queue').updateOne(
      { _id: `${a}|${b}` },
      {
        $setOnInsert: { a, b, status: 'pending', created_at: now },
        $set: { evidence: { cont: p.cont, inter: p.inter, titleA: p.titleA, titleB: p.titleB, author: p.author, source: p.source }, updated_at: now },
      },
      { upsert: true }
    );
    queued += r.upsertedCount;
  }

  const verifyLosers = await books.countDocuments({ work_id: { $in: [...loserToWinner.keys()] } });
  console.log(`\nAPPLIED — ${modified} book docs touched; ${verifyLosers} books still on a loser id (must be 0).`);
  console.log(`queue: ${queued} new pending pairs (${candidates.length - queued} already present).`);
  console.log('Next: node scripts/workers/sync-books-catalog.mjs  (books_catalog carries work_id)');
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
