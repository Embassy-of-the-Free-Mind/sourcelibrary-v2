#!/usr/bin/env node
/**
 * OCR residue purity probe — detect UNTAGGED AI text serving as "original."
 *
 * Purpose: the quote / licensing / search surfaces serve the OCR residue
 * (stripEditorialWrappers + generic tag strip) as the source's own words.
 * Tagged annotations are handled by the wrapper strip, but AI prose that was
 * never tagged (#2393-class: image descriptions, "(Transcribing the text from
 * the three palm leaf segments...)", condition narration) is indistinguishable
 * from source text by tag logic. This probe finds it two independent ways:
 *
 *  1. REGISTER: on a non-English book, an English-register segment in the
 *     residue is a leak candidate (AI writes its meta-prose in English).
 *  2. WITNESS (default mode): the prior OCR of the same page from
 *     `page_revisions` is an independent second reading. A leak candidate
 *     absent from the witness is one model's improvisation; present in BOTH
 *     runs it is a systematic prompt-era artifact — the class that
 *     self-consistency/agreement checks can never catch.
 *
 * Three output lanes, honestly separated (see #3308 discussion):
 *  - MISTAG: pages whose residue is mostly English on a "non-English" book —
 *    almost always a books.language mistag (known IA issue), NOT leakage.
 *    These books feed the metadata-repair lane.
 *  - LEAK single-run / shared: isolated English segments, split by witness.
 *    Shared-lane hits are further split by visual vocabulary: "The image
 *    depicts..." is leakage; "Principal navigations, voyages..." on a German
 *    page is likely a genuine English quotation (bibliographies quote foreign
 *    titles) — route those to vision spot-check, don't auto-flag.
 *
 * Caveat: page_revisions over-represents problem pages (pages get re-OCR'd
 * because something was wrong), so witness-mode rates are an upper bound for
 * re-processed pages. For an unbiased corpus-wide rate use --random-pages
 * (register+lexicon only, no witness).
 *
 * Usage:
 *   node scripts/eval/ocr-purity-probe.mjs [--sample 1500] [--random-pages]
 *                                          [--jsonl out.jsonl]
 * Requires MONGODB_URI.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : dflt;
};
const SAMPLE = Number(opt('--sample', 1500));
const RANDOM_PAGES = flag('--random-pages');
const JSONL = opt('--jsonl', null);

const EN_STOP = new Set(['the','of','with','from','this','that','which','has','have','been','are','was','were','not','for','on','as','by','at','or','be','is','and','to','it','its','their','there','shows','into','left','right','top','bottom','page','image','text','a']);
const VISUAL_RE = /\b(depicts?|engraving|woodcut|illustration|diagram|the (page|image|text|stamp|margin|manuscript|document)|handwritten|illegible|faded|border|ornament|decorat|previous page|next page|transcri|coat of arms|title page|visible|seal|emblem|folio|strips? of paper)\b/i;

const residue = raw => stripEditorialWrappers(raw || '').replace(/<[^>]+>/g, ' ');
const tokens = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9']+/g, ' ').trim().split(/\s+/).filter(Boolean);
const segments = txt => txt.split(/(?<=[.!?])\s+|\n{1,}/).map(s => s.trim()).filter(s => s.length >= 45);
function isEnglishRegister(seg, toks) {
  if (toks.length < 8) return false;
  const hits = toks.filter(t => EN_STOP.has(t));
  if (new Set(hits).size < 3) return false;
  const ratio = hits.length / toks.length;
  return ratio >= 0.22 || (ratio > 0.12 && VISUAL_RE.test(seg));
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const bookCache = new Map();
async function bookOf(bookId) {
  if (!bookCache.has(bookId)) {
    bookCache.set(bookId, await db.collection('books').findOne(
      { id: bookId }, { projection: { language: 1, title: 1 } }));
  }
  return bookCache.get(bookId);
}
const usableLang = lang =>
  lang && lang !== 'english' && lang !== 'en' && !lang.includes('auto');

// Assemble (pageId, bookId, current, witness?) units for the chosen mode.
async function* units() {
  if (RANDOM_PAGES) {
    const pages = await db.collection('pages').aggregate([
      { $match: { 'ocr.data': { $type: 'string' } } },
      { $sample: { size: SAMPLE } },
      { $project: { id: 1, book_id: 1, 'ocr.data': 1 } },
    ]).toArray();
    for (const p of pages) yield { pageId: p.id, bookId: p.book_id, current: p.ocr.data, witness: null };
  } else {
    const revs = await db.collection('page_revisions').aggregate([
      { $match: { field: 'ocr', data: { $type: 'string' } } },
      { $sample: { size: SAMPLE } },
    ]).toArray();
    for (const r of revs) {
      const pg = await db.collection('pages').findOne(
        { id: r.page_id }, { projection: { 'ocr.data': 1, book_id: 1 } });
      if (!pg?.ocr?.data || pg.ocr.data === r.data) continue;
      yield { pageId: r.page_id, bookId: pg.book_id, current: pg.ocr.data, witness: r.data };
    }
  }
}

const counts = { pairs: 0, segments: 0, mistagPages: 0, leakPages: 0, singleRun: 0, sharedVisual: 0, sharedQuotationLike: 0 };
const mistagBooks = new Set();
const rows = [];
const examples = { single: [], sharedVisual: [], sharedQuote: [] };

for await (const u of units()) {
  const book = await bookOf(u.bookId);
  const lang = (book?.language || '').toLowerCase();
  if (!usableLang(lang)) continue;
  counts.pairs++;
  const segs = segments(residue(u.current)).map(seg => {
    const toks = tokens(seg);
    return { seg, toks, isEn: isEnglishRegister(seg, toks) };
  });
  counts.segments += segs.length;

  const enFrac = segs.length ? segs.filter(s => s.isEn).length / segs.length : 0;
  if (enFrac > 0.5 && segs.length >= 3) {
    counts.mistagPages++;
    mistagBooks.add(u.bookId);
    rows.push({ lane: 'mistag', page_id: u.pageId, book_id: u.bookId, language: lang });
    continue;
  }

  const witnessToks = u.witness
    ? new Set(tokens(residue(u.witness)).filter(t => t.length >= 4))
    : null;
  let pageHasLeak = false;
  for (const { seg, toks, isEn } of segs) {
    if (!isEn) continue;
    pageHasLeak = true;
    const url = `https://sourcelibrary.org/book/${u.bookId}/page/${u.pageId}`;
    const row = { page_id: u.pageId, book_id: u.bookId, language: lang, segment: seg };
    if (!witnessToks) {
      counts.singleRun++; // register-only mode: no witness split
      rows.push({ lane: 'leak-register', ...row });
      continue;
    }
    const content = toks.filter(t => t.length >= 4);
    const inWitness = content.length ? content.filter(t => witnessToks.has(t)).length / content.length : 0;
    if (inWitness < 0.6) {
      counts.singleRun++;
      rows.push({ lane: 'leak-single-run', ...row });
      if (examples.single.length < 8) examples.single.push({ seg, lang, url });
    } else if (VISUAL_RE.test(seg)) {
      counts.sharedVisual++;
      rows.push({ lane: 'leak-shared-visual', ...row });
      if (examples.sharedVisual.length < 8) examples.sharedVisual.push({ seg, lang, url });
    } else {
      counts.sharedQuotationLike++;
      rows.push({ lane: 'shared-quotation-like', ...row });
      if (examples.sharedQuote.length < 8) examples.sharedQuote.push({ seg, lang, url });
    }
  }
  if (pageHasLeak) counts.leakPages++;
}

const pct = n => `${(100 * n / Math.max(1, counts.pairs)).toFixed(1)}%`;
console.log(`mode: ${RANDOM_PAGES ? 'random-pages (register only, unbiased)' : 'witness (page_revisions, upper bound for re-processed pages)'}`);
console.log(`non-English units: ${counts.pairs}; residue segments: ${counts.segments}`);
console.log(`MISTAG-suspect pages: ${counts.mistagPages} (${pct(counts.mistagPages)}) across ${mistagBooks.size} books`);
console.log(`pages with isolated English-register leakage: ${counts.leakPages} (${pct(counts.leakPages)})`);
console.log(`  single-run leak segments: ${counts.singleRun}`);
console.log(`  shared leak segments (visual vocab — systematic AI): ${counts.sharedVisual}`);
console.log(`  shared quotation-like (possible real foreign quotes — needs vision check): ${counts.sharedQuotationLike}`);
for (const [title, list] of [['SINGLE-RUN', examples.single], ['SHARED/VISUAL', examples.sharedVisual], ['SHARED/QUOTATION-LIKE', examples.sharedQuote]]) {
  if (!list.length) continue;
  console.log(`\n-- ${title} examples:`);
  list.forEach(e => console.log(`  [${e.lang}] "${e.seg.slice(0, 150)}"\n    ${e.url}`));
}
if (mistagBooks.size) console.log(`\nmistag-suspect books: ${[...mistagBooks].join(', ')}`);
if (JSONL) {
  writeFileSync(JSONL, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.log(`\nwrote ${rows.length} rows to ${JSONL}`);
}
await client.close();
