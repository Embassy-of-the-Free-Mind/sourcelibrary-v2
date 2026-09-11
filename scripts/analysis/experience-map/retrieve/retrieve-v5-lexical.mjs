#!/usr/bin/env node
/**
 * Retrieval v5, LEXICAL lane — native-language probes over the original-script OCR (roadmap item 1 of the July
 * experience paper: "probes written directly in the source languages"). The embedding lane can only see
 * translations (page vectors are of the English), so the "translationese" constraint in section 6 of the paper
 * is structural there; this lane searches what the sources themselves wrote.
 *
 * PRIOR ART: ~/sourcelibrary-atlas/scripts/local-corpus/search.mjs (single-query CLI over pages_src/pages_en) and
 * retrieve-v5-local.mjs (semantic lane, same output schema); neither runs a probe SET per (dimension, language)
 * with positive control, a per-book cap and a language-restricted book set, which is what a stratified map needs.
 *
 * Probe sources (recorded on every hit as probe_source): probes/native-west.jsonl + native-east.jsonl (model-authored
 * tradition vocabulary, one dimension per line) and probes/probes-native-derived.json (page-terms lift on July's experiential pages).
 * Every term is positive-controlled: a term with 0 hits in its language's books is reported in
 * v5-lexical-summary.json, never silently dropped. Two-character CJK terms use the pages_cjk index (character
 * spaced; build-cjk-index.mjs); everything else the trigram pages_src (≥3 chars), NFC-normalised.
 * Output hits-v5-lex.jsonl (classify-v3 schema; page_id = book#page, dedupes against the semantic lane) and
 * hits-v5-lex-untranslated.jsonl (native-term hits on pages with no translation: the translation to-do, counted
 * not read).
 *
 *   node scripts/analysis/experience-map/retrieve/retrieve-v5-lexical.mjs [--k 40] [--per-book 3]
 */
import fs from 'node:fs'; import path from 'node:path';
import { createRequire } from 'node:module';
const HOME = process.env.HOME; const SL = path.join(HOME, 'sourcelibrary'); const CORPUS = process.env.SL_CORPUS || path.join(HOME, 'sl-corpus');
const OUT = process.env.V5_OUT || path.join(SL, 'scripts', 'output', 'experience-map', 'v5'); const PROBES = path.join(SL, 'scripts', 'analysis', 'experience-map', 'probes');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const K = +arg('--k', 40), PER_BOOK = +arg('--per-book', 3);
const Database = createRequire(path.join(HOME, 'sourcelibrary-atlas', 'package.json'))('better-sqlite3');
const { stripEditorialWrappers } = await import(path.join(SL, 'scripts', 'lib', 'strip-editorial-wrappers.mjs'));
fs.mkdirSync(OUT, { recursive: true });
const db = new Database(path.join(CORPUS, 'corpus.sqlite'), { readonly: true });
const hasCjk = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='pages_cjk'").get();

// script gates: a term for a non-Latin-script language must contain that script (drops English keyword tags mislabelled by book language)
const SCRIPT = { Greek: /[Ͱ-Ͽἀ-῿]/, Chinese: /[㐀-䶿一-鿿]/, 'Classical Chinese': /[㐀-䶿一-鿿]/, Japanese: /[㐀-䶿一-鿿぀-ヿ]/, Korean: /[가-힯㐀-䶿一-鿿]/, Tibetan: /[ༀ-࿿]/, Arabic: /[؀-ۿ]/, Persian: /[؀-ۿ]/, 'Ottoman Turkish': /[؀-ۿ]/, Hebrew: /[֐-׿]/, Syriac: /[܀-ݏ]/, Armenian: /[԰-֏]/, Coptic: /[Ⲁ-⳿]/, Georgian: /[Ⴀ-ჿ]/, Russian: /[Ѐ-ӿ]/, 'Church Slavonic': /[Ѐ-ӿ]/, Sanskrit: /[ऀ-ॿ]|[āīūṛṝḷṃḥśṣṭḍṇñṅ]/, Pali: /[āīūṃṇḷṭḍñṅ]/, Bengali: /[ঀ-৿]/, Tamil: /[஀-௿]/, Hindi: /[ऀ-ॿ]/, Mongolian: /[᠀-᢯]/, Ethiopic: /[ሀ-፿]/, "Ge'ez": /[ሀ-፿]/, Amharic: /[ሀ-፿]/ };
const CJK = /[㐀-䶿一-鿿]/;
const LANG_MATCH = { Chinese: ['Chinese', 'Classical Chinese'], Greek: ['Greek', 'Ancient Greek', 'Greek-Latin'], Latin: ['Latin', 'Latin-German', 'Greek-Latin'], Persian: ['Persian'], Arabic: ['Arabic', 'Hebrew and Judeo-Arabic'] };

// probe sets
const sets = [];
// authored sets are JSONL (one dimension per line, written incrementally by the authoring agents); derived is JSON
for (const [src, file] of [['authored', 'native-west.jsonl'], ['authored', 'native-east.jsonl'], ['derived', 'probes-native-derived.json']]) { const f = path.join(PROBES, file); if (!fs.existsSync(f)) { console.log(`no ${file}`); continue; } const dims = file.endsWith('.jsonl') ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : JSON.parse(fs.readFileSync(f, 'utf8')).dimensions; for (const d of dims) for (const [lang, terms] of Object.entries(d.terms || {})) for (const t of terms) sets.push({ dim: d.id, lang, term: String(t).normalize('NFC').trim(), src }); console.log(`${file}: ${dims.length} dimensions`); }
const dedup = new Map(); for (const s of sets) { const k = `${s.dim}|${s.lang}|${s.term.toLowerCase()}`; if (!dedup.has(k)) dedup.set(k, s); else dedup.get(k).src += '+' + s.src; }
let probes = [...dedup.values()]; const gated = [];
probes = probes.filter((p) => { const re = SCRIPT[p.lang]; if (re && !re.test(p.term)) { gated.push(p); return false; } const n = [...p.term].length; if (CJK.test(p.term)) return n >= 2; return n >= 3; });
console.log(`${probes.length} probes after script gate (${gated.length} gated: wrong script for their language)`);

// books per language
const bookLang = new Map(); for (const r of db.prepare('SELECT id, language FROM books').iterate()) bookLang.set(r.id, r.language || '');
const cat = new Map(); for (const r of db.prepare('SELECT id, display_title, title, author, language, year_num, visible FROM catalog').iterate()) cat.set(r.id, r);
const langBooks = (lang) => { const names = new Set(LANG_MATCH[lang] || [lang]); const s = new Set(); for (const [id, L] of bookLang) if (names.has(L)) s.add(id); return s; };
const langBookCache = new Map();

const qTri = db.prepare(`SELECT p.book_id, p.p, bm25(pages_src) AS rank FROM pages_src JOIN pages p ON p.rowid = pages_src.rowid WHERE pages_src MATCH ? ORDER BY rank LIMIT ?`);
const qCjk = hasCjk ? db.prepare(`SELECT p.book_id, p.p, bm25(pages_cjk) AS rank FROM pages_cjk JOIN pages p ON p.rowid = pages_cjk.rowid WHERE pages_cjk MATCH ? ORDER BY rank LIMIT ?`) : null;
const fts = (s) => `"${s.replace(/"/g, '""')}"`;

const hits = new Map(); const control = []; let zero = 0, ran = 0, skippedCjk = 0; const t0 = Date.now();
for (const p of probes) {
  if (!langBookCache.has(p.lang)) langBookCache.set(p.lang, langBooks(p.lang)); const books = langBookCache.get(p.lang);
  let rows; const isCjk = CJK.test(p.term);
  if (isCjk) { if (!qCjk) { skippedCjk++; continue; } rows = qCjk.all(fts([...p.term.replace(/\s+/g, '')].join(' ')), K * 20); }
  else rows = qTri.all(fts(p.term), K * 20);
  ran++;
  const inLang = rows.filter((r) => books.has(r.book_id)); const perBook = {}; let kept = 0;
  for (const r of inLang) { perBook[r.book_id] = (perBook[r.book_id] || 0) + 1; if (perBook[r.book_id] > PER_BOOK) continue; const id = `${r.book_id}#${r.p}`; kept++; if (kept > K) break; if (hits.has(id)) { hits.get(id).also = (hits.get(id).also || 0) + 1; continue; } hits.set(id, { book_id: r.book_id, page: r.p, dim: p.dim, probe: p.term, probe_lang: p.lang, probe_source: p.src, slice: `lex:${p.lang}`, rank: r.rank }); }
  control.push({ dim: p.dim, lang: p.lang, term: p.term, src: p.src, raw_hits: rows.length, in_language: inLang.length, kept }); if (!inLang.length) zero++;
  if (ran % 200 === 0) console.log(`${ran}/${probes.length} probes · ${hits.size} pages · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.log(`${ran} probes run, ${zero} with 0 in-language hits, ${skippedCjk} CJK probes skipped (no pages_cjk), ${hits.size} candidate pages`);

// attach text: one read per book
const byBook = new Map(); for (const [id, h] of hits) { if (!byBook.has(h.book_id)) byBook.set(h.book_id, []); byBook.get(h.book_id).push([id, h]); }
const out = fs.createWriteStream(path.join(OUT, 'hits-v5-lex.jsonl')); const untr = fs.createWriteStream(path.join(OUT, 'hits-v5-lex-untranslated.jsonl'));
let kept = 0, missing = 0, short = 0, nofile = 0; const perLang = {};
for (const [b, list] of byBook) { const f = path.join(CORPUS, 'books', `${b}.jsonl`); if (!fs.existsSync(f)) { nofile += list.length; continue; } const want = new Map(list.map(([id, h]) => [h.page, [id, h]])); const c = cat.get(b) || {};
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; const pg = JSON.parse(line); const w = want.get(pg.p); if (!w) continue; const [id, h] = w;
    const base = { page_id: id, book_id: b, page_number: pg.p, book_title: c.display_title || c.title || '', book_author: c.author || '', book_language: c.language || '', book_year: c.year_num ?? null, visible: !!c.visible, dim: h.dim, probe: h.probe, probe_lang: h.probe_lang, probe_source: h.probe_source, slice: h.slice, similarity: null, lex_rank: h.rank, also_matched: h.also || 0, lane: 'lexical' };
    if (!pg.tr) { missing++; untr.write(JSON.stringify({ ...base, has_ocr: !!pg.ocr }) + '\n'); continue; }
    const text = stripEditorialWrappers(pg.tr).trim(); if (text.length < 150) { short++; continue; } kept++; perLang[base.book_language] = (perLang[base.book_language] || 0) + 1; out.write(JSON.stringify({ ...base, text: text.slice(0, 3000) }) + '\n'); } }
out.end(); untr.end();
const zeroTerms = control.filter((c) => !c.in_language).map((c) => `${c.lang}|${c.term}|${c.src}`);
fs.writeFileSync(path.join(OUT, 'v5-lexical-summary.json'), JSON.stringify({ built: new Date().toISOString(), probes: probes.length, gated: gated.length, ran, zero_hit_terms: zero, cjk_index: hasCjk, skippedCjk, candidates: hits.size, kept, untranslated: missing, short, nofile, perLang, control, zeroTerms, gatedTerms: gated.map((g) => `${g.lang}|${g.term}|${g.src}`) }, null, 1));
console.log(`kept ${kept} translated passages; ${missing} native-term hits on UNTRANSLATED pages; short ${short}; no file ${nofile}`);
console.log('per language:', Object.entries(perLang).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([l, n]) => `${l}:${n}`).join('  '));
