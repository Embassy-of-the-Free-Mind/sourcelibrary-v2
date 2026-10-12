#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-zh-qa-6388/prepare.mjs kanripoScore (the #5935 leaf rule: own qa_screen leaf at
// dice ≥ 0.6, else the leaf between two trusted neighbours) — reused here, but a CONTAINED page has no ocr (and so no
// qa_screen) any more, so this version also accepts the neighbour rule alone and returns the Kanripo leaf TEXT for the
// bake-off arm (c), not only a CER.
//
// #6388 table bake-off: for each candidate page, the Kanripo leaf (WYG witness) where the alignment can place it.
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paddle-table-6388/align.mjs CAND.jsonl OUT.jsonl
// CAND rows: {key, bid, pn}. Writes NOTHING to Mongo.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';

const QA_TRUST = 0.6;
const [, , IN, OUT] = process.argv;
const cand = fs.readFileSync(IN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] });
const db = c.db('bookstore');
const juanOf = (pb) => Number(String(pb || '').match(/_(\d{3})-\d+[ab]$/)?.[1]);
const out = [];
for (const r of cand) {
  const ps = await db.collection('pages').find({ book_id: r.bid, page_number: { $in: [r.pn - 2, r.pn - 1, r.pn, r.pn + 1, r.pn + 2] } }, { projection: { _id: 0, page_number: 1, 'ocr.qa_screen': 1 } }).toArray();
  const at = (k) => ps.find((x) => x.page_number === k)?.ocr?.qa_screen;
  const ok = (q) => q?.status === 'screened' && q.dice >= QA_TRUST;
  const anyQ = [r.pn, r.pn - 1, r.pn + 1, r.pn - 2, r.pn + 2].map(at).find((q) => q?.repo);
  if (!anyQ) { out.push({ key: r.key, status: 'no-kanripo-work', reason: at(r.pn)?.reason ?? at(r.pn)?.status ?? 'no qa_screen' }); continue; }
  const krId = String(anyQ.repo).replace(/^kanripo\//, '');
  const w = await workInfo(krId);
  const js = [r.pn, r.pn - 1, r.pn + 1, r.pn - 2, r.pn + 2].map(at).filter(ok).map((q) => juanOf(q.pb));
  if (!js.length) { out.push({ key: r.key, status: 'unaligned', repo: krId }); continue; }
  const pbs = await pbPages(krId, 'WYG', (w.juan_files || []).filter((x) => js.some((j) => Math.abs(x - j) <= 1)));
  const idx = (q) => (ok(q) ? pbs.findIndex((x) => x.pb === q.pb) : -1);
  let k = -1, leaf = null;
  if (ok(at(r.pn))) { k = idx(at(r.pn)); leaf = 'own'; }
  else {
    const a = idx(at(r.pn - 1)), b = idx(at(r.pn + 1)), a2 = idx(at(r.pn - 2)), b2 = idx(at(r.pn + 2));
    if (a >= 0 && b >= 0 && b - a === 2) { k = a + 1; leaf = 'neighbours'; }
    else if (a2 >= 0 && b2 >= 0 && b2 - a2 === 4) { k = a2 + 2; leaf = 'neighbours±2'; }
    else if (a >= 0 && b < 0) { k = a + 1; leaf = 'one-neighbour'; }
    else if (b >= 0 && a < 0) { k = b - 1; leaf = 'one-neighbour'; }
  }
  if (k < 0 || k >= pbs.length) { out.push({ key: r.key, status: 'unaligned', repo: krId }); continue; }
  out.push({ key: r.key, status: 'aligned', repo: krId, witness: w.witness, witness_sha: w.witness_sha, ref_pb: pbs[k].pb, leaf, own_dice: at(r.pn)?.dice ?? null, kanripo_raw: pbs[k].raw, kanripo_text: pbs[k].text, licence: { repo_licence: w.repo_licence, licence_file: w.licence_file, readme_licence_line: w.readme_licence_line } });
  console.log(r.key, leaf, pbs[k].pb, pbs[k].text.length);
}
await c.close();
fs.writeFileSync(OUT, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
const by = {}; for (const x of out) by[x.status + (x.leaf ? ':' + x.leaf : '')] = (by[x.status + (x.leaf ? ':' + x.leaf : '')] || 0) + 1; console.log(by);
