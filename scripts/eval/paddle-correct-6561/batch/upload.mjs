#!/usr/bin/env node
// PRIOR ART: none — looked for a staging-collection uploader in scripts/eval/ and scripts/maintenance/
// (`git grep -l "staging" scripts/`); candidates there are written straight to `pages` by the script that read them
// (scripts/batch/cli-ocr.mjs apply). Here the read (cloudlayer) and the review + write (main) are on different
// boxes, so the candidates cross in a collection nothing else reads.
//
// #6561 batch, step 3: put run.mjs's accepted corrections where the review job on main can read them.
// Writes ONLY to `paddle_table_corrections_6561` (new, staging; no cron or worker reads it). Not `pages`.
//
// Usage (cwd = scratch): node --env-file=… upload.mjs [--apply] [--coll=NAME] [--account=TEXT] [--draft=TEXT]
// #6561 item 1 (the stale pages) uploads with --coll=stale_corrections_6561, its box's account, and
// --draft='current ocr.data (paddle-zh-2026-10 reading)'. Defaults: the table batch, unchanged.
import fs from 'node:fs';
import os from 'node:os';
import { MongoClient } from 'mongodb';
import { sha } from './prompt.mjs';

const APPLY = process.argv.includes('--apply');
const ARG = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const COLL = ARG('coll', 'paddle_table_corrections_6561');
const ACCOUNT = ARG('account', 'derek@playpowerlabs (cloudlayer)');
const DRAFT = ARG('draft', 'page_revisions snapshot, reason withhold_paddle_table_6388');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const P = JSON.parse(fs.readFileSync('prompt.json', 'utf8'));
const pages = new Map(readJsonl('pages.jsonl').map((p) => [p.pid, p]));
const last = new Map();
for (const r of readJsonl('out.jsonl')) if (r.outcome === 'ok') last.set(r.page_id, r);

const docs = [];
for (const [pid, r] of last) {
  const p = pages.get(pid);
  if (!p || sha(r.text) !== r.corrected_sha || sha(p.paddle) !== r.paddle_sha) { console.error('SHAPE: row does not match its page or its own hash', pid); process.exit(3); }
  docs.push({
    page_id: pid, book_id: p.bid, page_number: p.pn, title: p.title, image_url: p.image_url,
    paddle_text: p.paddle, paddle_sha: r.paddle_sha, corrected_text: r.text, corrected_sha: r.corrected_sha,
    layout: r.layout, flags: r.flags || [], detector_reasons: p.reasons || [], ...(p.cer != null ? { stale_cer: p.cer } : {}), run: r.run,
    provenance: {
      method: 'opus-correct (#6561): page image + Paddle draft in, corrected transcription out, one page per call',
      model: r.model, cli: 'claude -p', cli_version: r.cli_version ?? null, account: ACCOUNT, host: os.hostname(),
      prompt: { name: P.prompt_name, version: P.prompt_version, head_sha: P.head_sha, redo_opus_sha: P.redo_opus_sha, note: 'default OCR prompt + the #6388 pilot addendum (count, counting rods, drawings) + the #6561 draft block + sentinel reply format; scripts/eval/paddle-correct-6561/batch/prompt.mjs' },
      draft: { engine: 'paddle', source: DRAFT },
      image: { url: p.image_url, bytes: r.image_bytes ?? null, sha256: r.image_sha256 ?? null },
      read_at: new Date(r.at), secs: r.secs, num_turns: r.num_turns,
    },
    review: null, uploaded_at: new Date(),
  });
}
const missing = [...pages.keys()].filter((id) => !last.has(id));
console.log(`${docs.length} corrections for ${pages.size} listed pages; ${missing.length} pages have no accepted correction (they stay withheld)`);
fs.writeFileSync('not-corrected.json', JSON.stringify(missing.map((id) => ({ page_id: id, book_id: pages.get(id).bid, page_number: pages.get(id).pn })), null, 1));
if (!APPLY) { console.log('(dry run; add --apply)'); process.exit(0); }

const c = await MongoClient.connect(process.env.MONGODB_URI);
const coll = c.db('bookstore').collection(COLL);
await coll.createIndex({ page_id: 1 }, { unique: true });
await coll.createIndex({ book_id: 1 });
for (let i = 0; i < docs.length; i += 500) {
  // $setOnInsert-style: never overwrite a doc the review has already written a verdict into
  await coll.bulkWrite(docs.slice(i, i + 500).map(({ review, ...d }) => ({ updateOne: { filter: { page_id: d.page_id }, update: { $set: d, $setOnInsert: { review } }, upsert: true } })), { ordered: false });
}
// A count is not an integrity check: read every doc back and compare its text hash with the checkpoint's.
let n = 0, wrong = 0;
// By this upload's own page ids: several boxes may upload one run into one collection (#6561 item 1).
for (let i = 0; i < docs.length; i += 1000) {
  for await (const d of coll.find({ page_id: { $in: docs.slice(i, i + 1000).map((x) => x.page_id) } }, { projection: { page_id: 1, corrected_text: 1, paddle_text: 1 } }).batchSize(1000)) {
    n++; const r = last.get(d.page_id);
    if (!r || typeof d.corrected_text !== 'string' || sha(d.corrected_text) !== r.corrected_sha || sha(d.paddle_text) !== r.paddle_sha) wrong++;
  }
}
await c.close();
console.log(`${COLL}: ${n} docs read back, ${wrong} wrong`);
if (n !== docs.length || wrong) { console.error('UPLOAD CHECK FAILED'); process.exit(4); }
fs.writeFileSync('upload.done', JSON.stringify({ collection: COLL, docs: n, not_corrected: missing.length, at: new Date().toISOString() }));
