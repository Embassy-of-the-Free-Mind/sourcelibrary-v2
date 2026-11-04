#!/usr/bin/env node
// PRIOR ART: scripts/eval/seam-prompt-6742/ab.mjs `build` (context per page from Mongo, isTranslatablePage /
// sameLanguageReason drops) — reused for the window checks; the xlref track files under scripts/eval/results/xlref-t*-2026-10/
// supply the candidate books and their one reference page each. No existing draw picks a WINDOW of consecutive pages
// around a reference page, which this job needs (12 pages per book, the brief given to every one).
/**
 * book-brief-7499 · select: the seeded, stratified draw of 10 books and their 12-page windows. Read-only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/book-brief-7499/select.mjs --out=DIR [--seed=7499]
 *
 * Candidates: every book with a reference page in the xlref tracks (T1 Latin, T2 Greek, T3 German/vernacular,
 * T4 Hebrew/Arabic, T5 Sanskrit/Chinese). Eligible when: visible && pages_count > 0; a run of >= 15 consecutive pages,
 * containing the reference page, each with OCR, a stored translation and translatable (isTranslatablePage, not
 * same-language); for T5, the book prints a commentary (title/OCR markers, recorded). The window is 12 consecutive
 * pages of that run containing the reference page, at a seeded offset, with at least one run page before it (the
 * production seed: the stored English of the page before).
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { isTranslatablePage, sameLanguageReason } from '../../lib/translate-core.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { shuffle } from '../seams-6742/lib.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = arg('out'); const SEED = Number(arg('seed', 7499));
const R = path.join(path.dirname(new URL(import.meta.url).pathname), '../results');
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

export const STRATA = [
  { key: 'latin', n: 3, track: 'T1', file: 'xlref-t1-2026-10/records.jsonl', langs: /^Latin$/ },
  { key: 'vernacular', n: 2, track: 'T3', file: 'xlref-t3-2026-10/records.jsonl', langs: /German|Italian|Spanish|French|Dutch/ },
  { key: 'greek', n: 2, track: 'T2', file: 'xlref-t2-2026-10/pages.jsonl', langs: /Greek/ },
  { key: 'semitic', n: 1, track: 'T4', file: 'xlref-t4-2026-10/references.jsonl', langs: /^(Hebrew|Arabic)$/ },
  { key: 'commentary', n: 2, track: 'T5', file: 'xlref-t5-2026-10/work/records-arms.jsonl', langs: /Sanskrit|Chinese/ },
];
// A printed commentary: words that name one in the title, or commentary markers in the OCR of the window.
const COMMENTARY_TITLE = /comment|bh[aā]ṣya|bhashya|ṭīk[aā]|tika|vy[aā]khy[aā]|vṛtti|vritti|注|註|疏|解|箋|義記|述記|集説|集说|正義|章句|टीका|भाष्य|व्याख्या|वृत्ति/i;
// वृत्ति is NOT a marker: it occurs inside ordinary words (सप्ताहवृत्ता…) and picked the Arthaśāstra, whose notes are variant readings.
// व्याख्यातः ("explained") is the Arthaśāstra's own verb, not a commentary heading: Devanagari markers are टीका alone.
const COMMENTARY_OCR = /टीका|<commentary|注[曰云]|疏[曰云]|箋[曰云]|〔注〕|【注】|\(注\)|集解|正義曰|傳曰/;

const refOf = (r) => r.reference_text ?? r.reference?.text ?? null;
const refMeta = (r) => r.reference_meta ?? (r.reference ? { title: r.reference.title, translator: r.reference.translator, year: r.reference.year, licence: r.reference.licence, private: r.reference.publishable === false, style: r.reference.style, canonical: r.reference.canonical, located: r.reference.located } : null);

async function main() {
  if (!OUT) throw new Error('--out=DIR');
  fs.mkdirSync(OUT, { recursive: true });
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 };
  const picked = [], audit = [];
  for (const s of STRATA) {
    const rows = readJsonl(path.join(R, s.file)).filter(r => s.langs.test(r.lang) && refOf(r) && !(refMeta(r)?.private));
    const byBook = new Map(); for (const r of rows) if (!byBook.has(r.book_id)) byBook.set(r.book_id, r);
    const rand = makeRng(SEED + STRATA.indexOf(s));
    const order = shuffle([...byBook.keys()].sort(), rand);
    let got = 0;
    for (const bid of order) {
      if (got >= s.n) break;
      const r = byBook.get(bid); const p0 = Number(r.page_number);
      const book = await db.collection('books').findOne({ $or: [{ id: bid }, { id: bid.replace(/-/g, '') }] }, { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1, visible: 1, pages_count: 1, work_id: 1, source_work: 1, image_source: 1 } });
      const why = (x) => { audit.push({ stratum: s.key, book_id: bid, page: p0, lang: r.lang, why: x }); };
      if (!book) { why('no-book'); continue; }
      if (!(book.visible === true && book.pages_count > 0)) { why('not-live'); continue; }
      const pages = await db.collection('pages').find({ book_id: book.id, page_number: { $gte: p0 - 30, $lte: p0 + 30 } }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
      const ok = (p) => p && p.ocr?.data && p.translation?.data && isTranslatablePage(p).ok && !sameLanguageReason({ book, page: p });
      const at = new Map(pages.map(p => [p.page_number, p]));
      if (!ok(at.get(p0))) { why('ref-page-not-translatable'); continue; }
      let lo = p0, hi = p0; while (ok(at.get(lo - 1))) lo--; while (ok(at.get(hi + 1))) hi++;
      if (hi - lo + 1 < 15) { why(`run-${hi - lo + 1}`); continue; }
      // window [w, w+11] ⊂ [lo+1, hi], containing p0
      const starts = []; for (let w = Math.max(lo + 1, p0 - 11); w <= Math.min(p0, hi - 11); w++) starts.push(w);
      if (!starts.length) { why('no-window'); continue; }
      const w = starts[Math.floor(rand() * starts.length)];
      const win = Array.from({ length: 12 }, (_, i) => at.get(w + i));
      let commentary = null;
      if (s.key === 'commentary') {
        const t = COMMENTARY_TITLE.test(`${book.title} ${book.display_title ?? ''}`) ? 'title' : null;
        const o = win.filter(p => COMMENTARY_OCR.test(p.ocr.data)).length;
        if (!t && o < 3) { why(`no-commentary (ocr-marked ${o}/12)`); continue; }
        commentary = { title: !!t, ocr_marked_pages: o };
      }
      got++;
      picked.push({ stratum: s.key, track: s.track, lang: r.lang, book: { id: book.id, title: book.title, display_title: book.display_title, author: book.author, year: book.year ?? book.published, language: book.language }, ref_page: p0, run: [lo, hi], window: [w, w + 11], page_ids: win.map(p => p.id), commentary,
        reference: { text: refOf(r), meta: refMeta(r), fit: r.reference_fit ?? null } });
      audit.push({ stratum: s.key, book_id: bid, page: p0, lang: r.lang, why: 'PICKED' });
    }
    if (got < s.n) console.error(`stratum ${s.key}: only ${got} of ${s.n} eligible`);
  }
  await c.close();
  fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, at: new Date().toISOString(), books: picked.map(({ reference, ...b }) => ({ ...b, reference_meta: reference.meta })), audit }, null, 1));
  fs.writeFileSync(path.join(OUT, 'refs.jsonl'), picked.map(b => JSON.stringify({ book_id: b.book.id, page: b.ref_page, ...b.reference })).join('\n') + '\n');
  for (const b of picked) console.log(`${b.stratum}\t${b.lang}\t${b.book.id}\tref ${b.ref_page}\twin ${b.window.join('-')}\t${(b.book.display_title || b.book.title || '').slice(0, 60)}`);
}
main();
