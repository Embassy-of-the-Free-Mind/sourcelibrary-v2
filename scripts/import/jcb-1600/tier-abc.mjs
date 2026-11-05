#!/usr/bin/env node
// PRIOR ART: scripts/import/jcb-1600/catalogue.mjs consumes title tiers (1a/1b/2/3); this replaces
// them with Derek's content tiers A/B/C (inbox 2026-11-04 10:28), from screen.mjs output. No writes.
//
// A  about the Americas: OCR the whole book.
// B  treats them in part: OCR the strong-hit pages and 2 either side (page ids listed per book).
// C  no hits: catalogue + archive, no OCR now.
//
// Rules (each row carries the one that fired, in `why`):
//   screen trusted = status ok AND lex_share >= LEX_PARTIAL. Measured on 37 held controls with truth
//   pages (leave-one-out lexicon, recall within ±2 pages, page-weighted): lex >= 0.75 -> 0.94
//   (1010/1074); 0.65-0.75 -> 0.65 (255/393); < 0.65 -> 0.45 (141/313; Columbus 1493 0/5).
//   So 0.65-0.75 decides the tier but is flagged `rescreen` (its page list is short).
//   trusted:   A if density >= 0.15, or title tier 1 and density >= 0.03 (Staden 1558 at 4.6% was B), or extra-A list;
//              B if any strong page, or >= 3 weak-only pages;  else C.
//   any tier: a book of <= 60 pages with any hit, title tier 1-2, or an untrusted screen -> A (R1).
//   untrusted (garbled or missing IA text, typically early gothic): the TITLE tier decides —
//              title 1 -> A; title 2 -> B on whatever hits exist (flagged `rescreen` for a GPU-draft
//              screen, since the hit list is known to be short); title 3 -> C (flagged `rescreen`).
//
// node scripts/import/jcb-1600/tier-abc.mjs --screen DIR --title-tiers F.json [--extra-a ids] --out DIR
import fs from 'node:fs';
import path from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const SCR = arg('--screen'); const OUT = arg('--out');
const LEX_MIN = Number(arg('--lex-min', '0.75'));
const LEX_PARTIAL = Number(arg('--lex-partial', '0.65'));
const NEIGH = 2;
const SHORT = Number(arg('--short', '60'));
const extraA = new Set((arg('--extra-a', '') || '').split(',').filter(Boolean));
const tt = JSON.parse(fs.readFileSync(arg('--title-tiers'), 'utf8'));
const titleTier = {}; for (const [t, ids] of Object.entries(tt)) for (const id of ids) titleTier[id] = Number(t);
const readJl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const books = readJl(path.join(SCR, 'books.jsonl'));
const hits = readJl(path.join(SCR, 'hits.jsonl'));
const byBook = {}; for (const h of hits) (byBook[h.book_id] ??= []).push(h);
fs.mkdirSync(OUT, { recursive: true });

// Our page list per book (idx -> page_id) comes from hits only for hit pages; neighbours need the full
// order, so screen.mjs's idx is used and the caller resolves idx -> page id (pages-by-idx below).
const rows = [];
for (const b of books) {
  const t = titleTier[b.ia] ?? null;
  const hs = byBook[b.book_id] || [];
  const strongIdx = hs.filter(h => h.strong).map(h => h.idx);
  const weakIdx = hs.filter(h => !h.strong).map(h => h.idx);
  const trusted = b.status === 'ok' && (b.lex_share ?? 0) >= LEX_PARTIAL;
  const partial = trusted && b.lex_share < LEX_MIN;
  let tier, why, rescreen = false;
  if (extraA.has(b.book_id)) { tier = 'A'; why = 'named in the brief (Vespucci six)'; }
  else if (trusted) {
    if (b.density >= 0.15) { tier = 'A'; why = `dense hits ${(b.density * 100).toFixed(0)}%`; }
    else if (t === 1 && b.density >= 0.03) { tier = 'A'; why = `title 1 + hits ${(b.density * 100).toFixed(1)}%`; }
    else if (strongIdx.length) { tier = 'B'; why = `${strongIdx.length} strong hit pages`; }
    else if (weakIdx.length >= 3) { tier = 'B'; why = `${weakIdx.length} weak-only hit pages`; }
    else { tier = 'C'; why = weakIdx.length ? `only ${weakIdx.length} weak hit page(s)` : 'no hits'; }
    if (partial && tier !== 'A') { rescreen = true; why += ` (IA text partial, lex ${b.lex_share})`; }
  } else {
    rescreen = true;
    const cause = b.status !== 'ok' ? `IA text ${b.status}` : `IA text garbled (lex ${b.lex_share})`;
    if (t === 1) { tier = 'A'; why = `${cause}; title tier 1`; rescreen = false; }
    else if (t === 2) { tier = 'B'; why = `${cause}; title tier 2, ${strongIdx.length} strong hit pages`; }
    else { tier = strongIdx.length ? 'B' : 'C'; why = `${cause}; title tier ${t ?? '?'}${strongIdx.length ? `, ${strongIdx.length} strong hit pages` : ''}`; }
  }
  // R1 (by-eye check of 30 decisions, 2026-11-04: 9 wrong, 6 of them short pamphlets set too low —
  // Newe Zeytung Presillg Landt, Villegaignon 1557, Lancaster 1595, Ein Auszug 1520 — where the IA text
  // is thin or garbled): a short book with any signal is read whole. +1,833 pages over 68 books.
  if (tier !== 'A' && b.pages <= SHORT && (strongIdx.length || weakIdx.length || (t && t <= 2) || rescreen)) {
    tier = 'A'; why += `; short (${b.pages} pp) with a signal: read whole`; rescreen = false;
  }
  let ocrIdx = [];
  if (tier === 'A') ocrIdx = null; // whole book
  else if (tier === 'B') {
    const src = strongIdx.length ? strongIdx : weakIdx;
    const s = new Set();
    for (const i of src) for (let d = -NEIGH; d <= NEIGH; d++) if (i + d >= 0 && i + d < b.pages) s.add(i + d);
    ocrIdx = [...s].sort((x, y) => x - y);
  }
  rows.push({ book_id: b.book_id, ia: b.ia, language: b.language, pages: b.pages, title_tier: t, screen_status: b.status, lex_share: b.lex_share ?? null,
    strong_pages: strongIdx.length, weak_pages: weakIdx.length, density: b.density ?? null, families: b.families ?? null,
    tier, why, rescreen, ocr_pages: tier === 'A' ? b.pages : tier === 'B' ? ocrIdx.length : 0, ocr_idx: ocrIdx });
}
fs.writeFileSync(path.join(OUT, 'tiers-abc.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const sum = {};
for (const r of rows) { const s = (sum[r.tier] ??= { books: 0, pages: 0, ocr_pages: 0, rescreen: 0 }); s.books++; s.pages += r.pages || 0; s.ocr_pages += r.ocr_pages; s.rescreen += r.rescreen ? 1 : 0; }
const total = rows.reduce((a, r) => a + (r.pages || 0), 0), ocr = rows.reduce((a, r) => a + r.ocr_pages, 0);
console.log(JSON.stringify({ lex_min: LEX_MIN, lex_partial: LEX_PARTIAL, by_tier: sum, total_pages: total, ocr_pages: ocr, pages_saved: total - ocr }, null, 1));
