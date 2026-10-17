// PRIOR ART: scripts/eval/results/paired-translate-maya-6559/selection-maya.json (hand-picked runs of 5 pages; this
// draws single leaves at random, stratified by the Codex's twelve Books). Writes NOTHING to the database.
// Ran as scripts/.tmp-select-6865.mjs (imports relative to scripts/); kept as the record of how the 20 pages were drawn.
//   node --env-file=.env.production.local scripts/.tmp-select-6865.mjs --out=DIR
// Book of the twelve: from the running <header> (explicit "Libro N", an ordinal word, or a Book's subject words),
// carried forward to the next page whose header names a Book. Pages with < 300 chars in either column are left out.
import { MongoClient } from 'mongodb'; import fs from 'node:fs';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
const VOLS = ['69dfeba8090ad7d5c33b0f36', '69dfebaa090ad7d5c33b1211', '69dfebab090ad7d5c33b1512'];
const ORD = { primero: 1, segundo: 2, tercero: 3, quarto: 4, quinto: 5, sexto: 6, septimo: 7, setimo: 7, octauo: 8, octavo: 8, nono: 9, decimo: 10, undecimo: 11, vndecimo: 11, duodecimo: 12, 'duo decimo': 12 };
const SUBJ = [[/dioses/, 1], [/cerimon|ceremon|fiesta|templo/, 2], [/adiu?i?nator|adiunator/, 4], [/agueros/, 5], [/rethorica|philosophia moral/, 6], [/astrolog|philosophia natural/, 7], [/señores|senores|adereços/, 8], [/mercaderes|officiales de pluma/, 9], [/vicios|virtudes|enfermedades|mjembros|chichimecas|tultecas|otomies|mexicanos/, 10], [/aues|yeruas|animales|piedras|arbustos|flores/, 11], [/conqu[iy]sta|conqvista/, 12]];
function bookOf(h) {
  const s = h.toLowerCase();
  const n = s.match(/libro[\s.,]*(\d{1,2})/); if (n && +n[1] >= 1 && +n[1] <= 12) return +n[1];
  for (const [w, v] of Object.entries(ORD).sort((a, b) => b[0].length - a[0].length)) if (new RegExp(`libro[\\s.,]*${w}|${w}[\\s.,]*libro`).test(s)) return v;
  for (const [re, v] of SUBJ) if (re.test(s)) return v;
  return null;
}
let seed = 6865; const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const byBook = {};
for (const vol of VOLS) {
  const ps = await db.collection('pages').find({ book_id: vol }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  let cur = vol === VOLS[0] ? 1 : vol === VOLS[1] ? 6 : 10;
  for (const p of ps) {
    const o = p.ocr?.data || ''; const h = (o.match(/<header>([^<]*)<\/header>/) || [])[1] || '';
    const b = bookOf(h); if (b) cur = b;
    if (!o.includes('<column-break/>')) continue;
    const body = o.replace(/<(header|vocab|warning|scan-quality|language|script|page-type|columns|page-num|sig)>[\s\S]*?<\/\1>/g, '');
    const [l, r] = body.split('<column-break/>'); if (!r || l.trim().length < 300 || r.trim().length < 300) continue;
    (byBook[cur] ||= []).push({ book: vol, page: p.id, page_number: p.page_number, codex_book: cur, header: h, left_chars: l.trim().length, right_chars: r.trim().length });
  }
}
const pick = []; const take = (b) => { const pool = byBook[b].filter((x) => !pick.includes(x)); const x = pool[Math.floor(rnd() * pool.length)]; pick.push(x); };
const fixed = byBook[2].find((x) => x.book === VOLS[0] && x.page_number === 251); if (!fixed) throw new Error('Vol. 1 p. 251 not eligible');
pick.push(fixed);
for (let b = 1; b <= 12; b++) if (b !== 2) take(b);
const extra = [...Array(12).keys()].map((i) => i + 1).sort(() => rnd() - 0.5).slice(0, 8);   // 8 Books get a second leaf
for (const b of extra) take(b);
pick.sort((a, b) => VOLS.indexOf(a.book) - VOLS.indexOf(b.book) || a.page_number - b.page_number);
console.log(Object.fromEntries(Object.entries(byBook).map(([k, v]) => [k, v.length])));
for (const x of pick) console.log(x.codex_book, x.book.slice(-4), x.page_number, x.left_chars, x.right_chars, x.header);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(`${OUT}/selection.json`, JSON.stringify(pick, null, 1));
fs.writeFileSync(`${OUT}/page-ids.json`, JSON.stringify(pick.map((x) => x.page)));
await c.close();
