#!/usr/bin/env node
/**
 * latin-r4-refs-5924.mjs — the sample for round 4 of the open-engine bake-off, Latin print (#5924, parent #5660):
 * a random draw of BOOKS from every Latin edition we hold that has a same-edition transcription, one run of
 * 3 consecutive pages per book from a uniformly random start, plus a reference-free draw from the OCR queue.
 *
 * PRIOR ART: latin-period-refs-5126.mjs — edition files (flattenTei / decodeLenient / wikisourceEdition are
 * imported from it, unchanged). build-edition-refs.mjs — cuts a window with the STORED OCR as probe; that needs
 * stored OCR, fails where the stored OCR is another leaf's (#3368), and favours pages the served engine (lite,
 * an arm here) read well. Here the page is drawn first and located second, by Tesseract 5 `lat` (not an arm),
 * with the shared window cutter (lib/edition-window.mjs cutEditionWindow, pad 3) and record writer
 * (lib/private-refs.mjs). /root/ocr-bakeoff-5660c/tcp (round 3) matched EEBO-TCP by hand; that match is here.
 *
 *   node --env-file=.env.production.local scripts/eval/latin-r4-refs-5924.mjs <stage> --work=<dir> [...]
 *
 *   catalogue   every Latin book with pages → <work>/catalogue.json (+ queue counts)
 *   candidates  catalogue × {CAMENA works (--camena=<clone>), EEBO-TCP (--tcp=<TCP.csv>), la.wikisource Liber
 *               indexes} by year ± 1, title words, author → <work>/candidates.jsonl (book, edition) pairs
 *   editions    edition text + page-break offsets per source work → <work>/editions/<key>.{txt,pb.json}
 *   verify      per pair: up to 6 seeded interior pages with stored OCR (else 4 by Tesseract) located in the
 *               edition; same text = ≥ 2 pages with overlap ≥ 0.35; page-break evidence recorded
 *   pool        verified pairs → <work>/pool.json (one row per book, century by catalogue year)
 *   draw        seeded order of the pool per century + a uniform random start per book → <work>/draw.json
 *   align       for drawn books, in draw order: the 3 pages' images, Tesseract, window per page → worklist
 *   popdraw     the population sample from the Latin OCR queue (stratified 25/20/10/5/5) → <work>/popdraw.json
 *   export      images of every drawn run into a bench root (--root) in benchmark-score's layout
 *   write       <work>/leaf-check.json (by-eye verdicts) → benchmark/refs/r4l-<book>-p<n>.{json,txt}
 *
 * Never writes to Mongo. Makes no model call.
 */
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { flattenTei, decodeLenient, wikisourceEdition } from './latin-period-refs-5126.mjs';
import { cutEditionWindow, foldedWords, stripTags } from './lib/edition-window.mjs';
import { writePrivateRef, privateRefsDir, sha256 } from './lib/private-refs.mjs';
import { fetchImage } from './lib/runners.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const execFileP = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STAGE = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const WORK = args.work, SEED = 5924, MAX_WIDTH = 2400;
const RES = path.join(__dirname, 'results', 'open-engine-print-5660', 'r4');
const REFS = path.join(__dirname, 'benchmark', 'refs');
if (!STAGE || !WORK) { console.error('usage: <stage> --work=<dir>'); process.exit(1); }
fs.mkdirSync(WORK, { recursive: true });
const W = f => path.join(WORK, f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
const nat = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const shortId = id => String(id).replace(/[^0-9a-z]/gi, '');
const century = y => (y ? (y < 1500 ? '1400s' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : null) : 'undated');
const UA = { 'User-Agent': 'SourceLibraryEval/1.0 (https://sourcelibrary.org)' };
// Mulberry32, the house seeded generator (latin-period-refs-5126, build-edition-refs)
export function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const fnv = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const shuffle = (xs, seed) => { const r = rng(seed); return xs.map(x => ({ x, k: r() })).sort((a, b) => a.k - b.k).map(o => o.x); };

async function db() {
  const { MongoClient } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  return { client, db: client.db('bookstore') };
}

// ── catalogue ────────────────────────────────────────────────────────────────
// `published` → the first 14xx–17xx year (the issue's queue definition: pages_count by the first 1[4-9]xx year).
const yearOf = p => +((String(p ?? '').match(/1[4-7]\d\d/) || [])[0]) || null;
async function stageCatalogue() {
  const { client, db: d } = await db();
  const rows = await d.collection('books').find({ language: /latin|^lat$|^la$/i, pages_count: { $gt: 2 } }, { projection: {
    id: 1, title: 1, display_title: 1, author: 1, published: 1, publisher: 1, place_published: 1, pages_count: 1, visible: 1,
    hidden_reason: 1, duplicate_of: 1, language: 1, ia_identifier: 1, provider: 1, 'pipeline_next.step': 1 } }).toArray();
  const out = rows.map(b => ({ _id: String(b._id), id: b.id || String(b._id), title: b.title, display_title: b.display_title, author: b.author,
    published: b.published, year: yearOf(b.published), publisher: b.publisher, place: b.place_published, pages: b.pages_count, visible: !!b.visible,
    hidden_reason: b.hidden_reason ?? null, duplicate_of: b.duplicate_of ?? null, lang: b.language, ia: b.ia_identifier ?? null, provider: b.provider ?? null,
    next: b.pipeline_next?.step ?? null }));
  fs.writeFileSync(W('catalogue.json'), JSON.stringify(out));
  const q = {}; for (const b of out.filter(b => b.next === 'ocr')) { const k = century(b.year) || 'other'; (q[k] ||= { books: 0, pages: 0 }); q[k].books++; q[k].pages += b.pages; }
  console.log(`${out.length} Latin books; OCR queue by century`, q);
  await client.close();
}

// ── candidates ───────────────────────────────────────────────────────────────
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ſ/g, 's').replace(/j/g, 'i').replace(/v/g, 'u').replace(/æ/g, 'ae').replace(/œ/g, 'oe');
const STOP = new Set('et in de ad cum ex per quae qui quod libri liber libros tres duo quatuor sex septem octo nouem decem quinque item atque ac hoc est id siue seu nunc primum nuper editio editus edita opera omnia una his huic eius eorum ab non sunt ut uel the and of to for with that this from'.split(' '));
const toks = s => fold(s).split(/[^a-z]+/).filter(w => w.length > 3 && !STOP.has(w));
/** Catalogue match as the #5126 search did it: year ± 1, title words, author surname. Score ≥ 0.8 kept, top 3. */
function matchCatalogue(work, byYear) {
  const wt = new Set(toks(work.title)); const sur = fold(work.author).split(/[ ,;]+/).find(x => x.length > 3) || '';
  const out = [];
  for (const y of [work.year - 1, work.year, work.year + 1]) for (const b of byYear[y] || []) {
    const bt = toks(`${b.title} ${b.display_title || ''}`); if (!bt.length || !wt.size) continue;
    const inter = new Set(bt.filter(t => wt.has(t))).size; const auth = sur.length > 3 && fold(`${b.author} ${b.title}`).includes(sur);
    const s = inter / Math.max(3, Math.min(wt.size, new Set(bt).size)) + (auth ? 0.5 : 0) + (y === work.year ? 0.1 : 0);
    if (s >= 0.8) out.push({ s: +s.toFixed(2), auth, book: b.id, year: b.year, title: String(b.title).slice(0, 120) });
  }
  return out.sort((a, b) => b.s - a.s).slice(0, 3);
}
function camenaWorks(root) {
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.xml') ? [path.join(d, e.name)] : []);
  const works = {};
  for (const f of ['cera', 'historicapolitica', 'poemata', 'thesaurus'].flatMap(d => fs.existsSync(path.join(root, d)) ? walk(path.join(root, d)) : [])) {
    const x = fs.readFileSync(f, 'latin1'); const h = (x.match(/<teiHeader[\s\S]*?<\/teiHeader>/) || [''])[0];
    const g = re => ((h.match(re) || [])[1] || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const pathname = g(/<note type="pathname"[^>]*>([\s\S]*?)<\/note>/) || path.basename(f, '.xml');
    const key = `${path.relative(root, path.dirname(f))}/${pathname}`;
    const w = works[key] ||= { key, files: [], title: g(/<title[^>]*>([\s\S]*?)<\/title>/), author: g(/<author[^>]*>([\s\S]*?)<\/author>/), bibl: g(/<bibl[^>]*>([\s\S]*?)<\/bibl>/) };
    w.files.push(path.relative(root, f)); const y = w.bibl.match(/1[4-8]\d\d/); w.year = y ? +y[0] : null;
  }
  return Object.values(works).filter(w => w.year);
}
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
async function wsIndex() {
  const cache = W('ws-index.json'); if (fs.existsSync(cache)) return readJson(cache);
  const api = async p => { for (let i = 0; i < 4; i++) { try { const r = await fetch('https://la.wikisource.org/w/api.php?' + new URLSearchParams({ format: 'json', formatversion: '2', ...p }), { headers: UA, signal: AbortSignal.timeout(40000) }); if (r.ok) return r.json(); } catch { /* retry */ } await new Promise(r => setTimeout(r, 2000)); } throw new Error('la.wikisource api'); };
  const titles = []; let cont = {};
  do { const j = await api({ action: 'query', list: 'allpages', apnamespace: '106', aplimit: '500', ...cont }); titles.push(...j.query.allpages.map(p => p.title)); cont = j.continue || null; } while (cont);
  const out = [];
  for (let i = 0; i < titles.length; i += 20) {
    const j = await api({ action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main', titles: titles.slice(i, i + 20).join('|') });
    for (const p of j.query.pages) {
      const t = p.revisions?.[0]?.slots?.main?.content || '';
      const f = k => { const m = t.match(new RegExp('\\|\\s*' + k + '\\s*=\\s*([^\\n|]*)', 'i')); return m ? m[1].trim() : ''; };
      out.push({ liber: p.title, title: f('Titulus') || f('Title'), author: f('Auctor') || f('Author'), annus: f('Annus') || f('Year'), place: f('Locus'), printer: f('Typographus') || f('Publisher') });
    }
  }
  fs.writeFileSync(cache, JSON.stringify(out, null, 1));
  return out;
}
async function stageCandidates() {
  const cat = readJson(W('catalogue.json')).filter(b => b.year && b.year < 1800);
  const byYear = {}; for (const b of cat) (byYear[b.year] ||= []).push(b);
  const byId = new Map(cat.map(b => [b.id, b]));
  const out = []; const n = { CAMENA: 0, 'EEBO-TCP': 0, 'la.wikisource': 0 };
  const push = (src, m) => { for (const c of m.cands) { const b = byId.get(c.book); out.push({ key: m.key, source: src, source_id: m.source_id, source_title: m.title, source_bibl: m.bibl, source_year: m.year, source_url: m.url, source_files: m.files, book_id: b.id, book_year: b.year, book_title: String(b.title).slice(0, 120), match_score: c.s, author_match: c.auth }); n[src]++; } };
  if (args.camena) for (const w of camenaWorks(args.camena)) {
    const cands = matchCatalogue(w, byYear); if (!cands.length) continue;
    push('CAMENA', { key: `camena-${w.key.replace(/[^A-Za-z0-9]+/g, '_')}`, source_id: w.key, title: w.title, bibl: w.bibl, year: w.year, url: 'https://github.com/nevenjovanovic/camena-neolatinlit', files: w.files, cands });
  }
  if (args.tcp) {
    const rows = parseCsv(fs.readFileSync(args.tcp, 'utf8')); const H = rows.shift(); const col = k => H.indexOf(k);
    for (const r of rows) {
      const y = +((r[col('Date')] || '').match(/1[4-7]\d\d/) || [])[0]; if (!y || y >= 1701) continue;
      const w = { title: r[col('Title')], author: r[col('Author')], year: y };
      const cands = matchCatalogue(w, byYear); if (!cands.length) continue;
      const id = r[col('TCP')];
      push('EEBO-TCP', { key: `tcp-${id}`, source_id: id, title: w.title.slice(0, 200), bibl: `${r[col('STC')]} (${y})`, year: y, url: `https://github.com/textcreationpartnership/${id}`, cands });
    }
  }
  for (const l of await wsIndex()) {
    const y = yearOf(l.annus); if (!y) continue;
    const w = { title: l.title.replace(/\[\[|\]\]|''/g, ''), author: l.author.replace(/\[\[|\]\]/g, ''), year: y };
    const cands = matchCatalogue(w, byYear); if (!cands.length) continue;
    push('la.wikisource', { key: `ws-${l.liber.replace(/^Liber:/, '').replace(/[^A-Za-z0-9]+/g, '_')}`, source_id: l.liber, title: w.title.slice(0, 200), bibl: `${l.place} ${l.printer} ${l.annus}`.trim(), year: y, url: `https://la.wikisource.org/wiki/${encodeURIComponent(l.liber.replace(/ /g, '_'))}`, cands });
  }
  fs.writeFileSync(W('candidates.jsonl'), out.map(o => JSON.stringify(o)).join('\n') + '\n');
  console.log(`${out.length} (book, edition) pairs`, n, `${new Set(out.map(o => o.book_id)).size} books`);
}

// ── editions ─────────────────────────────────────────────────────────────────
async function buildEdition(c) {
  const dir = W('editions'); fs.mkdirSync(dir, { recursive: true });
  const fp = path.join(dir, `${c.key}.txt`); if (fs.existsSync(fp)) return true;
  if (fs.existsSync(path.join(dir, `${c.key}.fail`))) return false;
  let ed;
  try {
    if (c.source === 'CAMENA') {
      let text = ''; const pbs = [];
      for (const f of [...c.source_files].sort((a, b) => (/_front/.test(b) - /_front/.test(a)) || nat(a, b))) {
        const r = flattenTei(decodeLenient(fs.readFileSync(path.join(args.camena, f))), 'camena');
        pbs.push(text.length, ...r.pbs.map(x => x + text.length)); text += r.text + '\n';
      }
      ed = { text, pbs };
    } else if (c.source === 'EEBO-TCP') {
      const local = args['tcp-xml'] && path.join(args['tcp-xml'], `${c.source_id}.xml`);
      let xml = local && fs.existsSync(local) ? fs.readFileSync(local, 'utf8') : null;
      if (!xml) { const r = await fetch(`https://raw.githubusercontent.com/textcreationpartnership/${c.source_id}/master/${c.source_id}.xml`, { headers: UA, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`TCP fetch ${r.status}`); xml = await r.text(); }
      ed = flattenTei(xml, 'tcp');
    } else if (c.source === 'la.wikisource') {
      ed = await wikisourceEdition(c.source_id);
      fs.writeFileSync(path.join(dir, `${c.key}.ids.json`), JSON.stringify(ed.ids));
    }
    if (!ed || (ed.text.match(/\p{L}/gu) || []).length < 2000) throw new Error(`edition too short (${ed?.text.length ?? 0} chars)`);
  } catch (e) { fs.writeFileSync(path.join(dir, `${c.key}.fail`), String(e.message)); return false; }
  fs.writeFileSync(fp, ed.text); fs.writeFileSync(path.join(dir, `${c.key}.pb.json`), JSON.stringify(ed.pbs));
  return true;
}
async function stageEditions() {
  const seen = new Set(); let ok = 0, fail = 0;
  for (const c of readJsonl(W('candidates.jsonl'))) { if (seen.has(c.key)) continue; seen.add(c.key); (await buildEdition(c)) ? ok++ : fail++; if ((ok + fail) % 25 === 0) console.log(`${ok} ok, ${fail} failed`); }
  console.log(`editions: ${ok} ok, ${fail} failed`);
}
const editionCache = new Map();
function edition(key) {
  if (!editionCache.has(key)) {
    const text = fs.readFileSync(W(`editions/${key}.txt`), 'utf8');
    editionCache.set(key, { text, words: foldedWords(text, 'latin'), pbs: readJson(W(`editions/${key}.pb.json`)) });
  }
  return editionCache.get(key);
}
// Does the located window sit on one page of the edition (its <pb>s fall where our page breaks)? A window
// is page-aligned when both ends lie within 20 % of a segment's length (+ the 3-word pad) of that segment's ends.
function pbAligned(ed, cut) {
  const pbs = ed.pbs; if (!pbs || pbs.length < 3) return null;
  const mid = (cut.from_char + cut.to_char) / 2; let k = 0; while (k + 1 < pbs.length && pbs[k + 1] <= mid) k++;
  const a = pbs[k], b = k + 1 < pbs.length ? pbs[k + 1] : ed.text.length, tol = 0.2 * (b - a) + 40;
  return Math.abs(cut.from_char - a) <= tol && Math.abs(cut.to_char - b) <= tol;
}

// ── images + Tesseract ───────────────────────────────────────────────────────
const PAGE_PROJ = { page_number: 1, photo: 1, cropped_photo: 1, split_from_spread: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 };
export const imageUrlOf = p => getPageSource(p) || p.photo || null;   // what production OCR reads
async function saveImage(url, dest) {
  if (fs.existsSync(dest)) return dest;
  const sharp = (await import('sharp')).default;
  let buf = await fetchImage(url, 90000); const meta = await sharp(buf).metadata();   // benchmark-seal's rule: width ≤ 2400, JPEG q92
  if (meta.width > MAX_WIDTH) buf = await sharp(buf).resize({ width: MAX_WIDTH }).jpeg({ quality: 92 }).toBuffer();
  else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(dest, buf); return dest;
}
async function tesseract(img) {
  const cache = img.replace(/\.jpg$/, '.tess.txt'); if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
  const { stdout } = await execFileP('tesseract', [img, 'stdout', '-l', 'lat', '--psm', '3'], { maxBuffer: 1 << 24, env: { ...process.env, OMP_THREAD_LIMIT: '1' }, timeout: 300000 });
  fs.writeFileSync(cache, stdout); return stdout;
}
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

// ── verify ───────────────────────────────────────────────────────────────────
async function stageVerify() {
  const { client, db: d } = await db();
  const outP = W('verify.json'); const ver = fs.existsSync(outP) ? readJson(outP) : {};
  const pairs = readJsonl(W('candidates.jsonl')).filter(c => fs.existsSync(W(`editions/${c.key}.txt`)) && !ver[`${c.book_id}|${c.key}`]);
  const imgDir = W('verify-img'); fs.mkdirSync(imgDir, { recursive: true });
  console.log(`${pairs.length} pairs to verify`);
  let done = 0;
  await pool(pairs, Number(args.conc || 3), async c => {
    const ed = edition(c.key); const rows = [];
    try {
      const pages = await d.collection('pages').find({ book_id: c.book_id }, { projection: { page_number: 1 } }).sort({ page_number: 1 }).toArray();
      const n = pages.length; const inner = pages.slice(Math.floor(n * 0.1), Math.ceil(n * 0.9));
      const order = shuffle(inner.map(p => p.page_number), SEED ^ fnv(c.book_id));
      // stored OCR first (cheap): the first 6 drawn pages that have ≥ 200 characters of it
      for (const pn of order.slice(0, 30)) {
        if (rows.length >= 6) break;
        const pg = await d.collection('pages').findOne({ book_id: c.book_id, page_number: pn }, { projection: { 'ocr.data': 1 } });
        const t = stripTags(pg?.ocr?.data || ''); if (t.length < 200) continue;
        const cut = cutEditionWindow(ed.words, ed.text, t, 'latin');
        rows.push({ page: pn, probe: 'stored-ocr', overlap: cut ? +cut.overlap.toFixed(3) : 0, pb_aligned: cut && cut.overlap >= 0.35 ? pbAligned(ed, cut) : null });
      }
      if (rows.length < 2) {   // no stored OCR to speak of: Tesseract on 4 drawn pages
        for (const pn of order.slice(0, 4)) {
          const pg = await d.collection('pages').findOne({ book_id: c.book_id, page_number: pn }, { projection: PAGE_PROJ });
          const url = pg && imageUrlOf(pg); if (!url) { rows.push({ page: pn, probe: 'tesseract', error: 'no image' }); continue; }
          try {
            const img = await saveImage(url, path.join(imgDir, `${shortId(c.book_id)}-p${pn}.jpg`));
            const cut = cutEditionWindow(ed.words, ed.text, await tesseract(img), 'latin');
            rows.push({ page: pn, probe: 'tesseract', overlap: cut ? +cut.overlap.toFixed(3) : 0, pb_aligned: cut && cut.overlap >= 0.35 ? pbAligned(ed, cut) : null });
          } catch (e) { rows.push({ page: pn, probe: 'tesseract', error: String(e.message).slice(0, 80) }); }
        }
      }
      const hit = rows.filter(r => r.overlap >= 0.35);
      ver[`${c.book_id}|${c.key}`] = { book_id: c.book_id, key: c.key, n_pages: n, tried: rows.length, matched: hit.length, pb_aligned: hit.filter(r => r.pb_aligned).length, same_text: hit.length >= 2, rows };
    } catch (e) { ver[`${c.book_id}|${c.key}`] = { book_id: c.book_id, key: c.key, error: String(e.message).slice(0, 120) }; }
    if (++done % 10 === 0) { fs.writeFileSync(outP, JSON.stringify(ver)); console.log(`${done}/${pairs.length}`); }
  });
  fs.writeFileSync(outP, JSON.stringify(ver));
  await client.close();
}

// ── pool ─────────────────────────────────────────────────────────────────────
// A book is in the pool when at least one edition's text is found on ≥ 2 of its seeded interior pages.
// Edition evidence: `page-breaks` when ≥ 1 matched page is page-aligned, else `same-text` (year ± 1 by catalogue).
function stagePool() {
  const cat = new Map(readJson(W('catalogue.json')).map(b => [b.id, b]));
  const cands = readJsonl(W('candidates.jsonl')); const ver = readJson(W('verify.json'));
  const books = {};
  for (const c of cands) {
    const v = ver[`${c.book_id}|${c.key}`]; if (!v?.same_text) continue;
    const b = cat.get(c.book_id); const cen = century(b.year); if (!cen || cen === 'undated') continue;
    const row = books[c.book_id] ||= { book_id: c.book_id, year: b.year, century: cen, title: String(b.title).slice(0, 120), pages: b.pages, visible: b.visible, editions: [] };
    row.editions.push({ key: c.key, source: c.source, source_id: c.source_id, source_year: c.source_year, matched: `${v.matched}/${v.tried}`, evidence: v.pb_aligned ? 'page-breaks' : 'same-text' });
  }
  const rows = Object.values(books).sort((a, b) => nat(a.book_id, b.book_id));
  for (const r of rows) r.editions.sort((a, b) => (b.evidence === 'page-breaks') - (a.evidence === 'page-breaks') || parseInt(b.matched) - parseInt(a.matched));
  const n = {}; for (const r of rows) { n[r.century] ||= { books: 0, by_source: {} }; n[r.century].books++; const s = r.editions[0].source; n[r.century].by_source[s] = (n[r.century].by_source[s] || 0) + 1; }
  fs.writeFileSync(W('pool.json'), JSON.stringify({ built_at: new Date().toISOString(), rule: 'same text on ≥ 2 seeded interior pages (stored OCR, else Tesseract lat), overlap ≥ 0.35', counts: n, books: rows }, null, 1));
  console.log(JSON.stringify(n, null, 1));
}

// ── draw ─────────────────────────────────────────────────────────────────────
// Per century: the pool in a Mulberry32(5924 + century) order; every book's run starts at a page drawn
// uniformly from 1 … n−2 (so the run is pages s, s+1, s+2) with Mulberry32(5924 ^ fnv(book_id)).
export function runStart(bookId, nPages) { return 1 + Math.floor(rng(SEED ^ fnv(bookId))() * Math.max(1, nPages - 2)); }
async function stageDraw() {
  const P = readJson(W('pool.json'));
  const { client, db: d } = await db();
  const draw = { seed: SEED, rule: 'per century, pool shuffled by Mulberry32(5924 + centuryStart); run start uniform over page_number 1..n-2 by Mulberry32(5924 ^ fnv1a(book_id)); n = pages in the pages collection', centuries: {} };
  for (const cen of ['1400s', '1500s', '1600s', '1700s']) {
    const books = P.books.filter(b => b.century === cen);
    const order = shuffle(books, SEED + parseInt(cen));
    draw.centuries[cen] = [];
    for (const b of order) {
      const nums = (await d.collection('pages').find({ book_id: b.book_id }, { projection: { page_number: 1 } }).toArray()).map(p => p.page_number).sort((x, y) => x - y);
      const s = runStart(b.book_id, nums.length);
      draw.centuries[cen].push({ book_id: b.book_id, year: b.year, n_pages: nums.length, start_index: s, pages: nums.slice(s - 1, s + 2), editions: b.editions.map(e => e.key) });
    }
  }
  await client.close();
  fs.writeFileSync(W('draw.json'), JSON.stringify(draw, null, 1));
  for (const [c, r] of Object.entries(draw.centuries)) console.log(c, r.length);
}

// ── align ────────────────────────────────────────────────────────────────────
// For each drawn book in draw order, until the century's target of aligned books is met (--target=1600s:50,…):
// the 3 page images, Tesseract, and the window in each candidate edition. A page whose own probe fails gets
// the window of the edition page next to a neighbour's located window (`pb-neighbour`), when that neighbour
// window is page-aligned. Every drawn book is recorded, aligned or skipped with its reason.
async function stageAlign() {
  const draw = readJson(W('draw.json'));
  const target = Object.fromEntries(String(args.target || '1600s:50,1500s:30,1700s:999,1400s:999').split(',').map(x => x.split(':')).map(([k, v]) => [k, +v]));
  const outP = W('align.json'); const al = fs.existsSync(outP) ? readJson(outP) : {};
  const { client, db: d } = await db();
  const imgDir = W('runs'); fs.mkdirSync(imgDir, { recursive: true });
  for (const [cen, rows] of Object.entries(draw.centuries)) {
    const okCount = () => rows.filter(r => al[r.book_id]?.status === 'aligned').length;
    const todo = []; for (const r of rows) { if (okCount() + todo.length >= (target[cen] ?? 0) * 1.25 + 4 && !al[r.book_id]) break; if (!al[r.book_id]) todo.push(r); }
    // process in draw order, in small parallel batches; stop when the target is met (books after it stay undrawn)
    for (let i = 0; i < todo.length && okCount() < (target[cen] ?? 0); i += 4) {
      await Promise.all(todo.slice(i, i + 4).map(r => alignBook(d, r, imgDir).then(x => { al[r.book_id] = { century: cen, order: rows.indexOf(r), ...x }; })));
      fs.writeFileSync(outP, JSON.stringify(al, null, 1));
      console.log(`${cen}: ${okCount()} aligned of ${rows.filter(r => al[r.book_id]).length} drawn so far`);
    }
  }
  await client.close();
}
async function alignBook(d, r, imgDir) {
  const pages = [];
  for (const pn of r.pages) {
    const pg = await d.collection('pages').findOne({ book_id: r.book_id, page_number: pn }, { projection: PAGE_PROJ });
    const url = pg && imageUrlOf(pg); const slug = `r4l-${shortId(r.book_id)}-p${pn}`;
    const row = { page: pn, slug, image: url };
    if (!url) { row.error = 'no image'; pages.push(row); continue; }
    try { await saveImage(url, path.join(imgDir, `${slug}.jpg`)); row.probe = (await tesseract(path.join(imgDir, `${slug}.jpg`))); } catch (e) { row.error = String(e.message).slice(0, 100); }
    pages.push(row);
  }
  if (pages.some(p => p.error)) return { status: 'skip', reason: `image: ${pages.find(p => p.error).error}`, pages: pages.map(({ probe, ...p }) => p) };
  let best = null;
  for (const key of r.editions) {
    const ed = edition(key);
    const cuts = pages.map(p => { const c = cutEditionWindow(ed.words, ed.text, p.probe, 'latin'); return c && c.overlap >= 0.35 ? { ...c, pb: pbAligned(ed, c), how: 'tesseract' } : null; });
    // neighbour fallback through the edition's page breaks
    for (let i = 0; i < 3; i++) if (!cuts[i]) for (const j of [i - 1, i + 1]) {
      const nb = cuts[j]; if (!nb || nb.how !== 'tesseract' || !nb.pb) continue;
      const pbs = ed.pbs; const mid = (nb.from_char + nb.to_char) / 2; let k = 0; while (k + 1 < pbs.length && pbs[k + 1] <= mid) k++;
      const kk = k + (i - j); if (kk < 0 || kk >= pbs.length) continue;
      const a = pbs[kk], b = kk + 1 < pbs.length ? pbs[kk + 1] : ed.text.length; const win = ed.text.slice(a, b).trim();
      if ((win.match(/\p{L}/gu) || []).length >= 40) { cuts[i] = { window: win, from_char: a, to_char: b, overlap: null, how: 'pb-neighbour' }; break; }
    }
    const n = cuts.filter(Boolean).length;
    if (!best || n > best.n) best = { key, n, cuts };
  }
  const out = pages.map((p, i) => {
    const c = best.cuts[i]; const { probe, ...rest } = p;
    if (c) fs.writeFileSync(path.join(imgDir, `${p.slug}.ref.txt`), c.window);
    return { ...rest, tess_letters: (probe.match(/\p{L}/gu) || []).length, aligned: !!c, how: c?.how ?? null, overlap: c?.overlap != null ? +c.overlap.toFixed(3) : null, pb_aligned: c?.pb ?? null, from_char: c?.from_char ?? null, to_char: c?.to_char ?? null, ref_chars: c ? [...c.window].length : 0 };
  });
  // a run is ALIGNED if at least one page has a window; pages without one are decided by eye (blank / plate /
  // text outside the transcription / locator failure) and never silently dropped
  return { status: best.n ? 'aligned' : 'skip', reason: best.n ? null : 'no page of the run located in any candidate edition', edition: best.key, pages: out };
}

// ── population draw ──────────────────────────────────────────────────────────
// The WHOLE Latin OCR queue (pipeline_next.step = ocr), visible and hidden, stratified by century of the first
// 14xx–17xx year in `published`: 1600s 25, 1500s 20, undated 10, 1700s 5, 1400s 5. Mulberry32(5925 + stratum).
async function stagePopdraw() {
  const cat = readJson(W('catalogue.json')).filter(b => b.next === 'ocr');
  const quota = { '1600s': 25, '1500s': 20, undated: 10, '1700s': 5, '1400s': 5 };
  const used = new Set(fs.existsSync(W('pool.json')) ? readJson(W('pool.json')).books.map(b => b.book_id) : []);
  const { client, db: d } = await db();
  const out = { seed: 5925, rule: 'queue = Latin books with pipeline_next.step = ocr (catalogue stage); per stratum Mulberry32(5925 + index) shuffle, the first N with ≥ 3 pages in the pages collection; start uniform as in draw', strata: {} };
  for (const [i, [st, n]] of Object.entries(quota).entries()) {
    const books = shuffle(cat.filter(b => (century(b.year) || 'other') === st).sort((a, b) => nat(a.id, b.id)), 5925 + i);
    out.strata[st] = { queue_books: books.length, drawn: [] };
    for (const b of books) {
      if (out.strata[st].drawn.length >= n) break;
      const nums = (await d.collection('pages').find({ book_id: b.id }, { projection: { page_number: 1 } }).toArray()).map(p => p.page_number).sort((x, y) => x - y);
      if (nums.length < 3) { out.strata[st].drawn.push({ book_id: b.id, skip: `only ${nums.length} pages in pages collection` }); continue; }
      const s = runStart(b.id, nums.length);
      out.strata[st].drawn.push({ book_id: b.id, year: b.year, title: String(b.title).slice(0, 100), n_pages: nums.length, start_index: s, pages: nums.slice(s - 1, s + 2), visible: b.visible, hidden_reason: b.hidden_reason, duplicate_of: b.duplicate_of, provider: b.provider, in_reference_pool: used.has(b.id) });
    }
  }
  await client.close();
  fs.writeFileSync(W('popdraw.json'), JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out.strata)) console.log(k, v.queue_books, v.drawn.filter(x => !x.skip).length);
}

// ── export: one bench root, two strata ───────────────────────────────────────
// <root>/latin-r4-acc/<slug>.jpg (aligned runs) and <root>/latin-r4-pop/<slug>.jpg (population runs) +
// manifest.json, the layout benchmark-run-api / benchmark-score read. Population slugs: r4p-<book>-p<n>.
async function stageExport() {
  const ROOT = args.root; if (!ROOT) throw new Error('--root required');
  const { client, db: d } = await db();
  const al = readJson(W('align.json'));
  const acc = path.join(ROOT, 'latin-r4-acc'), pop = path.join(ROOT, 'latin-r4-pop');
  for (const dir of [acc, pop]) fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const accRows = [];
  for (const [book, a] of Object.entries(al)) if (a.status === 'aligned') for (const p of a.pages) {
    const src = W(`runs/${p.slug}.jpg`); const dst = path.join(acc, `${p.slug}.jpg`);
    if (!fs.existsSync(dst)) fs.copyFileSync(src, dst); accRows.push({ slug: p.slug, book_id: book, page_number: p.page, century: a.century });
  }
  fs.writeFileSync(path.join(acc, 'manifest.json'), JSON.stringify({ stratum: 'latin-r4-acc', exported_at: new Date().toISOString(), pages: accRows }, null, 1));
  const pd = readJson(W('popdraw.json')); const popRows = [];
  for (const [st, s] of Object.entries(pd.strata)) for (const b of s.drawn.filter(x => !x.skip)) for (const pn of b.pages) {
    const slug = `r4p-${shortId(b.book_id)}-p${pn}`; const dst = path.join(pop, `${slug}.jpg`);
    const row = { slug, book_id: b.book_id, page_number: pn, stratum: st };
    try {
      if (!fs.existsSync(dst)) { const pg = await d.collection('pages').findOne({ book_id: b.book_id, page_number: pn }, { projection: PAGE_PROJ }); const url = pg && imageUrlOf(pg); if (!url) throw new Error('no image'); await saveImage(url, dst); row.image = url; }
    } catch (e) { row.error = String(e.message).slice(0, 100); console.log(`! ${slug}: ${row.error}`); }
    popRows.push(row);
  }
  fs.writeFileSync(path.join(pop, 'manifest.json'), JSON.stringify({ stratum: 'latin-r4-pop', exported_at: new Date().toISOString(), pages: popRows }, null, 1));
  await client.close();
  console.log(`acc ${accRows.length} pages, pop ${popRows.filter(r => !r.error).length} pages (${popRows.filter(r => r.error).length} failed)`);
}

// ── throughput books + the pod's lane ───────────────────────────────────────
// Two WHOLE books for the end-to-end throughput test (Amendment 2 G): the Latin OCR queue's books with
// 150–500 pages, Mulberry32(5926) order, the first two whose every page image fetches. Sweep set: the first
// 160 pages of the first book. Pages go to <lane>/bench/img/_bench/tp-<book>-p<n>.jpg.
async function stageLane() {
  const LANE = args.lane, ROOT = args.root; if (!LANE || !ROOT) throw new Error('--lane and --root required');
  const img = path.join(LANE, 'bench', 'img', '_bench'); fs.mkdirSync(img, { recursive: true });
  const rows = [];
  for (const st of ['latin-r4-acc', 'latin-r4-pop']) for (const f of fs.readdirSync(path.join(ROOT, st)).filter(f => f.endsWith('.jpg')).sort()) {
    const dst = path.join(img, f); if (!fs.existsSync(dst)) fs.linkSync(path.join(ROOT, st, f), dst); rows.push(`_bench\t${f.slice(0, -4)}\timg/_bench/${f}`);
  }
  fs.writeFileSync(path.join(LANE, 'bench', 'acc.tsv'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(LANE, 'bench', 'cpu.tsv'), rows.join('\n') + '\n');
  fs.writeFileSync(path.join(LANE, 'bench', 'tput.tsv'), rows.slice(0, 16).join('\n') + '\n');   // warm-up, discarded
  const cat = readJson(W('catalogue.json')).filter(b => b.next === 'ocr' && b.pages >= 150 && b.pages <= 500).sort((a, b) => nat(a.id, b.id));
  const { client, db: d } = await db();
  const tp = []; const books = [];
  for (const b of shuffle(cat, 5926)) {
    if (books.length >= 2) break;
    const pages = await d.collection('pages').find({ book_id: b.id }, { projection: PAGE_PROJ }).sort({ page_number: 1 }).toArray();
    const got = [];
    try {
      await pool(pages, 6, async p => { const slug = `tp-${shortId(b.id)}-p${p.page_number}`; const url = imageUrlOf(p); if (!url) throw new Error('no image'); await saveImage(url, path.join(img, `${slug}.jpg`)); got.push([p.page_number, slug]); });
    } catch (e) { console.log(`tp ${b.id}: ${e.message} — next book`); continue; }
    got.sort((x, y) => x[0] - y[0]); for (const [, slug] of got) tp.push(`_bench\t${slug}\timg/_bench/${slug}.jpg`);
    books.push({ book_id: b.id, title: String(b.title).slice(0, 100), year: b.year, pages: got.length });
    console.log(`tp book ${b.id}: ${got.length} pages`);
  }
  await client.close();
  fs.writeFileSync(path.join(LANE, 'bench', 'tp.tsv'), tp.join('\n') + '\n');
  fs.writeFileSync(path.join(LANE, 'bench', 'sweep.tsv'), tp.slice(0, 160).join('\n') + '\n');
  fs.writeFileSync(W('tp-books.json'), JSON.stringify({ rule: 'queue books with 150–500 pages, Mulberry32(5926) order, first two whose images all fetch; sweep = first 160 tp pages', books }, null, 1));
  console.log(`acc+pop ${rows.length} pages; tp ${tp.length} pages`);
}

// ── write: by-eye verdicts → references ──────────────────────────────────────
const LICENCE = { CAMENA: 'CC-BY-SA-4.0', 'EEBO-TCP': 'CC0-1.0', 'la.wikisource': 'CC-BY-SA-4.0' };
function stageWrite() {
  const checks = readJson(W('leaf-check.json')).rows;
  const cands = readJsonl(W('candidates.jsonl')); const al = readJson(W('align.json'));
  let n = 0;
  for (const row of checks.filter(r => r.verdict === 'ok')) {
    const a = al[row.book_id]; const p = a?.pages.find(x => x.page === row.page);
    const c = cands.find(x => x.book_id === row.book_id && x.key === a?.edition);
    if (!a || !p || !c) { console.log(`! ${row.book_id} p${row.page}: not in align/candidates`); continue; }
    const text = fs.readFileSync(W(`runs/${p.slug}.ref.txt`), 'utf8');
    const rec = {
      source: c.source === 'la.wikisource' ? `la.wikisource ${c.source_id}` : `${c.source} ${c.source_id}`,
      edition: `${c.source_title} — ${c.source_bibl}`.slice(0, 300), licence: LICENCE[c.source], kind: 'same-edition-transcription',
      canonical: false, memorization_risk: 'low', acquired: 'open e-text, fetched 2026-10-06 (job latin-r4-5924)', source_url: c.source_url || null,
      origin: 'library', book_id: c.book_id, page_number: row.page, script: 'latin', reference_kind: 'same-edition-transcription',
      window: { from_char: p.from_char, to_char: p.to_char, overlap: p.overlap, located_by: p.how, probe: 'tesseract-5 lat (not an arm)', pad_words: p.how === 'tesseract' ? 3 : 0 },
      leaf_check: { status: 'ok', by: row.checker, at: row.at, note: row.note || null, method: 'read-from-image', leaf_language: row.leaf_language || 'lat', page_type: row.page_type || null, typeface: row.typeface || null, human_spot_check: null },
      same_edition: { evidence: row.same_edition || null },
      run: { century: a.century, pages: a.pages.map(x => x.page) },
      reference_error_rate: null, built_by: 'latin-r4-refs-5924.mjs', built_at: new Date().toISOString(), stratum: 'latin-r4-acc',
    };
    writePrivateRef(REFS, p.slug, text, rec);
    const priv = path.join(privateRefsDir(), `${p.slug}.txt`);
    if (sha256(fs.readFileSync(priv, 'utf8')) !== sha256(text)) throw new Error(`${p.slug}: private copy differs`);
    fs.writeFileSync(path.join(REFS, `${p.slug}.txt`), text); fs.unlinkSync(priv);
    const recP = path.join(REFS, `${p.slug}.json`); fs.writeFileSync(recP, JSON.stringify({ ...readJson(recP), text_location: 'repo' }, null, 2) + '\n');
    n++;
  }
  console.log(`${n} references written`);
}

const STAGES = { catalogue: stageCatalogue, candidates: stageCandidates, editions: stageEditions, verify: stageVerify, pool: stagePool, draw: stageDraw, align: stageAlign, popdraw: stagePopdraw, export: stageExport, lane: stageLane, write: stageWrite };
if (!STAGES[STAGE]) { console.error(`unknown stage ${STAGE}: ${Object.keys(STAGES).join(' | ')}`); process.exit(1); }
await STAGES[STAGE]();
