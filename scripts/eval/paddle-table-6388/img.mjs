// PRIOR ART: see README.md in this directory (#6388 table detector + bake-off; scratch-run stage, run from $JOB_SCRATCH/w).
import fs from 'fs'; import { MongoClient } from 'mongodb';
const B = JSON.parse(fs.readFileSync('bake.json'));
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
for (const b of B) {
  const p = await db.collection('pages').findOne({ book_id: b.bid, page_number: b.pn }, { projection: { id: 1, archived_photo: 1, photo: 1, 'ocr.engine.input': 1, 'ocr.source': 1 } });
  const url = p.ocr?.engine?.input?.image_url || p.archived_photo || p.photo; // image-pick-ok: the bake-off must show readers the exact image Paddle read (engine.input), not a re-derived crop
  b.pid = p.id; b.image_url = url; b.served_source = p.ocr?.source ?? null;
  const f = `img/${b.uid}.jpg`;
  if (!fs.existsSync(f)) { const r = await fetch(url); const buf = Buffer.from(await r.arrayBuffer()); if (!r.ok || buf.length < 1000) { console.log('FAIL', b.uid, url, r.status); continue; } fs.writeFileSync(f, buf); }
  console.log(b.uid, url, fs.statSync(f).size, b.served_source);
}
fs.writeFileSync('bake.json', JSON.stringify(B, null, 1));
await c.close();
