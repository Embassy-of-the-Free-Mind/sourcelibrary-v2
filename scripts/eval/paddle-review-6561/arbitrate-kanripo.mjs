#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-table-pilot-6388/kcheck.mjs (is a span the reviewer called invented on the aligned
// Kanripo leaf?) — it reads the pilot's own score/align files; this reads the gate verdicts and an align.mjs output for
// the 23 gate pages, and counts each span in the corrected text, the Paddle draft and the leaf (folded), so a
// disagreement can be sent to the image. Writes per-page text dumps (k-<uid>.txt) for the by-eye read.
// Usage (cwd = scratch): zcat results/gate-verdicts.jsonl.gz > gate-verdicts.jsonl; (build cand.jsonl {key,bid,pn} of
// the invented calls); node scripts/eval/paddle-table-6388/align.mjs cand.jsonl align.jsonl; node arbitrate-kanripo.mjs
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { foldHan } from '../ground-truth-5935/lib.mjs';
const inv = fs.readFileSync('gate-verdicts.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter((x) => x.review?.verdict === 'invented');
const A = new Map(fs.readFileSync('align.jsonl', 'utf8').split('\n').filter(Boolean).map(JSON.parse).map((a) => [a.key, a]));
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const cnt = (h, n) => (n ? h.split(n).length - 1 : 0);
const out = [];
for (const p of inv) {
  const d = await db.collection('paddle_table_corrections_6561').findOne({ page_id: p.page_id });
  const a = A.get(p.uid);
  const body = foldHan(d.corrected_text), pad = foldHan(d.paddle_text || '');
  const leaf = a?.status === 'aligned' ? foldHan(a.kanripo_text) : null;
  fs.writeFileSync(`k-${p.uid}.txt`, `CORRECTED:\n${d.corrected_text}\n\nPADDLE:\n${d.paddle_text}\n\nKANRIPO (${a?.ref_pb ?? a?.status}):\n${a?.kanripo_raw ?? ''}\n`);
  for (const x of p.review.invented) {
    const w = foldHan(String(x.what).replace(/\(.*?\)/g, '').replace(/[\s|#]/g, ''));
    out.push({ uid: p.uid, page_id: p.page_id, what: x.what, n_corrected: cnt(body, w), n_paddle: cnt(pad, w), n_kanripo: leaf == null ? null : cnt(leaf, w), leaf: a?.leaf ?? a?.status, ref_pb: a?.ref_pb ?? null });
  }
}
await c.close();
fs.writeFileSync('kcheck.jsonl', out.map((o) => JSON.stringify(o)).join('\n') + '\n');
for (const o of out) console.log(o.uid, JSON.stringify(o.what), 'corrected', o.n_corrected, 'paddle', o.n_paddle, 'kanripo', o.n_kanripo, o.leaf);
