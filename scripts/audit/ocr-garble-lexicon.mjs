#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/aggregate-page-terms.mjs — aggregates the OCR's own <vocab>
 * and the translation's <term> tags into a glossary (a few terms a page, chosen by the model);
 * it is not a wordlist of what the corpus's running text contains. scripts/audit/
 * ocr-loop-corpus.mjs — the mirror-walk skeleton this follows. No per-language wordlist exists
 * in the repo (looked: scripts/lib, scripts/audit, scripts/eval/lib, scripts/analysis).
 *
 * Build the corpus-derived lexicon the garble detector looks words up in (#5313).
 *
 * WHY CORPUS-DERIVED
 * ------------------
 * The library is early-modern print and manuscript: `vnnd`, `q̃`, `ſubſtantia`, `κ(αὶ)`. A
 * modern dictionary calls a clean incunable garbage. A word that appears in the running text
 * of several DIFFERENT books of the corpus is a word of this corpus, whatever a dictionary
 * says; a garble is idiosyncratic to its page. So the lexicon is: every unit (word, Tibetan
 * syllable bigram, CJK character bigram — see scripts/lib/ocr-garble-score.mjs) with the
 * number of distinct books it occurs in. The scorer takes "in >= 3 books" as "a word".
 *
 * A book cannot vouch for its own garble: the floor is 3 books, so one book's repeated
 * misreading never enters. What this CANNOT exclude is an error the OCR model makes the same
 * way across many books — that is in the lexicon, and the detector is blind to it.
 *
 * Reads the local mirror only (~/sl-corpus: catalog.jsonl + books/<id>.jsonl). NEVER WRITES to
 * any database. Output is per-machine, in the mirror directory, not in the repo.
 *
 * Usage:
 *   node scripts/audit/ocr-garble-lexicon.mjs                       # ~/sl-corpus → ~/sl-corpus/garble-lexicon
 *   node scripts/audit/ocr-garble-lexicon.mjs --pages-per-book=60 --workers=10
 *
 * Flags:
 *   --mirror=DIR          mirror root (default ~/sl-corpus)
 *   --out=DIR             lexicon directory (default <mirror>/garble-lexicon)
 *   --pages-per-book=N    evenly spaced text pages read per book (default 60)
 *   --workers=N           parallel readers (default 10)
 *   --min-books=N         floor for a unit to be STORED (default 2; the scorer applies its own, 3)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { garbleBody, tokensOf, lexiconUnitsOf, latinLangOf, LATIN_LANGS, lexiconFile } from '../lib/ocr-garble-score.mjs';

const arg = (n, d) => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};

const MIRROR = arg('mirror', path.join(os.homedir(), 'sl-corpus'));
const OUT = arg('out', path.join(MIRROR, 'garble-lexicon'));
const PAGES_PER_BOOK = Number(arg('pages-per-book', '60'));
const WORKERS = Number(arg('workers', '10'));
const MIN_BOOKS = Number(arg('min-books', '2'));
const WORKER = arg('worker', '');
const BUCKETS = 64;
const TMP = path.join(OUT, 'tmp');

/** Page types with no running text to learn words from. */
const SKIP_TYPES = new Set(['blank', 'illustration', 'frontispiece', 'diagram', 'digitizer-insert', 'archived-spread', 'plate', 'map']);

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

const bucketOf = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % BUCKETS;
};

function runWorker() {
  const [idx, of] = WORKER.split('/').map(Number);
  const books = liveBooks().filter((_, i) => i % of === idx);
  const bufs = Array.from({ length: BUCKETS }, () => []);
  const sizes = new Array(BUCKETS).fill(0);
  const flush = (b) => {
    if (!bufs[b].length) return;
    fs.appendFileSync(path.join(TMP, `w${idx}.b${b}.tsv`), bufs[b].join(''));
    bufs[b] = []; sizes[b] = 0;
  };
  const stats = { books: 0, pages: 0, missing: 0, byKeyBooks: {} };
  for (const book of books) {
    let text;
    try { text = fs.readFileSync(path.join(MIRROR, 'books', `${book.id}.jsonl`), 'utf8'); } catch { stats.missing++; continue; }
    const lines = text.split('\n').filter(Boolean);
    const step = Math.max(1, lines.length / PAGES_PER_BOOK);
    const counts = new Map();
    let read = 0;
    for (let x = 0; x < lines.length && read < PAGES_PER_BOOK; x += step) {
      let d; try { d = JSON.parse(lines[Math.floor(x)]); } catch { continue; }
      if (!d.ocr || SKIP_TYPES.has(d.type)) continue;
      read++;
      for (const [k, u] of lexiconUnitsOf(tokensOf(garbleBody(d.ocr)))) {
        const id = k + '\t' + u;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    if (!read) continue;
    stats.books++; stats.pages += read;
    const lang = LATIN_LANGS.indexOf(latinLangOf(book.language));
    const keys = new Set();
    for (const [id, tf] of counts) {
      const b = bucketOf(id);
      const row = `${id}\t${tf}\t${lang}\n`;
      bufs[b].push(row); sizes[b] += row.length;
      if (sizes[b] > 1 << 20) flush(b);
      keys.add(id.slice(0, id.indexOf('\t')));
    }
    for (const k of keys) {
      stats.byKeyBooks[k] = (stats.byKeyBooks[k] || 0) + 1;
      if (k === 'Latin' && lang >= 0) {
        const lk = `Latin@${LATIN_LANGS[lang]}`;
        stats.byKeyBooks[lk] = (stats.byKeyBooks[lk] || 0) + 1;
      }
    }
  }
  for (let b = 0; b < BUCKETS; b++) flush(b);
  fs.writeFileSync(path.join(TMP, `w${idx}.stats.json`), JSON.stringify(stats));
}

async function main() {
  // The output directory is replaced wholesale; only ever replace one this script wrote.
  if (fs.existsSync(OUT) && fs.readdirSync(OUT).length && !fs.existsSync(path.join(OUT, '_meta.json')) && !fs.existsSync(TMP)) {
    console.error(`${OUT} exists and is not a lexicon directory (no _meta.json). Refusing to replace it.`);
    process.exit(2);
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  const self = fileURLToPath(import.meta.url);
  const started = Date.now();
  console.log(`Lexicon: ${liveBooks().length} live books with OCR, ${PAGES_PER_BOOK} pages each, ${WORKERS} workers`);
  await Promise.all(Array.from({ length: WORKERS }, (_, i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [self, `--worker=${i}/${WORKERS}`, `--mirror=${MIRROR}`, `--out=${OUT}`, `--pages-per-book=${PAGES_PER_BOOK}`], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}`))));
  })));
  console.log(`  map done in ${((Date.now() - started) / 1000).toFixed(0)}s; reducing ${BUCKETS} buckets`);

  const meta = { built_at: new Date().toISOString(), mirror: MIRROR, pages_per_book: PAGES_PER_BOOK, min_books_stored: MIN_BOOKS, books: 0, pages: 0, keys: {} };
  for (let i = 0; i < WORKERS; i++) {
    const s = JSON.parse(fs.readFileSync(path.join(TMP, `w${i}.stats.json`), 'utf8'));
    meta.books += s.books; meta.pages += s.pages;
    for (const [k, n] of Object.entries(s.byKeyBooks)) (meta.keys[k] ||= { books: 0, tokens: 0, units: 0 }).books += n;
  }
  const sinks = new Map();
  const sink = (key) => {
    if (!sinks.has(key)) sinks.set(key, fs.openSync(path.join(OUT, lexiconFile(key)), 'w'));
    return sinks.get(key);
  };
  for (let b = 0; b < BUCKETS; b++) {
    const acc = new Map(); // "key\tunit" → [books, tokens]
    const add = (id, tf) => { const e = acc.get(id); if (e) { e[0]++; e[1] += tf; } else acc.set(id, [1, tf]); };
    for (let i = 0; i < WORKERS; i++) {
      const f = path.join(TMP, `w${i}.b${b}.tsv`);
      if (!fs.existsSync(f)) continue;
      const text = fs.readFileSync(f, 'utf8');
      let at = 0;
      while (at < text.length) {
        let nl = text.indexOf('\n', at); if (nl < 0) nl = text.length;
        const line = text.slice(at, nl); at = nl + 1;
        const c = line.lastIndexOf('\t'), t = line.lastIndexOf('\t', c - 1);
        if (t < 0) continue;
        const id = line.slice(0, t), tf = +line.slice(t + 1, c), lang = +line.slice(c + 1);
        add(id, tf);
        if (lang >= 0 && id.startsWith('Latin\t')) add(`Latin@${LATIN_LANGS[lang]}${id.slice(5)}`, tf);
      }
      fs.rmSync(f);
    }
    const out = new Map();
    for (const [id, [bf, tf]] of acc) {
      const tab = id.indexOf('\t');
      const key = id.slice(0, tab);
      const m = (meta.keys[key] ||= { books: 0, tokens: 0, units: 0 });
      m.tokens += tf;
      if (bf < MIN_BOOKS) continue;
      m.units++;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(`${id.slice(tab + 1)}\t${bf}\t${tf}\n`);
    }
    for (const [key, rows] of out) fs.writeSync(sink(key), rows.join(''));
  }
  for (const fd of sinks.values()) fs.closeSync(fd);
  // A key with no stored unit has no file; drop it so the loader does not look for one.
  for (const k of Object.keys(meta.keys)) if (!meta.keys[k].units) delete meta.keys[k];
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.writeFileSync(path.join(OUT, '_meta.json'), JSON.stringify(meta, null, 2));
  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s: ${meta.books} books, ${meta.pages} pages → ${OUT}`);
  for (const [k, v] of Object.entries(meta.keys).sort((a, b) => b[1].units - a[1].units).slice(0, 30)) {
    console.log(`  ${k.padEnd(16)} ${String(v.books).padStart(6)} books  ${String(v.units).padStart(9)} units  ${String(v.tokens).padStart(11)} tokens`);
  }
}

if (WORKER) runWorker(); else await main();
