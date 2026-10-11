#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/restore-withheld-translation.mjs puts back a WITHHELD translation from its
// page_revisions row; here the page is not withheld, it carries the run's new English, and the text to put back is the
// stage-2 snapshot of the English before the run (stored-before.jsonl.gz, byte-identical to the page_revisions row the
// apply wrote). Same door (writePageTranslation: human-edit guard, a page_revisions snapshot of what it replaces).
//
// #6361 convergent check: on every sampled page where BOTH blind readers (Opus, Gemini 3.7 Flash) preferred the old
// English against the image, put the old English back. Dry run unless --apply.
//   node --env-file=… restore-old.mjs --score=$JOB_SCRATCH/convergent/score-all.json --stored=<stored-before.jsonl.gz> [--apply]
import fs from 'node:fs';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { writePageTranslation, syncBookTranslationCounters } from '../../../lib/translate-core.mjs';
import { notRecorded } from '../../../lib/write-provenance.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const APPLY = process.argv.includes('--apply');
const score = JSON.parse(fs.readFileSync(arg('score'), 'utf8'));
const stored = new Map(zlib.gunzipSync(fs.readFileSync(arg('stored'))).toString('utf8').split('\n').filter(Boolean).map((l) => { const r = JSON.parse(l); return [r.page_id, r]; }));
const RUN_JOBS = new Set(['tengyur-cli-6361', 'tengyur-cli-6361-reread']);
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const touched = new Set();
for (const p of score.both_prefer_old.pages) {
  const page = await db.collection('pages').findOne({ id: p.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } });
  const old = stored.get(p.page_id)?.translation;
  const job = page?.translation?.engine?.run?.job_id;
  if (!old?.data) { console.log(`${p.page_id}: no old English in the snapshot; skip`); continue; }
  if (!RUN_JOBS.has(job)) { console.log(`${p.page_id}: stored English is not this run's (job ${job}); skip`); continue; }
  console.log(`${APPLY ? 'restore' : 'would restore'} vol ${p.vol} p${p.page_number} (${p.page_id}): ${page.translation.data.length} → ${old.data.length} chars`);
  if (!APPLY) continue;
  const book = await db.collection('books').findOne({ id: page.book_id });
  const why = `#6361 convergent check (#6420): both blind readers (Opus; gemini-3.7-flash-high via agy) preferred the English from before the run against the page image (slot ${p.slot}); put back. Opus: ${p.opus} Gemini: ${p.gemini}`;
  const promptRef = { id: old.prompt_id, name: old.prompt_name, version: old.prompt_version, content_hash: old.prompt_hash };
  const res = await writePageTranslation(db, { page, book, text: old.data, promptRef, model: old.model, jobId: 'tengyur-cli-6361-convergent', note: 'restore-convergent-6361', engine: notRecorded(`restore of the English before #6361 (model ${old.model}, updated ${old.updated_at}); its engine block was never recorded. ${why}`) });
  if (res.protected) { console.log('  human-edited; skipped'); continue; }
  await recordSweepAction(db, { sweep: 'tengyur-cli-6361', book_id: page.book_id, action: 'restored-previous-translation', detail: { page_id: page.id, page_number: page.page_number, slot: p.slot, why } });
  touched.add(page.book_id);
}
for (const b of touched) await syncBookTranslationCounters(db, b);
await client.close();
