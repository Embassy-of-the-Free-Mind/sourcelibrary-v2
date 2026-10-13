#!/usr/bin/env node
/**
 * Lexical lane of the aliveness atlas (#6652): FTS5 phrase search over the local mirror's ENGLISH translations
 * (~/sl-corpus/corpus.sqlite, table pages_en, rowid = pages.rowid), for the phrases in probes/probes-aliveness-lexical.json.
 *
 * Two outputs, both model-free:
 *  1. lexical-counts.json — for EVERY phrase, the number of translated pages that contain it, split by century and by
 *     edition language, with the translated-page denominators per century so a rate per 10K pages can be quoted.
 *     Zero-hit phrases are listed (a phrase with no hits tests nothing).
 *  2. hits-lex.jsonl — up to PER_PHRASE randomly drawn pages per phrase (seeded), deduplicated by book#page, carrying
 *     the translation text, in the classifier's input schema (lane: 'lexical'). These go to the screen and the judge.
 * PRIOR ART: retrieve/retrieve-v5-lexical.mjs — native-script terms over ORIGINAL-language OCR (pages_src trigram);
 * it does not fit because this lane searches the English translation for translators' phrasing, and needs per-phrase
 * century/language counts that the v5 lane does not produce.
 *   node retrieve/retrieve-aliveness-lexical.mjs [--per 40]
 */
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const HOME = process.env.HOME; const SL = path.join(HOME, 'sourcelibrary');
const CORPUS = process.env.SL_CORPUS || path.join(HOME, 'sl-corpus');
const OUT = process.env.ALIVE_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'aliveness');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const PER = +arg('--per', 40);
const { stripEditorialWrappers } = await import(path.join(SL, 'scripts', 'lib', 'strip-editorial-wrappers.mjs'));
const Database = createRequire(path.join(HOME, 'sourcelibrary-atlas', 'package.json'))('better-sqlite3');
const db = new Database(path.join(CORPUS, 'corpus.sqlite'), { readonly: true });
const { dimensions } = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'probes', 'probes-aliveness-lexical.json'), 'utf8'));

// catalogue + denominators
const cat = new Map(); for (const r of db.prepare('SELECT id, display_title, title, author, language, year_num, visible FROM catalog').iterate()) cat.set(r.id, r);
const cent = (y) => (Number.isFinite(y) ? Math.floor(y / 100) * 100 : null);
const denom = {}; for (const r of db.prepare('SELECT book_id, count(*) n FROM pages WHERE tr = 1 GROUP BY book_id').iterate()) { const c = cent(cat.get(r.book_id)?.year_num); const k = c ?? 'nd'; denom[k] = (denom[k] || 0) + r.n; }

// seeded shuffle
let seed = 6652; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const q = db.prepare('SELECT p.book_id, p.p FROM pages_en e JOIN pages p ON p.rowid = e.rowid WHERE pages_en MATCH ?');
const counts = {}; const zero = []; const picked = new Map();
for (const [dim, phrases] of Object.entries(dimensions)) {
  for (const ph of phrases) {
    const rows = q.all(`"${ph.replace(/"/g, '')}"`);
    const byC = {}, byL = {}; for (const r of rows) { const b = cat.get(r.book_id) || {}; const c = cent(b.year_num) ?? 'nd'; byC[c] = (byC[c] || 0) + 1; const L = b.language || '?'; byL[L] = (byL[L] || 0) + 1; }
    counts[ph] = { dim, pages: rows.length, books: new Set(rows.map((r) => r.book_id)).size, byCentury: byC, byLanguage: Object.fromEntries(Object.entries(byL).sort((a, b) => b[1] - a[1]).slice(0, 12)) };
    if (!rows.length) { zero.push(ph); continue; }
    for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    for (const r of rows.slice(0, PER)) { const id = `${r.book_id}#${r.p}`; if (!picked.has(id)) picked.set(id, { book_id: r.book_id, p: r.p, dim, phrase: ph }); }
    console.log(`${dim.padEnd(17)} ${String(rows.length).padStart(6)} pages  "${ph}"`);
  }
}

// attach text, one read per book
const byBook = new Map(); for (const [id, h] of picked) { if (!byBook.has(h.book_id)) byBook.set(h.book_id, []); byBook.get(h.book_id).push([id, h]); }
const out = fs.createWriteStream(path.join(OUT, 'hits-lex.jsonl')); let kept = 0, miss = 0;
for (const [b, list] of byBook) {
  const f = path.join(CORPUS, 'books', `${b}.jsonl`); if (!fs.existsSync(f)) { miss += list.length; continue; }
  const want = new Map(list.map(([id, h]) => [h.p, [id, h]])); const c = cat.get(b) || {};
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; const pg = JSON.parse(line); const w = want.get(pg.p); if (!w || !pg.tr) continue; const [id, h] = w;
    const text = stripEditorialWrappers(pg.tr).trim(); if (text.length < 150) continue;
    out.write(JSON.stringify({ page_id: id, book_id: b, page_number: pg.p, book_title: c.display_title || c.title || '', book_author: c.author || '', book_language: c.language || '', book_year: c.year_num ?? null, visible: !!c.visible, dim: h.dim, probe: h.phrase, slice: 'lexical', similarity: null, lane: 'lexical', text: text.slice(0, 3000) }) + '\n'); kept++; }
}
out.end();
fs.writeFileSync(path.join(OUT, 'lexical-counts.json'), JSON.stringify({ built: new Date().toISOString(), per_phrase_sample: PER, translated_pages_by_century: denom, zero_hit: zero, phrases: counts }, null, 1));
console.log(`${Object.keys(counts).length} phrases (${zero.length} zero-hit: ${zero.join('; ')}); sampled ${picked.size} pages → ${kept} with text (${miss} no mirror file)`);
