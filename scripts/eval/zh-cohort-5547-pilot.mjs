#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/ndl-koten-lane.mjs (#4925) — plan / compare / apply for a GPU OCR lane
 * on whole books, with holds and a production write. This pilot must NOT hold, write or touch any
 * book (#5547: the held cohort stays exactly as #4719 left it), reads with a different engine, and
 * asks a narrower question (throughput, failure rate, would a writer accept it), so it borrows the
 * lane's shape (manifest.tsv → box → out/<bid>/<pn>.txt) and its guards (loopVerdict,
 * missingProvenance) read-only, and writes files only.
 *
 * #5547 step 4 — PaddleOCR-VL scale pilot on the Chinese held cohort.
 *
 *   prep    draw 30 books (Mulberry32 seed 5547 over the id-sorted list) from the HELD books whose
 *           sealed page was read by eye as manuscript-regular; list their pages; fetch every page
 *           image to <dir>/img/<bid>/<pn>.jpg (≤ 2400 px, what the benchmark engines saw); copy the
 *           540 sealed benchmark images to <dir>/img/_bench/; write manifest.tsv (bid, pn, file) with
 *           the benchmark pages FIRST, then the books in draw order. Images are on disk before any
 *           GPU boots.
 *   report  read <dir>/out (box output) + box.json: books/pages completed in the time box, s/page,
 *           empty and error pages, loop pages (the production loop guard), and the writer dry-run:
 *           the $set a lane writer would apply for 5 pages, checked with the production provenance
 *           checker. Writes <dir>/report.json. Nothing is written to Mongo.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-cohort-5547-pilot.mjs prep [--dir=/root/zh-ocr-eval-5547/pilot]
 *   node scripts/eval/zh-cohort-5547-pilot.mjs report [--dir=...] [--eur-per-hour=0.7875] [--billed-min=N]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connect, disconnect } from './lib/sampling.mjs';
import { fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { loopVerdict } from '../lib/ocr-loop-guard.mjs';
import { missingProvenance, contentHash } from '../lib/write-provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/zh-ocr-eval-5547/pilot');
const BENCH = argOf('bench', '/root/ocr-bench/images/chinese-cohort-5547');
const REG = path.join(__dirname, 'benchmark', 'chinese-cohort-5547.json');
const N_BOOKS = parseInt(argOf('books', '30'), 10);
const SEED = 5547, MAX_WIDTH = 2400;
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

async function prep() {
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const eyeDir = path.join(BENCH, 'out', 'script-class');
  const eye = s => { try { return JSON.parse(fs.readFileSync(path.join(eyeDir, `${s}.json`), 'utf8')).script_class; } catch { return null; } };
  const pool = reg.pages.filter(p => !p.retired && p.cohort === 'held' && eye(p.slug) === 'manuscript-regular').map(p => p.book_id).sort();
  const rnd = mulberry32(SEED); const bag = [...pool]; const books = [];
  while (books.length < N_BOOKS && bag.length) books.push(bag.splice(Math.floor(rnd() * bag.length), 1)[0]);
  console.log(`pool ${pool.length} held books with an eye-manuscript-regular sealed page; drew ${books.length}`);
  const { db } = await connect();
  const PROJ = { page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 };
  const meta = await db.collection('books').find({ id: { $in: books } }, { projection: { id: 1, title: 1, pages_count: 1, work_id: 1 } }).toArray();
  const byId = new Map(meta.map(b => [b.id, b]));
  const jobs = []; const bookRows = [];
  for (const bid of books) {
    const pages = await db.collection('pages').find({ book_id: bid }, { projection: PROJ, maxTimeMS: 60000 }).sort({ page_number: 1 }).toArray();
    let noImg = 0;
    for (const p of pages) { const url = getPageSource(p); if (!url) { noImg++; continue; } jobs.push({ bid, pn: p.page_number, url }); }
    bookRows.push({ book_id: bid, title: byId.get(bid)?.title, pages_count: byId.get(bid)?.pages_count, pages_listed: pages.length, no_image: noImg, work_id: byId.get(bid)?.work_id });
  }
  await disconnect();
  fs.mkdirSync(path.join(DIR, 'img', '_bench'), { recursive: true });
  let failed = 0, done = 0; const q = [...jobs];
  const worker = async () => {
    const sharp = (await import('sharp')).default;
    while (q.length) {
      const j = q.shift(); const f = path.join(DIR, 'img', j.bid, `${String(j.pn).padStart(5, '0')}.jpg`);
      if (fs.existsSync(f)) { done++; continue; }
      try {
        let buf = await fetchImage(j.url, 90000); const m = await sharp(buf).metadata();
        if (m.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
        else if (m.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); done++;
      } catch (e) { failed++; j.error = String(e.message).slice(0, 100); }
      if ((done + failed) % 500 === 0) console.log(`  ${done + failed}/${jobs.length} (${failed} failed)`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const lines = [];
  for (const p of reg.pages.filter(p => !p.retired)) { const src = path.join(BENCH, `${p.slug}.jpg`); const dst = path.join(DIR, 'img', '_bench', `${p.slug}.jpg`); if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); lines.push(`_bench\t${p.slug}\timg/_bench/${p.slug}.jpg`); }
  for (const bid of books) for (const j of jobs.filter(x => x.bid === bid && !x.error)) lines.push(`${bid}\t${String(j.pn).padStart(5, '0')}\timg/${bid}/${String(j.pn).padStart(5, '0')}.jpg`);
  fs.writeFileSync(path.join(DIR, 'manifest.tsv'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(DIR, 'books.json'), JSON.stringify({ seed: SEED, drawn_at: new Date().toISOString(), rule: 'held books whose sealed chinese-cohort-5547 page is eye-classified manuscript-regular; Mulberry32(5547) draw without replacement over the id-sorted pool', pool: pool.length, books: bookRows, fetch_failed: jobs.filter(j => j.error).map(j => ({ bid: j.bid, pn: j.pn, error: j.error })) }, null, 1));
  console.log(`manifest: ${lines.length} images (${reg.pages.filter(p => !p.retired).length} bench + ${jobs.length - failed} book pages); fetch failed ${failed}`);
}

function report() {
  const OUT = path.join(DIR, 'out');
  const books = JSON.parse(fs.readFileSync(path.join(DIR, 'books.json'), 'utf8'));
  const box = fs.existsSync(path.join(DIR, 'box.json')) ? JSON.parse(fs.readFileSync(path.join(DIR, 'box.json'), 'utf8')) : {};
  const timings = fs.existsSync(path.join(DIR, 'timings.jsonl')) ? fs.readFileSync(path.join(DIR, 'timings.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  const per = { bench: { pages: 0, empty: 0, error: 0, loop: 0 }, books: [] };
  const tOf = new Map(timings.map(t => [`${t.bid}/${t.pn}`, t]));
  const read = (bid, pn) => { const f = path.join(OUT, bid, `${pn}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const hanCount = s => [...(s || '')].filter(c => /\p{Script=Han}/u.test(c)).length;
  const loopPages = [];
  for (const b of books.books) {
    const dir = path.join(OUT, b.book_id);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.txt')) : [];
    const expected = fs.readdirSync(path.join(DIR, 'img', b.book_id)).filter(f => f.endsWith('.jpg')).length;
    let empty = 0, error = 0, loop = 0, han = 0;
    for (const f of files) {
      const t = fs.readFileSync(path.join(dir, f), 'utf8'); const pn = f.replace(/\.txt$/, '');
      const tm = tOf.get(`${b.book_id}/${pn}`);
      if (tm?.error) error++;
      else if (hanCount(t) < 10) empty++;
      const v = loopVerdict(t); if (v.loop) { loop++; loopPages.push(`${b.book_id}/${pn}`); }
      han += hanCount(t);
    }
    per.books.push({ book_id: b.book_id, title: b.title, expected, read: files.length, complete: files.length >= expected, empty, error, loop, han_chars: han });
  }
  const benchDir = path.join(OUT, '_bench');
  if (fs.existsSync(benchDir)) for (const f of fs.readdirSync(benchDir).filter(f => f.endsWith('.txt'))) { const t = fs.readFileSync(path.join(benchDir, f), 'utf8'); per.bench.pages++; if (hanCount(t) < 10) per.bench.empty++; if (loopVerdict(t).loop) per.bench.loop++; if (tOf.get(`_bench/${f.replace(/\.txt$/, '')}`)?.error) per.bench.error++; }
  const complete = per.books.filter(b => b.complete);
  const pagesDone = per.books.reduce((s, b) => s + b.read, 0) + per.bench.pages;
  const okTimes = timings.filter(t => !t.error && t.secs != null).map(t => t.secs).sort((a, b) => a - b);
  const wall = box.infer_secs || null;
  const eurH = parseFloat(argOf('eur-per-hour', '0.7875')); const billedMin = parseFloat(argOf('billed-min', '0')) || null;
  // writer dry-run: the $set a Paddle lane would write, shaped like the NDL/Kraken lanes', checked by the production provenance checker
  const sample = complete.slice(0, 5).map(b => { const f = fs.readdirSync(path.join(OUT, b.book_id)).filter(x => x.endsWith('.txt')).sort()[3]; const text = fs.readFileSync(path.join(OUT, b.book_id, f), 'utf8'); return { book_id: b.book_id, pn: f.replace(/\.txt$/, ''), text }; });
  const dry = sample.map(s => {
    const set = { data: s.text, content_hash: contentHash(s.text), language: 'Chinese', model: `paddleocr-vl/${box.paddleocr_version || 'unknown'}`, source: 'paddle', updated_at: new Date(),
      engine: { name: 'PaddleOCR-VL', model: box.vl_model || 'PaddleOCR-VL', version: box.paddleocr_version || null, licence: 'Apache-2.0', run: { issue: 5547, host: box.host || null, gpu: box.gpu || null } } };
    return { book_id: s.book_id, page: s.pn, chars: s.text.length, loop_guard: loopVerdict(s.text), provenance_missing: missingProvenance('ocr', set) };
  });
  const rep = {
    generated_at: new Date().toISOString(), box,
    time_box: { books_drawn: books.books.length, books_complete: complete.length, pages_read: pagesDone, bench_pages_read: per.bench.pages, book_pages_read: pagesDone - per.bench.pages, book_pages_in_complete_books: complete.reduce((s, b) => s + b.read, 0) },
    throughput: { infer_wall_secs: wall, wall_secs_per_page: wall && pagesDone ? +(wall / pagesDone).toFixed(2) : null, worker_secs_per_page_median: okTimes.length ? okTimes[okTimes.length >> 1] : null, worker_secs_p90: okTimes.length ? okTimes[Math.floor(okTimes.length * 0.9)] : null, workers: box.workers || null },
    failures: { error_pages: timings.filter(t => t.error).length, empty_pages_books: per.books.reduce((s, b) => s + b.empty, 0), loop_pages_books: per.books.reduce((s, b) => s + b.loop, 0), bench: per.bench, loop_pages: loopPages.slice(0, 50) },
    cost: { eur_per_hour: eurH, billed_minutes: billedMin, eur_billed: billedMin ? +(billedMin / 60 * eurH).toFixed(2) : null, eur_per_page_at_wall: wall && pagesDone ? +((wall / 3600 * eurH) / pagesDone).toFixed(6) : null, eur_per_page_billed: billedMin && pagesDone ? +((billedMin / 60 * eurH) / pagesDone).toFixed(6) : null },
    writer_dry_run: dry,
    books: per.books,
  };
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(rep, null, 1));
  const { books: _b, writer_dry_run, ...head } = rep; console.log(JSON.stringify(head, null, 1)); console.log(JSON.stringify(writer_dry_run.map(d => ({ ...d, loop_guard: d.loop_guard.loop })), null, 1));
}

if (CMD === 'prep') prep().catch(e => { console.error(e); process.exit(1); });
else if (CMD === 'report') report();
else { console.error('usage: prep | report'); process.exit(2); }
