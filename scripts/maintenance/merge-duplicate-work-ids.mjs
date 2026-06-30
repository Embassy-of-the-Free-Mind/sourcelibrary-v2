#!/usr/bin/env node
/**
 * Merge UNAMBIGUOUS duplicate work_ids (issue: work_id health / canonical works).
 *
 * Root cause (bucket A): the work_id resolver slugs a `local:` id from EITHER the
 * English title OR the original-language title depending on which pass ran, so the
 * SAME work gets two ids — e.g. Pacioli's Summa as both
 * `…arithmetica-et-geometria-proportionalita` and `…arithmetic-geometry-proportionality`.
 *
 * SAFE SUBSET ONLY. We cluster work_ids by (author surname + IDENTICAL full
 * normalized title), and EXCLUDE Tibetan (pecha section-letter false-merges) and
 * volume-marked titles (the multi-volume grain question is an unresolved POLICY
 * decision — see the foundation issue). Token-overlap clustering over-merges
 * badly here (the "thor bu" / "rgyud" miscellanea), so we require the FULL title
 * to be identical — same-work by construction.
 *
 * Reversible: every book's prior work_id is written to a backup file before any
 * change, and the merge is a pure work_id rewrite (no other field touched).
 *
 * Winner per cluster (deterministic): Wikidata QID > local:a: > local:n: > other;
 * tiebreak = shortest, then lexicographic.
 *
 * Usage:
 *   node scripts/maintenance/merge-duplicate-work-ids.mjs            # dry-run + writes the cluster report
 *   node scripts/maintenance/merge-duplicate-work-ids.mjs --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';

const APPLY = process.argv.includes('--apply');
const OUT_DIR = path.join(process.cwd(), 'scripts', 'output');
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const volRe = /\b(vol|volume|part|tome|band|tomus|tom|pt|bd)\.?\s*[ivxlcdm0-9]/i;

function rankFormat(w) {
  if (/^Q\d+$/.test(w)) return 0;        // Wikidata QID — most canonical
  if (/^local:a:/.test(w)) return 1;     // author-resolved
  if (/^local:n:/.test(w)) return 2;     // anon-resolved
  return 3;                              // bare/cjk/other
}
function pickWinner(wids) {
  return [...wids].sort((a, b) => {
    const r = rankFormat(a) - rankFormat(b); if (r) return r;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  })[0];
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db(process.env.MONGODB_DB || 'bookstore').collection('books');
  const LIVE = { visible: true, pages_translated: { $gt: 0 } };

  const all = await books.find({ ...LIVE, work_id: { $exists: true, $ne: null } })
    .project({ _id: 0, id: 1, work_id: 1, author: 1, title: 1, language: 1 }).toArray();

  // representative (author,title) per work_id
  const repByWid = new Map();
  for (const b of all) if (!repByWid.has(b.work_id)) repByWid.set(b.work_id, b);

  // cluster work_ids by (surname + identical full normalized title), safe-excluded
  const clusters = new Map();
  for (const [w, b] of repByWid) {
    if ((b.language || '') === 'Tibetan') continue;       // pecha hazard
    if (volRe.test(b.title || '')) continue;              // grain policy — undecided
    const t = norm(b.title);
    if (t.split(' ').length < 3) continue;                // need a substantive title
    const k = `${norm(b.author).split(' ').pop()}||${t}`;
    if (!clusters.has(k)) clusters.set(k, new Set());
    clusters.get(k).add(w);
  }

  const merges = []; // {winner, losers[], title, author}
  for (const [k, set] of clusters) {
    if (set.size < 2) continue;
    const wids = [...set];
    const winner = pickWinner(wids);
    const losers = wids.filter((w) => w !== winner);
    const rep = repByWid.get(winner) || repByWid.get(wids[0]);
    merges.push({ winner, losers, title: rep.title, author: rep.author, language: rep.language });
  }

  // build the per-book rewrite plan
  const loserToWinner = new Map();
  for (const m of merges) for (const l of m.losers) loserToWinner.set(l, m.winner);
  const affected = all.filter((b) => loserToWinner.has(b.work_id))
    .map((b) => ({ book_id: b.id, old_work_id: b.work_id, new_work_id: loserToWinner.get(b.work_id), title: b.title }));

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${merges.length} clusters, ${loserToWinner.size} duplicate ids → merged, ${affected.length} books rewritten`);
  for (const m of merges) console.log(`  keep ${m.winner}\n    + ${m.losers.join('\n    + ')}   [${m.language}] "${(m.title||'').slice(0,40)}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const backupPath = path.join(OUT_DIR, 'workid-merge-backup-2026-06-30.json');
  fs.writeFileSync(backupPath, JSON.stringify({ generated: 'dry-run', merges, affected }, null, 1));
  console.log(`\nbackup/plan written: ${backupPath}`);

  if (APPLY) {
    let n = 0;
    const ops = affected.map((a) => ({ updateOne: { filter: { id: a.book_id }, update: { $set: { work_id: a.new_work_id } } } }));
    for (let i = 0; i < ops.length; i += 500) {
      const res = await books.bulkWrite(ops.slice(i, i + 500), { ordered: false });
      n += res.modifiedCount;
    }
    console.log(`\nAPPLIED — ${n} books rewritten. Reverse with the backup file (old_work_id per book_id).`);
  } else {
    console.log('\nDRY-RUN — pass --apply to write. Review the cluster list above first.');
  }
  await client.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
