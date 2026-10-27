#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-table-6388/img.mjs (fetches page images for a review set; no Kanripo leaf beside
// them). Here: for one flagged page, the stored Paddle body text, the Kanripo leaf it SHOULD be (interpolated
// from the nearest in-sequence neighbours in align.mjs's pages.jsonl) and the leaf it best matched, plus the page
// image saved under --img for opening by eye.
//   node --env-file=… scripts/eval/siku-kanripo-7503/eye.mjs --rows=pages.jsonl --img=DIR --dir=KANRIPO_CACHE BOOK:PN …
// READ-ONLY.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText } from '../ground-truth-5935/lib.mjs';

const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const rows = fs.readFileSync(arg('rows'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const IMG = arg('img');
fs.mkdirSync(IMG, { recursive: true });
const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const cache = {};
for (const spec of process.argv.slice(2).filter((x) => !x.startsWith('--'))) {
  const [bid, pnS] = spec.split(':'); const pn = +pnS;
  const b = await db.collection('books').findOne({ id: bid }, { projection: { work_id: 1, title: 1 } });
  const kr = b.work_id.replace(/^kr:/, '');
  if (!cache[kr]) { const w = await workInfo(kr); cache[kr] = await pbPages(kr, w.witness, w.juan_files); }
  const pbs = cache[kr];
  const br = rows.filter((r) => r.book_id === bid);
  const me = br.find((r) => r.pn === pn);
  const prev = br.filter((r) => r.pn < pn && r.status === 'aligned' && !r.flag_out_of_sequence).at(-1);
  const next = br.find((r) => r.pn > pn && r.status === 'aligned' && !r.flag_out_of_sequence);
  const exp = prev ? pbs[prev.idx + (pn - prev.pn)] : next ? pbs[next.idx - (next.pn - pn)] : null;
  const p = await db.collection('pages').findOne({ book_id: bid, page_number: pn }, { projection: { 'ocr.data': 1, archived_photo: 1 } });
  const f = path.join(IMG, `${bid}-${pn}.jpg`);
  if (!fs.existsSync(f) && p.archived_photo) { const r = await fetch(p.archived_photo); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  console.log(`\n=== ${bid}:${pn} ${b.title} | status ${me?.status} dice ${me?.dice} cer ${me?.cer ?? '-'} | best ${me?.pb ?? '-'}`);
  console.log(`prev in-seq ${prev ? prev.pn + '→' + prev.pb : '-'} | next in-seq ${next ? next.pn + '→' + next.pb : '-'} | expected ${exp?.pb ?? '-'}`);
  console.log('--- paddle body:\n' + bodyText(p.ocr?.data || '').trim().slice(0, 900));
  if (exp) console.log(`--- kanripo expected ${exp.pb}:\n` + exp.raw.replace(/¶/g, '').trim().slice(0, 900));
  if (me?.pb && me.pb !== exp?.pb) console.log(`--- kanripo best ${me.pb}:\n` + pbs[me.idx].raw.replace(/¶/g, '').trim().slice(0, 400));
  console.log(`image: ${f}`);
}
await c.close();
