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
import NotesRendererMod from '../../src/components/reader/NotesRenderer';

const NotesRenderer = NotesRendererMod.default || NotesRendererMod;
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRAW = arg('--draw', '/data/scratch/sl/claude-jobs/qc5700/draw.jsonl');
const OUT = arg('--out', 'scripts/eval/results/quality-census-2026-10');
const BOOT = Number(arg('--boot', 1000));
fs.mkdirSync(OUT, { recursive: true });

// ── (a) note classes ─────────────────────────────────────────────────────────────────────────
const NOT_A_LETTER = '(?!\\s+(?:stage|phase|state|step|steps|part|section|word|words|sentence|condition|pattern|position|position|value|values|letters? of (?:each|the words)|sound|vowel|consonant))';
export const INITIAL_RE = new RegExp(
  '\\bdrop[- ]?caps?\\b' +
  '|\\b(?:decorat\\w*|ornate|ornament\\w*|woodcut|engraved|illuminat\\w*|historiated|inhabited|foliated|floriated|flourished|rubricated|calligraphic|red|blue|gold(?:en)?|large|capital|figured|zoomorphic|pictorial|factotum|initial)\\s+(?:[\\w\'’-]+[\\s,]+){0,3}?initials?\\b' + NOT_A_LETTER +
  '|\\binitials?\\s+(?:letter|capital)s?\\b' +
  '|\\binitial\\s+["\'‘“(]?[A-ZÀ-ÞΑ-Ω\\u0531-\\u0556\\u05D0-\\u05EA]["\'’”)]?(?=[\\s.,;:)]|$)', 'i');
export const SCAN_RE = new RegExp([
  '\\bfox(?:ing|ed)\\b', '\\bspeckl\\w*', '\\b(?:water|ink|damp|mou?ld|brown|tide)[- ]?stain\\w*',
  '\\bstain(?:ed|ing|s)?\\b', '\\bbleed[- ]?through\\b', '\\bshow[- ]?through\\b', '\\bink (?:has )?(?:bled|bleeding)\\b',
  '\\b(?:reversed|mirror(?:ed)?|ghost(?:ed)?) (?:impression|image|text)s?\\b', '\\boffset(?:ting)? (?:of|from) (?:the )?(?:facing|opposite)\\b',
  '\\bfad(?:ed|ing)\\b', '\\bblurr(?:ed|y|ing)\\b', '\\bout of focus\\b', '\\bsmudg\\w*', '\\bworm[- ]?(?:holes?|eaten|damage)\\b',
  '\\b(?:paper|page|leaf|scan|image|margin|corner|edge|text) (?:is |are |has been )?(?:damaged|torn|creased|crumpled|trimmed|cropped|cut off)\\b',
  '\\b(?:damaged|torn|creased|crumpled|trimmed|cropped) (?:paper|page|leaf|scan|image|margin|corner|edge|area|portion|section)\\b',
  '\\bcut off (?:at|by|along) the (?:edge|margin|binding|gutter|scan|image|page|bottom|top|right|left)\\b',
  '\\b(?:gutter|binding|fold) (?:obscures|hides|swallows|obscuring)\\b', '\\bobscured by (?:the )?(?:binding|gutter|fold|stain|damage|tape)\\b',
  '\\brotated\\b', '\\bsideways\\b', '\\bupside[- ]down\\b', '\\b(?:printed|written|oriented|running) (?:vertically|at (?:a|an) (?:90|right)[- ]degree)',
  '\\b(?:image|scan|photograph|reproduction|microfilm) (?:quality|resolution)\\b', '\\blow[- ]resolution\\b', '\\bpoor(?:ly)? (?:scanned|quality|legib\\w*|reproduc\\w*)\\b',
  '\\bdiscolou?r\\w*', '\\b(?:yellow|brown)(?:ed|ing) (?:paper|page)\\b', '\\bbrowning\\b', '\\b(?:paper|tape) repair\\b',
].join('|'), 'i');
export const ORNAMENT_RE = /\b(?:head-?pieces?|tail-?pieces?|fleurons?|printer'?s (?:ornaments?|devices?|flowers?|marks?)|typographic(?:al)? ornaments?|cul-de-lampe|vignettes?|(?:ornamental|decorative) (?:borders?|bands?|rules?|frames?|bars?|dividers?|lines?|elements?|ornaments?|flourish\w*|motifs?|pieces?|devices?))\b/i;

// A scan warning talks about THIS page's text or leaf. A condition word inside a description of
// an illustration, a cover, a stamp or a watermark is an image description (its own class, not
// counted here): by eye, 32 of the first 50 SCAN_RE hits were that.
const SCAN_SUBJECT = /\b(?:page|text|leaf|leaves|folio|paper|columns?|lines?|portion|section|corner|reverse|verso|recto|margins?|scan|legib\w*|illegib\w*|obscur\w*|characters|words?|writing|script|ink)\b/i;
const IMAGE_DESC_OPENER = /^(?:editorial note:\s*)?(?:a|an|the)\s+(?:[\w,'-]+\s+){0,5}?(?:woodcut|engraving|etching|illustration|photograph|drawing|image shows|cover|binding|spine|fore-edge|watermark|diagram|miniature|stamp|label|portrait|plate|map|figure|emblem|frontispiece|seal)\b/i;
const NOT_CONDITION = /\b(?:front cover|back cover|spine|fore-edge|binding|watermark|bookplate|mirror[- ]script|ex libris)\b/i;
export function isScanWarning(t) {
  return SCAN_RE.test(t) && SCAN_SUBJECT.test(t) && !IMAGE_DESC_OPENER.test(t) && !NOT_CONDITION.test(t);
}

export function classifyNote(body) {
  const t = String(body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^\s*(?:original|orig\.|lit\.|literally|alt\.|alternative|or\b|cf\.|i\.e\.|continu\w+ from)/i.test(t)) return null;
  if (INITIAL_RE.test(t)) return 'initial';
  if (isScanWarning(t)) return 'scan';
  if (ORNAMENT_RE.test(t)) return 'ornament';
  return null;
}
function notes(tr) {
  return [...String(tr || '').matchAll(/<note(?:\s[^>]*)?>([\s\S]*?)<\/note>/gi)].map(m => m[1]);
}

// ── (c) leaked markup ────────────────────────────────────────────────────────────────────────
export const BRACKET_META = /^\s*(?:blank(?: page)?\b|(?:no )?translat(?:ion|able|ed)\b|translation of\b|(?:the )?(?:note|text|page|passage|list|table|line|entry) (?:continues|is|ends|breaks|cut)|name|title|author|date|number|illegible|unclear|several (?:lines|words)|(?:text|lines?|words?) (?:missing|illegible|cut off|obscured|damaged)|continued|continu(?:es|ing) (?:from|on)|from (?:the )?previous page|see (?:previous|next)|image|figure|illustration|diagram|page (?:\d+|break|ends)|end of (?:page|text)|(?:greek|latin|hebrew|arabic|chinese|syriac|german|french) (?:text|word|phrase|passage)|transcri)/i;
const PAIRED = ['note', 'margin', 'gloss', 'term', 'insert', 'unclear', 'header', 'page-num', 'image-desc', 'interp', 'meta', 'summary', 'keywords', 'sig', 'warning', 'vocab'];
export function rawLeaks(tr, ocr) {
  const t = String(tr || '');
  const out = {};
  const empty = /<(margin|note|gloss|term|insert|unclear|header|page-num|sig|interp|image-desc|meta|summary|keywords)(?:\s[^>]*)?>\s*<\/\1>/i.exec(t);
  if (empty) out.empty_tag = empty[0];
  for (const tag of PAIRED) {
    const opens = (t.match(new RegExp(`<${tag}(?:\\s[^>]*)?(?<!/)>`, 'gi')) || []).length;
    const closes = (t.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length;
    if (opens > closes) (out.unclosed ||= []).push(tag);
    if (closes > opens) (out.orphan_close ||= []).push(tag);
  }
  // Square brackets the translation prompt forbids ("Bare [square brackets] for interpolations").
  // Exclude the legacy [[tag: …]] syntax and markdown links. A page whose OCR carries brackets
  // too may be the source's own; reported apart.
  const plain = t.replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\[[^\]\n]*\]\([^)]*\)/g, ' ');
  const br = plain.match(/\[[^\[\]\n]{1,120}\]/g) || [];
  if (br.length) {
    const ocrHas = /\[[^\[\]\n]{1,120}\]/.test(String(ocr || ''));
    out[ocrHas ? 'brackets_source_has' : 'brackets_translator'] = br.slice(0, 3);
    // The harmful subclass: not an interpolated word but the model talking — a placeholder
    // ("[Name]", "[Title]") or a description of the page ("[Blank page — no translatable content]",
    // "[The note continues…]"). The reader styles every bracket as "Translator's addition", so
    // these read as content.
    const meta = br.filter(b => BRACKET_META.test(b.slice(1, -1)));
    if (meta.length) out.brackets_meta = meta.slice(0, 3);
  }
  if (/<(?:header|page-num)(?:\s[^>]*)?>/i.test(t)) out.meta_tag_in_english = true;
  // The dominant empty-tag shape: `<margin></margin>` + the margin's text + a stray `</margin>` —
  // the opener was closed too early. The reader drops both, so the margin prints as body text.
  if (/<(margin|insert|gloss|unclear|note|term)>\s*<\/\1>[^<]{1,600}<\/\1>/i.test(t)) out.premature_close = true;
  return out;
}
const ENT = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
export function visibleText(tr) {
  let html;
  try { html = renderToStaticMarkup(React.createElement(NotesRenderer, { text: String(tr || ''), showMetadata: false })); }
  catch (e) { return { error: String(e.message || e) }; }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&(?:lt|gt|amp|quot|nbsp|#x27|#39);/g, m => ENT[m]).replace(/[ \t]+/g, ' ');
  return { text };
}
export function visibleLeaks(text) {
  const out = {};
  const ctx = (re) => { const m = re.exec(text); return m ? text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ').trim() : null; };
  const h = ctx(/#/); if (h) out.vis_hash = h;
  const tg = ctx(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/); if (tg) out.vis_tag = tg;
  const mw = ctx(/\bpage-num\b|\bpage-type\b|\bscan-quality\b|<\/?header\b|\bheader>/i); if (mw) out.vis_meta_word = mw;
  const ar = ctx(/->|<-(?!-)/); if (ar) out.vis_centre_arrow = ar;
  return out;
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
