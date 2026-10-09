#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/zh-cohort-5547-pilot.mjs (#5547 — Paddle pilot: manifest.tsv → box → out/<bid>/<pn>.txt,
 * images fetched before any GPU boots; borrowed here unchanged in shape), scripts/eval/benchmark-seal.mjs (seals a
 * stratum from a DB draw, but its references come from benchmark-refs.mjs e-text windows, while this frame's reference
 * is already ON the page: `ocr.data` of pages fitted from CBETA by #5566), scripts/eval/lib/private-refs.mjs (the
 * scored-but-never-published reference split, used as is). None builds a stratum whose reference is a fitted typed text.
 *
 * #6101 — CBETA as a REFERENCE instrument for Chinese print. The 66 visible CBETA books (#5566) carry pages whose
 * `ocr.source = 'cbeta-xml-p5'`: CBETA's typed text fitted to OUR scan of the same edition. CBETA is CC BY-NC-SA: it is
 * used to score, never committed. Every text file this script writes goes under --dir (Hetzner), never the repo.
 *
 *   frame     list the frame (visible books, pages with ocr.source cbeta-xml-p5, page_number > 0); write each page's
 *             CBETA text to <dir>/refs-private/<slug>.txt and frame.json (no text). Reads Mongo, writes nothing to it.
 *   fetch     page images → <dir>/img/<slug>.jpg (≤ 2400 px wide, what every benchmark engine sees); manifest.tsv for
 *             the Paddle box with the SEALED pages first.
 *   seal      Mulberry32(6101) draw of 200 pages, round-robin over the 54 PRINT books (≈ 3–4 per book: one per book
 *             is not possible at 200); writes the registry scripts/eval/benchmark/chinese-print-cbeta.json, the public reference
 *             records (bundle + per-slug, text_location private), and the bench tree <dir>/bench/chinese-print-cbeta.
 *   all       the same layout for EVERY frame page as stratum chinese-print-cbeta-all under <dir>/bench-all (Paddle
 *             only; registry written to scripts/eval/benchmark/ for scoring and NOT committed — see the experiment file).
 *   paddle    copy Paddle's box output (<dir>/pv/out/<bid>/<pn>.txt) into both bench trees as engine paddleocr-vl-1.6.
 *   controls  stratum chinese-print-cbeta-controls: 5 sealed pages, engine `control-self` (the reference itself, CER 0
 *             expected) and `control-neighbour` (the NEXT frame page's reference, high CER expected).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/cbeta-ref-6101.mjs frame|fetch|seal|all|paddle|controls [--dir=/root/cbeta-ref-6101]
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { getPageSource } from '../lib/page-image-url.mjs';
import { binomTwoSided } from './lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const CMD = process.argv[2];
const DIR = argOf('dir', '/root/cbeta-ref-6101');
const BOOKS_FROM = argOf('books-from', '/root/cbeta-5566/report.json');   // #5566's done table: the 79 books it fitted
const STRATUM = 'chinese-print-cbeta';
const N_SEAL = 200, SEED = 6101, MAX_WIDTH = 2400;
const ENGINE_PADDLE = 'paddleocr-vl-1.6';
const PRIV = path.join(DIR, 'refs-private');
const REG = path.join(__dirname, 'benchmark', `${STRATUM}.json`);
const REFS = path.join(__dirname, 'benchmark', 'refs');
const LICENCE = 'CC BY-NC-SA 4.0 (CBETA)';
const sha256 = t => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const slugOf = (bid, pn) => `${STRATUM}-${bid.slice(-6)}-p${pn}`;

// The reference as scored. CBETA's conventions (ocr.text_edition.conventions): inline notes in （）, Taishō/CBETA
// punctuation, gaiji as 〔composition〕 where Unicode has no character. The scorer's CJK normaliser keeps Han/kana
// only, so punctuation and the （） brackets are dropped there (the note TEXT stays: it is printed on the page as
// small double-line characters). A 〔…〕 composition stands for ONE printed character: it becomes one 〇 here, so it
// costs any engine one substitution instead of three-plus spurious ones.
const refForScoring = t => String(t || '').replace(/〔[^〔〕]{1,12}〕/g, '〇');

const frameFile = path.join(DIR, 'frame.json');
const readFrame = () => JSON.parse(fs.readFileSync(frameFile, 'utf8'));

async function frame() {
  const { MongoClient } = await import('mongodb');
  const ids = [...new Set(JSON.parse(fs.readFileSync(BOOKS_FROM, 'utf8')).map(r => r.book))].sort();
  const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
  const books = await db.collection('books').find({ id: { $in: ids } }, { projection: { id: 1, title: 1, visible: 1, pages_count: 1, language: 1, published: 1, year: 1 } }).toArray();
  const live = books.filter(b => b.visible === true && b.pages_count > 0).sort((a, b) => a.id.localeCompare(b.id));
  fs.mkdirSync(PRIV, { recursive: true });
  const PROJ = { page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.content_hash': 1, 'ocr.text_edition.cbeta_id': 1, 'ocr.text_edition.lines': 1 };
  const pages = []; const bookRows = []; const nonHan = new Map();
  for (const b of live) {
    const ps = await db.collection('pages').find({ book_id: b.id, 'ocr.source': 'cbeta-xml-p5', page_number: { $gt: 0 } }, { projection: PROJ, maxTimeMS: 60000 }).sort({ page_number: 1 }).toArray();
    if (!ps.length) continue;
    for (const p of ps) {
      const slug = slugOf(b.id, p.page_number);
      const text = refForScoring(p.ocr.data);
      fs.writeFileSync(path.join(PRIV, `${slug}.txt`), text);
      for (const ch of text) if (!/[\p{Script=Han}\s]/u.test(ch)) nonHan.set(ch, (nonHan.get(ch) || 0) + 1);
      pages.push({ slug, book_id: b.id, page_number: p.page_number, image_url: getPageSource(p), cbeta_id: p.ocr.text_edition?.cbeta_id || null, cbeta_lines: p.ocr.text_edition?.lines || null, ocr_content_hash: p.ocr.content_hash || null, ref_sha256: sha256(text), ref_chars: [...text].filter(ch => /\p{Script=Han}/u.test(ch)).length });
    }
    bookRows.push({ book_id: b.id, title: b.title, language: b.language, pages_count: b.pages_count, frame_pages: ps.length, published: b.published ?? b.year ?? null });
  }
  await c.close();
  fs.writeFileSync(frameFile, JSON.stringify({ issue: 6101, built_at: new Date().toISOString(), rule: "books: #5566's 79 fitted books (report.json) that are visible:true && pages_count > 0; pages: ocr.source = 'cbeta-xml-p5' && page_number > 0", books: bookRows, pages }, null, 1));
  console.log(`frame: ${bookRows.length} visible books, ${pages.length} pages; no image: ${pages.filter(p => !p.image_url).length}; image hosts: ${JSON.stringify(pages.reduce((m, p) => { const h = p.image_url ? new URL(p.image_url).host : 'none'; m[h] = (m[h] || 0) + 1; return m; }, {}))}`);
  console.log('non-Han characters in the references (top 30):', [...nonHan].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([c, n]) => `${c}:${n}`).join(' '));
}

async function fetchAll() {
  const fr = readFrame();
  const sharp = (await import('sharp')).default;
  fs.mkdirSync(path.join(DIR, 'img'), { recursive: true });
  const jobs = fr.pages.filter(p => p.image_url);
  // NDL's IIIF server answered 403 at concurrency 2 (#5566), so its host runs one at a time; R2 runs 8.
  const lanes = { r2: jobs.filter(j => !/ndl\.go\.jp/.test(j.image_url)), ndl: jobs.filter(j => /ndl\.go\.jp/.test(j.image_url)) };
  let done = 0, failed = 0; const fails = [];
  const worker = q => async () => {
    while (q.length) {
      const j = q.shift(); const f = path.join(DIR, 'img', `${j.slug}.jpg`);
      if (fs.existsSync(f)) { done++; continue; }
      let ok = false;
      for (let a = 0; a < 3 && !ok; a++) {
        try {
          const r = await fetch(j.image_url, { signal: AbortSignal.timeout(90000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
          let buf = Buffer.from(await r.arrayBuffer()); const m = await sharp(buf).metadata();
          if (m.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
          else if (m.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
          fs.writeFileSync(f, buf); ok = true; done++;
        } catch (e) { if (a === 2) { failed++; fails.push({ slug: j.slug, url: j.image_url, error: String(e.message).slice(0, 100) }); } else await new Promise(r => setTimeout(r, 5000 * (a + 1))); }
      }
      if ((done + failed) % 250 === 0) console.log(`  ${done + failed}/${jobs.length} (${failed} failed)`);
    }
  };
  await Promise.all([...Array.from({ length: 8 }, worker(lanes.r2)), worker(lanes.ndl)()]);
  fs.writeFileSync(path.join(DIR, 'fetch-failed.json'), JSON.stringify(fails, null, 1));
  console.log(`fetched ${done}, failed ${failed} (no image url: ${fr.pages.length - jobs.length})`);
}

function writeTree(root, stratum, pages) {
  const d = path.join(root, stratum); fs.mkdirSync(d, { recursive: true });
  for (const p of pages) { const dst = path.join(d, `${p.slug}.jpg`); if (!fs.existsSync(dst)) fs.copyFileSync(path.join(DIR, 'img', `${p.slug}.jpg`), dst); }
  fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ stratum, exported_at: new Date().toISOString(), pages: pages.map(p => ({ slug: p.slug, bytes: fs.statSync(path.join(d, `${p.slug}.jpg`)).size })) }, null, 2));
}
const classes = () => { const f = path.join(DIR, 'book-class.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {}; };
function regRow(p, fr, cls) {
  const b = fr.books.find(x => x.book_id === p.book_id);
  return { slug: p.slug, book_id: p.book_id, page_number: p.page_number, substratum: cls[p.book_id]?.script_class || null, observed_substratum: cls[p.book_id]?.script_class || null, title: b?.title || null, year: null, published: b?.published ?? null, language: 'Chinese', cbeta_id: p.cbeta_id, cbeta_lines: p.cbeta_lines, ref_sha256: p.ref_sha256, ref_chars: p.ref_chars, image_url: p.image_url };
}
function writeRefRecord(p, stratum) {
  return { slug: p.slug, stratum, source: 'CBETA XML P5, fitted to this page by #5566 (pages.ocr, source cbeta-xml-p5)', work: p.cbeta_id, lines: p.cbeta_lines, text_location: 'private', text_sha256: p.ref_sha256, licence: LICENCE, licence_url: 'https://www.cbeta.org/copyright.php', licence_note: 'Scored, never published (#5488, #6101): the text lives on the Hetzner box only.', normalisation: '〔composition〕 gaiji → 〇; the scorer keeps Han/kana only, so CBETA punctuation and the （） around inline notes are dropped' };
}

function seal() {
  const fr = readFrame(); const cls = classes();
  const have = new Set(fs.readdirSync(path.join(DIR, 'img')).map(f => f.replace(/\.jpg$/, '')));
  // Pages with too little reference text to score (a title strip, a colophon line) are not drawn: ≥ 30 Han characters.
  // PRINT books only (by-eye class, <dir>/book-class.json): 12 of the 66 frame books are the Siku Quanshu MANUSCRIPT
  // copy of 五燈會元 (X1565), already measured at n=433 by #5547. They get Paddle on every page, not the shared draw.
  if (!Object.keys(cls).length) throw new Error('book-class.json missing: classify the books by eye before sealing');
  const pool = fr.pages.filter(p => have.has(p.slug) && p.ref_chars >= 30 && /^(woodblock|typeset)$/.test(cls[p.book_id]?.script_class || ''));
  const rnd = mulberry32(SEED);
  const byBook = new Map(); for (const p of pool) { if (!byBook.has(p.book_id)) byBook.set(p.book_id, []); byBook.get(p.book_id).push(p); }
  const order = [...byBook.keys()].sort();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  for (const b of order) { const a = byBook.get(b); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }
  const drawn = [];
  for (let round = 0; drawn.length < N_SEAL; round++) {
    let any = false;
    for (const b of order) { const a = byBook.get(b); if (a[round] && drawn.length < N_SEAL) { drawn.push(a[round]); any = true; } }
    if (!any) break;
  }
  const reg = { stratum: STRATUM, issue: 6101, seed: SEED, sealed_at: new Date().toISOString(), max_width: MAX_WIDTH,
    draw_rule: `Mulberry32(${SEED}): the frame's PRINT books (by-eye class woodblock or typeset) shuffled, each book's pages shuffled, then round-robin one page per book per round until ${N_SEAL} (54 print books → 3 or 4 per book). Pool: print-book frame pages with an image and ≥ 30 Han characters of reference.`, book_class: 'by eye, one mid-book page per book (book-class.json in results/cbeta-ref-6101/)',
    frame: { books: fr.books.length, pages: fr.pages.length, pool: pool.length, rule: fr.rule },
    reference_plan: 'CBETA XML P5 (CC BY-NC-SA 4.0) as fitted to the page by #5566; text private (Hetzner), sha256 public',
    pages: drawn.map(p => regRow(p, fr, cls)) };
  fs.writeFileSync(REG, JSON.stringify(reg, null, 1) + '\n');
  fs.mkdirSync(REFS, { recursive: true });
  const bundle = drawn.map(p => JSON.stringify({ slug: p.slug, record: writeRefRecord(p, STRATUM) })).join('\n') + '\n';
  fs.writeFileSync(path.join(REFS, `${STRATUM}.refs.jsonl`), bundle);
  for (const p of drawn) fs.writeFileSync(path.join(REFS, `${p.slug}.json`), JSON.stringify(writeRefRecord(p, STRATUM), null, 2));
  writeTree(path.join(DIR, 'bench'), STRATUM, drawn);
  // the Paddle manifest: sealed pages first, then every other frame page by book
  const sealed = new Set(drawn.map(p => p.slug));
  const rest = fr.pages.filter(p => have.has(p.slug) && !sealed.has(p.slug));
  const rows = [...drawn, ...rest].map(p => `${p.book_id}\t${String(p.page_number).padStart(5, '0')}\timg/${p.slug}.jpg`);
  fs.mkdirSync(path.join(DIR, 'pv'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'pv', 'manifest.tsv'), rows.join('\n') + '\n');
  const per = new Map(); for (const p of drawn) per.set(p.book_id, (per.get(p.book_id) || 0) + 1);
  console.log(`sealed ${drawn.length} pages from ${per.size} books (per book ${Math.min(...per.values())}–${Math.max(...per.values())}); Paddle manifest ${rows.length} rows`);
}

function all() {
  const fr = readFrame(); const cls = classes();
  const have = new Set(fs.readdirSync(path.join(DIR, 'img')).map(f => f.replace(/\.jpg$/, '')));
  const pages = fr.pages.filter(p => have.has(p.slug)).map(p => ({ ...p, slug: p.slug.replace(STRATUM, `${STRATUM}-all`) }));
  for (const p of pages) { const src = path.join(PRIV, `${p.slug.replace(`${STRATUM}-all`, STRATUM)}.txt`); fs.copyFileSync(src, path.join(PRIV, `${p.slug}.txt`)); }
  fs.writeFileSync(path.join(__dirname, 'benchmark', `${STRATUM}-all.json`), JSON.stringify({ stratum: `${STRATUM}-all`, issue: 6101, note: 'NOT COMMITTED: the every-page Paddle pass; scored locally, compact per-page results committed under results/cbeta-ref-6101/', pages: pages.map(p => regRow(p, fr, cls)) }, null, 1));
  for (const p of pages) fs.writeFileSync(path.join(REFS, `${p.slug}.json`), JSON.stringify(writeRefRecord(p, `${STRATUM}-all`)));
  const d = path.join(DIR, 'bench-all', `${STRATUM}-all`); fs.mkdirSync(d, { recursive: true });
  for (const p of pages) { const dst = path.join(d, `${p.slug}.jpg`); if (!fs.existsSync(dst)) fs.linkSync(path.join(DIR, 'img', `${p.slug.replace(`${STRATUM}-all`, STRATUM)}.jpg`), dst); }
  console.log(`all: ${pages.length} pages`);
}

function paddle() {
  const fr = readFrame(); const OUT = path.join(DIR, 'pv', 'out');
  const timings = new Map();
  for (const f of fs.readdirSync(path.join(DIR, 'pv', 'box')).filter(f => /^timings-\d+\.jsonl$/.test(f))) for (const l of fs.readFileSync(path.join(DIR, 'pv', 'box', f), 'utf8').split('\n').filter(Boolean)) { const t = JSON.parse(l); if (t.bid) timings.set(`${t.bid}/${t.pn}`, t); }
  let n = 0, err = 0;
  const targets = [[path.join(DIR, 'bench', STRATUM, 'out', ENGINE_PADDLE), s => s, new Set(JSON.parse(fs.readFileSync(REG, 'utf8')).pages.map(p => p.slug))],
    [path.join(DIR, 'bench-all', `${STRATUM}-all`, 'out', ENGINE_PADDLE), s => s.replace(STRATUM, `${STRATUM}-all`), null]];
  for (const [d] of targets) fs.mkdirSync(d, { recursive: true });
  const meters = targets.map(() => []);
  for (const p of fr.pages) {
    const pn = String(p.page_number).padStart(5, '0'); const f = path.join(OUT, p.book_id, `${pn}.txt`);
    if (!fs.existsSync(f)) continue;
    const t = timings.get(`${p.book_id}/${pn}`); if (t?.error) err++;
    n++;
    targets.forEach(([d, rename, only], i) => {
      if (only && !only.has(p.slug)) return;
      fs.copyFileSync(f, path.join(d, `${rename(p.slug)}.txt`));
      meters[i].push(JSON.stringify({ slug: rename(p.slug), engine: ENGINE_PADDLE, finishReason: t?.error ? 'ERROR' : 'STOP', secs: t?.secs ?? null, error: t?.error || null }));
    });
  }
  targets.forEach(([d], i) => fs.writeFileSync(path.join(d, '_meter.jsonl'), meters[i].join('\n') + '\n'));
  console.log(`paddle: ${n} pages copied (${err} timed out / errored)`);
}

function controls() {
  const fr = readFrame(); const reg = JSON.parse(fs.readFileSync(REG, 'utf8'));
  const st = `${STRATUM}-controls`; const rnd = mulberry32(SEED + 1);
  const pick = [...reg.pages].sort((a, b) => a.slug.localeCompare(b.slug)); const five = [];
  while (five.length < 5) five.push(pick.splice(Math.floor(rnd() * pick.length), 1)[0]);
  const idx = new Map(fr.pages.map((p, i) => [p.slug, i]));
  const d = path.join(DIR, 'bench-controls', st);
  for (const e of ['control-self', 'control-neighbour']) fs.mkdirSync(path.join(d, 'out', e), { recursive: true });
  const rows = [];
  for (const p of five) {
    const cs = p.slug.replace(STRATUM, st);
    fs.copyFileSync(path.join(DIR, 'img', `${p.slug}.jpg`), path.join(d, `${cs}.jpg`));
    fs.copyFileSync(path.join(PRIV, `${p.slug}.txt`), path.join(PRIV, `${cs}.txt`));
    fs.writeFileSync(path.join(REFS, `${cs}.json`), JSON.stringify(writeRefRecord(fr.pages[idx.get(p.slug)], st)));
    const self = fs.readFileSync(path.join(PRIV, `${p.slug}.txt`), 'utf8');
    // the neighbour: the next frame page of the same book (else the previous one)
    const i = idx.get(p.slug); const nb = fr.pages[i + 1]?.book_id === p.book_id ? fr.pages[i + 1] : fr.pages[i - 1];
    fs.writeFileSync(path.join(d, 'out', 'control-self', `${cs}.txt`), self);
    fs.writeFileSync(path.join(d, 'out', 'control-neighbour', `${cs}.txt`), fs.readFileSync(path.join(PRIV, `${nb.slug}.txt`), 'utf8'));
    rows.push({ ...p, slug: cs, neighbour: nb.slug });
  }
  fs.writeFileSync(path.join(__dirname, 'benchmark', `${st}.json`), JSON.stringify({ stratum: st, issue: 6101, note: 'NOT COMMITTED: positive/negative scorer controls', pages: rows }, null, 1));
  console.log(`controls: ${rows.map(r => `${r.slug} (neighbour ${r.neighbour})`).join(', ')}`);
}

// ── report: the scorer's page rows → intervals that respect the draw (3–4 pages per book), and the committed files ──
const median = xs => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
function wilson(k, n, z = 1.96) { if (!n) return null; const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [r3(c - h), r3(c + h)]; }
/** Book-cluster bootstrap: resample BOOKS with replacement, take every page of each drawn book, apply stat. */
function clusterCI(rows, stat, seed = SEED, B = 2000) {
  const books = [...new Set(rows.map(r => r.book))]; const by = new Map(books.map(b => [b, rows.filter(r => r.book === b)]));
  const rnd = mulberry32(seed); const vals = [];
  for (let i = 0; i < B; i++) { const s = []; for (let j = 0; j < books.length; j++) s.push(...by.get(books[Math.floor(rnd() * books.length)])); const v = stat(s); if (v != null) vals.push(v); }
  vals.sort((a, b) => a - b); return vals.length ? [r3(vals[Math.floor(0.025 * vals.length)]), r3(vals[Math.floor(0.975 * vals.length)])] : null;
}
const latestScored = (dir, st) => { const f = fs.readdirSync(dir).filter(x => new RegExp(`^${st}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(x)).sort().at(-1); return f ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null; };

function report() {
  const OUT = path.join(__dirname, 'results', 'cbeta-ref-6101'); fs.mkdirSync(OUT, { recursive: true });
  const reg = JSON.parse(fs.readFileSync(REG, 'utf8')); const bookOf = new Map(reg.pages.map(p => [p.slug, p.book_id]));
  // --scored=<dir> --tag=<name>: the same report over another scoring of the same pages (the label-stripped sensitivity run)
  const SCORED = argOf('scored', path.join(__dirname, 'results', 'benchmark')); const TAG = argOf('tag', '');
  const shared = latestScored(SCORED, STRATUM);
  const ENGINES = ['paddleocr-vl-1.6', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
  const res = { issue: 6101, generated_at: new Date().toISOString().slice(0, 10), stratum: STRATUM, n_sealed: reg.pages.length, n_books: new Set(reg.pages.map(p => p.book_id)).size,
    note: 'CER against CBETA fitted to the page, Han only. CIs: book-cluster bootstrap (2,000 resamples, seed 6101) for medians and paired deltas; Wilson for rates (page-level, so slightly narrow).', shared: null, all_pages: null };
  if (shared) {
    const pages = shared.pages;
    const misfit = pages.filter(p => p.ref_mismatch).map(p => p.slug);
    const scorable = pages.filter(p => p.has_ref && ENGINES.every(e => p.engines[e] && !p.engines[e].missing));
    const answered = scorable.filter(p => ENGINES.every(e => !p.engines[e].refused));
    const per = {};
    for (const e of ENGINES) {
      const rows = answered.map(p => ({ book: bookOf.get(p.slug), cer: p.engines[e].cer, inv: p.engines[e].invention_ref, loop: p.engines[e].loop }));
      const cat = rows.filter(r => r.cer > 0.5).length; const ran = pages.filter(p => p.engines[e] && !p.engines[e].missing);
      per[e] = { n: rows.length, median_cer: r3(median(rows.map(r => r.cer))), median_cer_ci95: clusterCI(rows, s => median(s.map(r => r.cer))), mean_cer: r3(rows.reduce((a, r) => a + r.cer, 0) / rows.length),
        catastrophic: cat, catastrophic_rate: r3(cat / rows.length), catastrophic_ci95: wilson(cat, rows.length), invention_ref_median: r3(median(rows.map(r => r.inv).filter(x => x != null))),
        loops: rows.filter(r => r.loop).length, refused: ran.filter(p => p.engines[e].refused).length, empty: ran.filter(p => p.engines[e].empty && !p.engines[e].refused).length };
    }
    const paired = (a, b) => {   // Δ = CER(b) − CER(a): positive means a reads better
      const rows = answered.map(p => ({ book: bookOf.get(p.slug), d: p.engines[b].cer - p.engines[a].cer }));
      const w = rows.filter(r => r.d > 1e-9).length, l = rows.filter(r => r.d < -1e-9).length;
      return { a, b, n: rows.length, a_wins: w, a_losses: l, ties: rows.length - w - l, median_delta_b_minus_a: r3(median(rows.map(r => r.d))), ci95: clusterCI(rows, s => median(s.map(r => r.d))), p_sign: r3(binomTwoSided(Math.max(w, l), w + l)) };
    };
    const byClass = {};
    for (const c of ['woodblock', 'typeset']) {
      const cp = answered.filter(p => p.script_class === c); byClass[c] = { n: cp.length, engines: {} };
      for (const e of ENGINES) { const v = cp.map(p => p.engines[e].cer); byClass[c].engines[e] = { median_cer: r3(median(v)), catastrophic: v.filter(x => x > 0.5).length }; }
    }
    res.shared = { scored_file: TAG ? `${SCORED}/${STRATUM}-${shared.summary.date}.json (Hetzner; not committed)` : `scripts/eval/results/benchmark/${STRATUM}-${shared.summary.date}.json`, n_pages_scored: pages.length, reference_misfit: misfit, n_all_three_answered: answered.length,
      n_books_answered: new Set(answered.map(p => bookOf.get(p.slug))).size, engines: per,
      paired: [paired('gemini-3.1-flash-lite', 'paddleocr-vl-1.6'), paired('gemini-3.1-flash-lite', 'gemini-3-flash-preview'), paired('gemini-3-flash-preview', 'paddleocr-vl-1.6')].map(x => ({ ...x, reading: `Δ = CER(${x.b}) − CER(${x.a}); negative = ${x.b} better` })),
      by_class: byClass, textless: shared.summary.textless };
  }
  const allDir = argOf('scored-all', path.join(DIR, 'scored-all'));
  const all = fs.existsSync(allDir) ? latestScored(allDir, `${STRATUM}-all`) : null;
  if (all) {
    const cls = classes(); const fr = readFrame(); const sha = new Map(fr.pages.map(p => [`${STRATUM}-all${p.slug.slice(STRATUM.length)}`, p]));
    // The scorer drops a page as TEXTLESS when every engine returns < 30 content characters; with Paddle alone that is
    // Paddle's own failure (a 90 s timeout, an empty read, or the NDL label strip read instead of the page) on a page whose
    // reference has text. Those pages are put back here as failures, never left out of n.
    const meterAll = new Map(); const mf = path.join(DIR, 'bench-all', `${STRATUM}-all`, 'out', ENGINE_PADDLE, '_meter.jsonl');
    if (fs.existsSync(mf)) for (const l of fs.readFileSync(mf, 'utf8').split('\n').filter(Boolean)) { const m = JSON.parse(l); meterAll.set(m.slug, m); }
    const base = (slug, f) => ({ slug: slug.replace(`${STRATUM}-all`, STRATUM), book: f.book_id, pn: f.page_number, class: cls[f.book_id]?.script_class, ref_chars: f.ref_chars, timeout: !!meterAll.get(slug)?.error, ref_sha256: f.ref_sha256 });
    const rows = [
      ...all.pages.map(p => { const e = p.engines[ENGINE_PADDLE] || {}; return { ...base(p.slug, sha.get(p.slug)), has_ref: p.has_ref, failed_no_text: false, misfit_or_cat: !!p.ref_mismatch, cer: p.has_ref ? e.cer : null, loop: !!e.loop, empty: !!e.empty }; }),
      ...all.summary.textless.filter(slug => meterAll.has(slug)).map(slug => ({ ...base(slug, sha.get(slug)), has_ref: false, failed_no_text: sha.get(slug).ref_chars >= 30, misfit_or_cat: false, cer: null, loop: false, empty: true })),
    ];
    const summ = {};
    for (const c of ['woodblock', 'typeset', 'manuscript-regular', 'all']) {
      const rs = rows.filter(r => c === 'all' || r.class === c); const ref = rs.filter(r => r.has_ref);
      summ[c] = { n_pages: rs.length, n_books: new Set(rs.map(r => r.book)).size, scored: ref.length, median_cer: r3(median(ref.map(r => r.cer))), median_cer_ci95: clusterCI(ref, s => median(s.map(r => r.cer))),
        cer_over_0_5_or_misfit: rs.filter(r => r.misfit_or_cat).length, no_text_on_text_page: rs.filter(r => r.failed_no_text).length, of_which_timeout: rs.filter(r => r.failed_no_text && r.timeout).length,
        textless_both: rs.filter(r => r.empty && !r.failed_no_text && !r.has_ref).length,
        failure_rate: r3(rs.filter(r => r.misfit_or_cat || r.failed_no_text).length / rs.filter(r => r.has_ref || r.misfit_or_cat || r.failed_no_text).length),
        failure_ci95: wilson(rs.filter(r => r.misfit_or_cat || r.failed_no_text).length, rs.filter(r => r.has_ref || r.misfit_or_cat || r.failed_no_text).length), loops: rs.filter(r => r.loop).length };
    }
    res.all_pages = { engine: ENGINE_PADDLE, pages_read: rows.length, not_reached: fr.pages.length - rows.length, order: 'sealed 200, then the other print pages in a seeded shuffle (seed 6102), manuscript last; read until the 5-hour box deadline', timeouts: rows.filter(r => r.timeout).length, by_class: summ, note: 'one engine: the misfit guard cannot separate a misread from a misfitted reference, so CER > 0.5 pages are counted together as cer_over_0_5_or_misfit; no_text_on_text_page = Paddle returned < 30 characters (timeout, empty, or the NDL label only) on a page whose reference has ≥ 30; failure = either' };
    fs.writeFileSync(path.join(OUT, `paddle-all-pages${TAG ? `-${TAG}` : ''}.jsonl`), rows.sort((a, b) => a.slug.localeCompare(b.slug)).map(r => JSON.stringify(r)).join('\n') + '\n');
  }
  if (TAG) res.variant = TAG;
  fs.writeFileSync(path.join(OUT, TAG ? `summary-${TAG}.json` : 'summary.json'), JSON.stringify(res, null, 1) + '\n');
  console.log(JSON.stringify(res, null, 1));
}

// SENSITIVITY (not preregistered; found while reading the worst pages): every NDL image carries the library's label strip
// under the book (国立国会図書館 / タイトル『…』 / 請求記号 … / ガラス使用). Paddle transcribes it on 193 of 200 sealed pages,
// Gemini on ≤ 6; the reference has no label, so it costs Paddle ~25 Han characters a page that are not page text.
// `nolabel` copies a bench tree with those lines removed from EVERY engine's output, for a second scoring.
const LABEL_LINE = /国立国会図書館|國立國會圖書館|請求記号|ガラス使用/;
function nolabel() {
  const src = argOf('from', path.join(DIR, 'bench')); const dst = argOf('to', path.join(DIR, 'bench-nolabel')); const st = argOf('stratum', STRATUM);
  const s = path.join(src, st), d = path.join(dst, st); fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(s).filter(f => f.endsWith('.jpg') || f === 'manifest.json')) if (!fs.existsSync(path.join(d, f))) fs.symlinkSync(path.join(s, f), path.join(d, f));
  let changed = 0;
  for (const e of fs.readdirSync(path.join(s, 'out'))) {
    fs.mkdirSync(path.join(d, 'out', e), { recursive: true });
    for (const f of fs.readdirSync(path.join(s, 'out', e))) {
      const t = fs.readFileSync(path.join(s, 'out', e, f), 'utf8');
      const o = f.endsWith('.txt') ? t.split('\n').filter(l => !LABEL_LINE.test(l)).join('\n') : t;
      if (o !== t) changed++;
      fs.writeFileSync(path.join(d, 'out', e, f), o);
    }
  }
  console.log(`nolabel: ${st} → ${d}; ${changed} outputs had label lines removed`);
}

const CMDS = { frame, fetch: fetchAll, seal, all, paddle, controls, report, nolabel };
if (!CMDS[CMD]) { console.error(`usage: ${Object.keys(CMDS).join(' | ')}`); process.exit(2); }
await CMDS[CMD]();
