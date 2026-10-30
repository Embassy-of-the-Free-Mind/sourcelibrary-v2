#!/usr/bin/env node
/**
 * Give each work merged by apply-verified-work-merges.mjs one uniform work_title (#7761).
 *
 * PRIOR ART: apply-verified-work-merges.mjs set work_title to the surviving id's own title,
 * which is often a translation's or a single edition's title page ("L'architettura di
 * Leonbatista Alberti" for De re aedificatoria). llm-verify-work-merges.mjs --apply-from
 * would have written the proposer's canonical_title unjudged (Ptolemy got an English
 * paraphrase). This writes the title chosen by scripts/eval/work-recall/title-judge.mjs.
 *
 * Input: title-judge output, one row per work: {winner, title, pick}. Every book carrying
 * the winner id (hidden included) gets work_title = title, because /work and /works read
 * the title off the editions. Slugs and ids are untouched, so no URL changes.
 * OVERRIDES pins titles corrected by hand after reading the judge's output.
 *
 *   node --env-file=.env.production.local scripts/maintenance/retitle-verified-work-merges.mjs <titles.jsonl>           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/retitle-verified-work-merges.mjs <titles.jsonl> --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const inF = process.argv.slice(2).find((a) => a.endsWith('.jsonl'));
if (!inF) { console.error('usage: retitle-verified-work-merges.mjs <titles.jsonl> [--apply]'); process.exit(2); }
const SWEEP = 'verified-work-retitle-2026-10';
const ISSUE = 7761;
// read by hand 2026-10-30: the judge kept a full title-page phrase for Vesalius' Epitome
const OVERRIDES = { 'Andreae Vesalii Bruxellensis suorum de humani corporis fabrica librorum epitome': 'Epitome' };

const rows = fs.readFileSync(inF, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  .map((r) => ({ ...r, title: OVERRIDES[r.title] || Object.entries(OVERRIDES).find(([k]) => r.title.startsWith(k.slice(0, 40)))?.[1] || r.title }));
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const want = new Map(rows.map((r) => [r.winner, r.title]));
const winners = [...want.keys()];
const writes = [];
for (let i = 0; i < winners.length; i += 500) {
  for (const b of await books.find({ work_id: { $in: winners.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, work_id: 1, work_title: 1, visible: 1 } }).toArray()) {
    if (b.work_title !== want.get(b.work_id)) writes.push({ before: b, title: want.get(b.work_id) });
  }
}
console.log(`works ${rows.length}; book writes ${writes.length} (hidden ${writes.filter((w) => !w.before.visible).length})`);
for (const w of writes.slice(0, 8)) console.log(`  ${w.before.work_id.slice(0, 50)}: ${String(w.before.work_title).slice(0, 50)} -> ${w.title}`);

const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const backupPath = path.join(outDir, `verified-work-retitle-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ sweep: SWEEP, issue: ISSUE, apply: APPLY, source: inF, writes: writes.map((w) => ({ id: w.before.id, work_id: w.before.work_id, before: w.before.work_title ?? null, after: w.title })) }, null, 2));
console.log(`plan + before-state -> ${backupPath}`);
if (!APPLY) { console.log('DRY RUN — pass --apply to write.'); await client.close(); process.exit(0); }

let n = 0, stale = 0;
for (const w of writes) {
  const b = w.before;
  await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'work-title-set', detail: { work_id: b.work_id, from: b.work_title ?? null, to: w.title, judge: 'title-judge sonnet', issue: ISSUE, backup: backupPath } });
  const r = await books.updateOne({ id: b.id, work_id: b.work_id }, { $set: { work_title: w.title, updated_at: new Date() } });
  if (r.matchedCount) n += r.modifiedCount; else stale++;
}
console.log(`APPLIED — ${n} books retitled, ${stale} skipped (work_id changed since plan).`);
await client.close();
