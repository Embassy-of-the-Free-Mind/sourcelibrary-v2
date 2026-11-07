// PRIOR ART: the one-off img.mjs of the #7065 job (session scratch, not in the repo) — same lookup, kept here so the
// by-eye reads of #7117 can be repeated. Read-only: prints the page image URL of each <book_id>:<page> and, with
// --get <dir>, downloads it (scaled by the Source Library image route when it serves one).
// Usage: node --env-file=… page-image.mjs [--get <dir>] <book_id>:<page> …
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const args = process.argv.slice(2);
const gi = args.indexOf('--get'); const dir = gi >= 0 ? args.splice(gi, 2)[1] : null;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
for (const a of args) {
  const [id, p] = a.split(':');
  const r = await pages.findOne({ book_id: id, page_number: +p }, { projection: { 'ocr.data': 0, 'translation.data': 0 } });
  const urls = (JSON.stringify(r || {}).match(/https?:[^"]+?\.(?:jpe?g|png|webp)[^"]*/gi) || []).filter((u) => !/thumb/i.test(u));
  const u = r?.cropped_photo || r?.photo || urls[0];
  console.log(a, u || '(no image url)');
  if (dir && u) { const res = await fetch(u); if (res.ok) fs.writeFileSync(`${dir}/${id}_${p}.jpg`, Buffer.from(await res.arrayBuffer())); else console.log('  fetch', res.status); }
}
await c.close();
