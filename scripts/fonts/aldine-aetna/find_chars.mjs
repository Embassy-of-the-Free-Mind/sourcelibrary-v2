// Search OCR of the fount-bearing books for rare capitals and digits; emit page list.
import { MongoClient } from '/Users/dereklomas/sourcelibrary/node_modules/mongodb/lib/index.js';
import fs from 'fs';
const BOOKS = {
  '6a06d1f39a48d51399960d08': 'ita-bnc-ald-00000673-001', // De Aetna
  '69b220c6f79d8af0eab7fcef': 'ita-bnc-ald-00000039-001', // De Aetna (2nd copy)
  '69b220de56715b0e3247381a': 'ita-bnc-ald-00000690-001', // Leoniceno
  '69b220da56715b0e32473793': 'ita-bnc-ald-00000691-001', // Maiolo Epiphyllides
  '69b220cff79d8af0eab7fe91': 'ita-bnc-ald-00000692-001', // Maiolo De gradibus
  '69b220ccf79d8af0eab7fd3a': 'ita-bnc-ald-00000688-001', // Lascaris
  '6a08574849638a50931c42e9': 'ita-bnc-ald-00000689-001', // Lascaris 2nd copy
};
const c = await new MongoClient(process.env.MONGODB_URI).connect();
const pages = c.db('bookstore').collection('pages');
const hits = { K: [], X: [], Y: [], Z: [], J: [], U: [], W: [], digit: [] };
for (const [bid, ia] of Object.entries(BOOKS)) {
  const cur = pages.find({ book_id: bid }, { projection: { page_number: 1, 'ocr.data': 1 } });
  for await (const p of cur) {
    const t = (p.ocr && p.ocr.data) || '';
    if (!t) continue;
    const body = t.replace(/<[^>]+>/g, ' ');
    for (const L of ['K', 'X', 'Y', 'Z', 'J', 'U', 'W']) {
      const re = new RegExp(`(^|[\\s(.,;:])${L}[a-zA-Z]`, 'g');
      let m; while ((m = re.exec(body))) hits[L].push({ ia, page: p.page_number, snip: body.slice(Math.max(0, m.index - 20), m.index + 25).replace(/\n/g, ' ') });
    }
    const d = /(^|\s)[0-9]{1,4}(\s|$|[.,;:])/g; let m;
    while ((m = d.exec(body))) hits.digit.push({ ia, page: p.page_number, snip: body.slice(Math.max(0, m.index - 20), m.index + 25).replace(/\n/g, ' ') });
  }
}
await c.close();
for (const [k, v] of Object.entries(hits)) {
  console.log(`\n== ${k}: ${v.length} hits`);
  for (const h of v.slice(0, 8)) console.log(`  ${h.ia.slice(12, 20)} p${h.page}  …${h.snip}…`);
}
fs.writeFileSync('/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/e9206fa7-e6dd-4621-9312-2ab6aa55dc1a/scratchpad/aetna/char_hits.json', JSON.stringify(hits));
