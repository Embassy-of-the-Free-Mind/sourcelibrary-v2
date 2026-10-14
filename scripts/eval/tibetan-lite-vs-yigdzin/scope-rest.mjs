// yigdzin-rest-4523 step 1 (#4523): the PAGE-level todo for the Tibetan pages earlier Yigdzin runs never read.
// PRIOR ART: scope.mjs + build-todo.mjs (yig527) select BOOKS held under the #4523 holds with 0 Yigdzin pages, then take
// every page of them. That is what missed these pages: they sit in books that already have some Yigdzin pages, or in
// books under other holds. This script selects pages directly, over every live Tibetan book, and reuses build-todo's
// skips (blank / archived-spread / no or unscoped image), lane-lib's scope matcher and page script gate, and the
// exclude list.
//
// Scope, live Tibetan books (language 'Tibetan', visible, pages_count > 0):
//   a  ocr.unreadable (withheld) and ocr.model in the Gemini Flash family (isGeminiFlashModel)
//   b  no OCR: no ocr.model and no ocr.data (or no model and withheld). NOT pages that carry the Esukhia Derge
//      Kangyur/Tengyur e-text (`ocr.source: esukhia-derge-*`, no model): those are typed reference text, never OCR'd over.
// Only books held under a #4523 / #5660 OCR hold are in: a page written into an UNHELD book is a new untranslated page,
// and gap-fill translates it (Gemini spend, and a translation change, neither approved here); a book held by another
// lane (Tengyur import, a QA job, the title-leaf detector) belongs to that lane. Both are counted, never read.
// A page another Yigdzin run already judged REJECT is not re-read (temperature 0: the same read, the same verdict).
// Script gate: (a) per page on its Gemini read (scriptGate); (b) per book: the book's non-Yigdzin text must be ≥ 80 %
// Tibetan script (the #5660 rule), or the book passed an earlier lane's gate (yig527 / #5660 todo), or it is listed in
// $YIG_DIR/eye-books.json as checked by eye ({"<book>": "tibetan" | "<why not>"}). Anything else is held back as
// `needs-eye` and listed, never read.
//
//   YIG_DIR=<state dir> node --env-file=.env.production.local scope-rest.mjs [--prior <decisions.jsonl> ...]
// Out: $YIG_DIR/{todo-all.jsonl, todo-skipped.jsonl, book-gate.jsonl, scope-summary.json}
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { isGeminiFlashModel, scriptGate } from './lane-lib.mjs';

const DIR = process.env.YIG_DIR;
if (!DIR) { console.error('YIG_DIR required'); process.exit(1); }
const SKIP_TYPES = new Set(['blank', 'archived-spread']);
const LANE_HOLDS = new Set(['tibetan-retranslation-awaits-derek', 'specialist-ocr-lane-4523', 'tibetan-unverified-gemini-ocr-4523', 'gpu-backlog-5660']);
const EXCL = JSON.parse(fs.readFileSync(new URL('./exclude-books.json', import.meta.url), 'utf8')).books;
const argv = process.argv.slice(2);
const priorFiles = argv.flatMap((a, i) => (argv[i - 1] === '--prior' ? [a] : []));
const passedFiles = argv.flatMap((a, i) => (argv[i - 1] === '--passed-books' ? [a] : []));
const EYE = fs.existsSync(`${DIR}/eye-books.json`) ? JSON.parse(fs.readFileSync(`${DIR}/eye-books.json`, 'utf8')) : {};

// stems an earlier Yigdzin run judged REJECT
const rejected = new Set();
for (const f of priorFiles) for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
  if (!l.startsWith('{')) continue;
  const r = JSON.parse(l);
  if ((r.class || r.verdict) === 'reject' && r.stem) rejected.add(r.stem);
}
// books an earlier lane's script gate let in (one jsonl per file, a `book` field per row)
const passed = new Set();
for (const f of passedFiles) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l.startsWith('{')) passed.add(JSON.parse(l).book);

const LAT = /[A-Za-zÀ-ɏḀ-ỿ]/gu, CJK = /[㐀-鿿豈-﫿]/gu, TIB = /[ༀ-࿿]/gu;
const m = new MongoClient(process.env.MONGODB_URI); await m.connect();
const db = m.db('bookstore');
const books = await db.collection('books').find({ language: 'Tibetan', visible: true, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, provider: 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
const out = fs.createWriteStream(`${DIR}/todo-all.jsonl`), skip = fs.createWriteStream(`${DIR}/todo-skipped.jsonl`);
const bg = fs.createWriteStream(`${DIR}/book-gate.jsonl`);
const c = { a: {}, b: {} }; const inc = (s, k) => { c[s][k] = (c[s][k] || 0) + 1; };
for (const b of books) {
  const bid = b.id || String(b._id);
  const pages = await db.collection('pages').find({ book_id: bid }, {
    projection: { id: 1, page_number: 1, page_type: 1, archived_photo: 1, 'ocr.model': 1, 'ocr.unreadable': 1, 'ocr.source': 1,
      has: { $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] } },
  }).sort({ page_number: 1 }).toArray();
  const want = [];
  for (const p of pages) {
    const mo = p.ocr?.model ?? null, unr = p.ocr?.unreadable === true;
    const scope = unr && isGeminiFlashModel(mo) ? 'a' : !mo && (!p.has || unr) && !String(p.ocr?.source || '').startsWith('esukhia-') ? 'b' : null;
    if (scope) want.push({ p, scope });
  }
  if (!want.length) continue;
  // book-level script evidence from text that is not Yigdzin's (Yigdzin writes Tibetan on any image)
  let bookGate = null;
  if (want.some((w) => w.scope === 'b')) {
    const esukhia = pages.some((p) => String(p.ocr?.source || '').startsWith('esukhia-'));
    let lat = 0, cjk = 0, tib = 0;
    if (!esukhia) {
      const ps = await db.collection('pages').find({ book_id: bid, 'ocr.model': { $nin: ['bdrc-yigdzin-v1', null] }, 'ocr.data': { $nin: ['', null] } },
        { projection: { 'ocr.data': 1 } }).limit(40).toArray();
      for (const q of ps) {
        if (scriptGate(q.ocr.data)) { lat += 1000; continue; }  // a gated page counts as non-Tibetan, whatever its length
        const s = q.ocr.data.replace(/<[^>]*>/g, ' ');
        lat += (s.match(LAT) || []).length; cjk += (s.match(CJK) || []).length; tib += (s.match(TIB) || []).length;
      }
    }
    const n = lat + cjk + tib, share = n ? +(tib / n).toFixed(3) : null;
    const eye = EYE[bid];
    bookGate = EXCL[bid] ? 'excluded-book' : eye ? (eye === 'tibetan' ? null : `eye:${eye}`) : esukhia ? null
      : share != null && n >= 200 && share >= 0.8 ? null : passed.has(bid) ? null : share != null && n >= 200 ? `script-share:${share}` : 'needs-eye';
    bg.write(JSON.stringify({ book: bid, title: b.title, provider: b.provider, b_pages: want.filter((w) => w.scope === 'b').length, esukhia, share, n, eye: eye ?? null, passed: passed.has(bid), gate: bookGate }) + '\n');
  }
  const needText = want.filter((w) => w.scope === 'a').map((w) => w.p.id);
  const text = new Map();
  for (let i = 0; i < needText.length; i += 500) {
    for (const q of await db.collection('pages').find({ id: { $in: needText.slice(i, i + 500) } }, { projection: { id: 1, 'ocr.data': 1 } }).toArray()) text.set(q.id, q.ocr?.data || '');
  }
  for (const { p, scope } of want) {
    const stem = `${bid}_${String(p.page_number).padStart(5, '0')}`;
    const base = { id: p.id, book: bid, page: p.page_number, scope };
    const hold = b.pipeline_auto?.hold?.reason;
    // a page number <= 0 is a page parked out of the reading order (one book renumbered negatively); stems need > 0
    const why = EXCL[bid] ? 'excluded-book' : !(p.page_number > 0) ? 'page-number-not-positive' : !hold ? 'book-not-held' : !LANE_HOLDS.has(hold) ? `book-held-other:${hold}` : SKIP_TYPES.has(p.page_type) ? `type:${p.page_type}` : !p.archived_photo ? 'no-archived_photo'
      : !p.archived_photo.includes(`/${bid}/`) ? 'key-not-book-scoped' : rejected.has(stem) ? 'prior-yigdzin-reject'
        : scope === 'b' && bookGate ? `book-gate:${bookGate}` : null;
    if (why) { skip.write(JSON.stringify({ ...base, why }) + '\n'); inc(scope, why.replace(/:[\d.]+$/, '')); continue; }
    const gate = scope === 'a' ? scriptGate(text.get(p.id)) : null;
    out.write(JSON.stringify({ ...base, stem, url: p.archived_photo, type: p.page_type ?? null, prior: p.ocr?.model ?? 'none', gate }) + '\n');
    inc(scope, gate ? `todo-gated:${gate}` : 'todo');
  }
}
out.end(); skip.end(); bg.end();
fs.writeFileSync(`${DIR}/scope-summary.json`, JSON.stringify({ at: new Date().toISOString(), books: books.length, rejected_prior: rejected.size, passed_books: passed.size, eye_books: Object.keys(EYE).length, ...c }, null, 1));
console.log(JSON.stringify(c));
await m.close();
