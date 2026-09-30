#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundaries.mjs measures LEAK (#5026) and DRIFT (#5021)
// per page PAIR, corpus-wide, as boundary rates; scripts/lib/block-drift.mjs holds the tests.
// scripts/audit/detect-fabricated-translation.mjs finds translations silent about an OCR
// declination on non-Latin scripts. None of them asks the question the #5274 audit asked of a
// single PAGE — "does this translation carry content its source does not?" — and none was ever
// scored against a labelled set. This file reuses their tests (sharedRun, detectBlockDrift,
// duplicatedAcrossBoundary, sourceProse/translationProse) and adds two page-level signals.
/**
 * translation-bridging — pages whose translation BRIDGES a gap instead of marking it (#5305).
 *
 * The #5274 audit's largest major-defect class was invention (11.2% of served pages), and most
 * major inventions had one shape: the source page stops mid-sentence (a catchword, a leaf edge,
 * an illegible column) and the translation finishes the thought — with the next page's opening,
 * or with nothing on any page. This flags a page on four signals, each reported separately:
 *
 *   ratio     translation prose ÷ source prose is above the language's p98 (bands measured on
 *             the mirror, --bands). Long means content the source may not carry.
 *   leak      the translation shares a run ≥ 200 chars with a NEIGHBOURING page's translation
 *             while the two sources do not (#5026 method, translation-page-boundaries.mjs).
 *   drift     page N+1's opening clause is translated at the end of page N, or on both pages
 *             (block-drift.mjs detectBlockDrift / duplicatedAcrossBoundary, #5021).
 *   openEnd   the source ends mid-sentence (no sentence-final mark after its trailing
 *             furniture) and the translation ends on a closed sentence with no marker
 *             ([continues], an ellipsis, a dash). The restraint the prompt should ask for (#5305 A).
 *
 * This is a WORK LIST and a RATE, never a verdict on a page. It files no issues
 * (measurement-instruments.md), so it has nothing to close.
 *
 * MEASURED 2026-09-30 (#5305), against the #5274 audit's Opus verdicts on 311 served pages
 * (36 with an invention flag, 14 with a major one; base rate 11.6%):
 *
 *   signal     flagged  precision  recall(any invention)  recall(major)
 *   ratioHigh     10      0.40          0.11                 0.14
 *   leak           4      0.50          0.06                 0.14
 *   drift          7      0.43          0.08                 0.07
 *   openEnd       48      0.23          0.31                 0.36
 *   any           63      0.25          0.44                 0.50
 *
 * Read by hand (TEXT, source and translation; no page image) on 20 random openEnd flags from a
 * corpus draw: 7 were real bridging (the translation carries content past the page's last
 * words), 4 closed a split word or a list with no new content, and 9 were false. After the
 * fixes below (footnote asterisk, numbered/apparatus last line), the pass at 3,000 books
 * (one page each, seed 5305) flags 17.7% of pages on any signal, 14.5% openEnd. So roughly a
 * third of an openEnd flag is a bridged page. The rest are the translator closing a sentence the
 * page left open, which is the behaviour #5305 A asks the prompt to stop.
 *
 * What it cannot see: invention inside the page (a name or a claim added to a note: most of
 * the audit's minor inventions), garble smoothed into prose, or a CJK page that does not punctuate.
 *
 * Usage:
 *   node scripts/audit/translation-bridging.mjs --bands                 # (re)measure length bands
 *   node scripts/audit/translation-bridging.mjs --validate              # P/R vs the #5274 judge
 *   node scripts/audit/translation-bridging.mjs [--sample=N] [--seed=S] # corpus rate, one page per book
 * Reads the local corpus mirror (~/sl-corpus/books/*.jsonl, --dir). Writes to --out
 * (default scripts/output/translation-bridging/).
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import {
  sourceProse, translationProse, detectBlockDrift, duplicatedAcrossBoundary, sharedRun,
} from '../lib/block-drift.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BANDS_FILE = path.join(HERE, 'baselines/translation-length-bands.json');
const AUDIT_DIR = path.join(HERE, '../eval/results/translation-corpus-audit-2026-09-30');
export const LEAK_MIN_CHARS = 200;
const NON_PROSE = new Set(['index', 'toc', 'title-page', 'illustration', 'blank', 'errata', 'diagram', 'frontispiece',
  'colophon', 'map', 'archived-spread', 'digitizer-insert', 'digitizer-notice', 'exlibris', 'bookplate', 'cover', 'table']);

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const flag = (k) => process.argv.includes(`--${k}`);

// Letters and digits only: whitespace, punctuation and markup do not measure content.
const contentLen = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length;
const normTr = (t) => translationProse(t).replace(/\s+/g, ' ').trim();
const normSrc = (t) => sourceProse(t).replace(/\s+/g, ' ').trim();

// Trailing furniture: page numbers, signature marks, a catchword line, running feet.
const isFurnitureLine = (line) => {
  const t = line.trim();
  if (!t) return true;
  if (!/\p{L}{3,}/u.test(t) && !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(t)) return true;
  if (t.length <= 40 && /\p{Lu}/u.test(t) && !/\p{Ll}/u.test(t)) return true;
  return false;
};
// A footnote block under the body ("(1) De qua Cap. III.", "---", "* Vide …") is not where the
// page's running sentence ends; the body line above it is.
const FOOTNOTE_LINE = /^\s*(?:\(\d{1,3}\)|\d{1,3}\)|\[\d{1,3}\]|[*†‡§¶]|-{3,}|_{3,}|—{2,})/u;
function tailProse(text) {
  const lines = text.split('\n');
  let j = lines.length;
  while (j > 0 && lines.length - j < 4 && isFurnitureLine(lines[j - 1])) j--;
  let k = j;
  while (k > 1 && j - k < 12 && FOOTNOTE_LINE.test(lines[k - 1])) k--;
  if (k < j && k > 1) j = k;
  while (j > 0 && isFurnitureLine(lines[j - 1]) && lines.length - j < 16) j--;
  return lines.slice(0, j).join('\n').trim();
}
// A catchword: the last source line is a single short word that repeats as the opening of the
// next page. Printers set it below the text; it is not part of the sentence.
function dropCatchword(text) {
  const lines = text.split('\n');
  const last = lines[lines.length - 1]?.trim() || '';
  if (lines.length > 3 && /^\S{1,14}$/u.test(last)) return lines.slice(0, -1).join('\n').trim();
  return text;
}

const SRC_CLOSED = /[.!?…。！？」』;:·»”"'’)\]]\s*$/u;
const TR_CLOSED = /[.!?…"'’”»)\]]\s*$/u;
const TR_MARKED = /(\[[^\]]{0,60}(?:continu|illegible|cut off|breaks off|incomplete|lacuna|missing|unclear)[^\]]{0,60}\]|…|\.\s*\.\s*\.|[—–-]\s*)\s*["'’”»)\]]*\s*$/iu;

/** The source stops mid-sentence and the translation closes the sentence without a marker. */
export function openEnd(ocr, tr) {
  const src = sourceEndsOpen(ocr);
  if (!src) return null;
  const out = tailProse(translationProse(tr));
  if (contentLen(out) < 80 || TR_MARKED.test(out) || !TR_CLOSED.test(out)) return null;
  return { srcTail: src.slice(-80), trTail: out.slice(-120) };
}

/** The source's body prose when it ends mid-sentence (a hyphen, a letter, a comma, a digit), else null. */
//
// No claim (each a false-positive family from the hand read of 20 corpus flags, 2026-09-30):
//   - a footnote mark after a full stop ("nominauerunt.*") — closed;
//   - a last line that is a numbered verse/line ("32. ad-da …") or critical apparatus ("27 κατὰ
//     ποσὸν] ita libri"): the unit is the line, not the sentence.
export function sourceEndsOpen(ocr) {
  const src = dropCatchword(tailProse(sourceProse(ocr)));
  if (contentLen(src) < 80) return null;
  const closed = src.replace(/(?<=[.!?。])\s*[*†‡]+\s*$/u, '.');
  if (SRC_CLOSED.test(closed)) return null;
  const last = src.split('\n').pop().trim();
  if (/^\d{1,4}[.)]?\s/u.test(last) || /\]/u.test(last)) return null;
  return /[-‐¬=]\s*$/u.test(src) || /\p{L}\*$/u.test(src) || /\p{L}$/u.test(src) || /[,،、，]\s*$/u.test(src) || /\p{N}$/u.test(src) ? src : null;
}

// Fallback band for a language with too few pages: by the SOURCE's script, since a character
// of Chinese carries several English words and a letter of Latin carries about one.
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
export function scriptClass(ocr) {
  const t = sourceProse(ocr), n = contentLen(t);
  return n && (t.match(CJK) || []).length / n > 0.3 ? '_cjk' : '_alphabetic';
}

/** All four signals for one page, given its neighbours (either may be null). */
export function bridgingSignals({ page, prev, next, lang, bands }) {
  const s = {};
  const src = contentLen(sourceProse(page.ocr)), out = contentLen(translationProse(page.tr));
  const band = bands?.[lang] || bands?.[scriptClass(page.ocr)];
  s.ratio = src >= 80 ? +(out / src).toFixed(3) : null;
  s.ratioHigh = !!(band && s.ratio != null && s.ratio > band.p98);
  const trN = normTr(page.tr), srcN = normSrc(page.ocr);
  s.leak = false;
  for (const nb of [prev, next]) {
    if (!nb?.tr) continue;
    const run = sharedRun(trN, normTr(nb.tr));
    if (run.len >= LEAK_MIN_CHARS && sharedRun(srcN, normSrc(nb.ocr)).len < LEAK_MIN_CHARS) { s.leak = true; s.leakText = run.text; }
  }
  s.drift = false;
  if (next?.tr && !NON_PROSE.has(page.type) && !NON_PROSE.has(next.type)) {
    const d = detectBlockDrift({ ocrPrev: page.ocr, ocrNext: next.ocr, trPrev: page.tr, trNext: next.tr });
    const dup = duplicatedAcrossBoundary(page.tr, next.tr);
    if (d.drift || dup) { s.drift = true; s.driftFragment = (d.fragment || dup?.text || '').slice(0, 200); }
  }
  const oe = NON_PROSE.has(page.type) ? null : openEnd(page.ocr, page.tr);
  s.openEnd = !!oe; if (oe) s.openEndTail = oe;
  s.any = s.ratioHigh || s.leak || s.drift || s.openEnd;
  return s;
}

function readBook(dir, id) {
  const f = path.join(dir, `${id}.jsonl`);
  if (!fs.existsSync(f)) return null;
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
function loadLangs(dir) {
  const lang = new Map();
  const idx = path.join(path.dirname(dir), 'books.jsonl');
  if (fs.existsSync(idx)) for (const line of fs.readFileSync(idx, 'utf8').split('\n')) {
    if (!line) continue; try { const b = JSON.parse(line); lang.set(b.id, b.language || 'unknown'); } catch {}
  }
  return lang;
}
// Deterministic PRNG (mulberry32) so a sample can be re-drawn.
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** One translated interior prose page per book, seeded. Returns [{id, lang, rows, i}]. */
function* samplePages(dir, n, seed) {
  const lang = loadLangs(dir), r = rng(seed);
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  for (let i = files.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [files[i], files[j]] = [files[j], files[i]]; }
  let got = 0;
  for (const f of files) {
    if (got >= n) return;
    let rows; try { rows = fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { continue; }
    rows.sort((a, b) => a.p - b.p);
    const cand = rows.map((x, i) => i).filter(i => rows[i].tr?.trim() && rows[i].ocr && !NON_PROSE.has(rows[i].type) && i > 0 && i < rows.length - 1);
    if (!cand.length) continue;
    got++;
    yield { id: f.slice(0, -6), lang: lang.get(f.slice(0, -6)) || 'unknown', rows, i: cand[Math.floor(r() * cand.length)] };
  }
}
const pageCtx = (rows, i) => ({ page: rows[i], prev: rows[i - 1]?.p === rows[i].p - 1 ? rows[i - 1] : null, next: rows[i + 1]?.p === rows[i].p + 1 ? rows[i + 1] : null });

function measureBands(dir, n, seed) {
  const by = {};
  for (const { lang, rows, i } of samplePages(dir, n, seed)) {
    const src = contentLen(sourceProse(rows[i].ocr)), out = contentLen(translationProse(rows[i].tr));
    if (src < 80) continue;
    for (const k of [lang, scriptClass(rows[i].ocr), '_all']) (by[k] ||= []).push(out / src);
  }
  const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  const bands = { _measured: new Date().toISOString().slice(0, 10), _pages: by._all.length, _seed: seed };
  for (const [l, a] of Object.entries(by)) {
    if (a.length < 150 && !l.startsWith('_')) continue; // too few pages for a p98; falls back to the script band
    a.sort((x, y) => x - y);
    bands[l] = { n: a.length, p02: +q(a, 0.02).toFixed(3), p50: +q(a, 0.5).toFixed(3), p98: +q(a, 0.98).toFixed(3) };
  }
  return bands;
}

function validate(dir, bands) {
  const man = fs.readFileSync(path.join(AUDIT_DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(m => m.kind === 'main');
  const items = new Map(fs.readFileSync(path.join(AUDIT_DIR, 'items.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(x => [x.id, x]));
  const verdict = new Map();
  const vdir = path.join(AUDIT_DIR, 'verdicts/opus');
  for (const f of fs.readdirSync(vdir)) for (const l of fs.readFileSync(path.join(vdir, f), 'utf8').split('\n')) {
    if (!l.trim()) continue; const v = JSON.parse(l); verdict.set(v.id, v);
  }
  const lang = loadLangs(dir);
  const rows = [];
  for (const m of man) {
    const book = (readBook(dir, m.book_id) || []).sort((a, b) => a.p - b.p);
    const i = book.findIndex(r => r.p === m.page_number);
    const it = items.get(m.id), v = verdict.get(m.id);
    if (!v) continue;
    // Judge what the JUDGE saw: page N's source and translation from the audit packet.
    const page = { p: m.page_number, ocr: it.source, tr: it.translation, type: m.page_type };
    const ctx = i >= 0 ? pageCtx(book, i) : { prev: null, next: null };
    const s = bridgingSignals({ page, prev: ctx.prev, next: ctx.next, lang: lang.get(m.book_id) || m.language, bands });
    const inv = v.defects.filter(d => d.type === 'invention');
    rows.push({ id: m.id, lang: m.language, arm: m.arm, inv: !!v.flags.invention, invMajor: inv.some(d => d.severity === 'major'), ...s });
  }
  const pr = (key, truth) => {
    const tp = rows.filter(r => r[key] && r[truth]).length, fp = rows.filter(r => r[key] && !r[truth]).length;
    const pos = rows.filter(r => r[truth]).length;
    return { flagged: tp + fp, tp, precision: tp + fp ? +(tp / (tp + fp)).toFixed(2) : null, recall: pos ? +(tp / pos).toFixed(2) : null, positives: pos };
  };
  const report = { pages: rows.length, base: { invention: rows.filter(r => r.inv).length, inventionMajor: rows.filter(r => r.invMajor).length } };
  for (const key of ['ratioHigh', 'leak', 'drift', 'openEnd', 'any']) report[key] = { invention: pr(key, 'inv'), major: pr(key, 'invMajor') };
  return { report, rows };
}

function main() {
  const dir = arg('dir', path.join(os.homedir(), 'sl-corpus/books'));
  const out = arg('out', 'scripts/output/translation-bridging');
  fs.mkdirSync(out, { recursive: true });
  if (flag('bands')) {
    const bands = measureBands(dir, Number(arg('sample', 6000)), Number(arg('seed', 5305)));
    fs.writeFileSync(BANDS_FILE, JSON.stringify(bands, null, 2) + '\n');
    console.log(`bands over ${bands._pages} pages → ${BANDS_FILE}`);
    return;
  }
  const bands = JSON.parse(fs.readFileSync(BANDS_FILE, 'utf8'));
  if (flag('validate')) {
    const { report, rows } = validate(dir, bands);
    fs.writeFileSync(path.join(out, 'validate-rows.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.writeFileSync(path.join(out, 'validate.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  // Corpus rate: one interior prose page per book, seeded. The draw is NOT the audit's
  // (the audit is stratified by language and arm); a rate here is per book, unweighted.
  const n = Number(arg('sample', 3000)), seed = Number(arg('seed', Number(new Date().toISOString().slice(0, 7).replace('-', ''))));
  const tally = { pages: 0, ratioHigh: 0, leak: 0, drift: 0, openEnd: 0, any: 0, byLang: {} };
  const w = fs.createWriteStream(path.join(out, `flags-${seed}.jsonl`));
  for (const { id, lang, rows, i } of samplePages(dir, n, seed)) {
    const s = bridgingSignals({ ...pageCtx(rows, i), lang, bands });
    const b = (tally.byLang[lang] ||= { pages: 0, any: 0 });
    tally.pages++; b.pages++;
    for (const k of ['ratioHigh', 'leak', 'drift', 'openEnd', 'any']) if (s[k]) tally[k]++;
    if (s.any) { b.any++; w.write(JSON.stringify({ book: id, page: rows[i].p, lang, url: `https://sourcelibrary.org/book/${id}?page=${rows[i].p}`, ...s }) + '\n'); }
  }
  w.end();
  tally.seed = seed;
  fs.writeFileSync(path.join(out, `summary-${seed}.json`), JSON.stringify(tally, null, 2));
  const pct = (k) => `${(100 * tally[k] / Math.max(1, tally.pages)).toFixed(1)}%`;
  console.log(`${tally.pages} pages (one per book, seed ${seed}): any ${pct('any')} · ratioHigh ${pct('ratioHigh')} · leak ${pct('leak')} · drift ${pct('drift')} · openEnd ${pct('openEnd')}`);
  console.log(`read the precision block (--validate) before quoting any of these as a defect rate`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
