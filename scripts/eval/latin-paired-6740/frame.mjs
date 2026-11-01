#!/usr/bin/env node
// PRIOR ART: scripts/eval/queue-routes-7853/frame.mjs (strata by century band, largest-remainder allocation, sequential
// Poisson PPS on pages owed with one uniform a book drawn before exclusions, the agy face tag in PPS order with
// replacement of pages tagged none, results/frame.json) and scripts/eval/route-judge-6740/judge.mjs drawBlank (#7701:
// the first-read lane's frame FIRST_READ_BOOKS + firstReadSkip, spreadReason, one interior UNREAD page per book, the
// block of up to 4 consecutive unread pages with a seeded position). #7853's frame was the stored-text correction queue;
// drawBlank drew books equally and excluded only named sample files. Here: the latin-blank/print queue, books weighted
// by the pages they still owe the first read, and every book any committed eval file names is excluded.
/**
 * The frame of the Latin first-read paired test (experiment file §Frame). Read-only on Mongo; the only model calls are
 * the face tags.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/latin-paired-6740/frame.mjs census
 *   ... frame.mjs exclusions        every book a committed eval file under scripts/eval/ names -> OUT/exclusions.json
 *   ... frame.mjs draw              strata, allocation, the ordered PPS list per stratum -> OUT/draw.json
 *   ... frame.mjs tag [--concurrency=2]   page + block + face tag in stratum order until each stratum holds n_h pages
 *   ... frame.mjs select            OUT/selected.json; results/frame.json
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, RESULTS, J, W, jsonl, SEED, makeRng, arg, imageFor, agyFace, yearOf, centuryBand, BLOCK } from './lib.mjs';
import { FIRST_READ_BOOKS, firstReadSkip, byFirstReadOrder, UNREAD, spreadReason, isInterior } from '../../batch/cli-ocr-lane.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

/** Pages drawn (experiment file §Sample size). */
export const N = 40;
/** A stratum under this share of the queue's owed pages gets no page (reported as uncovered). */
export const MIN_SHARE = 0.01, MIN_PER_STRATUM = 2;
/** Exclusions: a committed file naming more queue books than this is a census, not a test sample, and is not used. */
export const CENSUS_BOOKS = 1000;
const BOOK_PROJ = { id: 1, title: 1, language: 1, year: 1, published: 1, visible: 1, pages_count: 1, pages_ocr: 1, processing_priority: 1, image_source: 1, needs_splitting: 1, split_completed: 1, pipeline_auto: 1 };
const PAGE_PROJ = { _id: 0, id: 1, page_number: 1, crop: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, photo: 1, enhanced_photo: 1, photo_original: 1 };
const gzWrite = (f, rows) => fs.writeFileSync(f, zlib.gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
const gzRead = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
async function withDb(fn) { const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); try { return await fn(c.db('bookstore')); } finally { await c.close(); } }

/**
 * The queue: the first-read lane's Latin books (FIRST_READ_BOOKS + firstReadSkip languages lat; what the live armc
 * --frame=first-read lane plans from). Owed pages = pages_count - pages_ocr, the lane's own count (cli-ocr-lane.mjs
 * count); the page-level spread check runs on the drawn book only (a book that may be an unsplit spread is replaced).
 */
async function census() {
  await withDb(async (db) => {
    const books = (await db.collection('books').find(FIRST_READ_BOOKS, { projection: BOOK_PROJ }).toArray())
      .filter((b) => !firstReadSkip(b, { languages: ['lat'] })).sort(byFirstReadOrder);
    const rows = books.map((b, k) => ({ id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: yearOf(b), published: b.published ?? null, provider: b.image_source?.provider ?? null, hold: b.pipeline_auto?.hold?.reason ?? null, pages_count: b.pages_count, pages_ocr: b.pages_ocr ?? 0, owed: Math.max(0, b.pages_count - (b.pages_ocr ?? 0)), queue_pos: k }));
    gzWrite(path.join(OUT, 'census.jsonl.gz'), rows);
    const owed = rows.reduce((a, r) => a + r.owed, 0);
    W('census-summary.json', { at: new Date().toISOString(), books: rows.length, books_owing: rows.filter((r) => r.owed).length, pages_owed: owed, no_ocr_books: rows.filter((r) => !r.pages_ocr).length });
    console.log(`census: ${rows.length} books, ${owed} owed pages`);
  });
}

/**
 * Books used in earlier tests: every 24-hex / uuid id in a committed .json/.jsonl/.gz/.md/.tsv/.csv file under
 * scripts/eval/ (results, samples, router evidence, experiment files), page ids resolved to their books, intersected
 * with the queue. Broad on purpose: a book any committed eval names is out. Writes OUT/exclusions.json.
 */
async function exclusions() {
  const C = gzRead(path.join(OUT, 'census.jsonl.gz')), inQ = new Set(C.map((r) => r.id));
  const ids = new Set(), skipped = {}; let files = 0;
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'node_modules' && !p.startsWith(path.join(ROOT, 'scripts/eval/latin-paired-6740'))) walk(p); continue; }
      if (!/\.(json|jsonl|gz|md|tsv|csv)$/.test(f.name) || fs.statSync(p).size > 60e6) continue;
      let t = fs.readFileSync(p); if (p.endsWith('.gz')) { try { t = zlib.gunzipSync(t); } catch { continue; } }
      const mine = new Set([...t.toString('utf8').matchAll(/\b[0-9a-f]{24}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g)].map((m) => m[0]));
      // a file naming more than CENSUS_BOOKS queue books is a corpus census or classification, not a test sample
      const hits = [...mine].filter((x) => inQ.has(x)).length;
      if (hits > CENSUS_BOOKS) { skipped[path.relative(ROOT, p)] = hits; continue; }
      for (const x of mine) ids.add(x);
      files++;
    }
  };
  walk(path.join(ROOT, 'scripts/eval'));
  const books = new Set([...ids].filter((x) => inQ.has(x)));
  const direct = books.size;
  await withDb(async (db) => {
    const all = [...ids].filter((x) => !inQ.has(x));
    for (let i = 0; i < all.length; i += 5000) for (const p of await db.collection('pages').find({ id: { $in: all.slice(i, i + 5000) } }, { projection: { _id: 0, book_id: 1 } }).toArray()) if (inQ.has(p.book_id)) books.add(p.book_id);
  });
  W('exclusions.json', { at: new Date().toISOString(), files_scanned: files, census_files_skipped: skipped, ids_seen: ids.size, books_named_directly: direct, books: [...books].sort() });
  console.log(`exclusions: ${books.size} queue books (${direct} by book id) from ${ids.size} ids in ${files} files`);
}

/** Strata (century band of the book's year) and allocation, then the sequential Poisson PPS order inside each stratum. */
function draw() {
  const excl = new Set(J('exclusions.json').books);
  const rows = gzRead(path.join(OUT, 'census.jsonl.gz')).filter((r) => r.owed > 0);
  const rnd = makeRng(SEED.draw);
  // One uniform a book, in id order, before any exclusion: the draw does not move when the exclusion list does.
  const U = new Map([...rows].sort((a, b) => (a.id < b.id ? -1 : 1)).map((r) => [r.id, rnd()]));
  const strata = {};
  for (const r of rows) {
    const s = centuryBand(r.year); strata[s] ??= { books: 0, pages: 0, books_excluded: 0, pages_excluded: 0, list: [] }; const st = strata[s];
    if (excl.has(r.id)) { st.books_excluded++; st.pages_excluded += r.owed; continue; }
    st.books++; st.pages += r.owed; st.list.push({ id: r.id, owed: r.owed, key: U.get(r.id) / r.owed });
  }
  const S = Object.entries(strata), M = S.reduce((a, [, s]) => a + s.pages, 0);
  const elig = S.filter(([, s]) => s.pages / M >= MIN_SHARE), Me = elig.reduce((a, [, s]) => a + s.pages, 0);
  // Largest remainder over the eligible strata, then a floor of MIN_PER_STRATUM taken from the largest.
  const raw = elig.map(([k, s]) => ({ k, q: N * s.pages / Me }));
  for (const x of raw) x.n = Math.floor(x.q);
  let left = N - raw.reduce((a, x) => a + x.n, 0);
  for (const x of [...raw].sort((a, b) => (b.q - b.n) - (a.q - a.n) || (a.k < b.k ? -1 : 1))) { if (left <= 0) break; x.n++; left--; }
  for (const x of raw) while (x.n < MIN_PER_STRATUM) { const big = raw.filter((y) => y.n > MIN_PER_STRATUM).sort((a, b) => b.n - a.n)[0]; if (!big) break; big.n--; x.n++; }
  for (const [k, s] of S) { s.share = +(s.pages / M).toFixed(4); s.n = raw.find((x) => x.k === k)?.n ?? 0; }
  for (const s of Object.values(strata)) { s.list.sort((a, b) => a.key - b.key || (a.id < b.id ? -1 : 1)); s.order = s.list.map((x) => x.id); delete s.list; }
  W('draw.json', { at: new Date().toISOString(), seed: SEED.draw, n: N, min_share: MIN_SHARE, min_per_stratum: MIN_PER_STRATUM, excluded_books: excl.size, strata });
  for (const [k, s] of Object.entries(strata).sort()) console.log(`${k.padEnd(10)} books ${String(s.books).padStart(5)} pages ${String(s.pages).padStart(8)} share ${s.share} n ${s.n} (excluded ${s.books_excluded} books, ${s.pages_excluded} pages)`);
}

/**
 * The page of a drawn book (drawBlank's rule): the book must still be in the frame and not a possible unsplit spread;
 * one interior UNREAD page, uniform from the stream seeded by the book id; its block is the run of consecutive unread
 * page numbers around it, cut to BLOCK pages with the page at a seeded position.
 */
async function pageOf(db, id) {
  const b = await db.collection('books').findOne({ id }, { projection: BOOK_PROJ });
  const why = !b ? 'book gone' : firstReadSkip(b, { languages: ['lat'] });
  if (why) return { skip: `left the frame: ${why}` };
  const unread = await db.collection('pages').find({ book_id: id, ...UNREAD }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
  if (spreadReason(b, unread)) return { skip: 'possible unsplit spread (spreadReason)' };
  const inner = unread.filter((p) => isInterior(p.page_number, b.pages_count));
  if (!inner.length) return { skip: 'no interior unread page' };
  const rnd = makeRng(SEED.draw + parseInt(id.replace(/[^0-9a-f]/g, '').slice(-6), 16));
  const p = inner[Math.floor(rnd() * inner.length)];
  const byNum = new Map(unread.map((x) => [x.page_number, x]));
  const pos = Math.floor(rnd() * BLOCK);
  let start = p.page_number - pos;
  const runTo = (a, z) => { for (let n = a; n <= z; n++) if (!byNum.has(n)) return false; return true; };
  while (start < p.page_number && !runTo(start, p.page_number)) start++;
  let end = p.page_number;
  while (end + 1 - start < BLOCK && byNum.has(end + 1)) end++;
  const block = Array.from({ length: end - start + 1 }, (_, i) => byNum.get(start + i));
  const image = getPageSource(p);
  if (!image) return { skip: 'no image source' };
  return { page_id: p.id, page_number: p.page_number, image, block: block.map((x) => x.id), block_images: Object.fromEntries(block.map((x) => [x.id, getPageSource(x)])), book_title: String(b.title || '').slice(0, 80), published: b.published ?? null, provider: b.image_source?.provider ?? null };
}

/** Face tags, stratum by stratum in PPS order, until n_h usable pages (a page tagged none, or unfetchable, is replaced). */
async function tag() {
  const D = J('draw.json');
  const file = path.join(OUT, 'tags.jsonl');
  const have = new Map(jsonl(file).map((r) => [r.book_id, r]));
  const conc = Math.max(1, Math.min(2, Number(arg('concurrency') || 2)));
  await withDb(async (db) => {
    for (const [k, s] of Object.entries(D.strata).sort()) {
      if (!s.n) continue;
      const usable = () => s.order.filter((id) => have.get(id)?.tag && have.get(id).tag.face !== 'none').length;
      let i = 0, stop = null;
      await Promise.all(Array.from({ length: conc }, async () => {
        while (!stop && i < s.order.length) {
          if (usable() >= s.n) break;
          const id = s.order[i++]; if (have.has(id)) continue;
          const pg = await pageOf(db, id);
          let row = { book_id: id, stratum: k, rank: s.order.indexOf(id) };
          if (pg.skip) row = { ...row, tag: null, err: pg.skip };
          else {
            let img = null; try { img = await imageFor(`L-${pg.page_id}`, pg.image); } catch (e) { row = { ...row, ...pg, tag: null, err: String(e.message).slice(0, 200) }; }
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

/** The sample: in each stratum the first n_h books in PPS order whose page was tagged with printed body text. */
function select() {
  const D = J('draw.json'), C = gzRead(path.join(OUT, 'census.jsonl.gz')), byId = new Map(C.map((r) => [r.id, r]));
  const tags = new Map(jsonl(path.join(OUT, 'tags.jsonl')).map((r) => [r.book_id, r]));
  const sel = [], replaced = {};
  for (const [k, s] of Object.entries(D.strata).sort()) {
    let got = 0;
    for (const id of s.order) {
      if (got >= s.n) break;
      const t = tags.get(id); if (!t) break;
      if (!t.tag || t.tag.face === 'none') { const why = t.tag ? 'face none (no printed body text)' : String(t.err || 'unparsed tag').replace(/https?:\S+/, '').slice(0, 60); replaced[why] = (replaced[why] ?? 0) + 1; continue; }
      const r = byId.get(id);
      sel.push({ key: `L-${t.page_id}`, page_id: t.page_id, book_id: id, page_number: t.page_number, title: r.title, year: r.year, provider: t.provider, stratum: k, face: t.tag.face, image: t.image, block: t.block, block_images: t.block_images, owed: r.owed, stratum_pages: s.pages, stratum_n: s.n });
      got++;
    }
    if (got < s.n) console.log(`  ${k}: ${got}/${s.n} (short)`);
  }
  W('selected.json', { at: new Date().toISOString(), selected: sel, replaced });
  const Q = { books: 0, pages: 0, century: {}, no_ocr_books: 0, provider: {} };
  for (const r of C.filter((x) => x.owed)) { Q.books++; Q.pages += r.owed; const c = centuryBand(r.year); Q.century[c] = (Q.century[c] ?? 0) + r.owed; if (!r.pages_ocr) Q.no_ocr_books++; const pv = r.provider ?? 'none'; Q.provider[pv] = (Q.provider[pv] ?? 0) + r.owed; }
  const smp = { pages: sel.length, century: {}, face: {}, block_sizes: {}, provider: {} };
  for (const x of sel) { smp.century[x.stratum] = (smp.century[x.stratum] ?? 0) + 1; smp.face[x.face] = (smp.face[x.face] ?? 0) + 1; smp.block_sizes[x.block.length] = (smp.block_sizes[x.block.length] ?? 0) + 1; smp.provider[x.provider ?? 'none'] = (smp.provider[x.provider ?? 'none'] ?? 0) + 1; }
  const strataOut = Object.fromEntries(Object.entries(D.strata).sort().map(([k, s]) => [k, { books: s.books, pages: s.pages, share: s.share, n: s.n, selected: sel.filter((x) => x.stratum === k).length, books_excluded: s.books_excluded, pages_excluded: s.pages_excluded }]));
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, 'frame.json'), JSON.stringify({ at: new Date().toISOString(), census: J('census-summary.json'), exclusions: (({ files_scanned, ids_seen, books_named_directly, books }) => ({ files_scanned, ids_seen, books_named_directly, books: books.length }))(J('exclusions.json')), queue: Q, sample: smp, strata: strataOut, replaced, tags_made: tags.size }, null, 1) + '\n');
  console.log(`selected ${sel.length}: ${JSON.stringify(smp)}; replaced ${JSON.stringify(replaced)}`);
}

const stages = { census, exclusions, draw, tag, select };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
