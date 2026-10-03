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
  'derge-tengyur': { status: 'running', owner_issue: 5497,
    done: '213 volumes imported hidden and held, 128,369 of 128,639 pages carry the Esukhia public-domain text, aligned folio by folio to the BDRC scans and verified on sampled reads. Translation pilot on 5 volumes: 1,269 pages for $1.90.',
    next_action: 'Draft English for every page (approved by Derek, hard cap $200): gemini-3-flash-preview, one page per request, chosen over the pilot\'s chained blocks on 113 pages judged against 84000 (#5497). Volumes stay hidden; publishing them as an unreviewed machine draft is Derek\'s decision once the reader shows the licence and draft label (#5571).',
    cost_usd: 200 },
  'derge-kangyur': { status: 'running', owner_issue: 5665,
    next_action: 'Import running (held_books / pages_with_text count it): BDRC W4CZ5369, the Library of Congress copy the e-text transcribes, plus the Esukhia public-domain text, aligned folio by folio, with the texts 84000 has published or has in progress marked per page. Then archive the images ($0 model spend) and price a draft English for the texts 84000 has not begun.',
    cost_usd: 0 },
  cbeta: { status: 'next', owner_issue: 2554,
    next_action: 'Whole-canon CBETA → facsimile reader books (#2554) after the Chan subset (#5566) proves the fit-and-translate lane. CC BY-NC-SA: each page shows its licence (#5571).',
    cost_usd: 306 },
  'cbeta-chan': { status: 'running', owner_issue: 5566,
    done: 'Chan texts fitted to our scans; 74 of 79 books visible with the CBETA text and its licence.',
    next_action: 'Translate the 19 texts listed on #5566 under envelope cbeta-chan-2026-10 (unblocked 2026-10-02 07:58Z).',
    cost_usd: 9 },
  'pali-mula': { status: 'running', owner_issue: 5668,
    done: 'Eternity A+B pass (#5513): OCR + draft English on the Pali books we hold (hidden ones stay hidden).',
    next_action: 'Fit the VRI Chaṭṭha Saṅgāyana text (non-commercial, attribution) to our Pali scans instead of relying on OCR; re-translate changed pages.',
    cost_usd: 4 },
  'pali-atthakatha': { status: 'running', owner_issue: 5668,
    done: 'Eternity A+B pass covered the commentaries we hold except five aṭṭhakathā owned by the quality-round-1 eval (#5438).',
    next_action: 'As root texts: fit the VRI text; translate the five aṭṭhakathā once the eval releases them.',
    cost_usd: 11 },
  'pali-tika': { status: 'next', owner_issue: 5668,
    next_action: 'As root texts: fit the VRI text where we hold a scan; English coverage unknown (upper bound priced).',
    cost_usd: 4 },
  'gretil-buddhist': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL licence, quoted from its files: "THIS GRETIL TEXT FILE IS FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE." Each file inherits its source edition\'s terms, so no file can be published without clearing that edition.',
    next_action: 'Clear per source edition, or OCR our own scans instead (the A+B pass did this for the Sanskrit books we hold).', cost_usd: null },
  'gretil-vedanta': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As GRETIL Buddhist.', cost_usd: null },
  'gretil-gaudiya': { status: 'blocked', owner_issue: 5513,
    blocker: 'GRETIL "FOR REFERENCE PURPOSES ONLY! COPYRIGHT AND TERMS OF USAGE AS FOR SOURCE FILE."',
    next_action: 'As GRETIL Buddhist.', cost_usd: null },
  'sefaria-zohar': { status: 'blocked', owner_issue: 5560,
    blocker: 'Licence: every Sefaria Zohar Hebrew version reports its licence as `unknown` (Sefaria API, version licence field), so no Zohar text is fitted (#5560: 0 of 175 refused pages of the Bodley Zohar written).',
    next_action: 'Re-read the refused pages with the loop-guarded OCR re-read (#3878), not a Sefaria fit.', cost_usd: null },
  'sefaria-lurianic': { status: 'running', owner_issue: 5560,
    done: 'Fit lane built and run; Luria\'s Zohar commentary MS does not follow the public-domain Sha\'ar Ma\'amarei Rashbi (79 of 602 pages locate), so it is not fitted.',
    next_action: 'Loop-guarded OCR re-read of the refused pages (#3878).', cost_usd: null },
  'sefaria-cordovero': { status: 'running', owner_issue: 5560,
    done: 'Pardes Rimmonim: 12 refused pages filled with verified public-domain Sefaria text, now translating in the A+B pass.',
    next_action: '46 pages refused with reasons; loop-guarded OCR re-read (#3878).', cost_usd: null },
  'openiti-sufi': { status: 'next', owner_issue: null,
    next_action: 'No owner. CC BY-NC-SA like CBETA; the Chan lane (#5566) is the template once it publishes. Persian manuscript OCR is parked (#5559).',
    cost_usd: 29 },
  ganjoor: { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: no licence statement found on ganjoor-data or ganjoor.net (gap map, licence.quote empty).',
    next_action: 'Ask Ganjoor for terms before any import.', cost_usd: null },
  'mongolian-kanjur': { status: 'running', owner_issue: 5664,
    done: 'Scans-only import of BDRC W4CZ5370 (108 volumes) under way, held and hidden.',
    next_action: 'OCR feasibility is open: flash-lite drops ~70% of columns (#5664); needs a reference text or a Mongolist first.', cost_usd: 0 },
  'tripitaka-koreana': { status: 'blocked', owner_issue: 5513,
    blocker: 'Licence unverified: the K-Tripitaka e-text was unreachable from our host and no licence was found (gap map priced it via a CBETA proxy).',
    next_action: 'Obtain the e-text and its terms from the Haeinsa / Dongguk project.', cost_usd: null },
  kanripo: { status: 'next', owner_issue: 5568,
    next_action: 'Align Kanripo text (CC BY-SA 4.0) to the held Siku Quanshu scans instead of OCR: 7,001 books have covering juan files, 36/40 pilot books align (#5568).',
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
await pgc.end(); await mc.close();

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
const traditions = TRADITIONS.map((t) => {
  const byId = new Map();
  for (const k of t.sets) for (const b of sets[k].books) byId.set(b.id, b);
  const bs = [...byId.values()];
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
  };
});

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
    traditions: 'books held per tradition, each counted once; pages_scanned/transcribed/translated = sums of pages_count/pages_ocr/pages_translated; canon_page_equivalents = the open typed canon (gap_map_rows) in base chars ÷ our average base chars per page in that language',
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
