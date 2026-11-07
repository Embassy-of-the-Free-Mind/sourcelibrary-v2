#!/usr/bin/env node
// PRIOR ART: none — scripts/eval/siku-kanripo-7503 and ground-truth-5935 read text only; lib/contact-sheet.mjs fetches for sheets, not to disk.
// #6552: page images for one collection's picks to $JOB_SCRATCH/<c>/img/<uid>.jpg and the private text to pages/<uid>.json.
//   node fetch.mjs --c=a --draw=draw-a.json
import fs from 'node:fs';
import sharp from 'sharp';
const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const C = arg('c'), ROOT = `${process.env.JOB_SCRATCH}/${C}`, picks = JSON.parse(fs.readFileSync(arg('draw'))).picked;
fs.mkdirSync(`${ROOT}/img`, { recursive: true }); fs.mkdirSync(`${ROOT}/pages`, { recursive: true });
for (const p of picks) {
  const f = `${ROOT}/img/${p.uid}.jpg`;
  if (!fs.existsSync(f)) {
    const r = await fetch(p.image, { redirect: 'follow' });
    if (!r.ok) { console.log(p.uid, 'HTTP', r.status, p.image); continue; }
    fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  }
  const m = await sharp(f).metadata();
  console.log(p.uid, m.width, m.height, fs.statSync(f).size);
  if (fs.existsSync(`${ROOT}/${p.uid}.json`)) fs.copyFileSync(`${ROOT}/${p.uid}.json`, `${ROOT}/pages/${p.uid}.json`);
}
