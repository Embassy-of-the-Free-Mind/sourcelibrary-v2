#!/usr/bin/env node
// PRIOR ART: scripts/lib/page-terms-parse.mjs (the #3825/#4777 original-note verifier — reused
// here, not rewritten); src/components/reader/NotesRenderer.tsx (the reader's own text pipeline —
// imported, so "leaked" means leaked AFTER the reader's repairs); src/lib/sanitize-translation-tags.ts
// and scripts/maintenance/fix-unclosed-note-tags.mjs (repairs, not a census); scripts/eval/lib/
// agreement-stats.mjs (wilson) and lib/paired-stats.mjs (makeRng). No census of note classes,
// failed originals and leaked markup over one-page-per-book exists (looked: scripts/eval/INDEX.md,
// EXPERIMENTS.md, `ls scripts/audit scripts/maintenance`).
/**
 * quality-census-score.mjs — score the #5700 A1 draw (quality-census-draw.mjs). READ-ONLY, $0.
 *
 * Runs under tsx because it imports the reader's TSX renderer:
 *   npx tsx scripts/eval/quality-census-score.mjs --draw <draw.jsonl> [--out <dir>]
 *
 * Per page (one interior translated page per live translated book):
 *   (a) translation <note>s that describe a decorative initial, or warn about the scan/page
 *       condition (foxing, stains, bleed-through, rotation, blur, cropping…). Printer's
 *       ornaments / headpieces are counted alongside as `ornament`, not in (a).
 *   (b) <note>original: "…"</note> whose quote is `absent` from the page's OCR under
 *       verifyQuote() (page-terms-parse.mjs). `script` (uncheckable) is reported, never counted.
 *   (c) leaked markup: on the RAW stored English (what the API, MCP and exports serve) and on the
 *       text the reader actually SHOWS (NotesRenderer rendered to static HTML, tags stripped).
 *   (e) OCR-risk strata: Latin before 1550, Chinese with interlinear commentary, rotated folios,
 *       pages whose OCR has a high share of garbled tokens (per script).
 * Estimates are page-weighted: each sampled page stands for its book's `pages_translated`
 * (a ratio estimator); CIs are a seeded bootstrap over BOOKS. Book shares carry Wilson CIs.
 */
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseTranslationTerms } from '../lib/page-terms-parse.mjs';
import { wilson } from './lib/agreement-stats.mjs';
import { makeRng } from './lib/paired-stats.mjs';
import { classifyNote, notes, rawLeaks, visibleLeaks } from './lib/quality-census-detectors.mjs';
export * from './lib/quality-census-detectors.mjs';
import NotesRendererMod from '../../src/components/reader/NotesRenderer';

const NotesRenderer = NotesRendererMod.default || NotesRendererMod;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRAW = arg('--draw', '/data/scratch/sl/claude-jobs/qc5700/draw.jsonl');
const OUT = arg('--out', 'scripts/eval/results/quality-census-2026-10');
const BOOT = Number(arg('--boot', 1000));
fs.mkdirSync(OUT, { recursive: true });

const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
export function visibleText(tr) {
  let html;
  try { html = renderToStaticMarkup(React.createElement(NotesRenderer, { text: String(tr || ''), showMetadata: false })); }
  catch (e) { return { error: String(e.message || e) }; }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&(?:lt|gt|amp|quot|nbsp|#x27|#39);/g, m => ENT[m]).replace(/[ \t]+/g, ' ');
  return { text };
}

// ── (e) OCR-risk strata ──────────────────────────────────────────────────────────────────────
const SCRIPTS = { Latin: /\p{Script=Latin}/u, Greek: /\p{Script=Greek}/u, Cyrillic: /\p{Script=Cyrillic}/u, Hebrew: /\p{Script=Hebrew}/u, Arabic: /\p{Script=Arabic}/u, Armenian: /\p{Script=Armenian}/u, Syriac: /\p{Script=Syriac}/u };
const VOWEL = /[aeiouyæœàáâãäåèéêëìíîïòóôõöùúûüýÿāēīōūăĕĭŏŭąęįųůőűȩ]/i;
const ROMAN = /^[ivxlcdm]+$/i;
/** Garbled-token share of the OCR body, per dominant script. Rules, not a dictionary: a token is
 *  garbled when it mixes scripts, mixes letters and digits, repeats one letter 4+ times, carries
 *  an in-word symbol (| ¦ ¬ § ¤ ^ ~ { }), or (Latin) has ≥5 letters and no vowel and is no roman numeral. */
export function garble(ocr) {
  const body = String(ocr || '').replace(/<(page-num|scan-quality|language|lang|script|page-type|vocab|meta|sig|columns|warning|keywords|summary|image-desc|detected-images|abbrev|note|header)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const toks = body.split(/[\s.,;:!?()\[\]"“”‘’«»—–\-*_/\\]+/).filter(t => t.length >= 2);
  const counts = {}; let total = 0, bad = 0;
  for (const tok of toks) {
    const scripts = Object.entries(SCRIPTS).filter(([, re]) => re.test(tok)).map(([k]) => k);
    if (!scripts.length) continue;
    total++;
    for (const s of scripts) counts[s] = (counts[s] || 0) + 1;
    const letters = tok.replace(/[^\p{L}]/gu, '');
    let g = scripts.length > 1
      || (/\p{L}/u.test(tok) && /\d/.test(tok) && !/^\d+(?:st|nd|rd|th|e|er|o|a|um|us)$/i.test(tok))
      || /(\p{L})\1{3,}/u.test(tok)
      || /\p{L}[|¦¬§¤^~{}]+\p{L}/u.test(tok);
    if (!g && scripts[0] === 'Latin' && letters.length >= 5 && !VOWEL.test(letters) && !ROMAN.test(letters)) g = true;
    if (g) bad++;
  }
  const dom = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || (/[\p{Script=Han}]/u.test(body) ? 'Han' : /\p{Script=Tibetan}/u.test(body) ? 'Tibetan' : 'none');
  return { script: dom, tokens: total, garbled: bad, rate: total ? bad / total : null };
}
export const ROTATED_RE = /\brotated\b|\bsideways\b|\bupside[- ]down\b|\b(?:printed|written|oriented|runs?|running|set) (?:vertically|at (?:a|an) (?:90|right)[- ]degree)|\bturned (?:90|on its side)|\blandscape orientation\b/i;
const CJK_COMMENTARY = (ocr) => /<gloss(?:\s[^>]*)?>[^<]*\p{Script=Han}{4,}/u.test(ocr) || /[（(][^）)]*\p{Script=Han}{4,}[^）)]*[）)]/u.test(ocr)
  || /小字|雙行|双行|夾註|夹注|interlinear|double[- ]line|two[- ]line (?:commentary|notes?)|small(?:er)? (?:characters|print) (?:commentary|notes?|annotation)/i.test(ocr);

// ── strata & stats ───────────────────────────────────────────────────────────────────────────
export function yearOf(y) { const m = /\d{3,4}/.exec(String(y ?? '')); return m ? Number(m[0]) : null; }
export function period(y) {
  const v = yearOf(y);
  if (v === null) return 'unknown';
  if (v < 1500) return '<1500';
  if (v < 1600) return '1500s'; if (v < 1700) return '1600s'; if (v < 1800) return '1700s'; if (v < 1900) return '1800s';
  return '1900+';
}
function weightedShare(rows, key) {
  const W = rows.reduce((s, r) => s + r.w, 0);
  return W ? rows.reduce((s, r) => s + (r[key] ? r.w : 0), 0) / W : 0;
}
function bootCI(rows, key, seed) {
  if (rows.length < 2) return [null, null];
  const rng = makeRng(seed); const est = [];
  for (let b = 0; b < BOOT; b++) {
    let W = 0, Y = 0;
    for (let i = 0; i < rows.length; i++) { const r = rows[Math.floor(rng() * rows.length)]; W += r.w; if (r[key]) Y += r.w; }
    est.push(W ? Y / W : 0);
  }
  est.sort((a, b) => a - b);
  return [est[Math.floor(BOOT * 0.025)], est[Math.floor(BOOT * 0.975)]];
}
function summarise(rows, key, seed) {
  const k = rows.filter(r => r[key]).length;
  const share = weightedShare(rows, key);
  const pages = rows.reduce((s, r) => s + r.w, 0);
  const [lo, hi] = bootCI(rows, key, seed);
  const [blo, bhi] = wilson(k, rows.length);
  return { books: rows.length, books_hit: k, book_share: k / rows.length, book_ci: [blo, bhi],
    page_share: share, page_ci: [lo, hi], served_pages: pages, pages_est: Math.round(share * pages),
    pages_ci: lo === null ? null : [Math.round(lo * pages), Math.round(hi * pages)] };
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
const lines = fs.readFileSync(DRAW, 'utf8').split('\n').filter(Boolean);
const rows = [];
const examples = { a: [], b: [], c: [] };
const noteTally = { initial: 0, scan: 0, ornament: 0, all: 0 };
const tierTally = {};
let renderErrors = 0;
for (const l of lines) {
  const d = JSON.parse(l);
  const tr = d.tr || '', ocr = d.ocr || '';
  const r = { book_id: d.book_id, page: d.page_number, title: d.title, language: d.language || 'unknown', period: period(d.year), year: yearOf(d.year), w: d.pages_translated || 1 };
  // (a)
  const cls = { initial: [], scan: [], ornament: [] };
  for (const n of notes(tr)) { noteTally.all++; const c = classifyNote(n); if (c) { cls[c].push(n); noteTally[c]++; } }
  r.a_initial = cls.initial.length > 0; r.a_scan = cls.scan.length > 0; r.a_ornament = cls.ornament.length > 0;
  r.a = r.a_initial || r.a_scan;
  r.a_notes = [...cls.initial.map(x => ['initial', x]), ...cls.scan.map(x => ['scan', x])];
  // (b)
  const orig = parseTranslationTerms(tr, ocr).filter(x => x.kind === 'original');
  for (const o of orig) tierTally[o.match] = (tierTally[o.match] || 0) + 1;
  r.b_has_original = orig.length > 0;
  r.b_absent = orig.filter(o => o.match === 'absent');
  r.b = r.b_absent.length > 0;
  r.b_checkable = orig.some(o => o.match !== 'script');
  // (c)
  const raw = rawLeaks(tr, ocr);
  const vis = visibleText(tr);
  if (vis.error) renderErrors++;
  const vl = vis.text ? visibleLeaks(vis.text) : {};
  r.c_raw = raw; r.c_vis = vl;
  r.c_empty = !!raw.empty_tag; r.c_unclosed = !!raw.unclosed; r.c_unclosed_note = !!raw.unclosed?.includes('note');
  r.c_orphan = !!raw.orphan_close; r.c_brackets = !!raw.brackets_translator; r.c_brackets_any = !!(raw.brackets_translator || raw.brackets_source_has);
  r.c_brackets_meta = !!raw.brackets_meta; r.c_premature_close = !!raw.premature_close;
  r.c_meta_tag = !!raw.meta_tag_in_english;
  r.c_vis_hash = !!vl.vis_hash; r.c_vis_tag = !!vl.vis_tag; r.c_vis_meta = !!vl.vis_meta_word; r.c_vis_arrow = !!vl.vis_centre_arrow;
  r.c_raw_any = r.c_empty || r.c_unclosed || r.c_orphan;
  r.c_vis_any = r.c_vis_hash || r.c_vis_tag || r.c_vis_meta || r.c_vis_arrow;
  r.c = r.c_raw_any || r.c_vis_any || r.c_brackets;
  // (e)
  const g = garble(ocr);
  r.e_script = g.script; r.e_garble_rate = g.rate; r.e_tokens = g.tokens;
  r.e_garble10 = g.tokens >= 30 && g.rate > 0.10; r.e_garble05 = g.tokens >= 30 && g.rate > 0.05;
  r.e_latin_pre1550 = /latin/i.test(r.language) && r.year !== null && r.year < 1550;
  r.e_chinese = /chinese/i.test(r.language);
  r.e_cjk_commentary = r.e_chinese && CJK_COMMENTARY(ocr);
  r.e_rotated = ROTATED_RE.test(ocr) || notes(tr).some(n => ROTATED_RE.test(n));
  rows.push(r);
}

// strata
const topLangs = Object.entries(rows.reduce((m, r) => ((m[r.language] = (m[r.language] || 0) + 1), m), {}))
  .sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k]) => k);
const langOf = r => (topLangs.includes(r.language) ? r.language : 'other');
const KEYS = ['a', 'a_initial', 'a_scan', 'a_ornament', 'b', 'b_has_original', 'c', 'c_raw_any', 'c_vis_any', 'c_empty', 'c_unclosed', 'c_unclosed_note', 'c_orphan', 'c_brackets', 'c_brackets_any', 'c_brackets_meta', 'c_premature_close', 'c_meta_tag', 'c_vis_hash', 'c_vis_tag', 'c_vis_meta', 'c_vis_arrow', 'e_garble05', 'e_garble10', 'e_rotated', 'e_latin_pre1550', 'e_cjk_commentary', 'e_chinese'];
const res = { generated_at: new Date().toISOString(), draw: path.basename(DRAW), pages: rows.length, render_errors: renderErrors, boot: BOOT,
  note_tally: noteTally, original_tier_tally: tierTally, overall: {}, by_language: {}, by_period: {}, garble_by_script: {} };
let seed = 5700;
for (const k of KEYS) res.overall[k] = summarise(rows, k, seed++);
// (b) on the pages that HAVE original-notes (the conditional rate)
res.overall.b_given_original = summarise(rows.filter(r => r.b_has_original), 'b', seed++);
for (const [name, fn] of [['by_language', langOf], ['by_period', r => r.period]]) {
  const groups = {};
  for (const r of rows) (groups[fn(r)] ||= []).push(r);
  for (const [g, rs] of Object.entries(groups)) {
    res[name][g] = {};
    for (const k of ['a', 'a_initial', 'a_scan', 'b', 'c', 'c_vis_any', 'c_raw_any', 'c_brackets', 'c_brackets_meta', 'e_garble10', 'e_rotated']) res[name][g][k] = summarise(rs, k, seed++);
    res[name][g].b_given_original = summarise(rs.filter(r => r.b_has_original), 'b', seed++);
  }
}
const byScript = {};
for (const r of rows) if (r.e_tokens >= 30) (byScript[r.e_script] ||= []).push(r);
for (const [s, rs] of Object.entries(byScript)) {
  const rates = rs.map(r => r.e_garble_rate).sort((a, b) => a - b);
  res.garble_by_script[s] = { pages: rs.length, median: rates[Math.floor(rates.length / 2)], p90: rates[Math.floor(rates.length * 0.9)],
    over05: summarise(rs, 'e_garble05', seed++), over10: summarise(rs, 'e_garble10', seed++) };
}
// Exact stratum sizes from the population metadata (every live translated book is in the draw).
const exact = (pred) => { const rs = rows.filter(pred); return { books: rs.length, pages_translated: rs.reduce((s, r) => s + r.w, 0) }; };
res.exact_strata = {
  all: exact(() => true),
  latin_pre1550: exact(r => r.e_latin_pre1550),
  latin_pre1501: exact(r => /latin/i.test(r.language) && r.year !== null && r.year <= 1500),
  chinese: exact(r => r.e_chinese),
};

// examples: 10 per class, seeded
const rng = makeRng(57001);
const pick = (arr, n) => arr.map(x => ({ x, u: rng() })).sort((a, b) => a.u - b.u).slice(0, n).map(o => o.x);
const link = r => `https://sourcelibrary.org/book/${r.book_id}?page=${r.page}`;
const clip = (s, n = 220) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);
examples.a = pick(rows.filter(r => r.a), 10).map(r => ({ link: link(r), language: r.language, notes: r.a_notes.slice(0, 2).map(([k, n]) => `${k}: ${clip(n)}`) }));
examples.b = pick(rows.filter(r => r.b), 10).map(r => ({ link: link(r), language: r.language, absent: r.b_absent.slice(0, 2).map(o => `"${o.term}"${o.gloss ? ` (${o.gloss})` : ''} — after: …${clip(o.context || '', 80)}`) }));
examples.c = pick(rows.filter(r => r.c_vis_any || r.c_raw_any), 10).map(r => ({ link: link(r), language: r.language,
  leaks: [...Object.entries(r.c_vis).map(([k, v]) => `${k}: …${clip(v, 90)}…`), ...Object.entries(r.c_raw).filter(([k]) => !k.startsWith('brackets') && k !== 'meta_tag_in_english').map(([k, v]) => `${k}: ${clip(JSON.stringify(v), 90)}`)] }));
examples.c_brackets = pick(rows.filter(r => r.c_brackets), 10).map(r => ({ link: link(r), language: r.language, brackets: r.c_raw.brackets_translator }));
examples.c_brackets_meta = pick(rows.filter(r => r.c_brackets_meta), 10).map(r => ({ link: link(r), language: r.language, brackets: r.c_raw.brackets_meta }));
res.examples = examples;

fs.writeFileSync(path.join(OUT, 'census.json'), JSON.stringify(res, null, 2));
// Per-page flags (no text) so every number can be re-derived and audited.
// One line per sampled page: the draw manifest plus the flags that FIRED (absent = 0).
fs.writeFileSync(path.join(OUT, 'pages.jsonl'), rows.map(r => JSON.stringify({
  b: r.book_id, p: r.page, l: r.language, y: r.period, w: r.w,
  f: KEYS.filter(k => r[k]), g: r.e_garble_rate === null ? null : Number(r.e_garble_rate.toFixed(3)),
})).join('\n') + '\n');
// By-eye review packets (text excerpts; kept OUT of git — raw dir).
const RAWDIR = arg('--raw', path.dirname(DRAW));
fs.writeFileSync(path.join(RAWDIR, 'review-a.jsonl'), pick(rows.filter(r => r.a || r.a_ornament), 120).map(r => JSON.stringify({ link: link(r), notes: r.a_notes.map(([k, n]) => `${k}: ${clip(n, 300)}`) })).join('\n'));
fs.writeFileSync(path.join(RAWDIR, 'review-c.jsonl'), pick(rows.filter(r => r.c_vis_any || r.c_raw_any), 120).map(r => JSON.stringify({ link: link(r), vis: r.c_vis, raw: r.c_raw })).join('\n'));
console.log(JSON.stringify({ pages: rows.length, render_errors: renderErrors, note_tally: noteTally, tiers: tierTally,
  overall: Object.fromEntries(Object.entries(res.overall).map(([k, v]) => [k, `${(v.page_share * 100).toFixed(2)}% [${(v.page_ci[0] * 100).toFixed(2)}–${(v.page_ci[1] * 100).toFixed(2)}] ≈ ${v.pages_est} pages; books ${v.books_hit}/${v.books}`])) }, null, 1));
