#!/usr/bin/env node
// PRIOR ART: scripts/eval/fraktur-paired-7835/frame.mjs t2-draw (the #7558 correction lane's frame: correctMain's book
// query, correctablePages restated because it is not exported, less the lane's gex45 ledger and lane_judge_verdicts; the
// block of the page and the next 3 pages; the face tag in draw order), scripts/batch/cli-ocr-lane.mjs correctMain (the
// book query and order this restates). #7835 drew books equally; here every book is weighted by the pages it owes the
// lane (sequential Poisson PPS inside strata), which no earlier frame did.
/**
 * The frame of #7853 (experiment file §Frame). Read-only on Mongo; the only model calls are the face tags.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/queue-routes-7853/frame.mjs exclusions
 *   ... frame.mjs census [--concurrency=8]   every book in the queue, its owed pages, century, scan band -> OUT/census.jsonl.gz
 *   ... frame.mjs draw                       strata, allocation, the ordered PPS list per stratum -> OUT/draw.json
 *   ... frame.mjs tag [--concurrency=2]      face tags in stratum order until each stratum holds n_h usable pages
 *   ... frame.mjs select                     OUT/selected.json; results/frame.json (the strata against the queue)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, RESULTS, J, W, jsonl, SEED, makeRng, arg, imageFor, agyFace, yearOf, centuryBand, scanBand, langOf, LANGS } from './lib.mjs';
import { LITE_MODELS, IDLE_STATUSES, isInterior, lastPageNumber, CORRECT_LANGUAGES } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

/** Pages drawn per language (experiment file §Sample size). */
export const N = Object.freeze({ de: 150, fr: 60 });
/** A stratum under this share of its language's owed pages gets no page (reported as uncovered). */
export const MIN_SHARE = 0.01, MIN_PER_STRATUM = 2;
/** The head of the queue reported beside it: the first 20,000 owed pages a language in the lane's own order. */
export const HEAD_PAGES = 20000;
export const LEDGER = '/root/jobs/cli-ocr-correct/correct-ledger.jsonl';
const PAGE_PROJ = { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, page_type: 1 };
const gzWrite = (f, rows) => fs.writeFileSync(f, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
const gzRead = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }

/**
 * The books of #7701, #7818 and #7835: every page and book id in their committed results and router evidence, page ids
 * resolved to their books. Writes OUT/exclusions.json.
 */
async function exclusions() {
  const files = [
    ...['cheap-routes-7701', 'first-read-7701', 'german-cheaper-7701', 'correction-pass-7818', 'fraktur-paired-7835'].map((n) => `scripts/eval/estimator/router-table/evidence/${n}.score.json`),
    ...fs.readdirSync(path.join(ROOT, 'scripts/eval/correction-pass-7818/results/release')).map((f) => `scripts/eval/correction-pass-7818/results/release/${f}`),
    ...fs.readdirSync(path.join(ROOT, 'scripts/eval/fraktur-paired-7835/results')).map((f) => `scripts/eval/fraktur-paired-7835/results/${f}`),
    ...['cheap-routes-7701-2026-10-29', 'first-read-7701-2026-10-29', 'german-cheaper-7701-2026-10-30'].flatMap((d) => { const p = path.join(ROOT, 'scripts/eval/route-judge-6740/results', d); return fs.existsSync(p) ? fs.readdirSync(p).map((f) => `scripts/eval/route-judge-6740/results/${d}/${f}`) : []; }),
  ];
  const ids = { page: new Set(), book: new Set() }, per = {};
  for (const f of files) {
    const abs = path.join(ROOT, f); if (!fs.existsSync(abs)) continue;
    const txt = f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(abs)).toString('utf8') : fs.readFileSync(abs, 'utf8');
    let n = 0;
    for (const m of txt.matchAll(/"(page_id|page|book_id|bid|other_page_id|planted_from)"\s*:\s*"([0-9a-f]{24}|[0-9a-f-]{36})"/g)) { (m[1] === 'book_id' || m[1] === 'bid' ? ids.book : ids.page).add(m[2]); n++; }
    // #7835 keys its pages T1-/T2-/T3-/T4-<page id>
    for (const m of txt.matchAll(/"T[1-4]-([0-9a-f]{24})"/g)) { ids.page.add(m[1]); n++; }
    per[f] = n;
  }
  await withDb(async (db) => {
    const pids = [...ids.page];
    for (let i = 0; i < pids.length; i += 1000) for (const p of await db.collection('pages').find({ id: { $in: pids.slice(i, i + 1000) } }, { projection: { book_id: 1 } }).toArray()) ids.book.add(p.book_id);
  });
  W('exclusions.json', { at: new Date().toISOString(), files: per, pages_seen: ids.page.size, books: [...ids.book].sort() });
  console.log(`exclusions: ${ids.book.size} books (${ids.page.size} page ids in ${Object.keys(per).length} files)`);
}

/**
 * Every book of the correction lane's queue (correctMain's query, German and French), with its owed pages: the
 * correctablePages rule restated, less the gex45 ledger and lane_judge_verdicts. One row a book, owed pages included.
 */
async function census() {
  const ledger = new Set(jsonl(LEDGER).map((r) => r.page_id));
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  await withDb(async (db) => {
    const judged = new Set((await db.collection('lane_judge_verdicts').find({}, { projection: { page_id: 1 } }).toArray()).map((r) => r.page_id));
    const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: CORRECT_LANGUAGES }, 'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } },
      { projection: { id: 1, title: 1, language: 1, year: 1, published: 1, pages_count: 1, processing_priority: 1, 'scan_quality.score': 1, 'scan_quality.classification': 1 } }).toArray())
      .sort((a, b) => (b.processing_priority ?? 0) - (a.processing_priority ?? 0) || a.id.localeCompare(b.id));
    const out = new Array(books.length);
    let i = 0, done = 0;
    const conc = Math.max(1, Math.min(12, Number(arg('concurrency') || 8)));
    await Promise.all(Array.from({ length: conc }, async () => {
      while (i < books.length) {
        const k = i++, b = books[k];
        const rows = await db.collection('pages').aggregate([
          { $match: { book_id: b.id, ...VISIBLE_PAGE_MATCH, 'ocr.model': { $in: LITE_MODELS }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } } },
          { $project: { _id: 0, id: 1, page_number: 1, n: { $strLenCP: '$ocr.data' }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } }, sq: { $regexFind: { input: '$ocr.data', regex: '<scan-quality>\\s*([a-z]+)', options: 'i' } } } },
          { $match: { n: { $gte: 300 }, hw: false } }, { $sort: { page_number: 1 } }]).toArray();
        const last = rows.length ? await lastPageNumber(db, b.id) : 0;
        const owed = rows.filter((p) => isInterior(p.page_number, last) && !ledger.has(p.id) && !judged.has(p.id));
        const sq = owed.map((p) => String(p.sq?.captures?.[0] || '').toLowerCase());
        out[k] = { id: b.id, lang: langOf(b.language), language: b.language, title: String(b.title || '').slice(0, 80), year: yearOf(b), priority: b.processing_priority ?? 0, queue_pos: k, book_scan: b.scan_quality?.score ?? null, book_scan_class: b.scan_quality?.classification ?? null,
          owed: owed.length, good: sq.filter((s) => s === 'good').length, fair: sq.filter((s) => s === 'fair').length, poor: sq.filter((s) => s === 'poor').length, pages: owed.map((p) => [p.id, p.page_number]) };
        if (++done % 500 === 0) console.log(`  census ${done}/${books.length}`);
      }
    }));
    gzWrite(path.join(OUT, 'census.jsonl.gz'), out);
    const t = {}; for (const r of out) { t[r.lang] ??= { books: 0, books_owing: 0, pages_owed: 0 }; t[r.lang].books++; t[r.lang].pages_owed += r.owed; if (r.owed) t[r.lang].books_owing++; }
    W('census-summary.json', { at: new Date().toISOString(), ledger_rows: ledger.size, judged_pages: judged.size, by_lang: t });
    console.log(`census: ${JSON.stringify(t)}`);
  });
}

/** Strata and allocation (experiment file §Strata), then the sequential Poisson PPS order inside each stratum. */
function draw() {
  const excl = new Set(J('exclusions.json').books);
  const rows = gzRead(path.join(OUT, 'census.jsonl.gz')).filter((r) => r.owed > 0);
  const stratum = (r) => `${r.lang}|${centuryBand(r.year)}|${scanBand(r.good, r.owed)}`;
  const rnd = makeRng(SEED.draw);
  // One uniform a book, in id order, before any exclusion: the draw does not move when the exclusion list does.
  const U = new Map([...rows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => [r.id, rnd()]));
  const strata = {};
  for (const r of rows) { const s = stratum(r); strata[s] ??= { lang: r.lang, books: 0, pages: 0, books_excluded: 0, pages_excluded: 0, list: [] }; const st = strata[s];
    if (excl.has(r.id)) { st.books_excluded++; st.pages_excluded += r.owed; continue; }
    st.books++; st.pages += r.owed; st.list.push({ id: r.id, owed: r.owed, key: U.get(r.id) / r.owed }); }
  for (const lang of Object.keys(N)) {
    const S = Object.entries(strata).filter(([, s]) => s.lang === lang), M = S.reduce((a, [, s]) => a + s.pages, 0);
    const elig = S.filter(([, s]) => s.pages / M >= MIN_SHARE);
    const Me = elig.reduce((a, [, s]) => a + s.pages, 0);
    // Largest remainder over the eligible strata, then a floor of MIN_PER_STRATUM taken from the largest.
    const raw = elig.map(([k, s]) => ({ k, q: N[lang] * s.pages / Me }));
    for (const x of raw) x.n = Math.floor(x.q);
    let left = N[lang] - raw.reduce((a, x) => a + x.n, 0);
    for (const x of [...raw].sort((a, b) => (b.q - b.n) - (a.q - a.n) || (a.k < b.k ? -1 : 1))) { if (left <= 0) break; x.n++; left--; }
    for (const x of raw) while (x.n < MIN_PER_STRATUM) { const big = raw.filter((y) => y.n > MIN_PER_STRATUM).sort((a, b) => b.n - a.n)[0]; if (!big) break; big.n--; x.n++; }
    for (const [k, s] of S) { s.share = +(s.pages / M).toFixed(4); s.n = raw.find((x) => x.k === k)?.n ?? 0; }
  }
  for (const s of Object.values(strata)) { s.list.sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1)); s.order = s.list.map((x) => x.id); delete s.list; }
  W('draw.json', { at: new Date().toISOString(), seed: SEED.draw, n: N, min_share: MIN_SHARE, min_per_stratum: MIN_PER_STRATUM, excluded_books: excl.size, strata });
  for (const [k, s] of Object.entries(strata).sort()) console.log(`${k.padEnd(26)} books ${String(s.books).padStart(5)} pages ${String(s.pages).padStart(7)} share ${s.share} n ${s.n}`);
}

/**
 * The page of a drawn book: one owed page, uniform from the stream seeded by the book id, with an image; its block is it
 * and the next 3 visible pages of the book (shifted back at the end).
 */
async function pageOf(db, r) {
  const rnd = makeRng(SEED.draw + parseInt(r.id.replace(/[^0-9a-f]/g, '').slice(-6), 16));
  const pick = r.pages[Math.floor(rnd() * r.pages.length)];
  const all = await db.collection('pages').find({ book_id: r.id, ...VISIBLE_PAGE_MATCH }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
  const i = all.findIndex((x) => x.id === pick[0]);
  if (i < 0) return { skip: 'page gone' };
  const p = all[i], image = getPageSource(p);
  if (!image) return { skip: 'no image source' };
  if (all.length < 4) return { skip: 'book under 4 pages' };
  const s = Math.min(i, all.length - 4);
  return { page_id: p.id, page_number: p.page_number, image, block: all.slice(s, s + 4).map((x) => x.id) };
}

/** Face tags, stratum by stratum in PPS order, until n_h usable pages (a page tagged none, or unfetchable, is replaced). */
async function tag() {
  const D = J('draw.json'), C = new Map(gzRead(path.join(OUT, 'census.jsonl.gz')).map((r) => [r.id, r]));
  const file = path.join(OUT, 'tags.jsonl');
  const have = new Map(jsonl(file).map((r) => [r.book_id, r]));
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 2)));
  await withDb(async (db) => {
    for (const [k, s] of Object.entries(D.strata).sort()) {
      if (!s.n) continue;
      const usable = () => s.order.filter((id) => have.get(id)?.tag && have.get(id).tag.face !== 'none').length;
      let i = 0, stop = null;
      await Promise.all(Array.from({ length: conc }, async () => {
        while (!stop && i < s.order.length) {
          if (usable() >= s.n) break;
          const id = s.order[i++]; if (have.has(id)) continue;
          const r = C.get(id), pg = await pageOf(db, r);
          let row = { book_id: id, stratum: k, rank: s.order.indexOf(id) };
          if (pg.skip) row = { ...row, tag: null, err: pg.skip };
          else {
            let img = null; try { img = await imageFor(`Q-${pg.page_id}`, pg.image); } catch (e) { row = { ...row, ...pg, tag: null, err: String(e.message).slice(0, 200) }; }
            if (img) { const t = await agyFace(img); if (t.quota) { stop = `agy quota: ${t.err}`; break; } row = { ...row, ...pg, ...t }; }
          }
          fs.appendFileSync(file, JSON.stringify({ ...row, at: new Date().toISOString() }) + '\n');
          have.set(id, row);
          console.log(`  ${k} #${row.rank} ${id}: ${row.tag?.face ?? row.err ?? 'unparsed'}`);
        }
      }));
      console.log(`${k}: ${usable()}/${s.n} usable${stop ? `; STOPPED ${stop}` : ''}`);
      if (stop) return;
    }
  });
}

/**
 * The sample: in each stratum the first n_h books in PPS order whose page was tagged with body text, in order. A book
 * tagged after its stratum filled (concurrency) is not used. Writes OUT/selected.json and results/frame.json.
 */
function select() {
  const D = J('draw.json'), C = gzRead(path.join(OUT, 'census.jsonl.gz')), byId = new Map(C.map((r) => [r.id, r]));
  const tags = new Map(jsonl(path.join(OUT, 'tags.jsonl')).map((r) => [r.book_id, r]));
  const sel = [], replaced = {};
  for (const [k, s] of Object.entries(D.strata).sort()) {
    let got = 0;
    for (const id of s.order) {
      if (got >= s.n) break;
      const t = tags.get(id); if (!t) break;   // untagged: the stratum stopped here
      if (!t.tag || t.tag.face === 'none') { const why = t.tag ? 'face none (no printed body text)' : String(t.err || 'unparsed tag').replace(/https?:\S+/, '').slice(0, 60); replaced[why] = (replaced[why] ?? 0) + 1; continue; }
      const r = byId.get(id);
      sel.push({ key: `Q-${t.page_id}`, page_id: t.page_id, book_id: id, page_number: t.page_number, lang: r.lang, language: r.language, title: r.title, year: r.year, stratum: k, face: t.tag.face, image: t.image, block: t.block, owed: r.owed, stratum_pages: s.pages, stratum_n: s.n });
      got++;
    }
    if (got < s.n) console.log(`  ${k}: ${got}/${s.n} (short)`);
  }
  W('selected.json', { at: new Date().toISOString(), selected: sel, replaced });
  // The strata against the whole queue: owed pages by language, century band and scan band (census), the sample's.
  const Q = {};
  for (const r of C.filter((x) => x.owed)) {
    const L = (Q[r.lang] ??= { books: 0, pages: 0, century: {}, scan: {}, page_scan_tag: { good: 0, fair: 0, poor: 0, other: 0 }, book_scan_score: {} });
    L.books++; L.pages += r.owed;
    const c = centuryBand(r.year), sc = scanBand(r.good, r.owed);
    L.century[c] = (L.century[c] ?? 0) + r.owed; L.scan[sc] = (L.scan[sc] ?? 0) + r.owed;
    L.page_scan_tag.good += r.good; L.page_scan_tag.fair += r.fair; L.page_scan_tag.poor += r.poor; L.page_scan_tag.other += r.owed - r.good - r.fair - r.poor;
    const bs = r.book_scan == null ? 'none' : r.book_scan >= 85 ? '>=85' : r.book_scan >= 70 ? '70-84' : '<70';
    L.book_scan_score[bs] = (L.book_scan_score[bs] ?? 0) + r.owed;
  }
  // The head of the queue: the books the lane takes first (its order: processing_priority, then id), up to HEAD_PAGES.
  const head = {};
  for (const lang of Object.keys(N)) {
    let n = 0; const H = (head[lang] ??= { books: 0, pages: 0, century: {}, scan: {} });
    for (const r of C.filter((x) => x.owed && x.lang === lang).sort((a, b) => a.queue_pos - b.queue_pos)) {
      if (n >= HEAD_PAGES) break; n += r.owed; H.books++; H.pages += r.owed;
      const c = centuryBand(r.year), sc = scanBand(r.good, r.owed); H.century[c] = (H.century[c] ?? 0) + r.owed; H.scan[sc] = (H.scan[sc] ?? 0) + r.owed;
    }
  }
  const S = {};
  for (const x of sel) { const L = (S[x.lang] ??= { pages: 0, century: {}, scan: {}, face: {} }); L.pages++; const [, c, sc] = x.stratum.split('|'); L.century[c] = (L.century[c] ?? 0) + 1; L.scan[sc] = (L.scan[sc] ?? 0) + 1; L.face[x.face] = (L.face[x.face] ?? 0) + 1; }
  // Face of the queue: the PPS sample is self-weighting inside a stratum, so the queue's face mix is sum_h W_h * share_h.
  const faceQueue = {};
  for (const lang of Object.keys(N)) {
    const st = Object.entries(D.strata).filter(([, s]) => s.lang === lang && s.n), Wt = st.reduce((a, [, s]) => a + s.pages, 0);
    const f = {}; for (const [k, s] of st) { const g = sel.filter((x) => x.stratum === k); for (const x of g) f[x.face] = (f[x.face] ?? 0) + (s.pages / Wt) / g.length; }
    faceQueue[lang] = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, +v.toFixed(3)]));
  }
  const strataOut = Object.fromEntries(Object.entries(D.strata).sort().map(([k, s]) => [k, { books: s.books, pages: s.pages, share: s.share, n: s.n, selected: sel.filter((x) => x.stratum === k).length, books_excluded: s.books_excluded, pages_excluded: s.pages_excluded }]));
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'frame.json'), JSON.stringify({ at: new Date().toISOString(), census: J('census-summary.json'), queue: Q, queue_head: { pages_per_lang: HEAD_PAGES, ...head }, sample: S, face_of_queue_estimated: faceQueue, strata: strataOut, replaced, tags_made: tags.size }, null, 1) + '\n');
  console.log(`selected ${sel.length}: ${JSON.stringify(S)}; replaced ${JSON.stringify(replaced)}`);
}

const stages = { exclusions, census, draw, tag, select };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
