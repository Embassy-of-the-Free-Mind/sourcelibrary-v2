#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/mkreq.mjs (the experiment's correct prompt: pilot read prompt + draft
// block, rebuilt here from the same parts and checked against results/prompt-ref.json by hash; it does not fit
// because it draws 100 pages from the pilot's scratch files, not the whole withheld list) and
// scripts/eval/paddle-table-pilot-6388/{mkreq-read,sample}.mjs (the live OCR prompt + addendum, the image-URL rule
// and the withheld text read back from the page_revisions snapshot; reused).
//
// #6561 batch, step 1: the work list for the Opus-correct pass over every page job paddle-tables-6388 withheld.
// Reads Mongo, writes files only.
//
// Usage (cwd = scratch): node --env-file=… prep.mjs <flagged.jsonl.gz>
// Writes: pages.jsonl (one row per page still withheld: uid, pid, bid, pn, title, image_url, paddle),
//         prep-skipped.jsonl, prompt.json (head, fmt, suffix + hashes).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { ADDENDUM_HEAD, FMT, OPUS_SUFFIX, LANGUAGE_INSTRUCTION, sha } from './prompt.mjs';

const [, , FLAGGED] = process.argv;
const REASON = 'paddle_table_6388', REV_REASON = 'withhold_paddle_table_6388';
const REF = JSON.parse(fs.readFileSync(new URL('../results/prompt-ref.json', import.meta.url), 'utf8'));
const raw = fs.readFileSync(FLAGGED);
const flagged = (FLAGGED.endsWith('.gz') ? zlib.gunzipSync(raw) : raw).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');

// The prompt, from the live default OCR prompt. It must hash to the experiment's, or this is a different arm.
const p = await db.collection('prompts').findOne({ type: 'ocr', is_default: true }, { sort: { version: -1 } });
const base = p.content.replace('{language_instruction}', LANGUAGE_INSTRUCTION).replace('{language}', '');
const head = `${base}\n${ADDENDUM_HEAD}`;
const redo = head + FMT + OPUS_SUFFIX;
if (sha(head) !== REF.head_sha || sha(redo) !== REF.redo_opus_sha) {
  console.error(`PROMPT DRIFT: head ${sha(head)} (want ${REF.head_sha}), redo ${sha(redo)} (want ${REF.redo_opus_sha}); default OCR prompt is ${p.name} v${p.version}. Not the #6561 arm: stop.`);
  process.exit(3);
}
fs.writeFileSync('prompt.json', JSON.stringify({ head, fmt: FMT, suffix: OPUS_SUFFIX, head_sha: sha(head), redo_opus_sha: sha(redo), prompt_name: p.name, prompt_version: String(p.version ?? ''), fetched_at: new Date().toISOString() }, null, 1));

const out = [], skipped = [];
for (let i = 0; i < flagged.length; i += 200) {
  const chunk = flagged.slice(i, i + 200), ids = chunk.map((r) => r.pid);
  const docs = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, photo: 1, 'ocr.engine.input': 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.edited_by': 1, 'ocr.unreadable': 1, 'ocr.unreadable_reason': 1 } }).toArray()).map((d) => [d.id, d]));
  const revs = new Map();
  for (const r of await db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr', reason: REV_REASON }, { projection: { page_id: 1, data: 1, created_at: 1 } }).sort({ created_at: 1 }).toArray()) revs.set(r.page_id, r.data);
  for (const r of chunk) {
    const d = docs.get(r.pid);
    const skip = (why) => skipped.push({ pid: r.pid, bid: r.bid, pn: r.pn, why });
    if (!d) { skip('no page'); continue; }
    if (d.ocr?.unreadable !== true || d.ocr?.unreadable_reason !== REASON) { skip(`not withheld by ${REASON} (unreadable=${d.ocr?.unreadable}, reason=${d.ocr?.unreadable_reason})`); continue; }
    if (d.ocr?.edited_by || d.ocr?.source === 'manual') { skip('human edit'); continue; }
    const paddle = typeof d.ocr?.data === 'string' ? d.ocr.data : revs.get(r.pid);
    if (typeof paddle !== 'string' || !paddle.trim()) { skip('no Paddle text in page or snapshot'); continue; }
    const url = d.ocr?.engine?.input?.image_url || d.archived_photo || d.photo; // image-pick-ok: the image Paddle read (engine input first), the pilot's rule (paddle-table-pilot-6388/sample.mjs)
    if (!url) { skip('no image url'); continue; }
    out.push({ uid: r.pid, pid: r.pid, bid: d.book_id, pn: d.page_number ?? r.pn, title: r.title, run: r.run, reasons: r.reasons, image_url: url, paddle, paddle_sha: sha(paddle) });
  }
  if ((i / 200) % 5 === 0) console.log(i + chunk.length, 'of', flagged.length);
}
await c.close();
fs.writeFileSync('pages.jsonl', out.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync('prep-skipped.jsonl', skipped.map((r) => JSON.stringify(r)).join('\n') + (skipped.length ? '\n' : ''));
const why = {}; for (const s of skipped) { const k = s.why.replace(/\(.*/, '').trim(); why[k] = (why[k] || 0) + 1; }
console.log(`pages.jsonl ${out.length} pages in ${new Set(out.map((o) => o.bid)).size} books; skipped ${skipped.length}`, JSON.stringify(why), `prompt ${crypto.createHash('sha256').update(redo).digest('hex').slice(0, 16)} OK`);
