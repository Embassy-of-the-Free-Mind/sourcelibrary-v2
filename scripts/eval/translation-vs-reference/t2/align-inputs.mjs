// PRIOR ART: fetch-served.mjs reads the served arm for FINAL records; this writes the aligners' worklists (OCR only,
// never the served English, so the person cutting the reference is blind to our translation) for #5695 T2.
/** Write per-group alignment worklists (candidate pages' OCR, no served English) for the T2 reference-cutting subagents. Read-only. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const [,, drawnFile, outDir] = process.argv;
const groups = {
  A: ['9a1123', 'e41cba', '4b33c9', '4b93b8', 'c43acd', '4b168d', 'a627f0', '2d08a6', '173a5d', 'bc3fb2'],
  B: ['458842', '909ff2', '4b628d', '4b68eb', '4b6bc4', 'd76202', '432997', '8c69fd', 'd772e7', 'cb8593'],
  C: ['5ea3a8', 'e93ae4', '151d0e', '96f838', '917f1b', 'bc7d4c', 'bc8c0b', '81286a', '7b0b2c', 'c91ab8'],
  D: ['6cfc2c', '430c9c', '6d0231', '42d7c7', '947f46', '6e12de', '4b98ab', '916e4c', 'd3d160', '2779bb'],
  E: ['1d29be', '6e13d3', '4307b0', '96231b', '94711f', 'cb7381', 'f5470c', 'abc97f', '6d4a6c', 'c52565', 'c52a29'],
  F: ['6d0737', '6cee47', '19a3b5', '42f9be', '42fd32', '44b377', 'ddb092', '962d53', '9179f7'],
  G: ['961a97', '1b4e3d', '2cf673', '4f2d40', '6d0f99', 'e86f6b', '376a04', 'db06a3', '737f80', 'a33f12', 'abd74f'],
  H: ['bd6715', '59b7d8', '17330c', '5f8f3a', '1eee46', '90ae35', '45a8df', 'e27928'],
};
const drawn = JSON.parse(fs.readFileSync(drawnFile, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
for (const [g, list] of Object.entries(groups)) {
  const items = [];
  for (const s of list) {
    const b = drawn.find((x) => x.suffix === s);
    const cps = [];
    for (const p of b.pages.slice(0, 4)) {
      const doc = await pages.findOne({ book_id: b.book_id, page_number: p.page_number }, { projection: { 'ocr.data': 1 } });
      cps.push({ page_number: p.page_number, script: p.script, greek_share: p.greek_share, image: p.image, page_url: `https://sourcelibrary.org/book/${b.book_id}?page=${p.page_number}`, ocr: doc.ocr.data });
    }
    items.push({ book_id: b.book_id, title: b.title, author: b.author, published: b.published, work: b.work, reference_hint: b.reference_hint, style_hint: b.style, canonical: b.canonical, genre: b.genre, bucket: b.bucket, candidate_pages: cps });
  }
  fs.writeFileSync(`${outDir}/align-${g}.json`, JSON.stringify(items, null, 1));
  console.log(g, items.length, items.reduce((a, x) => a + x.candidate_pages.length, 0));
}
await c.close();
