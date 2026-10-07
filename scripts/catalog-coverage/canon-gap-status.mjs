#!/usr/bin/env node
/**
 * Canon gap STATUS (#5513): what is done, running, next or blocked for each corpus of the canon gap
 * map, with live counts. The public page sourcelibrary.org/research/canon-gap reads the output.
 *
 * PRIOR ART: scripts/catalog-coverage/canon-gap-map.mjs (#5519) measures each corpus once (licence,
 * size, English, cost) and writes canon-gap-map-2026-10.json; it has no status, owner or next action,
 * and its holdings are a snapshot. This script keeps the map's corpus ids and its book selectors
 * (scripts/lib/canon-holdings.mjs, shared) and adds the plan, re-counted on every run.
 *
 * The STATUS table below is authored (who owns what, and what happens next); the counts are measured:
 *   held_books       books we hold for the corpus, live + hidden (the gap map's selector; `method` says how)
 *   live_books       of those, visible && pages_count > 0
 *   pipeline_held    of those, carrying a pipeline hold (pipeline-hold.mjs) — e.g. an import awaiting a decision
 *   readable_books   of those, readable_in_english (translation_state, page-counts.mjs isReadableInEnglish)
 *   pages_with_text  sum of pages_ocr over those books (stored counter, recountBook)
 *
 * Two figures the page used to hard-code (#5497, #5513), now measured on every run:
 *   eternity_shelf   the 278 books of the Eternity reading list (eternity-shelf-5513.json, the A+B
 *                    pass's list): how many are readable in English, recomputed from `pages`
 *                    (computeTranslationState), not read from the stored flag, which lags.
 *   tengyur_draft    the Derge Tengyur volumes: pages with text and pages with a draft English per
 *                    volume, counted on `pages`; translation spend on those books from BOTH usage
 *                    stores (type 'translation' only, so the 84000 reference and quality-arm evals,
 *                    metered as 'eval', are not counted as draft cost).
 *
 * Usage (Hetzner; needs MONGODB_URI + SUPABASE_DB_URL):
 *   node --env-file=.env.production.local scripts/catalog-coverage/canon-gap-status.mjs [--out=path.json]
 */
import { readFileSync, writeFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { pgClient } from '../works-catalog/lib.mjs';
import { loadHoldingCandidates, corpusBookSets, isLive, ROW_SET } from '../lib/canon-holdings.mjs';
import { isReadableInEnglish, buildVisiblePageCountPipeline, pageCountersFromStats, computeTranslationState } from '../lib/page-counts.mjs';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
const MAP = 'scripts/catalog-coverage/results/canon-gap-map-2026-10.json';
const OUT = args.out || 'scripts/catalog-coverage/results/canon-gap-status-2026-10.json';
const SHELF = 'scripts/catalog-coverage/eternity-shelf-5513.json';

// status: done | running | next | blocked. cost_usd: the next action's cost where it has one.
const STATUS = {
  'derge-tengyur': { status: 'running', owner_issue: 5800,
    done: 'All 213 volumes are public as an AI translation not yet reviewed by a scholar, with the licence on every page (#5497). 128,369 of 128,639 pages carry the Esukhia public-domain text, aligned folio by folio to the BDRC scans, and 128,333 of them have draft English from gemini-3-flash-preview, one page per request, for about $233. About 2 to 5 statements per 100 pages are reversed, measured against 84000. 721 invented heading lines were removed from 569 pages, and each volume lists its texts with Tohoku numbers (3,363 texts).',
    next_action: 'Tibetologists read 30 pages of the draft through Eternity, the first scholar review (#5800).',
    cost_usd: 0 },
  'derge-kangyur': { status: 'running', owner_issue: 5665,
    done: '103 volumes imported from BDRC (W4CZ5369, the copy the Esukhia text transcribes), held and hidden; 62,375 pages carry the Esukhia public-domain text, aligned folio by folio, in every volume but one. The 40 texts 84000 lists as not begun have a draft English (1,835 pages, $3.39).',
    next_action: 'Fill the Prajñāpāramitā volumes still short of text (vol. 20 and parts of vols. 15, 16, 19 and 24, about 2,600 pages), which needs a new alignment rule; correct the stored 84000 field for texts that run across volumes before pricing a draft English for the rest of what 84000 has not translated. Publication waits on the reader showing the licence and draft label (#5571).',
    cost_usd: 0 },
  cbeta: { status: 'next', owner_issue: 2554,
    next_action: 'Pair the whole CBETA canon with our scans once the Chan texts below are translated and published. CBETA\'s licence is non-commercial with attribution, so every page will show it (#5571).',
    cost_usd: 306 },
  'cbeta-chan': { status: 'running', owner_issue: 5566,
    done: 'Chan texts fitted to our scans; 74 of 79 books visible with the CBETA text and its licence.',
    next_action: 'Translate the remaining 19 texts listed on #5566.',
    cost_usd: 9 },
  'pali-mula': { status: 'running', owner_issue: 5668,
    done: 'The Pali books we hold have been read by OCR and drafted in English (hidden books stay hidden).',
    next_action: 'Replace the OCR with the VRI Chaṭṭha Saṅgāyana typed text (non-commercial, with attribution), matched to our scans, and retranslate the pages that change.',
    cost_usd: 4 },
  'pali-atthakatha': { status: 'running', owner_issue: 5668,
    done: 'The commentaries we hold are drafted in English, except five held back for a quality test (#5438).',
    next_action: 'As for the root texts: match the VRI typed text to our scans; translate the five held commentaries when the test releases them.',
    cost_usd: 11 },
  'pali-tika': { status: 'next', owner_issue: 5668,
    next_action: 'As for the root texts: match the VRI typed text wherever we hold a scan. How much is in English is unknown, so the cost is an upper bound.',
    cost_usd: 4 },
  'gretil-buddhist': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL licence, quoted from its files: "THIS GRETIL TEXT FILE IS FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE." Each file inherits its source edition\'s terms, so no file can be published without clearing that edition.',
    next_action: 'Clear the rights edition by edition, or read our own scans of the printed editions instead, as we already do for the Sanskrit books we hold.', cost_usd: null },
  'gretil-vedanta': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As for GRETIL Buddhist texts.', cost_usd: null },
  'gretil-gaudiya': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As for GRETIL Buddhist texts.', cost_usd: null },
  'sefaria-zohar': { status: 'blocked', owner_issue: 5560,
    blocker: 'Licence: every Sefaria Zohar Hebrew version reports its licence as `unknown` (Sefaria API, version licence field), so no Zohar text is fitted (#5560: 0 of 175 refused pages of the Bodley Zohar written).',
    next_action: 'Re-read the pages our OCR refused from our own scans (#3878) instead of using Sefaria\'s text.', cost_usd: null },
  'sefaria-lurianic': { status: 'running', owner_issue: 5560,
    done: 'Matching Sefaria\'s text to our scans was tried. Luria\'s Zohar commentary manuscript does not follow the public-domain Sha\'ar Ma\'amarei Rashbi (only 79 of 602 pages could be located), so it was not used.',
    next_action: 'Re-read the pages our OCR refused (#3878).', cost_usd: null },
  'sefaria-cordovero': { status: 'running', owner_issue: 5560,
    done: 'Pardes Rimmonim: 12 pages our OCR refused were filled with checked public-domain Sefaria text and are being translated.',
    next_action: 'Re-read the other 46 refused pages (#3878).', cost_usd: null },
  'openiti-sufi': { status: 'next', owner_issue: null,
    next_action: 'Not started. The licence is non-commercial with attribution, like CBETA\'s, so the Chan texts (#5566) are the model once they are published. Reading Persian manuscripts is paused until it is accurate enough (#5559).',
    cost_usd: 29 },
  ganjoor: { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: no licence statement found on ganjoor-data or ganjoor.net (gap map, licence.quote empty).',
    next_action: 'Ask Ganjoor for terms before any import.', cost_usd: null },
  'mongolian-kanjur': { status: 'running', owner_issue: 5664,
    done: 'Scans of BDRC W4CZ5370 (108 volumes) imported, held and hidden.',
    next_action: 'Find a way to read it: no engine we tried reads the script (Gemini Flash read 0 of 31 columns on 10 test pages and wrote fluent English that matches no passage; CrossLing-OCR-Mini returned Tibetan script) (#5664). A recogniser would first need 10 to 20 pages transcribed by a Mongolist, or IMU\'s line data.', cost_usd: 0 },
  'tripitaka-koreana': { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: the K-Tripitaka e-text was unreachable from our host and no licence was found (gap map priced it via a CBETA proxy).',
    next_action: 'Obtain the e-text and its terms from the Haeinsa / Dongguk project.', cost_usd: null },
  kanripo: { status: 'next', owner_issue: 5568,
    next_action: 'Our Siku Quanshu scans were read with PaddleOCR-VL instead of being replaced by the Kanripo typed text (decided 2 October, #5547; 7,006 books, 1,033,868 pages written by 5 October, #5600): 36 of 40 pilot books aligned, but on 28% of pages Kanripo\'s page break is a column or more off the scan. Kanripo serves as a check on that OCR (6.6% of pages flagged for review). Using it as a second text layer for up to 7,001 books waits on its licence: the Kanripo organisation states CC BY-SA 4.0, and no text states its own (#5568).',
    cost_usd: null },
};

const map = JSON.parse(readFileSync(MAP, 'utf8'));
const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore');
const pgc = pgClient(); await pgc.connect();
const { books, whBy } = await loadHoldingCandidates(db, pgc);
const sets = corpusBookSets(books, whBy);
const now = new Date().toISOString();

// Eternity shelf: readable in English, recomputed from pages per book (the #5513 close-out's method).
const shelfIds = JSON.parse(readFileSync(SHELF, 'utf8')).book_ids;
const shelfBooks = await db.collection('books').find({ id: { $in: shelfIds } }, { projection: { id: 1, language: 1, content_type: 1 } }).toArray();
let shelfReadable = 0;
for (const b of shelfBooks) {
  const [row] = await db.collection('pages').aggregate(buildVisiblePageCountPipeline(b.id)).toArray();
  if (isReadableInEnglish(computeTranslationState(pageCountersFromStats(row), { language: b.language, content_type: b.content_type }))) shelfReadable++;
}
const eternity_shelf = { listed: shelfIds.length, found: shelfBooks.length, readable: shelfReadable, list: SHELF, owner_issue: 5513, counted_at: now };

// Derge Tengyur draft English: per volume, pages with text and pages translated; translation spend.
const tgBooks = sets.tengyur.books.filter((b) => /Derge Tengyur, vol\. \d+/.test(b.title || ''));
const tgIds = tgBooks.map((b) => b.id);
const perBook = async (match) => new Map((await db.collection('pages').aggregate([
  { $match: { book_id: { $in: tgIds }, page_number: { $gt: 0 }, ...match } }, { $group: { _id: '$book_id', n: { $sum: 1 } } },
]).toArray()).map((a) => [a._id, a.n]));
const tgAll = await perBook({});
const tgText = await perBook({ 'ocr.data': { $exists: true, $nin: [null, ''] } });
const tgTr = await perBook({ 'translation.data': { $exists: true, $nin: [null, ''] } });
const volumes = tgBooks.map((b) => ({ vol: Number(b.title.match(/vol\. (\d+)/)[1]), book_id: b.id, pages_with_text: tgText.get(b.id) || 0, pages_translated: tgTr.get(b.id) || 0 }))
  .sort((a, b) => a.vol - b.vol);
const [supa] = (await pgc.query("select coalesce(sum(cost_usd),0)::float as usd, count(*)::int as rows from gemini_usage where book_id = any($1) and type = 'translation'", [tgIds])).rows;
const [mongoUsage] = await db.collection('gemini_usage').aggregate([{ $match: { book_id: { $in: tgIds }, type: 'translation' } }, { $group: { _id: null, usd: { $sum: { $ifNull: ['$cost_usd', 0] } }, rows: { $sum: 1 } } }]).toArray();
const tgPagesTr = volumes.reduce((a, v) => a + v.pages_translated, 0);
const tgUsd = +(supa.usd + (mongoUsage?.usd || 0)).toFixed(2);
const tengyur_draft = {
  owner_issue: 5497, volumes: volumes.length,
  // A volume counts as translated when ≥ 95% of its pages with text have a draft (blank and
  // refused pages never will); partly when any page has one.
  volumes_translated: volumes.filter((v) => v.pages_with_text && v.pages_translated >= 0.95 * v.pages_with_text).length,
  volumes_partly: volumes.filter((v) => v.pages_translated > 0 && !(v.pages_translated >= 0.95 * v.pages_with_text)).length,
  pages_imaged: tgIds.reduce((a, id) => a + (tgAll.get(id) || 0), 0),
  pages_with_text: volumes.reduce((a, v) => a + v.pages_with_text, 0),
  pages_translated: tgPagesTr,
  spend_usd: tgUsd, usage_rows: supa.rows + (mongoUsage?.rows || 0),
  usd_per_page: tgPagesTr ? +(tgUsd / tgPagesTr).toFixed(5) : null,
  model: 'gemini-3-flash-preview, prompt v13, Batch API, one page per request without neighbour context (#5497 arm B); the 5-volume pilot used 8-page chained blocks',
  per_volume: volumes.map(({ vol, pages_with_text, pages_translated }) => [vol, pages_with_text, pages_translated]),
  counted_at: now,
};
await pgc.end();

const corpora = map.rows.map((r) => {
  const s = STATUS[r.id];
  if (!s) throw new Error(`no STATUS entry for gap-map corpus ${r.id}`);
  const set = sets[ROW_SET[r.id]];
  const bs = set.books;
  return {
    id: r.id, corpus: r.corpus, ...s,
    held_books: bs.length,
    live_books: bs.filter(isLive).length,
    pipeline_held: bs.filter((b) => b.pipeline_auto?.hold).length,
    readable_books: bs.filter((b) => isReadableInEnglish(b.translation_state)).length,
    pages_with_text: bs.reduce((a, b) => a + (b.pages_ocr || 0), 0),
    holdings_method: set.method,
    updated_at: now,
  };
});
// Progress by TRADITION (the page's unit charts): the books we hold, counted once each even when
// two gap-map rows share a set (the three Pali rows) or one set contains another (Chan ⊂ CBETA),
// with pages at each stage — scanned (pages_count), transcribed (pages_ocr), translated
// (pages_translated) — and the open typed canon converted to page-equivalents at our own average
// characters per page in that language (map.rates), so held pages and canon size share one unit.
const TRADITIONS = [
  { id: 'tibetan', name: 'Tibetan Buddhist canon', sets: ['tengyur', 'kangyur', 'tengyur_other_editions', 'kangyur_other_editions'], rows: ['derge-tengyur', 'derge-kangyur'] },
  { id: 'chinese-buddhist', name: 'Chinese Buddhist canon', sets: ['cbeta', 'cbeta_chan'], rows: ['cbeta'] },
  { id: 'chinese-classics', name: 'Chinese classics', sets: ['kanripo'], rows: ['kanripo'] },
  { id: 'pali', name: 'Pali canon', sets: ['pali'], rows: ['pali-mula', 'pali-atthakatha', 'pali-tika'] },
  { id: 'sanskrit', name: 'Sanskrit', sets: ['gretil'], rows: ['gretil-buddhist', 'gretil-vedanta', 'gretil-gaudiya'] },
  { id: 'kabbalah', name: 'Kabbalah', sets: ['kabbalah'], rows: ['sefaria-zohar', 'sefaria-lurianic', 'sefaria-cordovero'] },
  { id: 'sufi', name: 'Sufi texts (Arabic and Persian)', sets: ['openiti_sufi'], rows: ['openiti-sufi'] },
  { id: 'persian-poetry', name: 'Persian poetry', sets: ['ganjoor'], rows: ['ganjoor'] },
  { id: 'mongolian', name: 'Mongolian Kanjur', sets: ['mongolian_kanjur'], rows: ['mongolian-kanjur'] },
];
// Which engine read each page and which model drafted its English, per book, from the page
// records themselves (ocr.model / ocr.source, translation.model). Read-only; one pass over the
// pages of every book in a tradition.
const tradBooks = TRADITIONS.map((t) => {
  const byId = new Map();
  for (const k of t.sets) for (const b of sets[k].books) byId.set(b.id, b);
  return [...byId.values()];
});
const allIds = [...new Set(tradBooks.flat().map((b) => b.id))];
const engineRows = [];
for (let i = 0; i < allIds.length; i += 25) engineRows.push(...await db.collection('pages').aggregate([
  { $match: { book_id: { $in: allIds.slice(i, i + 25) } } },
  { $group: {
    _id: {
      b: '$book_id',
      o: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 0] }, { $ifNull: ['$ocr.model', { $ifNull: ['$ocr.source', 'unrecorded'] }] }, null] },
      t: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 0] }, { $ifNull: ['$translation.model', 'unrecorded'] }, null] },
    },
    n: { $sum: 1 },
  } },
], { allowDiskUse: true }).toArray());
const enginesByBook = new Map();
for (const r of engineRows) {
  const e = enginesByBook.get(r._id.b) || { ocr: {}, translation: {} };
  if (r._id.o) e.ocr[r._id.o] = (e.ocr[r._id.o] || 0) + r.n;
  if (r._id.t) e.translation[r._id.t] = (e.translation[r._id.t] || 0) + r.n;
  enginesByBook.set(r._id.b, e);
}
const tally = (bs, kind) => {
  const out = {};
  for (const b of bs) for (const [k, n] of Object.entries(enginesByBook.get(b.id)?.[kind] || {})) out[k] = (out[k] || 0) + n;
  return Object.entries(out).sort((x, y) => y[1] - x[1]);
};
const titleOf = (b) => String(b.english_title || b.title || b.id).replace(/\s+/g, ' ').slice(0, 90);

const traditions = TRADITIONS.map((t, ti) => {
  const bs = tradBooks[ti];
  const canon = t.rows.map((id) => map.rows.find((r) => r.id === id));
  const canon_page_equivalents = Math.round(canon.reduce((a, r) => a + (r.size.base_chars ? r.size.base_chars / map.rates[r.lang].base_chars_per_page : 0), 0));
  return {
    id: t.id, name: t.name, gap_map_rows: t.rows,
    books: bs.length,
    readable_books: bs.filter((b) => isReadableInEnglish(b.translation_state)).length,
    pages_scanned: bs.reduce((a, b) => a + (b.pages_count || 0), 0),
    pages_transcribed: bs.reduce((a, b) => a + (b.pages_ocr || 0), 0),
    pages_translated: bs.reduce((a, b) => a + (b.pages_translated || 0), 0),
    canon_page_equivalents,
    ocr_engines: tally(bs, 'ocr'),
    translation_models: tally(bs, 'translation'),
    // [id, title, public, pages scanned, transcribed, translated], most-translated first: the unit
    // chart lays its squares over these so each square opens a real book.
    book_pages: bs
      .map((b) => [b.id, titleOf(b), isLive(b), b.pages_count || 0, b.pages_ocr || 0, b.pages_translated || 0])
      .sort((x, y) => y[5] - x[5] || y[4] - x[4] || y[3] - x[3]),
  };
});

await mc.close();

const missing = Object.keys(STATUS).filter((k) => !map.rows.some((r) => r.id === k));
if (missing.length) throw new Error(`STATUS has ids the gap map does not: ${missing.join(', ')}`);

writeFileSync(OUT, JSON.stringify({
  issue: 5513, generated_at: now, script: 'scripts/catalog-coverage/canon-gap-status.mjs', gap_map: MAP,
  fields: {
    status: 'done | running | next | blocked', owner_issue: 'GitHub issue that owns the next action', next_action: 'what happens next, in one sentence',
    cost_usd: 'cost of the next action where it has one (draft-English figures are the gap map\'s)', held_books: 'books we hold for the corpus, live + hidden (holdings_method)',
    live_books: 'visible && pages_count > 0', pipeline_held: 'books under a pipeline hold', readable_books: 'readable_in_english (translation_state)', pages_with_text: 'sum of pages_ocr',
    eternity_shelf: 'the 278-book Eternity reading list (list file); readable = readable_in_english recomputed from pages',
    tengyur_draft: 'Derge Tengyur volumes: pages with text / with draft English counted on pages; per_volume = [vol, pages_with_text, pages_translated]; spend_usd = type translation usage rows on these books, both stores',
    traditions: 'books held per tradition, each counted once; pages_scanned/transcribed/translated = sums of pages_count/pages_ocr/pages_translated; canon_page_equivalents = the open typed canon (gap_map_rows) in base chars ÷ our average base chars per page in that language; ocr_engines / translation_models = [model, pages] counted on pages with text / with English (ocr.model, else ocr.source; translation.model); book_pages = [id, title, public, scanned, transcribed, translated]',
  },
  corpora,
  traditions,
  eternity_shelf,
  tengyur_draft,
}, null, 1) + '\n');
console.log(`wrote ${OUT}: ${corpora.length} corpora`);
for (const c of corpora) console.log(`${c.id.padEnd(20)} ${c.status.padEnd(8)} #${c.owner_issue ?? '—'} held ${c.held_books} live ${c.live_books} readable ${c.readable_books} text-pages ${c.pages_with_text}`);
console.log(`eternity shelf: ${eternity_shelf.readable} / ${eternity_shelf.listed} readable`);
console.log(`tengyur draft: ${tengyur_draft.pages_translated} / ${tengyur_draft.pages_with_text} pages, ${tengyur_draft.volumes_translated} volumes translated (${tengyur_draft.volumes_partly} partly), $${tengyur_draft.spend_usd}`);
for (const t of traditions) console.log(`${t.id.padEnd(18)} books ${t.books} scanned ${t.pages_scanned} text ${t.pages_transcribed} translated ${t.pages_translated} readable ${t.readable_books} canon≈${t.canon_page_equivalents}pp`);
process.exit(0);
