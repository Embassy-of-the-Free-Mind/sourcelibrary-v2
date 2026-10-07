#!/usr/bin/env node
/**
 * PRIOR ART: hetzner:/root/ocr-bench/harness/classify-script.mjs (uncommitted, #4745) — the same
 * six-class prompt over a benchmark image directory through the eval harness's `runModel`,
 * which is unmetered (its calls were "≈ $0.10 unmetered" in EXPERIMENTS.md). The census must
 * be metered and capped, run over a manifest of URLs rather than a directory, and summarise
 * per BOOK, so the prompt is carried over verbatim and the plumbing is not.
 *
 * #5100 step 1 — cursive census of pre-1868 Japanese: CLASSIFY (paid) and SUMMARIZE (free).
 *
 * Who runs it: a session on Hetzner (paid Gemini runs there by convention), from
 * /root/sourcelibrary with `.env.production.local` sourced. Measurement only — writes nothing
 * to `pages`, rents nothing.
 *
 *   node scripts/eval/cursive-census-classify.mjs --manifest=<manifest.jsonl> --out=<dir> [--cap=4.5] [--concurrency=4] [--limit=N]
 *   node scripts/eval/cursive-census-classify.mjs --summarize --manifest=<manifest.jsonl> --out=<dir> --books=<books.json>
 *
 * Classifier: gemini-3-flash-preview, thinking OFF (the metered client's default), temperature 0,
 * the #4745 six-class prompt verbatim (10/10 by eye on the cursive-vs-regular axis). Every call
 * goes through scripts/lib/gemini-script-client.mjs and lands in `gemini_usage` under this
 * file's path as `endpoint`. The run stops itself at `--cap` dollars of list-price spend.
 *
 * Book rule (handoff): a series is one hand, so a book is cursive if ≥ 2 of its 3 pages are.
 * Resumable: a page with a written JSON (class or error) is skipped on rerun; delete to redo.
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { callGemini } from '../lib/gemini-script-client.mjs';
import { MODEL_PRICING, PAGE_RATE_USD, PAGE_RATES_MEASURED_ON } from '../lib/model-pricing.mjs';

const argOf = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const has = n => process.argv.includes(`--${n}`);
const MANIFEST = argOf('manifest', 'scripts/eval/results/cursive-census/manifest.jsonl');
const OUT = argOf('out', 'scripts/eval/results/cursive-census');
const BOOKS = argOf('books', path.join(OUT, 'books.json'));
const CAP = parseFloat(argOf('cap', '4.5'));
const CONC = parseInt(argOf('concurrency', '4'), 10);
const LIMIT = parseInt(argOf('limit', '0'), 10);
const MODEL = 'gemini-3-flash-preview';
const MAX_WIDTH = 2400;                         // what the benchmark engines saw (#4745 registries: max_width 2400)
const ENDPOINT = 'scripts/eval/cursive-census-classify.mjs';
const CURSIVE = new Set(['woodblock-cursive', 'manuscript-cursive']);
const CLASSES = ['typeset', 'woodblock-regular', 'woodblock-cursive', 'manuscript-regular', 'manuscript-cursive', 'illustration', 'other'];

// Verbatim from #4745's classify-script.mjs — the instrument whose confusion table is in the issue.
const PROMPT = `Look at this page image from a Japanese or Chinese book and classify what is physically on it. Answer with one JSON object only, no prose:
{"script_class": one of
  "typeset" (movable-type or modern printed characters, perfectly uniform),
  "woodblock-regular" (block-printed; characters in regular kaisho or mildly flowing gyosho, each character separable; kana in standard forms),
  "woodblock-cursive" (block-printed KUZUSHIJI: connected, abbreviated sosho forms and hentaigana, strokes run together within and between characters),
  "manuscript-regular" (handwritten with a brush or pen, but in regular kaisho/gyosho with separable characters),
  "manuscript-cursive" (handwritten kuzushiji: connected cursive forms and hentaigana),
  "illustration" (a picture, map, diagram or cover with little or no running text — under a fifth of the page),
  "other" (non-CJK script, or no text at all);
 "text_share": approximate fraction of the page area that is running text, 0 to 1;
 "spread": true if the image shows two facing pages;
 "note": up to 12 words}`;

const price = MODEL_PRICING[MODEL];
const dollars = (inTok, outTok) => (inTok * price.input + outTok * price.output) / 1e6;
const readManifest = () => fs.readFileSync(MANIFEST, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const pageFile = slug => path.join(OUT, 'pages', `${slug}.json`);

async function loadImage(row) {
  let buf;
  if (row.local_file) buf = fs.readFileSync(row.local_file);
  else {
    const resp = await fetch(row.image_url, { signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`fetch ${resp.status} ${row.image_url}`);
    buf = Buffer.from(await resp.arrayBuffer());
  }
  const meta = await sharp(buf).metadata();
  if ((meta.width || 0) > MAX_WIDTH || meta.format !== 'jpeg') buf = await sharp(buf).resize({ width: Math.min(MAX_WIDTH, meta.width || MAX_WIDTH) }).jpeg({ quality: 92 }).toBuffer();
  return { buf, width: meta.width, height: meta.height };
}

async function classify() {
  fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });
  let rows = readManifest().filter(r => !fs.existsSync(pageFile(r.slug)));
  // controls first, so the instrument check is in hand before the census spend
  rows.sort((a, b) => (b.control ? 1 : 0) - (a.control ? 1 : 0));
  if (LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`${rows.length} pages to classify on ${MODEL}; cap $${CAP}; concurrency ${CONC}`);
  let spent = 0, done = 0, errors = 0, stopped = false;
  const counts = {};
  const worker = async () => {
    while (rows.length && !stopped) {
      const row = rows.shift();
      const rec = { slug: row.slug, book_id: row.book_id, page_number: row.page_number, control: !!row.control, eye: row.eye, model: MODEL, at: new Date().toISOString() };
      try {
        const { buf, width, height } = await loadImage(row);
        rec.image = { width, height, bytes_sent: buf.length };
        const r = await callGemini({ model: MODEL, prompt: PROMPT, imageParts: buf, endpoint: ENDPOINT, type: 'eval', temperature: 0, maxOutputTokens: 300, bookId: row.book_id, promptVersion: 'script-class-6-v4745' });
        rec.tokens = { input: r.inputTokens, output: r.outputTokens, thinking: r.thinkingTokens };
        rec.cost_usd = dollars(r.inputTokens, r.outputTokens);
        spent += rec.cost_usd;
        const txt = (r.text || '').trim().replace(/^```(?:json)?\s*|```$/g, '');
        try { Object.assign(rec, JSON.parse(txt)); } catch { rec.script_class = 'unparsed'; rec.raw = txt.slice(0, 200); }
        if (!CLASSES.includes(rec.script_class)) { rec.raw = rec.raw || txt.slice(0, 200); rec.script_class = 'unparsed'; }
      } catch (e) { rec.script_class = 'error'; rec.error = String(e.message || e).slice(0, 300); errors++; }
      rec.slug = row.slug;
      fs.writeFileSync(pageFile(row.slug), JSON.stringify(rec));
      counts[rec.script_class] = (counts[rec.script_class] || 0) + 1;
      done++;
      if (row.control) console.log(`  control ${row.slug}: eye=${row.eye} → ${rec.script_class}`);
      if (done % 25 === 0) console.log(`  ${done} done, $${spent.toFixed(3)} spent, ${errors} errors, ${JSON.stringify(counts)}`);
      if (spent >= CAP) { stopped = true; console.log(`CAP REACHED at $${spent.toFixed(3)} — stopping`); }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  console.log(`CLASSIFY-DONE ${done} pages, $${spent.toFixed(4)} list-price spend, ${errors} errors, ${JSON.stringify(counts)}${stopped ? ' (STOPPED AT CAP)' : ''}`);
}

function summarize() {
  const manifest = readManifest();
  const books = JSON.parse(fs.readFileSync(BOOKS, 'utf8'));
  const recs = new Map();
  for (const f of fs.existsSync(path.join(OUT, 'pages')) ? fs.readdirSync(path.join(OUT, 'pages')) : []) {
    if (f.endsWith('.json')) { const j = JSON.parse(fs.readFileSync(path.join(OUT, 'pages', f), 'utf8')); recs.set(j.slug, j); }
  }
  // 1. positive control
  const controls = manifest.filter(r => r.control).map(r => { const j = recs.get(r.slug) || {}; return { slug: r.slug, eye: r.eye, got: j.script_class || 'missing', cursive_axis_ok: CURSIVE.has(r.eye) === CURSIVE.has(j.script_class || ''), exact: r.eye === j.script_class, note: r.note }; });
  const ctl = { n: controls.length, cursive_axis_agree: controls.filter(c => c.cursive_axis_ok).length, exact_agree: controls.filter(c => c.exact).length, rows: controls };
  // 2. per page
  const census = manifest.filter(r => !r.control);
  const byClass = {}; let classified = 0, unread = 0, spent = 0, inTok = 0, outTok = 0;
  const perBook = new Map();
  for (const r of census) {
    const j = recs.get(r.slug);
    if (!j) { unread++; continue; }
    spent += j.cost_usd || 0; inTok += j.tokens?.input || 0; outTok += j.tokens?.output || 0;
    const c = j.script_class || 'error';
    byClass[c] = (byClass[c] || 0) + 1;
    if (CLASSES.includes(c)) classified++;
    if (!perBook.has(r.book_id)) perBook.set(r.book_id, { book_id: r.book_id, title: r.title, year: r.year, visible: r.visible, pages_count: r.pages_count, pages_in_atlas: r.pages_in_atlas, classes: [] });
    perBook.get(r.book_id).classes.push(c);
  }
  for (const c of manifest.filter(r => r.control)) { const j = recs.get(c.slug); if (j) { spent += j.cost_usd || 0; inTok += j.tokens?.input || 0; outTok += j.tokens?.output || 0; } }
  // 3. book rule: cursive if ≥ 2 of the drawn pages are cursive
  const bookRows = [...perBook.values()].map(b => {
    const k = b.classes.filter(c => CURSIVE.has(c)).length;
    const text = b.classes.filter(c => CLASSES.includes(c) && c !== 'illustration' && c !== 'other').length;
    const pages = b.pages_in_atlas || b.pages_count || 0;
    let verdict = k >= 2 ? 'cursive' : (k === 1 ? 'one-cursive-page' : (text === 0 ? 'no-text-page' : 'not-cursive'));
    const ms = b.classes.filter(c => c === 'manuscript-cursive').length, wb = b.classes.filter(c => c === 'woodblock-cursive').length;
    return { ...b, cursive_pages_drawn: k, drawn: b.classes.length, pages, verdict, medium: k >= 2 ? (ms > wb ? 'manuscript' : 'woodblock') : null };
  });
  const cursiveBooks = bookRows.filter(b => b.verdict === 'cursive');
  const sumPages = arr => arr.reduce((s, b) => s + b.pages, 0);
  // page-share estimator: each book's sampled cursive fraction × its page count (books are clusters;
  // a book with 1/3 cursive pages contributes a third of its pages). Bootstrap over books for the interval.
  const pageShare = bookRows.reduce((s, b) => s + b.pages * (b.drawn ? b.cursive_pages_drawn / b.drawn : 0), 0);
  const seedRnd = (() => { let h = 5100; return () => { h = (h + 0x6D2B79F5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  const boot = { books: [], pages: [], pageShare: [] };
  for (let i = 0; i < 2000; i++) {
    let nb = 0, np = 0, ps = 0;
    for (const b of bookRows) {
      // within-book resample of the drawn pages (the only sampling in a full census of books)
      const draw = Array.from({ length: b.drawn }, () => b.classes[Math.floor(seedRnd() * b.classes.length)]);
      const k = draw.filter(c => CURSIVE.has(c)).length;
      if (k >= 2) { nb++; np += b.pages; }
      ps += b.pages * (b.drawn ? k / b.drawn : 0);
    }
    boot.books.push(nb); boot.pages.push(np); boot.pageShare.push(ps);
  }
  const ci = arr => { const s = [...arr].sort((a, b) => a - b); return [s[Math.floor(s.length * 0.025)], s[Math.floor(s.length * 0.975)]]; };
  const totalPages = sumPages(bookRows);
  const cursivePages = sumPages(cursiveBooks);
  // projections
  const l4EurPerHour = 0.79;          // #4745: Scaleway L4 ≈ 57 h ≈ €45
  const gpuHours = s => cursivePages * s / 3600;
  const perPageTranslateUsd = parseFloat(argOf('translate-usd-per-page', String(PAGE_RATE_USD.translationRealtime)));   // the lane's measured realtime rate, see PAGE_RATES_MEASURED_ON
  const summary = {
    generated_at: new Date().toISOString(), model: MODEL, prompt_version: 'script-class-6-v4745', seed: books.seed, cutoff_year: books.cutoff_year, rule: '≥2 of 3 interior pages cursive → book cursive',
    control: ctl,
    cohort: { books_in_cohort: books.books.length, books_with_pages_drawn: bookRows.length, books_no_usable_image: books.books.filter(b => !b.drawn).length, pages_total: totalPages, visible_books: bookRows.filter(b => b.visible).length, hidden_books: bookRows.filter(b => !b.visible).length },
    pages_classified: classified, pages_unread: unread, per_page_class: byClass,
    books_by_verdict: Object.fromEntries(['cursive', 'one-cursive-page', 'not-cursive', 'no-text-page'].map(v => [v, bookRows.filter(b => b.verdict === v).length])),
    cursive: {
      books: cursiveBooks.length, books_ci95: ci(boot.books), books_woodblock: cursiveBooks.filter(b => b.medium === 'woodblock').length, books_manuscript: cursiveBooks.filter(b => b.medium === 'manuscript').length,
      books_visible: cursiveBooks.filter(b => b.visible).length, books_hidden: cursiveBooks.filter(b => !b.visible).length,
      pages_by_book_rule: cursivePages, pages_by_book_rule_ci95: ci(boot.pages),
      pages_by_page_share: Math.round(pageShare), pages_by_page_share_ci95: ci(boot.pageShare).map(Math.round),
      pages_one_cursive_page_books: sumPages(bookRows.filter(b => b.verdict === 'one-cursive-page')),
    },
    spend: { list_price_usd: +spent.toFixed(4), input_tokens: inTok, output_tokens: outTok, calls: recs.size },
    projection: {
      ndl_l4_hours_at_2s: +gpuHours(2).toFixed(1), ndl_l4_hours_at_5s: +gpuHours(5).toFixed(1), ndl_l4_eur_at_2s: +(gpuHours(2) * l4EurPerHour).toFixed(2), ndl_l4_eur_at_5s: +(gpuHours(5) * l4EurPerHour).toFixed(2), l4_eur_per_hour: l4EurPerHour,
      retranslation_pages: cursivePages, retranslation_usd_per_page_assumed: perPageTranslateUsd, rate_measured_on: PAGE_RATES_MEASURED_ON, retranslation_usd: +(cursivePages * perPageTranslateUsd).toFixed(2),
    },
    books: bookRows.sort((a, b) => b.cursive_pages_drawn - a.cursive_pages_drawn || b.pages - a.pages),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  const { books: _b, ...head } = summary;
  console.log(JSON.stringify(head, null, 1));
}

if (has('summarize')) summarize(); else classify().catch(e => { console.error(e); process.exit(1); });
