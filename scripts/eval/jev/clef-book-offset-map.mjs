// Full-book text↔image offset map with Clef: for every page N, does image N transcribe as text N, N−1 or N+1?
// PRIOR ART: scripts/eval/jev/clef-shift-check.mjs — the same neighbour test, but only on the ONE flagged page per book
//   (and `sips`, macOS-only). A repair needs the whole book: where a shift starts and ends, and whether it is a constant
//   ±1 run (shiftable) or scrambled (not). scripts/audit/bulk-archive-alignment.mjs compares image to image (dHash) and
//   cannot see a text shift on books whose images are already correct.
// offset d at page N means image N matches text N+d. d=+1: the right text sits one page later (move text LEFT, the
//   scripts/lib/text-shift.mjs direction). d=−1: it sits one page earlier (move text RIGHT).
// Adaptive by default: neighbours are only scored when the page's own text scores < OWN_OK (0.7); FULL=1 scores all three.
// Run: node --env-file=<.env.production.local> scripts/eval/jev/clef-book-offset-map.mjs --book <id> [--from N --to M]
//        [--pages 3,9,14] [--img reader|source] [--out DIR] [--cap 1.0] [--tag before]       (needs MONGODB_URI, CF_ANALYTICS_TOKEN)
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const BOOK = flag('book');
const FROM = Number(flag('from', -Infinity)), TO = Number(flag('to', Infinity));
const IMG = flag('img', 'reader'); // reader = what the reader shows; source = pages.photo (the source leaf)
const OUT = flag('out', 'scripts/output/clef-offset-map');
const CAP = Number(flag('cap', '1.0'));
const TAG = flag('tag', '');
// --pages 30,43,83: score only these pages (e.g. re-score with FULL=1 the pages an adaptive pass left at offset 0)
const ONLY = flag('pages') ? new Set(flag('pages').split(',').map(Number)) : null;
const FULL = process.env.FULL === '1';
const OWN_OK = 0.7, MATCH = 0.7;
const CONC = 4;
if (!BOOK) { console.error('--book required'); process.exit(1); }

const Q = { same_page: { type: 'noul', instructions: 'The text in the state is a transcription of the page shown in the image (the same page, not a neighbouring page or a different book).' } };
const ocrText = (p) => String((typeof p?.ocr === 'object' ? p.ocr?.data : p?.ocr) || '')
  .replace(/<page-num>[^<]*<\/page-num>/g, '').trim(); // a printed folio number is a giveaway shared by neighbours; score the body
const readerUrl = (p) => p?.cropped_photo || p?.display_photo || p?.archived_photo || p?.photo;
const imgUrl = (p) => (IMG === 'source' ? p?.photo : readerUrl(p));

let spent = 0, calls = 0;
const imgCache = new Map();
async function image(p) {
  const url = imgUrl(p);
  if (!url) return null;
  if (!imgCache.has(url)) imgCache.set(url, (async () => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!r.ok) throw new Error('http ' + r.status);
        const jpg = await sharp(Buffer.from(await r.arrayBuffer())).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        return 'data:image/jpeg;base64,' + jpg.toString('base64');
      } catch (e) { if (i === 2) { console.error('image fail', p.page_number, e.message); return null; } await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
    }
  })());
  return imgCache.get(url);
}
async function ask(img, text) {
  if (!img || text.length < 60) return null;
  if (spent >= CAP) throw new Error(`cap $${CAP} reached`);
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts/eb0562555fd5ce2a4ec0f29b6df10e7b/ai/run/@cf/cloudflare/clef', {
      method: 'POST', headers: { Authorization: 'Bearer ' + process.env.CF_ANALYTICS_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'clef', images: [img], state: text.slice(0, 4000), questions: Q }),
    });
    if (r.status === 401 || r.status === 403) throw new Error('auth ' + r.status);
    if (!r.ok) { await new Promise((s) => setTimeout(s, 2000 * (i + 1))); continue; }
    const j = (await r.json()).result; if (!j) continue;
    spent += (j.usage.input_tokens * 0.24) / 1e6; calls++;
    return +j.answers.same_page.noul.toFixed(3);
  }
  return null;
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const book = await db.collection('books').findOne({ id: BOOK }, { projection: { title: 1 } });
const pages = await db.collection('pages').find({ book_id: BOOK, page_number: { $gte: 1 } }, {
  projection: { page_number: 1, ocr: 1, photo: 1, cropped_photo: 1, display_photo: 1, archived_photo: 1 },
}).sort({ page_number: 1 }).toArray();
await c.close();
const byNum = new Map(pages.map((p) => [p.page_number, p]));
const todo = pages.filter((p) => p.page_number >= FROM && p.page_number <= TO && (!ONLY || ONLY.has(p.page_number)));
console.log(`${book?.title?.slice(0, 70)} | ${todo.length} pages | img=${IMG} ${FULL ? 'full' : 'adaptive'}`);

const rows = new Array(todo.length);
let idx = 0;
async function worker() {
  while (idx < todo.length) {
    const k = idx++, p = todo[k], n = p.page_number;
    const img = await image(p);
    const row = { page: n, own: null, prev: null, next: null, offset: null };
    if (!img) { row.offset = 'no-image'; rows[k] = row; continue; }
    if (ocrText(p).length < 60) row.own_text = 'short';
    row.own = await ask(img, ocrText(p));
    if (FULL || row.own == null || row.own < OWN_OK) {
      row.prev = await ask(img, ocrText(byNum.get(n - 1)));
      row.next = await ask(img, ocrText(byNum.get(n + 1)));
    }
    const cand = [[0, row.own], [-1, row.prev], [1, row.next]].filter(([, s]) => s != null).sort((a, b) => b[1] - a[1]);
    row.offset = cand.length && cand[0][1] >= MATCH ? cand[0][0] : '?';
    rows[k] = row;
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

// Runs of equal offset, for reading the map at a glance.
const runs = [];
for (const r of rows) {
  const last = runs[runs.length - 1];
  if (last && last.offset === r.offset && r.page === last.to + 1) last.to = r.page; else runs.push({ offset: r.offset, from: r.page, to: r.page });
}
const tally = {};
for (const r of rows) tally[r.offset] = (tally[r.offset] || 0) + 1;
const scored = rows.filter((r) => r.offset !== 'no-image' && r.own_text !== 'short');
const matchPct = scored.length ? +(100 * scored.filter((r) => r.offset === 0).length / scored.length).toFixed(1) : null;
const summary = { book_id: BOOK, title: book?.title?.slice(0, 120), img: IMG, pages: rows.length, tally, match_pct: matchPct, calls, cost_usd: +spent.toFixed(4),
  runs: runs.map((r) => `${r.from}${r.to !== r.from ? '-' + r.to : ''}:${r.offset}`) };
fs.mkdirSync(OUT, { recursive: true });
const base = path.join(OUT, `${BOOK}${TAG ? '-' + TAG : ''}`);
fs.writeFileSync(base + '.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(base + '.summary.json', JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
