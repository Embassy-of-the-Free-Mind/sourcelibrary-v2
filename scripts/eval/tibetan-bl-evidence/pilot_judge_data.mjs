// PRIOR ART: scripts/eval/tibetan-mt-ab/build-judge-packet.mjs reads <data>/ids-final.txt, img/, refs-final.json and
// <src>/<id>.txt; nothing wrote that layout from a run-arms.mjs run. This does, for the #4523 BL pilot (C): 3 pages
// per book (seeded), the page image, the served OCR, and two "engines" — the pilot's chained-lane English and the
// English readers are served today. Read-only on Mongo. Run after run-arms.mjs --export.
//   node --env-file=/root/sourcelibrary/.env.production.local pilot_judge_data.mjs /root/tib-bl-evidence/C
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { pageImageUrl } from '../spot-check/lib.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const DIR = process.argv[2];
const J = path.join(DIR, 'judge');
for (const d of ['img', 'src', 'arms/pilot', 'arms/current']) fs.mkdirSync(path.join(J, d), { recursive: true });
const rng = makeRng(4523);
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ref = readJsonl(path.join(DIR, 'ref', 'reference.jsonl'));
const A = Object.fromEntries(readJsonl(path.join(DIR, 'arms', 'A.jsonl')).map((r) => [r.page_id, r]));
const pages = Object.fromEntries(fs.readdirSync(path.join(DIR, 'pages')).filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readJsonl(path.join(DIR, 'pages', f))).map((p) => [p.page_id, p]));
const byBook = {};
for (const r of ref) (byBook[r.vol] ||= []).push(r);
const chosen = [];
for (const [book, rs] of Object.entries(byBook).sort()) {
  const pool = rs.filter((r) => A[r.page_id] && pages[r.page_id]?.src);
  for (let i = 0; i < 3 && pool.length; i++) chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
}
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const ids = [];
for (const r of chosen) {
  const id = `${r.vol}_${String(r.page_number).padStart(5, '0')}`;
  const p = await c.db('bookstore').collection('pages').findOne({ book_id: r.vol, page_number: r.page_number });
  const url = pageImageUrl(p);
  const res = await fetch(url);
  if (!res.ok) { console.error(`image ${res.status} ${id} ${url}`); continue; }
  fs.writeFileSync(path.join(J, 'img', `${id}.jpg`), Buffer.from(await res.arrayBuffer()));
  fs.writeFileSync(path.join(J, 'src', `${id}.txt`), pages[r.page_id].src);
  fs.writeFileSync(path.join(J, 'arms/pilot', `${id}.json`), JSON.stringify({ text: A[r.page_id].text, via: A[r.page_id].via }));
  fs.writeFileSync(path.join(J, 'arms/current', `${id}.json`), JSON.stringify({ text: pages[r.page_id].current_en, model: pages[r.page_id].current_en_model }));
  ids.push(`${r.vol} ${r.page_number}`);
}
await c.close();
fs.writeFileSync(path.join(J, 'ids-final.txt'), ids.join('\n') + '\n');
const refs = JSON.parse(fs.readFileSync(path.join(DIR, 'refs-84000.json'), 'utf8'));
fs.writeFileSync(path.join(J, 'refs-final.json'), JSON.stringify(refs));
console.log(`${ids.length} judged pages → ${J}`);
