#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/check-rows.mjs writes book_checks for the fortnightly spot check (one text per
// page, its own review shape); this writes the retranslation-gate v1 rows from #6361's by-eye results, through the same
// recordBookCheck() door, after the apply (method: rows are written against the live page provenance).
//
// #6361 stage 2: one book_checks row per by-eye volume. Refuses a volume whose stored English on a page read is not
// the text the reviewer read (content hash ≠ the apply log's). Verdicts per scripts/eval/methods/retranslation-gate.md;
// page_findings are the STAGED (now stored) English's serious errors, unblinded with blind-key.json.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/tengyur-cli-6361/record-checks.mjs \
//     --apply-log=$JOB_SCRATCH/apply.jsonl [--write]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { recordBookCheck, buildBookCheck, pageProvenance, ensureBookCheckIndexes } from '../../lib/book-checks.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const WRITE = process.argv.includes('--write');
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'results', 'byeye');
const EVIDENCE = 'scripts/maintenance/tengyur-cli-6361/results/byeye';
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const draw = read('draw.json'), key = read('blind-key.json'), unblinded = read('unblinded.json');
const applied = new Map(fs.readFileSync(arg('apply-log'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.written).map((r) => [r.page_id, r.content_hash]));
// Vol 98 p.495: the staged error sits on the same verse line the stored English reverses outright, so it is not an
// error "the old English does not have" in the sense the stop rule was applied on 2026-10-10 (two volumes: 193, 183).
const VERDICT = { 193: 'fix', 183: 'fix', 98: 'caveat' };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
if (WRITE) await ensureBookCheckIndexes(db);
for (const v of draw.draw) {
  const review = read(`review-vol${v.vol}.json`);
  const nums = v.pages.map((p) => p.page_number);
  const live = await db.collection('pages').find({ id: { $in: v.pages.map((p) => p.page_id) } }, { projection: { id: 1, 'translation.content_hash': 1 } }).toArray();
  const mismatch = v.pages.filter((p) => live.find((l) => l.id === p.page_id)?.translation?.content_hash !== applied.get(p.page_id));
  if (mismatch.length) { console.log(`vol ${v.vol}: stored English is not the text read on p.${mismatch.map((p) => p.page_number)}; no row`); continue; }
  const page_findings = review.pages.map((rp) => {
    const side = key[`${v.vol}:${rp.page}`].A === 'staged' ? 'A' : 'B';
    const errs = rp[`${side}_serious`] || [];
    return errs.length ? { page_number: rp.page, errors: errs.map((e) => ({ stage: 'translation', class: e.class, problem: e.problem })) } : null;
  }).filter(Boolean);
  const verdict = VERDICT[v.vol] || (page_findings.length ? 'caveat' : 'show');
  const staged = nums.reduce((s, n) => s + (unblinded[`${v.vol}:${n}`]?.staged || 0), 0), stored = nums.reduce((s, n) => s + (unblinded[`${v.vol}:${n}`]?.stored || 0), 0);
  const row = {
    book_id: v.book_id, checked_at: new Date(draw.at), method_id: 'retranslation-gate', method_version: '1', run_id: 'tengyur-cli-6361',
    frame: `#6361 stage 2 by-eye draw (seed ${draw.seed}): ${v.why}`, pages_read: nums,
    reader: { kind: 'model', model: 'opus', image_opened: true }, verdict, verdict_source: 'retranslation-gate v1, derived after unblinding',
    note: `serious errors on these pages: new (stored since 2026-10-10) English ${staged}, previous English ${stored}. Per-volume stop rule waived by Derek 2026-10-10.`,
    evidence_path: `${EVIDENCE}/review-vol${v.vol}.json`,
    text_provenance: await pageProvenance(db, v.book_id, nums),
    page_findings,
  };
  buildBookCheck(row);
  console.log(`vol ${v.vol} ${v.book_id}: ${verdict}, findings on p.${page_findings.map((f) => f.page_number).join(',') || '-'}${WRITE ? '' : ' (dry run)'}`);
  if (WRITE) await recordBookCheck(db, row);
}
await client.close();
