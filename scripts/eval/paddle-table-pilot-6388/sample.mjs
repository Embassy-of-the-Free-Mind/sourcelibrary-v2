// PRIOR ART: scripts/eval/paddle-table-6388/{img,mkreview}.mjs — image fetch (engine input URL, then archived_photo,
// then photo) and the by-image review prompt (review-prompt.txt there), reused. This draws a seeded random sample
// from the census's flagged list and builds one Opus request per page (image + stored Paddle text).
//
// Usage (cwd = scratch dir holding flagged.jsonl):
//   node --env-file=… sample.mjs <n> <seed> <out-prefix> [--exclude=a.json,b.json] [--one-per-book] [--require=title1|title2]
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const [, , N, SEED, OUT] = process.argv;
const ARG = (n) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=').slice(1).join('=');
const h = (s) => crypto.createHash('sha256').update(`${SEED}:${s}`).digest('hex');
const exclude = new Set((ARG('--exclude') || '').split(',').filter(Boolean).flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).map((r) => r.pid)));
const rows = fs.readFileSync('flagged.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !exclude.has(r.pid));
rows.sort((a, b) => (h(a.pid) < h(b.pid) ? -1 : 1));

let pick;
if (process.argv.includes('--one-per-book')) {
  // One page per book, stratified by run: the runs' shares of the BOOKS, at least 2 books per run where it has them,
  // plus every --require title once. Seeded order within each stratum.
  const req = (ARG('--require') || '').split('|').filter(Boolean);
  const firstByBook = new Map();
  for (const r of rows) if (!firstByBook.has(r.bid)) firstByBook.set(r.bid, r);
  const books = [...firstByBook.values()];
  pick = [];
  for (const t of req) { const r = books.find((b) => (b.title || '').includes(t) && !pick.includes(b)); if (r) pick.push(r); }
  const byIss = {};
  for (const b of books) (byIss[b.iss] ||= []).push(b);
  const n = Number(N);
  const quota = Object.fromEntries(Object.entries(byIss).map(([k, v]) => [k, Math.max(Math.min(v.length, 5), Math.round((n * v.length) / books.length))]));
  let over = Object.values(quota).reduce((a, b) => a + b, 0) + pick.length - n;
  while (over > 0) { const k = Object.keys(quota).sort((a, b) => quota[b] - quota[a])[0]; quota[k]--; over--; }
  for (const [k, v] of Object.entries(byIss)) {
    const have = pick.filter((p) => String(p.iss) === k).length;
    for (const b of v) { if (pick.filter((p) => String(p.iss) === k).length >= quota[k] + have) break; if (!pick.includes(b)) pick.push(b); }
  }
  pick = pick.slice(0, n);
} else {
  pick = rows.slice(0, Number(N));
}

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
fs.mkdirSync('img', { recursive: true });
const out = [];
for (const [i, r] of pick.entries()) {
  const p = await db.collection('pages').findOne({ id: r.pid }, { projection: { id: 1, archived_photo: 1, photo: 1, 'ocr.engine.input': 1, 'ocr.data': 1 } });
  const url = p.ocr?.engine?.input?.image_url || p.archived_photo || p.photo; // image-pick-ok: the exact image Paddle read (engine input first), so the reviewer judges the read against its own input — the bake-off's img.mjs rule
  // A withheld page no longer carries its Paddle text; the snapshot the withhold took does.
  if (typeof p.ocr?.data !== 'string') {
    const rev = await db.collection('page_revisions').findOne({ page_id: r.pid, field: 'ocr', reason: 'withhold_paddle_table_6388' }, { projection: { data: 1 } });
    p.ocr = { ...p.ocr, data: rev?.data ?? '' };
  }
  const f = path.resolve('img', `${r.pid}.jpg`);
  if (!fs.existsSync(f)) {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || buf.length < 1000) { console.log('FAIL', r.pid, url, res.status); continue; }
    fs.writeFileSync(f, buf);
  }
  out.push({ uid: `${OUT}${String(i + 1).padStart(3, '0')}`, pid: r.pid, bid: r.bid, pn: r.pn, iss: r.iss, title: r.title, reasons: r.reasons, image: f, image_url: url, paddle: p.ocr?.data ?? '' });
}
await c.close();
fs.writeFileSync(`${OUT}sample.json`, JSON.stringify(out, null, 1));
const byIss = {}; for (const o of out) byIss[o.iss] = (byIss[o.iss] || 0) + 1;
console.log(`${OUT}sample.json`, out.length, 'books', new Set(out.map((o) => o.bid)).size, JSON.stringify(byIss));
