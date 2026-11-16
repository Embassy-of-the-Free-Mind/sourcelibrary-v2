#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs draw (one page per book, seeded, interior) and
// scripts/eval/pro-translate-6545/select-pages.py (#72's pick from the v2#6545 panels). Neither fits: judge.mjs draws
// named OCR cells, and select-pages.py picks from pages that all HAVE a published reference. This draws pages whose
// books our own evidence stores say have NO published English translation (#93 question 2).
/**
 * #93 draw: 20 pages each in Persian, Sanskrit, Classical Chinese, Greek, Hebrew; one page per book; visible books with
 * pages (visible: true && pages_count > 0); an interior page with real OCR in the expected script and a stored English
 * translation. Left out: the v2#6545 books (and their works), and books our data says HAVE a published English
 * translation (books.prior_translation, translation_verification, first_translation_attempts found / not_first /
 * priors[]). Books with a "none found" search are drawn first; the rest come from books with no evidence either way
 * (`ft_class: untold`), and the write-up reports how many. A language that falls short of --per (Persian: few books
 * hold a stored translation) spreads its shortfall over the languages drawn after it.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/fable-frontier-93/draw.mjs --out=DIR [--per=20]
 * Read-only. Writes DIR/sample.json and DIR/draw-stats.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = arg('out'); const PER = Number(arg('per') || 20);
if (!OUT) { console.error('--out=DIR'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const h = (s) => crypto.createHash('sha256').update(`fable-frontier-93:${s}`).digest('hex');

export const LANGS = {
  Persian: { labels: ['Persian'], script: /\p{Script=Arabic}/gu, min: 300 },
  Sanskrit: { labels: ['Sanskrit'], script: /\p{Script=Devanagari}/gu, min: 300 },
  'Classical Chinese': { labels: ['Classical Chinese', 'Chinese'], script: /\p{Script=Han}/gu, min: 150 },
  Greek: { labels: ['Greek', 'Ancient Greek'], script: /\p{Script=Greek}/gu, min: 300 },
  Hebrew: { labels: ['Hebrew', 'Hebrew and Aramaic'], script: /\p{Script=Hebrew}/gu, min: 300 },
};
const APP = /<(meta|image-desc|detected-images|vocab|summary|keywords|warning|note|lang|language|page-type|header|page-num|sig|footer)\b[^>]*>[\s\S]*?<\/\1>/gi;
const body = (t) => String(t || '').replace(APP, ' ').replace(/<[^>]+>/g, ' ');
const share = (t, re) => { const b = body(t); const letters = (b.match(/\p{L}/gu) || []).length; return letters ? (b.match(re) || []).length / letters : 0; };

const recs = fs.readFileSync('/root/pareto-6182/xl/records.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const ex6545 = new Set(recs.map((r) => r.book_id));

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const exBooks = await db.collection('books').find({ id: { $in: [...ex6545] } }, { projection: { work_id: 1 } }).toArray();
const exWorks = new Set(exBooks.map((b) => b.work_id).filter(Boolean));

const stats = {}; const pages = []; let extra = 0;   // a language that falls short (Persian) passes its shortfall to the languages after it
for (const [lang, L] of Object.entries(LANGS)) {
  const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $in: L.labels } },
    { projection: { id: 1, title: 1, author: 1, language: 1, work_id: 1, pages_count: 1, prior_translation: 1, is_first_translation: 1, 'translation_verification.has_english_translation': 1, 'translation_verification.translations': 1 } }).toArray();
  const ids = books.flatMap((b) => [b.id, String(b._id)]);
  const att = new Map();
  for (const a of await db.collection('first_translation_attempts').find({ book_id: { $in: ids } }, { projection: { book_id: 1, result: 1, priors: 1 } }).toArray()) {
    const x = att.get(a.book_id) ?? { results: new Set(), priors: 0 }; x.results.add(a.result); x.priors += (a.priors || []).length; att.set(a.book_id, x);
  }
  const st = { books: books.length, excluded_6545: 0, known_english: 0, none_found: 0, untold: 0, scanned: 0, no_page: 0, drawn_none: 0, drawn_untold: 0 };
  const cls = (b) => {
    const a = [att.get(b.id), att.get(String(b._id))].filter(Boolean);
    const res = new Set(a.flatMap((x) => [...x.results])), priors = a.reduce((s, x) => s + x.priors, 0);
    const tv = b.translation_verification;
    if (b.prior_translation || tv?.has_english_translation === true || (tv?.translations || []).length || priors || res.has('found') || res.has('not_first')) return 'known';
    if (res.has('none') || res.has('not_found') || res.has('likely_first') || tv?.has_english_translation === false || b.is_first_translation === true) return 'none';
    return 'untold';
  };
  const pool = { none: [], untold: [] };
  for (const b of books) {
    if (ex6545.has(b.id) || (b.work_id && exWorks.has(b.work_id))) { st.excluded_6545++; continue; }
    const k = cls(b); if (k === 'known') { st.known_english++; continue; }
    st[k === 'none' ? 'none_found' : 'untold']++; pool[k].push(b);
  }
  const usedWorks = new Set();
  const order = [...pool.none.sort((a, b) => h(a.id).localeCompare(h(b.id))).map((b) => [b, 'none']), ...pool.untold.sort((a, b) => h(a.id).localeCompare(h(b.id))).map((b) => [b, 'untold'])];
  let got = 0; const want = PER + extra;
  for (const [b, k] of order) {
    if (got >= want) break;
    if (b.work_id && usedWorks.has(b.work_id)) continue;
    st.scanned++;
    const lo = Math.max(3, Math.floor(b.pages_count * 0.1)), hi = Math.max(lo + 1, Math.ceil(b.pages_count * 0.9));
    const cand = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: lo, $lte: hi }, 'translation.data': { $type: 'string' }, 'ocr.data': { $type: 'string' } },
      { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
    const ok = cand.filter((p) => {
      if (!isTranslatablePage(p).ok || !getPageSource(p)) return false;
      const o = p.ocr.data; if ((body(o).match(L.script) || []).length < L.min || share(o, L.script) < 0.6) return false;
      const t = p.translation.data; return t.length >= 200 && !/<<<BEGIN>>>/.test(t);
    }).sort((x, y) => h(x.id).localeCompare(h(y.id)));
    if (!ok.length) { st.no_page++; continue; }
    const p = ok[0]; got++; st[k === 'none' ? 'drawn_none' : 'drawn_untold']++; if (b.work_id) usedWorks.add(b.work_id);
    pages.push({ uid: p.id, page_id: p.id, book_id: b.id, page_number: p.page_number, lang, book_language: b.language, title: b.title, author: b.author, work_id: b.work_id ?? null,
      ft_class: k, image_url: getPageSource(p), ocr_model: p.ocr.model ?? null, live_model: p.translation.model ?? null, live_updated_at: p.translation.updated_at ?? null,
      ocr_sha: crypto.createHash('sha256').update(p.ocr.data).digest('hex').slice(0, 16), live_sha: crypto.createHash('sha256').update(p.translation.data).digest('hex').slice(0, 16) });
  }
  if (got < want && !extra) extra = Math.ceil((want - got) / (Object.keys(LANGS).length - Object.keys(stats).length - 1));
  st.want = want; st.drawn = got;
  stats[lang] = st; console.log(lang, JSON.stringify(st));
}
await c.close();
fs.writeFileSync(path.join(OUT, 'sample.json'), JSON.stringify({ drawn_at: new Date().toISOString(), per: PER, pages }, null, 1));
fs.writeFileSync(path.join(OUT, 'draw-stats.json'), JSON.stringify(stats, null, 1));
console.log(`drawn ${pages.length} pages`);
