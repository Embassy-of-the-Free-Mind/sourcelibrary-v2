// PRIOR ART: scripts/eval/results/florentine-compare-6865/select.mjs (the same column split); no length screen per column existed for two-column leaves. Ran as scripts/.tmp-ratio-6865.mjs.
// length-ratios.json: English chars / OCR chars per column (tags and notes stripped). A screen, not a score.
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const [R, S] = process.argv.slice(2); const sel = JSON.parse(fs.readFileSync(`${R}/selection.json`, 'utf8'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const strip = (t) => t.replace(/->|<-/g, ' ').replace(/<(summary|keywords|header|meta|warning|vocab|scan-quality|language|script|page-type|columns|page-num|sig)>[\s\S]*?<\/\1>/g, '').replace(/<note>[\s\S]*?<\/note>/g, '').replace(/<[a-z\/][^>]*>/g, (m) => m === '<column-break/>' ? m : '');
const rows = [];
for (const x of sel) {
  const p = await db.collection('pages').findOne({ id: x.page }, { projection: { ocr: 1, translation: 1 } });
  const oc = strip(p.ocr.data).split('<column-break/>').map((s) => s.trim().length);
  const r = { page: `${x.book.slice(-4)}:${x.page_number}`, codex_book: x.codex_book, ocr_columns: oc.length };
  for (const [a, t] of [['opus', fs.readFileSync(`${S}/reads/opus/${x.page}.txt`, 'utf8')], ['argon', fs.readFileSync(`${S}/reads/argon/${x.page}.txt`, 'utf8')], ['flash', fs.readFileSync(`${S}/reads/flash/${x.page}.txt`, 'utf8')], ['lite', p.translation?.data || '']]) {
    const parts = strip(t).split('<column-break/>');
    r[a] = parts.length === oc.length ? parts.map((s, i) => (s.trim().length / oc[i]).toFixed(2)).join('/') : `${parts.length} cols`;
  }
  rows.push(r);
}
console.table(rows); fs.writeFileSync(`${R}/length-ratios.json`, JSON.stringify(rows, null, 1)); await c.close();
