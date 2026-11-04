// #8182 step 2: the seeded page draw. One page per book. Writes draw.json (ids, page numbers, served engine, counts;
// no page text) and, outside the repo, <priv>/served.jsonl (the served OCR of each drawn page: the overlap probe and
// the segmentation sanity check; never committed).
//
// PRIOR ART: scripts/eval/zh-planted-8171/draw.mjs (#8171: its B and C groups ARE our Chinese groups, reused by id
// from its committed sample.json, not redrawn); scripts/eval/lib/paired-stats.mjs makeRng (the seeded rng). Neither
// draws Tibetan pages; #5660's prereg drew Derge Kangyur volumes by title, the same title prefix is used here.
//
// Run: node --env-file=<main>/.env.production.local scripts/eval/ocr-context-8182/draw.mjs <priv-dir>
import fs from 'fs'; import path from 'path'; import { execSync } from 'child_process';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const SEED = 8182; const PRIV = process.argv[2]; if (!PRIV) throw new Error('usage: draw.mjs <priv-dir>');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const seedOf = (s) => { let h = SEED; for (const c of s) h = (Math.imul(h ^ c.codePointAt(0), 2654435761) >>> 0); return h; };
const shuffle = (xs, key) => { const r = makeRng(seedOf(key)); return xs.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x); };
const tibShare = (t) => { const c = [...String(t || '')].filter((ch) => !/\s/.test(ch)); return c.length ? c.filter((ch) => ch >= 'ༀ' && ch <= '࿿').length / c.length : 0; };

const KANGYUR = /^བཀའ་འགྱུར། སྡེ་དགེ/; const TENGYUR = /^བསྟན་འགྱུར། སྡེ་དགེ/;
// T-O excludes every canon-shaped collection by title before any text is read (they are BoCorpus-shaped by name).
const CANON = /kanjur|kangyur|bka'? ?'gyur|tanjur|tengyur|bstan ?'gyur|rgyud ?'bum|བཀའ་འགྱུར|བསྟན་འགྱུར/i;
const WANT = { TK: 45, TT: 45, TO: 90 };   // over-drawn; replacements are taken in draw order (PREREGISTRATION.md)

const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const books = await db.collection('books').find(
  { $or: [{ language: /tibet/i }, { original_language: /tibet/i }, { language: 'bo' }], 'book_class.class': { $ne: 'handwritten' }, pages_count: { $gt: 20 } },
  { projection: { title: 1, pages_count: 1, visible: 1, id: 1, 'book_class.class': 1 } }).toArray();
const frame = { TK: [], TT: [], TO: [] };
for (const b of books) {
  const t = b.title || ''; const id = b.id || String(b._id);
  if (KANGYUR.test(t)) frame.TK.push({ id, b }); else if (TENGYUR.test(t)) frame.TT.push({ id, b });
  else if (!CANON.test(t) && b.book_class?.class === 'printed') frame.TO.push({ id, b });
}
const served = fs.createWriteStream(path.join(PRIV, 'served.jsonl'));
const out = { issue: 8182, seed: SEED, made_at: new Date().toISOString(), frames: {}, pages: [] };
for (const g of ['TK', 'TT', 'TO']) {
  out.frames[g] = frame[g].length; let got = 0, rank = 0;
  for (const { id, b } of shuffle(frame[g], g)) {
    if (got >= WANT[g]) break;
    const r = makeRng(seedOf(`${g}:${id}`)); const n = b.pages_count; const lo = Math.max(3, Math.floor(n * 0.1)), hi = Math.floor(n * 0.9);
    let pick = null;
    for (let k = 0; k < 8 && !pick; k++) {
      const pn = lo + Math.floor(r() * Math.max(1, hi - lo));
      const p = await db.collection('pages').findOne({ book_id: id, page_number: pn }, { projection: { 'ocr.data': 1, 'ocr.model': 1, archived_photo: 1, image_width: 1, image_height: 1 } });
      const t = p?.ocr?.data || '';
      if (p?.archived_photo && t.length >= 300 && tibShare(t) >= 0.8) pick = { p, pn, t, tries: k + 1 };
    }
    rank++;
    if (!pick) { out.pages.push({ group: g, rank, book_id: id, used: false, why: 'no page with >=300 chars of >=80% Tibetan served text and an archived image in 8 tries' }); continue; }
    got++;
    out.pages.push({ group: g, rank, book_id: id, title: (b.title || '').slice(0, 60), page_number: pick.pn, tries: pick.tries, served_model: pick.p.ocr?.model ?? null,
      chars: pick.t.length, w: pick.p.image_width ?? null, h: pick.p.image_height ?? null, image: pick.p.archived_photo, used: true });
    served.write(JSON.stringify({ group: g, book_id: id, page_number: pick.pn, text: pick.t }) + '\n');
  }
}
// The Chinese groups: #8171's B (reference-covered: CBETA + Kanripo-screened Siku) and C (obscure, non-Siku), by id.
const s8171 = JSON.parse(execSync('git show origin/main:scripts/eval/zh-planted-8171/sample.json', { cwd: HERE, maxBuffer: 1 << 26 }).toString());
for (const p of s8171.passages.filter((x) => x.group === 'B' || x.group === 'C')) {
  const pg = await db.collection('pages').findOne({ book_id: p.book_id, page_number: p.page_number }, { projection: { 'ocr.model': 1, archived_photo: 1, image_width: 1, image_height: 1 } });
  out.pages.push({ group: p.group === 'B' ? 'ZB' : 'ZC', sub: p.sub, book_id: p.book_id, title: p.work, page_number: p.page_number, slug8171: p.slug,
    served_model: pg?.ocr?.model ?? null, w: pg?.image_width ?? null, h: pg?.image_height ?? null, image: pg?.archived_photo ?? null, used: !!pg?.archived_photo });
}
served.end(); await c.close();
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(out, null, 1) + '\n');
const tally = {}; for (const p of out.pages) { const k = `${p.group}:${p.used ? 'used' : 'skip'}`; tally[k] = (tally[k] || 0) + 1; }
console.log(out.frames, tally);
