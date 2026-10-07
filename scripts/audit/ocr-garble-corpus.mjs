#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/ocr-loop-corpus.mjs — the same mirror walk for ONE feature (the
 * exact periodic loop); this walks once for all garble features and keeps every page's row so
 * thresholds can be changed without a second walk. scripts/audit/page-integrity-scan.mjs —
 * chain and truncation checks between a page and its neighbours or its translation, not the
 * page's own legibility.
 *
 * Score every OCR'd page in the local mirror for garble (#5313) and report what a threshold
 * would flag. NEVER WRITES to any database: the output is rows on this machine and a summary.
 * Writing `ocr.read_quality` is a separate, reviewed step (field-sprawl.md) — see the issue.
 *
 * Two steps, so a threshold change costs seconds, not a walk:
 *   (default)     walk the mirror → <out>/rows.w*.tsv (one row per page) + baselines.json
 *                 (per language and per script: the median and upper quantiles of each feature)
 *   --summarise   re-read the rows, apply garbleVerdict(), print and write summary.json
 *
 * Usage:
 *   node scripts/audit/ocr-garble-lexicon.mjs          # once, first
 *   node scripts/audit/ocr-garble-corpus.mjs
 *   node scripts/audit/ocr-garble-corpus.mjs --summarise --sample=40
 *
 * Flags:
 *   --mirror=DIR     mirror root (default ~/sl-corpus)
 *   --lexicon=DIR    lexicon directory (default <mirror>/garble-lexicon)
 *   --out=DIR        rows + baselines (default <mirror>/garble-scores)
 *   --workers=N      parallel scorers (default 10)
 *   --summarise      apply the verdict to existing rows instead of walking
 *   --sample=N       with --summarise: write N flagged translated pages, one per book, seeded,
 *                    to <out>/flag-sample.jsonl for the hand read
 *   --seed=N         seed for --sample (default 5313)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { garbleFeatures, loadLexiconDir, ocrSelfCaution } from '../lib/ocr-garble-score.mjs';
import { garbleVerdict, baselineFor, BASELINE_FEATURES, VERDICT_VERSION } from '../lib/ocr-garble-verdict.mjs';

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const flag = n => process.argv.includes(`--${n}`);

if (flag('apply') || flag('write')) {
  console.error('This script never writes to the database. The ocr.read_quality sweep is a separate, reviewed step (#5313).');
  process.exit(2);
}

const MIRROR = arg('mirror', path.join(os.homedir(), 'sl-corpus'));
const LEXICON = arg('lexicon', path.join(MIRROR, 'garble-lexicon'));
const OUT = arg('out', path.join(MIRROR, 'garble-scores'));
const WORKERS = Number(arg('workers', '10'));
const WORKER = arg('worker', '');
const SAMPLE = Number(arg('sample', '0'));
const SEED = Number(arg('seed', '5313'));

const COLS = ['book', 'p', 'type', 'tr', 'caution', 'judged', 'script', 'units', 'oov', 'oov_lang', 'no_vowel', 'mixed', 'fragment', 'filler', 'repeat', 'loop'];
const num = (v) => (v == null ? '' : (Math.round(v * 10000) / 10000).toString());

function liveBooks() {
  const out = [];
  for (const line of fs.readFileSync(path.join(MIRROR, 'catalog.jsonl'), 'utf8').split('\n')) {
    if (!line) continue;
    let b; try { b = JSON.parse(line); } catch { continue; }
    if (b.visible !== true || !(b.pages_ocr > 0)) continue;
    out.push({ id: String(b.id), language: b.language || '' });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

async function runWorker() {
  const [idx, of] = WORKER.split('/').map(Number);
  const lexicon = await loadLexiconDir(LEXICON);
  const books = liveBooks().filter((_, i) => i % of === idx);
  const fd = fs.openSync(path.join(OUT, `rows.w${idx}.tsv`), 'w');
  let buf = [];
  for (const book of books) {
    let text;
    try { text = fs.readFileSync(path.join(MIRROR, 'books', `${book.id}.jsonl`), 'utf8'); } catch { continue; }
    let at = 0;
    while (at < text.length) {
      let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
      const line = text.slice(at, nl); at = nl + 1;
      if (!line) continue;
      let d; try { d = JSON.parse(line); } catch { continue; }
      if (!d.ocr) continue;
      const f = garbleFeatures(d.ocr, { lexicon, language: book.language });
      buf.push([
        book.id, d.p, d.type || '', d.tr ? 1 : 0, ocrSelfCaution(d.ocr) || '', f.judged ? 1 : f.why, f.script || '', f.units,
        num(f.oov), num(f.oov_lang), num(f.no_vowel), num(f.mixed), num(f.fragment), num(f.filler), num(f.repeat), num(f.loop),
      ].join('\t') + '\n');
    }
    if (buf.length > 5000) { fs.writeSync(fd, buf.join('')); buf = []; }
  }
  fs.writeSync(fd, buf.join(''));
  fs.closeSync(fd);
}

/** Every stored row, as an object with numbers parsed; `language` joined from the catalogue. */
function* rows() {
  const langOf = new Map(liveBooks().map(b => [b.id, b.language]));
  for (const f of fs.readdirSync(OUT).filter(f => /^rows\.w\d+\.tsv$/.test(f)).sort()) {
    const text = fs.readFileSync(path.join(OUT, f), 'utf8');
    let at = 0;
    while (at < text.length) {
      let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
      const c = text.slice(at, nl).split('\t'); at = nl + 1;
      if (c.length < COLS.length) continue;
      const r = { book: c[0], p: +c[1], type: c[2], tr: c[3] === '1', caution: c[4] || null, judged: c[5] === '1', why: c[5] === '1' ? null : c[5], script: c[6], units: +c[7], language: langOf.get(c[0]) || '' };
      for (let i = 8; i < COLS.length; i++) r[COLS[i]] = c[i] === '' ? null : +c[i];
      yield r;
    }
  }
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** Median and upper quantiles of each feature, per catalogue language and per script. */
function buildBaselines() {
  const acc = new Map(); // group → feature → Float32 values
  const push = (group, r) => {
    let g = acc.get(group); if (!g) acc.set(group, g = Object.fromEntries(BASELINE_FEATURES.map(f => [f, []])));
    for (const f of BASELINE_FEATURES) if (r[f] != null) g[f].push(r[f]);
  };
  let pages = 0, judged = 0;
  for (const r of rows()) {
    pages++;
    if (!r.judged) continue;
    judged++;
    push(`language:${r.language.trim().toLowerCase()}`, r);
    push(`script:${r.script}`, r);
  }
  const out = { built_at: new Date().toISOString(), pages, judged, groups: {} };
  for (const [group, feats] of acc) {
    const g = { n: feats.oov.length };
    if (g.n < 200) continue;
    for (const f of BASELINE_FEATURES) {
      const v = Float32Array.from(feats[f]).sort();
      if (!v.length) continue;
      g[f] = { n: v.length, p50: +quantile(v, 0.5).toFixed(4), p75: +quantile(v, 0.75).toFixed(4), p90: +quantile(v, 0.9).toFixed(4), p95: +quantile(v, 0.95).toFixed(4), p98: +quantile(v, 0.98).toFixed(4), p99: +quantile(v, 0.99).toFixed(4) };
    }
    out.groups[group] = g;
  }
  fs.writeFileSync(path.join(OUT, 'baselines.json'), JSON.stringify(out, null, 1));
  return out;
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function summarise() {
  const baselines = JSON.parse(fs.readFileSync(path.join(OUT, 'baselines.json'), 'utf8'));
  const tot = { pages: 0, judged: 0, unjudged: {}, flagged: 0, translated: 0, translated_judged: 0, translated_flagged: 0, translated_flagged_already_cautioned: 0, translated_cautioned: 0 };
  const byLang = new Map(), byReason = {}, flaggedBooks = new Map(), pool = [];
  for (const r of rows()) {
    tot.pages++;
    const lang = r.language.trim() || '(none)';
    let L = byLang.get(lang); if (!L) byLang.set(lang, L = { pages: 0, judged: 0, flagged: 0, translated: 0, translated_judged: 0, translated_flagged: 0 });
    L.pages++;
    if (r.tr) { tot.translated++; L.translated++; if (r.caution) tot.translated_cautioned++; }
    if (!r.judged) { tot.unjudged[r.why] = (tot.unjudged[r.why] || 0) + 1; continue; }
    tot.judged++; L.judged++;
    if (r.tr) { tot.translated_judged++; L.translated_judged++; }
    const v = garbleVerdict(r, baselineFor(baselines, r));
    if (!v.garbled) continue;
    tot.flagged++; L.flagged++;
    for (const why of v.reasons) byReason[why] = (byReason[why] || 0) + 1;
    if (r.tr) {
      tot.translated_flagged++; L.translated_flagged++;
      if (r.caution) tot.translated_flagged_already_cautioned++;
      flaggedBooks.set(r.book, (flaggedBooks.get(r.book) || 0) + 1);
      pool.push({ book: r.book, p: r.p, language: r.language, reasons: v.reasons, score: v.score, caution: r.caution });
    }
  }
  const pct = (a, b) => (b ? +(100 * a / b).toFixed(2) : null);
  const summary = {
    verdict_version: VERDICT_VERSION, at: new Date().toISOString(), mirror_baselines_built_at: baselines.built_at,
    ...tot,
    pct_flagged_of_judged: pct(tot.flagged, tot.judged),
    pct_translated_flagged_of_translated_judged: pct(tot.translated_flagged, tot.translated_judged),
    pct_translated_unjudged: pct(tot.translated - tot.translated_judged, tot.translated),
    books_with_a_flagged_translated_page: flaggedBooks.size,
    by_reason: byReason,
    by_language: [...byLang].filter(([, L]) => L.translated_judged >= 2000).sort((a, b) => b[1].translated_judged - a[1].translated_judged)
      .map(([language, L]) => ({ language, ...L, pct_translated_flagged: pct(L.translated_flagged, L.translated_judged) })),
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify({ ...summary, by_language: undefined }, null, 1));
  console.log('language             translated_judged  flagged   %');
  for (const L of summary.by_language) console.log(`${L.language.padEnd(20)} ${String(L.translated_judged).padStart(17)} ${String(L.translated_flagged).padStart(8)} ${String(L.pct_translated_flagged).padStart(6)}`);

  if (SAMPLE) {
    // One page per book (pages of a book are one observation), books in seeded order.
    const rand = mulberry32(SEED);
    const perBook = new Map();
    for (const x of pool) { const a = perBook.get(x.book); if (a) a.push(x); else perBook.set(x.book, [x]); }
    const books = [...perBook.keys()].sort().map(b => [rand(), b]).sort((a, b) => a[0] - b[0]).slice(0, SAMPLE).map(x => x[1]);
    const picks = books.map(b => { const a = perBook.get(b); return a[Math.floor(rand() * a.length)]; });
    fs.writeFileSync(path.join(OUT, 'flag-sample.jsonl'), picks.map(x => JSON.stringify({ ...x, url: `https://sourcelibrary.org/book/${x.book}?page=${x.p}` })).join('\n') + '\n');
    console.log(`Wrote ${picks.length} sampled flagged pages (one per book, seed ${SEED}) → ${path.join(OUT, 'flag-sample.jsonl')}`);
  }
}

async function main() {
  if (flag('summarise')) return summarise();
  if (!fs.existsSync(path.join(LEXICON, '_meta.json'))) {
    console.error(`No lexicon at ${LEXICON}. Run: node scripts/audit/ocr-garble-lexicon.mjs`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT).filter(f => /^rows\.w\d+\.tsv$/.test(f))) fs.rmSync(path.join(OUT, f));
  const self = fileURLToPath(import.meta.url);
  const started = Date.now();
  console.log(`Scoring ${liveBooks().length} live books with ${WORKERS} workers`);
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [self, `--worker=${i}/${WORKERS}`, `--mirror=${MIRROR}`, `--lexicon=${LEXICON}`, `--out=${OUT}`], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}`))));
  })));
  console.log(`  scored in ${((Date.now() - started) / 1000).toFixed(0)}s; building baselines`);
  const b = buildBaselines();
  console.log(`Baselines: ${b.pages} pages, ${b.judged} judged, ${Object.keys(b.groups).length} groups → ${path.join(OUT, 'baselines.json')}`);
}

if (WORKER) await runWorker(); else await main();
