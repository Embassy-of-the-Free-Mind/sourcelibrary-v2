// PRIOR ART: scripts/eval/cbeta-ref-6101.mjs frame() — the same 66 books (its committed book-class.json is the book
// list, because `pages` has no index on ocr.source), the same "visible && pages_count > 0" filter. It does not fit as
// is: the 12 Siku 五燈會元 books were re-read by Paddle on 2026-10-10, so their CBETA text is now only in
// `page_revisions` (source cbeta-xml-p5, field ocr), looked up here by page_id (indexed).
/**
 * #8140 frame A draw. One page per book, Mulberry32(8140): each book's pages (page_number > 0, sorted) are shuffled
 * and the first page whose CBETA text has ≥ 100 Han characters is taken. READ-ONLY on Mongo.
 *   node --env-file=… scripts/eval/zh-punct-8140/draw.mjs --priv=$JOB_SCRATCH/priv
 * Writes the CBETA text (CC BY-NC-SA — never committed) to <priv>/A/<slug>.key.txt and the public draw (ids, counts,
 * hashes, no text) to scripts/eval/zh-punct-8140/draw-A.json.
 */
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { mulberry32, hanCount, breaksOf } from './lib.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const PRIV = path.join(argOf('priv', '/tmp/zh-punct-priv'), 'A');
const cls = JSON.parse(fs.readFileSync(path.join(here, '../results/cbeta-ref-6101/book-class.json'), 'utf8'));
const sha = (t) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
const rng = mulberry32(8140);
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
fs.mkdirSync(PRIV, { recursive: true });
const books = (await db.collection('books').find({ id: { $in: Object.keys(cls) } }, { projection: { id: 1, title: 1, visible: 1, pages_count: 1 } }).toArray())
  .filter((b) => b.visible === true && b.pages_count > 0).sort((a, b) => a.id.localeCompare(b.id));
const rows = [];
for (const b of books) {
  const ps = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { page_number: 1, 'ocr.source': 1, 'ocr.data': 1 }, maxTimeMS: 60000 }).sort({ page_number: 1 }).toArray();
  const order = ps.map((p) => p); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  let pick = null, tried = 0;
  for (const p of order) {
    tried++;
    let text = null, from = null;
    if (p.ocr?.source === 'cbeta-xml-p5') { text = p.ocr.data; from = 'pages.ocr'; }
    else {
      const rv = await db.collection('page_revisions').find({ page_id: String(p._id), field: 'ocr', source: 'cbeta-xml-p5' }).sort({ created_at: -1 }).limit(1).toArray();
      if (rv.length && rv[0].data) { text = rv[0].data; from = 'page_revisions'; }
    }
    if (!text || hanCount(text) < 100) continue;
    pick = { p, text, from }; break;
  }
  if (!pick) { rows.push({ book_id: b.id, title: b.title, script_class: cls[b.id].script_class, pick: null, tried }); continue; }
  const slug = `${b.id.slice(-6)}-p${pick.p.page_number}`;
  fs.writeFileSync(path.join(PRIV, `${slug}.key.txt`), pick.text);
  const br = breaksOf(pick.text);
  rows.push({ slug, book_id: b.id, page_id: String(pick.p._id), page_number: pick.p.page_number, title: b.title, script_class: cls[b.id].script_class,
    siku_wudeng: cls[b.id].script_class === 'manuscript-regular', key_from: pick.from, han: hanCount(pick.text), chars: br.n,
    key_breaks: br.any.size, key_final: br.final.size, key_sha256: sha(pick.text), tried });
  process.stdout.write('.');
}
await c.close();
fs.writeFileSync(path.join(here, 'draw-A.json'), JSON.stringify({ issue: 8140, seed: 8140, rule: 'one page per book; seeded shuffle of the book\'s pages (page_number>0); first page with CBETA text of >= 100 Han chars', drawn_at: new Date().toISOString(), licence_note: 'CBETA CC BY-NC-SA 4.0: no text here, ids and hashes only', pages: rows }, null, 1));
console.log('\npicked', rows.filter((r) => r.slug).length, 'of', rows.length);
