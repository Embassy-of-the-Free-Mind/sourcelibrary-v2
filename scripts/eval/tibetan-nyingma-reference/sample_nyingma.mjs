// PRIOR ART: /root/tibetan-eval/redraw-2026-10-01/sample_tib_redraw.mjs (Hetzner; one served page per book,
// Kanjur vs bl-other strata). That draw has no Nyingma stratum and no served verdict, so it cannot answer whether
// MARK_UNRELIABLE pages are worse. This draw: every visible BL Tibetan book whose title names a Nyingma tantra
// collection, and per book ONE random page per served verdict class (SERVE / MARK_UNRELIABLE / none), so each class
// is one-page-per-book. Read-only. Seed 20261002.
//   cd /root/sourcelibrary && node --env-file=.env.production.local /root/nyingma-ref/sample_nyingma.mjs
import { makeLegacyLcg } from '../lib/paired-stats.mjs';
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const OUT = process.env.OUT || '/root/nyingma-ref/draw/';
fs.mkdirSync(OUT, { recursive: true });
const rnd = makeLegacyLcg(20261002); // the draw committed with this script was made with this generator (#5373)
// rNying rgyud / rNying ma rgyud 'bum / Tshamdrak / mTshams brag. NOT "Kanjur rGyud 'bum" (the Kanjur tantra section).
const NYINGMA = /rnying ?(ma'?i? )?rgyud|tsham ?drak|mtshams ?brag|rnying ma rgyud 'bum/i;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ language: 'Tibetan', visible: true, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, display_title: 1, image_source: 1, pages_count: 1 } }).toArray();
const srcOf = (b) => b.image_source?.provider || b.image_source?.type || (typeof b.image_source === 'string' ? b.image_source : null);
const bl = books.filter((b) => /\bbl\b/i.test(srcOf(b) || ''));
const ny = bl.filter((b) => NYINGMA.test(b.display_title || b.title || '')).sort((a, b) => a.id.localeCompare(b.id));
console.error(`tibetan visible ${books.length}; bl ${bl.length}; nyingma-titled ${ny.length}; pages ${ny.reduce((s, b) => s + (b.pages_count || 0), 0)}`);
const pages = db.collection('pages');
const out = fs.createWriteStream(OUT + 'nyingma-sample.jsonl');
const books_out = fs.createWriteStream(OUT + 'nyingma-books.jsonl');
const cls = (p) => p.ocr?.verdict?.verdict || (p.ocr?.unreadable ? 'UNREADABLE_OTHER' : 'NO_VERDICT');
let n = 0;
for (const b of ny) {
  const cand = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true } },
    { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.unreadable': 1, 'ocr.verdict': 1 } }).sort({ page_number: 1 }).toArray();
  const ok = cand.filter((p) => (p.ocr.data || '').length >= 600);
  const byCls = {};
  for (const p of ok) (byCls[cls(p)] ||= []).push(p);
  books_out.write(JSON.stringify({ book_id: b.id, title: b.display_title || b.title, pages_count: b.pages_count, with_text: ok.length,
    classes: Object.fromEntries(Object.entries(byCls).map(([k, v]) => [k, v.length])) }) + '\n');
  for (const k of Object.keys(byCls).sort()) {
    const arr = byCls[k];
    const p = arr[Math.floor(rnd() * arr.length)];
    out.write(JSON.stringify({ id: `${b.id}_${p.page_number}`, book_id: b.id, page_number: p.page_number, stratum: `nyingma:${k}`,
      verdict: k, title: b.display_title || b.title, arm: p.ocr.model || 'unknown', v_rule: p.ocr?.verdict?.rule ?? null,
      v_align: p.ocr?.verdict?.align ?? null, text: p.ocr.data }) + '\n');
    n++;
  }
}
out.end(); books_out.end();
console.error(`sampled ${n} pages from ${ny.length} books`);
await c.close();
