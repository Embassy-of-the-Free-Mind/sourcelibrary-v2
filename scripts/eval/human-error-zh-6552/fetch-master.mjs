#!/usr/bin/env node
// PRIOR ART: fetch.mjs (this directory; takes the resolver's image, which for archived pages is a ~770px copy. The Archive's own
// full/full leaf is about 2.5x that, and a span crop needs the pixels). Keeps a master only if its aspect matches, so it is the same leaf.
// #6552: replaces $JOB_SCRATCH/<c>/img/<uid>.jpg in place, keeps the small copy as img/small/<uid>.jpg. READ-ONLY on Mongo.
//   node --env-file=/root/sourcelibrary/.env.production.local fetch-master.mjs --c=a --draw=draw-a.json
import fs from 'node:fs';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const ROOT = `${process.env.JOB_SCRATCH}/${arg('c')}`, picks = JSON.parse(fs.readFileSync(arg('draw'))).picked;
fs.mkdirSync(`${ROOT}/img/small`, { recursive: true });
const c = await MongoClient.connect(process.env.MONGODB_URI, { compressors: ['zlib'] }), pages = c.db('bookstore').collection('pages');
for (const p of picks) {
  const f = `${ROOT}/img/${p.uid}.jpg`, m = await sharp(f).metadata();
  if (m.width >= 1200) { console.log(p.uid, 'already', m.width); continue; }
  const row = await pages.findOne({ id: p.page_id }, { projection: { photo: 1 } }); const url = row?.photo;
  if (!/archive\.org/.test(url || '')) { console.log(p.uid, 'no archive photo', url); continue; }
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) { console.log(p.uid, 'HTTP', r.status); continue; }
  const buf = Buffer.from(await r.arrayBuffer()), big = await sharp(buf).metadata();
  const same = Math.abs(big.width / big.height - m.width / m.height) < 0.02;
  console.log(p.uid, m.width, '->', big.width, big.height, same ? 'kept' : 'ASPECT DIFFERS, kept small');
  if (same) { fs.renameSync(f, `${ROOT}/img/small/${p.uid}.jpg`); fs.writeFileSync(f, buf); fs.rmSync(`${ROOT}/lines/${p.uid}.lines.json`, { force: true }); }
}
await c.close();
