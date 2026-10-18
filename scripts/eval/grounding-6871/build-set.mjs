#!/usr/bin/env node
/**
 * build-set.mjs — the labelled set for #6871 row A (image vs no-image likelihood as a guessed-text detector).
 *
 * PRIOR ART: scripts/batch/ocr-convergence/results/run/{calib,gate,main200b,q300}/decisions.jsonl.gz — the lane B
 * adjudications (#6420, #6694), where a sealed Opus read the image and listed the STORED read's errors as quoted
 * spans ("'præfertim' — image 'præſertim'"). They are the only Opus-judged stored reads with marked spans at scale.
 * The stored texts themselves were never committed (driver.mjs wrote them to <set>/stored/, gone with the job
 * worktrees), so this rebuilds each one READ-ONLY: the live `pages.ocr.data` when its updated_at is still the
 * snapshot's, else the `page_revisions` row of that page whose text has the snapshot's exact length (`len_stored`).
 * #6559 has no stored reads to label (its pages were empty; its 3 plants are Opus reads), #6561 marks Paddle
 * Chinese against Kanripo, not Opus — both are counted in the experiment file, not used here.
 *
 *   node --env-file=.env.production.local scripts/eval/grounding-6871/build-set.mjs <out.jsonl>
 * Writes one row per adjudicated page: {page_id, book_id, set, language, group, stored_model, text, errors[],
 * stored_serious, image, source}. Nothing is written to any store.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { normaliseForCer } from '../../batch/ocr-convergence/lib.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const RUN = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../batch/ocr-convergence/results/run');
const SETS = ['calib', 'gate', 'main200b', 'q300'];
const out = process.argv[2];
if (!out) { console.error('usage: build-set.mjs <out.jsonl>'); process.exit(2); }
const gz = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const rows = [];
const seen = new Set();
for (const s of SETS) {
  const cmp = new Map(gz(path.join(RUN, s, 'compare.jsonl.gz')).map((r) => [r.page_id, r]));
  for (const d of gz(path.join(RUN, s, 'decisions.jsonl.gz'))) {
    if (!d.adj || seen.has(d.page_id)) continue;   // a page adjudicated in two sets keeps its first
    seen.add(d.page_id);
    const c = cmp.get(d.page_id) || {};
    rows.push({ page_id: d.page_id, book_id: d.book_id, set: s, language: d.language, group: d.group, page_number: d.page_number,
      stored_model: d.stored_model, action: d.action, errors: d.adj.stored_errors || [], stored_serious: !!d.adj.stored_serious,
      pick: d.adj.pick, len_stored: Number(c.len_stored), stored_updated_at: c.stored_updated_at });
  }
}

const cli = await MongoClient.connect(process.env.MONGODB_URI);
const db = cli.db('bookstore');
const byId = new Map();
for (let i = 0; i < rows.length; i += 200) {
  const ids = rows.slice(i, i + 200).map((r) => r.page_id);
  const oids = ids.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
  for (const p of await db.collection('pages').find({ $or: [{ id: { $in: ids } }, { _id: { $in: oids } }] },
    { projection: { id: 1, 'ocr.data': 1, 'ocr.updated_at': 1, archived_photo: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1 } }).toArray()) {
    byId.set(p.id || String(p._id), p);
    byId.set(String(p._id), p);
  }
}
const stat = { live: 0, revision: 0, missing: 0 };
const fh = fs.createWriteStream(out);
for (const r of rows) {
  const p = byId.get(r.page_id);
  let text = null, source = null;
  const live = p?.ocr?.data || '';
  // identity check: compare recorded len_stored as the NORMALISED length (lib.mjs pairCer) of the very text Opus saw
  const same = (t) => !!t && normaliseForCer(t).length === r.len_stored;
  if (same(live)) {
    text = live; source = 'live';
  } else {
    const revs = await db.collection('page_revisions').find({ page_id: r.page_id, field: 'ocr' }, { projection: { data: 1, created_at: 1 } }).toArray();
    const hit = revs.find((v) => same(v.data));
    if (hit) { text = hit.data; source = 'revision'; }
  }
  if (!text) { stat.missing++; continue; }
  stat[source]++;
  fh.write(JSON.stringify({ ...r, text, source, image: p ? getPageSource(p) : null }) + '\n');
}
fh.end();
await cli.close();
console.log(JSON.stringify({ pages: rows.length, ...stat }));
