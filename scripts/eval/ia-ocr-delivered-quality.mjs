#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ia-ocr-baseline.mjs (IA-vs-ours agreement by script × century, July
 * 2026 — measures the SAMPLE pages we already had Gemini text for, never the pages we WROTE, and
 * has no notion of the gate's bands); scripts/eval/ia-ocr-cleanup-exp.mjs (60 pages, 10 books,
 * tests text-only cleanup — settled, no cleanup lane); scripts/import/ia-ocr-ingest.mjs (the gate
 * itself; its scoring functions are mirrored here because that module runs on import). Reused:
 * scripts/eval/lib/runners.mjs `runGemini`/`fetchImage`, lib/production-prompt.mjs, lib/metrics.mjs
 * `levenshtein`, scripts/lib/dehyphenate.mjs, scripts/lib/page-image-url.mjs.
 *
 * ia-ocr-delivered-quality — how good is the Internet Archive OCR text we actually WROTE into
 * `pages.ocr.data` (#4780, #4763), and where should the per-book agreement cutoff sit?
 *
 * THE QUESTION. The ingester fills untranscribed pages with IA's own OCR when the book's 25-page
 * Gemini sample agrees ≥ 0.85 (word-sequence ratio). Every number so far describes that SAMPLE.
 * This measures the DELIVERED text: one interior, previously-untranscribed page per book, scored
 * against a fresh Gemini read of the same page image — and it measures BELOW the cutoff too
 * (books the gate rejected at 0.40–0.85, text regenerated from the leaves cache exactly as the
 * ingester would have written it), because a sample of accepted books cannot say whether 0.85 is
 * right. Design: one page per BOOK (auto-memory lesson_sample_one_page_per_book); strata are
 * agreement band × language; nothing here writes to `pages`.
 *
 * WHAT IS MEASURED PER PAGE (all on normalised text: tag markup stripped from the Gemini side,
 * NFC, lowercase, ſ→s, curly quotes folded, whitespace collapsed):
 *   cer   — Levenshtein(IA, Gemini) / |Gemini|            (chars)
 *   wer   — Levenshtein over word tokens / |Gemini words|
 *   seq   — the gate's own word-sequence ratio (LCS, first 600 tokens)
 *   bow   — bag-of-words (multiset Dice) over the same tokens
 *   gap   — bow − seq. A column splice / mis-split keeps the words and destroys the order (large
 *           gap); a misread shrinks both together (small gap). Asked for by the hand read on #4780.
 * Per BOOK the gate is re-scored with the CURRENT ingester logic (the dry logs predate #4783's
 * Unicode tokenizer and dehyphenation): `agreement_now` (median over all reference pages, the
 * production statistic), `agreement_prose` (median over reference pages that look like running
 * prose in the book's script — no index/plates/title/facing-page apparatus), and `agreement_p75`.
 *
 * THE INSTRUMENT. Gemini flash-lite is not ground truth. Where both readers fail the same way CER
 * understates error; on scripts Gemini reads badly (polytonic Greek, Fraktur) a high CER may be
 * the REFERENCE being wrong. Every row carries `ref_flags` (non-STOP finish, length collapse or
 * explosion, repetition loop) and the report excludes flagged references from the headline
 * tables. Anchor rows (`--anchors <file>`: page ids with a human verdict) ride along so the
 * metric can be checked against a reading by eye. Framing: .claude/docs/ocr-translation-eval-landscape.md.
 *
 * Runs on Hetzner (the laptop is geo-blocked from Gemini and from archive.org): needs the dry-run
 * logs in `/root/sl-ia-cache/_runs/` and the leaves cache in `/root/sl-ia-cache/`.
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ia-ocr-delivered-quality.mjs --stage=sample   # pick books+pages, re-score gate, no cost
 *   node scripts/eval/ia-ocr-delivered-quality.mjs --stage=ocr      # fresh Gemini read per page (PAID), resumable
 *   node scripts/eval/ia-ocr-delivered-quality.mjs --stage=report   # markdown tables to stdout
 * Options: --cell-cap 25 (books per band × language)  --anchor-cap 10 (books per language in the
 *   <0.60 anchor band)  --concurrency 4  --max-cost 3 (USD, hard stop)  --seed 4780
 *   --runs-dir /root/sl-ia-cache/_runs  --cache /root/sl-ia-cache  --out <plan/results prefix>
 *   --anchors <jsonl of {book_id, page_number|leaf, verdict}>  --languages english,latin,french,german,greek,italian
 *   --retry-refused (ocr stage: re-read pages whose reference came back RECITATION/PROHIBITED_CONTENT)
 *
 * usage-ok: one-off hand-run eval (≈800 pages, ≈$1.5 at realtime lite rates, approved 2026-09-13),
 * never scheduled; it meters its own tokens, prints the dollar figure and refuses past --max-cost.
 * Recorded in scripts/eval/EXPERIMENTS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { normalizeLanguageToken } from '../lib/language-normalize.mjs';
import { editionYear } from '../lib/identity-fields.mjs';
import { OCR_MODEL_LITE } from '../lib/ocr-routing.mjs';
import { runGemini, fetchImage } from './lib/runners.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';
import { levenshtein } from './lib/metrics.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(k) || process.argv.some((a) => a.startsWith(`${k}=`));
const argEq = (k, d) => { const a = process.argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : arg(k, d); };
const STAGE = argEq('--stage', 'all');
const CELL_CAP = +argEq('--cell-cap', 25);
const ANCHOR_CAP = +argEq('--anchor-cap', 10);
const CONCURRENCY = +argEq('--concurrency', 4);
const MAX_COST = +argEq('--max-cost', 3);
const SEED = +argEq('--seed', 4780);
const RUNS_DIR = argEq('--runs-dir', '/root/sl-ia-cache/_runs');
const CACHE = argEq('--cache', '/root/sl-ia-cache');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = argEq('--out', path.join(HERE, 'results', 'ia-ocr-delivered-quality-2026-09-13'));
const PLAN = `${OUT}.plan.jsonl`, RESULTS = `${OUT}.jsonl`;
const ANCHORS = argEq('--anchors', null);
const RETRY_REFUSED = flag('--retry-refused');
const LANGS = argEq('--languages', 'english,latin,french,german,greek,italian').split(',').map((s) => s.trim().toLowerCase());
const SOURCE = 'ia_djvu';
const MAX_OFFSET = 3, MIN_REF_PAGES = 5, MAX_REFS = 80;
const BANDS = [[0.4, 0.6, '0.40-0.60'], [0.6, 0.7, '0.60-0.70'], [0.7, 0.75, '0.70-0.75'], [0.75, 0.8, '0.75-0.80'], [0.8, 0.85, '0.80-0.85'], [0.85, 0.9, '0.85-0.90'], [0.9, 0.95, '0.90-0.95'], [0.95, 1.01, '0.95+']];
const bandOf = (m) => (BANDS.find(([lo, hi]) => m >= lo && m < hi) || [])[2] || null;
const NON_PROSE_TYPES = new Set(['index', 'blank', 'illustration', 'title-page', 'half-title', 'toc', 'table-of-contents', 'contents', 'colophon', 'bibliography', 'diagram', 'frontispiece', 'plate', 'advertisement', 'cover', 'table', 'music', 'map', 'digitizer-insert', 'list']);

// ---------- seeded RNG (mulberry32) so the sample is reproducible ----------
let seed = SEED >>> 0;
const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- gate replica (mirrors scripts/import/ia-ocr-ingest.mjs; keep in lockstep) ----------
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
function leafTexts(xml) {
  const out = [];
  for (const o of xml.split(/<OBJECT\b/).slice(1)) {
    const paras = [];
    for (const p of o.split(/<PARAGRAPH\b/).slice(1)) {
      const lines = [];
      for (const l of p.split(/<LINE\b/).slice(1)) { const w = [...l.matchAll(/<WORD[^>]*>([\s\S]*?)<\/WORD>/g)].map((m) => decode(m[1]).trim()).filter(Boolean); if (w.length) lines.push(w.join(' ')); }
      if (lines.length) paras.push(lines.join('\n'));
    }
    out.push(paras.join('\n\n'));
  }
  return out;
}
function loadLeaves(iaId) {
  const j = path.join(CACHE, `${iaId}.leaves.json`), x = path.join(CACHE, `${iaId}_djvu.xml`);
  if (fs.existsSync(j)) return JSON.parse(fs.readFileSync(j, 'utf8')).map(dehyphenateLineBreaks);
  if (fs.existsSync(x)) return leafTexts(fs.readFileSync(x, 'utf8')).map(dehyphenateLineBreaks);
  return null;
}
const tokens = (s) => (s || '').replace(/<[^>]+>/g, ' ').normalize('NFC').replace(/[’‘ʼ]/g, "'").toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
function ratio(a, b) {
  a = a.slice(0, 600); b = b.slice(0, 600);
  if (!a.length || !b.length) return 0;
  const prev = new Uint16Array(b.length + 1); const cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) { for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); prev.set(cur); }
  return (2 * prev[b.length]) / (a.length + b.length);
}
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };

// ---------- metrics ----------
const median = (xs) => pct(xs, 0.5);
function pct(xs, q) { const s = [...xs].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q; const lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); }
function bagDice(a, b) {
  a = a.slice(0, 600); b = b.slice(0, 600);
  if (!a.length || !b.length) return 0;
  const c = new Map(); for (const t of a) c.set(t, (c.get(t) || 0) + 1);
  let m = 0; for (const t of b) { const n = c.get(t); if (n) { m++; c.set(t, n - 1); } }
  return (2 * m) / (a.length + b.length);
}
/** Gemini output → the words printed on the page. Container tags whose CONTENT is not on the page go first. */
function normalise(s) {
  return String(s || '')
    .replace(/<(warning|meta|image-desc|figure|note|scan-quality|language|page-type|columns|detected-images|vocab)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '').replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1').replace(/^->\s*|\s*<-$/gm, '').replace(/^-{3,}$/gm, '').replace(/^>\s*/gm, '')
    .normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"').replace(/[‐‑‒–—―]/g, '-')
    .replace(/\s+/g, ' ').trim();
}
const alnum = (s) => s.replace(/[^\p{L}\p{N}]+/gu, '');
const CAP = 8000;
function pageMetrics(iaText, refText) {
  const h = normalise(iaText).slice(0, CAP), r = normalise(refText).slice(0, CAP);
  const ht = tokens(h), rt = tokens(r);
  const cer = r.length ? levenshtein(h, r) / r.length : null;
  const wer = rt.length ? levenshtein(ht, rt) / rt.length : null;
  const ha = alnum(h), ra = alnum(r);
  const cerAlnum = ra.length ? levenshtein(ha, ra) / ra.length : null;
  const seq = ratio(ht, rt), bow = bagDice(ht, rt);
  return { cer: r3(cer), wer: r3(wer), cer_alnum: r3(cerAlnum), seq: r3(seq), bow: r3(bow), gap: r3(bow - seq), ia_chars: h.length, ref_chars: r.length, len_ratio: r3(h.length / Math.max(1, r.length)) };
}
const r3 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(3));
/** Is the REFERENCE degenerate? (a loop, a collapse, a refusal) — a high CER against such a reference says nothing about IA. */
function refFlags(refText, iaText, finishReason) {
  const flags = [];
  if (finishReason && finishReason !== 'STOP') flags.push(`finish:${finishReason}`);
  const r = normalise(refText), h = normalise(iaText);
  if (r.length < 40) flags.push('ref-empty');
  else if (r.length < 0.4 * h.length) flags.push('ref-short');
  else if (r.length > 2.5 * h.length) flags.push('ref-long');
  const rt = tokens(r); const seen = new Map(); let maxRep = 0;
  for (let i = 0; i + 12 <= rt.length; i += 4) { const k = rt.slice(i, i + 12).join(' '); const n = (seen.get(k) || 0) + 1; seen.set(k, n); if (n > maxRep) maxRep = n; }
  if (maxRep >= 6) flags.push('ref-loop');
  return flags;
}
const pageTypeOf = (raw) => (String(raw || '').match(/<page-type>\s*([^<]+)/i) || [])[1]?.trim().toLowerCase() || null;
function scriptShare(text, script) {
  const letters = (text.match(/\p{L}/gu) || []).length; if (!letters) return 0;
  const re = script === 'greek' ? /\p{Script=Greek}/gu : /\p{Script=Latin}/gu;
  return (text.match(re) || []).length / letters;
}
const langKey = (b) => { const t = (normalizeLanguageToken(b.language) || '').toLowerCase(); return /greek/.test(t) ? 'greek' : t.split(/[-,\s]/)[0] || null; };
const halfCentury = (y) => (y ? `${Math.floor(y / 50) * 50}–${Math.floor(y / 50) * 50 + 49}` : 'unknown');

// ---------- stage: sample ----------
function readVerdicts() {
  // Latest verdict per book id across every run log (dry, apply, rescore), by file mtime.
  const files = fs.readdirSync(RUNS_DIR).filter((f) => /\.(txt|log)$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(RUNS_DIR, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  const byBook = new Map();
  for (const { f } of files) {
    for (const line of fs.readFileSync(path.join(RUNS_DIR, f), 'utf8').split('\n')) {
      const m = line.match(/^\s+(ACCEPT|REJECT|UNSTABLE|LANG_MISMATCH) (\S+) (\d{0,4}) .*?\| agreement median ([0-9.]+) over (\d+) pages(?: \| offset (-?\d+) \((\d+)%\))?.*?\| fillable (\d+)/);
      if (!m) continue;
      byBook.set(m[2], { bid: m[2], verdict: m[1], agreement_log: +m[4], n_ref_log: +m[5], offset_log: m[6] != null ? +m[6] : null, fillable_log: +m[8], log_file: f });
    }
  }
  return byBook;
}

async function stageSample(db) {
  const verdicts = readVerdicts();
  console.log(`verdict lines: ${verdicts.size} books across ${RUNS_DIR}`);
  const ids = [...verdicts.keys()];
  const B = db.collection('books'), P = db.collection('pages');
  const books = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    books.push(...await B.find({ id: { $in: chunk } }, { projection: { id: 1, title: 1, language: 1, languages: 1, published: 1, year: 1, ia_identifier: 1, image_source: 1, pages_count: 1, pages_ocr: 1, hidden_reason: 1 } }).toArray());
  }
  const anchors = ANCHORS && fs.existsSync(ANCHORS) ? fs.readFileSync(ANCHORS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const anchorByBook = new Map(anchors.map((a) => [a.book_id, a]));
  // Stratify by (log band × language); a leaves cache must exist (no archive.org fetches here).
  const cells = new Map(); let noCache = 0, otherLang = 0, hidden = 0;
  for (const b of books) {
    const v = verdicts.get(b.id); const lang = langKey(b);
    if (!LANGS.includes(lang)) { otherLang++; continue; }
    if (b.hidden_reason) { hidden++; continue; }
    const iaId = b.ia_identifier || b.image_source?.identifier; if (!iaId) continue;
    if (!fs.existsSync(path.join(CACHE, `${iaId}.leaves.json`)) && !fs.existsSync(path.join(CACHE, `${iaId}_djvu.xml`))) { noCache++; continue; }
    const band = bandOf(v.agreement_log); if (!band) continue;
    const key = `${band}|${lang}`; (cells.get(key) || cells.set(key, []).get(key)).push({ b, v, lang, band, iaId });
  }
  console.log(`books: ${books.length} found, ${otherLang} other language, ${hidden} hidden, ${noCache} no leaves cache`);
  const picks = [];
  for (const [key, xs] of [...cells.entries()].sort()) {
    const cap = key.startsWith('0.40-0.60') ? ANCHOR_CAP : CELL_CAP;
    const forced = xs.filter((x) => anchorByBook.has(x.b.id));
    const rest = shuffle(xs.filter((x) => !anchorByBook.has(x.b.id))).slice(0, Math.max(0, cap - forced.length));
    picks.push(...forced, ...rest);
    console.log(`  ${key.padEnd(22)} pool ${String(xs.length).padStart(4)} → ${forced.length + rest.length}`);
  }
  console.log(`planned books: ${picks.length}`);

  // Resumable: books already in the plan are skipped (a re-run appends).
  const already = new Set(fs.existsSync(PLAN) ? fs.readFileSync(PLAN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).book_id) : []);
  const out = fs.createWriteStream(PLAN, { flags: 'a' });
  const summary = { planned: 0, skipped_done: already.size, no_ref: 0, no_leaves: 0, no_page: 0 };
  for (const { b, v, lang, band, iaId } of picks) {
    if (already.has(b.id)) continue;
    const leaves = loadLeaves(iaId); if (!leaves) { summary.no_leaves++; continue; }
    const leafTok = leaves.map(tokens);
    const pages = await P.find({ book_id: b.id }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, 'ocr.data': 1, 'ocr.source': 1, hidden: 1 } }).sort({ page_number: 1 }).toArray();
    // --- re-score the gate with the CURRENT ingester logic (offset vote, Unicode tokens, dehyphenated leaves)
    // Reference pages capped at MAX_REFS, evenly spaced through the book (a fully transcribed book has
    // hundreds; 7 offsets × LCS per page made the gate re-score the slow step). The median is robust to it.
    const refPages = pages.filter((p) => p.ocr?.data && p.ocr?.source !== SOURCE);
    const step = Math.max(1, Math.ceil(refPages.length / MAX_REFS));
    const refs = [];
    for (const p of refPages.filter((_, i) => i % step === 0)) {
      const t = p.ocr.data; const k = leafIndex(p); const tt = tokens(t); if (tt.length < 20) continue;
      const byOffset = {}; for (let d = -MAX_OFFSET; d <= MAX_OFFSET; d++) { const j = k + d; if (j < 0 || j >= leaves.length || leafTok[j].length < 20) continue; byOffset[d] = ratio(tt, leafTok[j]); }
      if (!Object.keys(byOffset).length) continue;
      const pt = pageTypeOf(t);
      const prose = !NON_PROSE_TYPES.has(pt || '') && tt.length >= 120 && scriptShare(t.replace(/<[^>]+>/g, ' '), lang) >= 0.9;
      refs.push({ byOffset, tt, k, prose });
    }
    if (refs.length < MIN_REF_PAGES) { summary.no_ref++; console.log(`  ${b.id} ${lang} ${band} | ref pages ${refs.length} < ${MIN_REF_PAGES}`); continue; }
    const votes = {}; for (const r of refs) { const best = Object.entries(r.byOffset).sort((x, y) => y[1] - x[1])[0][0]; votes[best] = (votes[best] || 0) + 1; }
    const [offsetStr] = Object.entries(votes).sort((x, y) => y[1] - x[1])[0]; const offset = +offsetStr;
    const eligible = refs.filter((r) => r.byOffset[offset] !== undefined);
    const offsetShare = eligible.filter((r) => Object.entries(r.byOffset).sort((x, y) => y[1] - x[1])[0][0] === offsetStr).length / Math.max(1, eligible.length);
    const scores = eligible.map((r) => r.byOffset[offset]);
    if (scores.length < MIN_REF_PAGES) { summary.no_ref++; continue; }
    const proseScores = eligible.filter((r) => r.prose).map((r) => r.byOffset[offset]);
    const bowScores = eligible.map((r) => bagDice(r.tt, leafTok[r.k + offset]));
    const agreementNow = median(scores);
    // --- the page: interior (skip the first 10%), never model-transcribed, has an IA leaf and a real image
    const first = Math.ceil(pages.length * 0.1);
    const cands = pages.filter((p) => p.page_number > first && !p.hidden && (!p.ocr?.data || p.ocr?.source === SOURCE))
      .map((p) => ({ p, k: leafIndex(p) + offset })).filter(({ p, k }) => k >= 0 && k < leaves.length && leafTok[k].length >= 20 && getPageSource(p));
    if (!cands.length) { summary.no_page++; console.log(`  ${b.id} ${lang} ${band} | no eligible page (${pages.length} pages, offset ${offset})`); continue; }
    // Anchor pages (a human verdict exists) are taken even if they carry model OCR — the read is fresh either way.
    let anchor = anchorByBook.get(b.id); let pick = null;
    if (anchor) {
      const ap = pages.find((p) => (anchor.page_id && p.id === anchor.page_id) || (anchor.page_number && p.page_number === anchor.page_number) || (anchor.leaf != null && leafIndex(p) + offset === anchor.leaf));
      const k = ap ? leafIndex(ap) + offset : -1;
      if (ap && k >= 0 && k < leaves.length && leafTok[k].length >= 20 && getPageSource(ap)) pick = { p: ap, k };
      else { console.log(`  ${b.id} anchor page not usable (${JSON.stringify(anchor)}) — random page instead`); anchor = null; }
    }
    if (!pick) pick = cands[Math.floor(rand() * cands.length)];
    const stored = pick.p.ocr?.source === SOURCE ? pick.p.ocr.data : null;
    const regen = leaves[pick.k];
    const year = editionYear(b);
    const row = {
      book_id: b.id, ia_id: iaId, title: (b.title || '').slice(0, 80), language: lang, year, half_century: halfCentury(year),
      verdict_log: v.verdict, agreement_log: v.agreement_log, band_log: band, log_file: v.log_file,
      agreement_now: r3(agreementNow), band: bandOf(agreementNow), agreement_prose: r3(median(proseScores)), n_ref_prose: proseScores.length, agreement_p75: r3(pct(scores, 0.75)),
      book_bow_median: r3(median(bowScores)), book_gap_median: r3(median(bowScores) - agreementNow),
      offset, offset_share: r3(offsetShare), n_ref: scores.length, n_ref_total: refPages.length, pages_in_book: pages.length, written: pages.filter((p) => p.ocr?.source === SOURCE).length,
      page_id: pick.p.id, page_number: pick.p.page_number, leaf: pick.k, image_url: getPageSource(pick.p), display_url: pick.p.display_photo || null,
      stored: !!stored, stored_matches_regen: stored ? normalise(stored) === normalise(regen) : null,
      ia_text: (stored || regen), neighbours: [-2, -1, 1, 2].filter((d) => pick.k + d >= 0 && pick.k + d < leaves.length).map((d) => ({ d, text: leaves[pick.k + d].slice(0, 6000) })),
      anchor: anchor ? { verdict: anchor.verdict, note: anchor.note || null } : null,
    };
    out.write(JSON.stringify(row) + '\n'); summary.planned++;
  }
  out.end();
  console.log(JSON.stringify(summary), '→', PLAN);
}

// ---------- stage: ocr (paid) ----------
async function stageOcr(db) {
  const plan = fs.readFileSync(PLAN, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  let existing = fs.existsSync(RESULTS) ? fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (RETRY_REFUSED) {
    // Drop refused references (RECITATION / PROHIBITED_CONTENT / error rows) so they are read again.
    const keep = existing.filter((r) => !r.error && !/RECITATION|PROHIBITED/.test(r.finish_reason || ''));
    console.log(`retry-refused: ${existing.length - keep.length} rows dropped for re-read`);
    fs.writeFileSync(RESULTS, keep.map((r) => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); existing = keep;
  }
  const done = new Set(existing.map((r) => r.page_id));
  const todo = plan.filter((r) => !done.has(r.page_id));
  const prompt = await getProductionOcrPrompt(db);
  // Production (pipeline-orchestrator.mjs, "Append book provenance context") ALWAYS appends a document-context
  // line so Gemini does not mistake public-domain print for copyrighted text. The first pass here omitted it and
  // 193/742 references (26%) came back RECITATION/PROHIBITED_CONTENT, concentrated in the cleanest books.
  const authors = new Map((await db.collection('books').find({ id: { $in: [...new Set(todo.map((r) => r.book_id))] } }, { projection: { id: 1, author: 1, title: 1, year: 1 } }).toArray()).map((b) => [b.id, b]));
  const promptFor = (row) => { const b = authors.get(row.book_id) || {}; const year = row.year || b.year; return `${prompt.text}\n\n**Document context:** "${b.title || row.title || 'Unknown'}" by ${b.author || 'Unknown'}. ${year ? `Published ${year}.` : ''} ${year && year < 1930 ? 'This work is in the public domain.' : ''}`.trim(); };
  console.log(`ocr: ${todo.length} pages to read (${done.size} already done) | model ${OCR_MODEL_LITE} | prompt ${prompt.name} v${prompt.version} ${prompt.content_hash || ''} | max cost $${MAX_COST}`);
  const out = fs.createWriteStream(RESULTS, { flags: 'a' });
  let cost = 0, inTok = 0, outTok = 0, thought = 0, n = 0, consecutive = 0, imgErr = 0, gemErr = 0, aborted = false;
  let lastIa = 0;
  const throttled = async (url) => { // ≤ 2 req/s to archive.org, with a contact UA (same rule as the ingester)
    if (/archive\.org/.test(url)) { const w = 500 - (Date.now() - lastIa); if (w > 0) await new Promise((r) => setTimeout(r, w)); lastIa = Date.now(); }
    return fetchImage(url, 45000);
  };
  const t0 = Date.now();
  const worker = async () => {
    while (todo.length && !aborted) {
      const row = todo.shift();
      let img; try { img = await throttled(row.image_url); } catch (e) { imgErr++; out.write(JSON.stringify({ ...row, neighbours: undefined, ia_text: row.ia_text.slice(0, 1200), error: `image: ${e.message.slice(0, 120)}` }) + '\n'); continue; }
      let res;
      for (let attempt = 0; attempt < 3 && !aborted; attempt++) {
        try { res = await runGemini(OCR_MODEL_LITE, img, promptFor(row), { temperature: 0.1, maxTokens: 16384, thinkingBudget: 0 }); consecutive = 0; break; }
        catch (e) {
          const retriable = /Rate limited|Gemini (429|5\d\d)/.test(e.message);
          if (retriable) { consecutive++; console.error(`  gemini refusal ${consecutive}/4: ${e.message.slice(0, 100)}`); if (consecutive >= 4) { aborted = true; console.error('ABORT: 4 consecutive Gemini 429/5xx'); break; } await new Promise((r) => setTimeout(r, 15000)); }
          else { console.error(`  gemini error: ${e.message.slice(0, 120)}`); res = { error: e.message.slice(0, 160) }; break; }
        }
      }
      if (!res) { gemErr++; continue; }
      if (res.error) { gemErr++; out.write(JSON.stringify({ ...row, neighbours: undefined, ia_text: row.ia_text.slice(0, 1200), error: `gemini: ${res.error}` }) + '\n'); continue; }
      inTok += res.inputTokens; outTok += res.outputTokens; thought += res.thinkingTokens; cost += res.costUsd + (res.thinkingTokens / 1e6) * 1.5;
      const m = pageMetrics(row.ia_text, res.text);
      const flags = refFlags(res.text, row.ia_text, res.finishReason);
      // Pairing check: if a NEIGHBOURING leaf fits the fresh read much better than the delivered one, the
      // delivered text is the wrong page (the ingester's leaf pairing slipped) — a delivery error, not a misread.
      const rt = tokens(normalise(res.text));
      const nb = (row.neighbours || []).map((x) => ({ d: x.d, seq: r3(ratio(tokens(normalise(x.text)), rt)) })).sort((a, b) => b.seq - a.seq)[0] || null;
      const misaligned = !!(nb && nb.seq > 0.5 && nb.seq > m.seq + 0.2);
      const { neighbours, ...rowNoNb } = row;
      const full = { ...rowNoNb, ia_text: row.ia_text.slice(0, 1200), neighbour_best: nb, misaligned, ref_text: res.text.slice(0, 1200), ...m, ref_flags: flags, finish_reason: res.finishReason, model: OCR_MODEL_LITE, doc_context: true, prompt_version: prompt.version, prompt_hash: prompt.content_hash || null, tokens: { in: res.inputTokens, out: res.outputTokens, thought: res.thinkingTokens }, cost_usd: r3(res.costUsd), duration_ms: res.durationMs, read_at: new Date().toISOString() };
      out.write(JSON.stringify(full) + '\n'); n++;
      if (n % 25 === 0) console.log(`  ${n} read | $${cost.toFixed(3)} | ${((Date.now() - t0) / 1000 / n).toFixed(1)}s/page | image errors ${imgErr}, gemini errors ${gemErr}`);
      if (cost > MAX_COST) { aborted = true; console.error(`STOP: spend $${cost.toFixed(2)} exceeds --max-cost ${MAX_COST}`); }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  out.end();
  console.log(`ocr done: ${n} pages read, ${imgErr} image errors, ${gemErr} gemini errors${aborted ? ' (ABORTED)' : ''} | tokens in ${inTok} out ${outTok} thought ${thought} | cost $${cost.toFixed(4)} ($${(cost / Math.max(1, n) * 1000).toFixed(2)}/1K pages)`);
  if (aborted) process.exit(3);
}

// ---------- stage: report ----------
function stageReport() {
  const all = fs.readFileSync(RESULTS, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const refused = all.filter((r) => /RECITATION|PROHIBITED/.test(r.finish_reason || ''));
  const rows = all.filter((r) => r.cer != null);
  const clean = rows.filter((r) => !r.ref_flags?.length && !r.misaligned);
  const misaligned = rows.filter((r) => r.misaligned);
  const fmt = (x, d = 3) => (x == null ? '—' : x.toFixed(d));
  const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(0)}%`);
  const share = (xs, t) => (xs.length ? xs.filter((c) => c <= t).length / xs.length : null);
  const cell = (xs) => { const c = xs.map((r) => r.cer); return `${xs.length} | ${fmt(median(c))} | ${fmt(pct(c, 0.25))}–${fmt(pct(c, 0.75))} | ${pc(share(c, 0.02))} | ${pc(share(c, 0.05))} | ${pc(share(c, 0.1))} | ${pc(share(c, 0.2))}`; };
  const L = [];
  L.push(`# IA OCR delivered quality — ${rows.length} pages / books scored of ${all.length} read (${refused.length} reference reads refused by Gemini, ${all.length - rows.length - refused.length} other errors; ${rows.filter((r) => r.ref_flags?.length).length} degenerate references and ${misaligned.length} mis-paired pages excluded from the CER tables and reported below)`);
  L.push(`\nCost: $${all.reduce((s, r) => s + (r.cost_usd || 0), 0).toFixed(3)} | model ${rows[0]?.model} | prompt v${rows[0]?.prompt_version} ${rows[0]?.prompt_hash || ''}`);
  const bandNames = BANDS.map((b) => b[2]);
  L.push(`\n## CER by re-scored agreement band (all languages)\n\n| band (agreement_now) | n | median CER | IQR | ≤2% | ≤5% | ≤10% | ≤20% |\n|---|---|---|---|---|---|---|---|`);
  for (const b of bandNames) { const xs = clean.filter((r) => r.band === b); if (xs.length) L.push(`| ${b} | ${cell(xs)} |`); }
  L.push(`| ALL | ${cell(clean)} |`);
  for (const lang of LANGS) {
    const xs = clean.filter((r) => r.language === lang); if (!xs.length) continue;
    L.push(`\n## ${lang} — by band\n\n| band | n | median CER | IQR | ≤2% | ≤5% | ≤10% | ≤20% |\n|---|---|---|---|---|---|---|---|`);
    for (const b of bandNames) { const ys = xs.filter((r) => r.band === b); if (ys.length) L.push(`| ${b} | ${cell(ys)} |`); }
  }
  L.push(`\n## CER by half-century × language (median CER, n) — pages in the ACCEPTED bands (≥ 0.85) only\n`);
  const hcs = [...new Set(clean.map((r) => r.half_century))].sort();
  L.push(`| half-century | ${LANGS.join(' | ')} |\n|---|${LANGS.map(() => '---').join('|')}|`);
  for (const hc of hcs) L.push(`| ${hc} | ${LANGS.map((l) => { const xs = clean.filter((r) => r.half_century === hc && r.language === l && r.agreement_now >= 0.85); return xs.length ? `${fmt(median(xs.map((r) => r.cer)))} (${xs.length})` : '—'; }).join(' | ')} |`);
  L.push(`\n## Cutoff sweep per language — pages the gate would ACCEPT at cutoff c (agreement_now ≥ c): n, median CER, share ≤5%, share >20%; and what c REJECTS that is actually good (CER ≤5%)\n`);
  for (const lang of LANGS) {
    const xs = clean.filter((r) => r.language === lang); if (xs.length < 8) continue;
    L.push(`\n### ${lang} (n=${xs.length})\n\n| cutoff | accepted n | median CER | ≤5% | >20% | rejected n | rejected ≤5% (false rejects) |\n|---|---|---|---|---|---|---|`);
    for (const c of [0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]) {
      const acc = xs.filter((r) => r.agreement_now >= c), rej = xs.filter((r) => r.agreement_now < c);
      const ac = acc.map((r) => r.cer);
      L.push(`| ${c.toFixed(2)} | ${acc.length} | ${fmt(median(ac))} | ${pc(share(ac, 0.05))} | ${pc(acc.length ? acc.filter((r) => r.cer > 0.2).length / acc.length : null)} | ${rej.length} | ${rej.length ? `${rej.filter((r) => r.cer <= 0.05).length} (${pc(rej.filter((r) => r.cer <= 0.05).length / rej.length)})` : '—'} |`);
    }
  }
  L.push(`\n## Order vs reading: bag-of-words minus sequence (gap) — does it isolate splice failures?\n`);
  const big = clean.filter((r) => r.gap >= 0.15).sort((a, b) => b.gap - a.gap);
  L.push(`Pages with gap ≥ 0.15: ${big.length} of ${clean.length}. Median CER among them ${fmt(median(big.map((r) => r.cer)))} vs ${fmt(median(clean.filter((r) => r.gap < 0.15).map((r) => r.cer)))} for the rest. Median cer_alnum (punctuation-free) among them ${fmt(median(big.map((r) => r.cer_alnum)))}.`);
  L.push(`\n| gap | bow | seq | CER | agreement_now | language | year | book | page |\n|---|---|---|---|---|---|---|---|---|`);
  for (const r of big.slice(0, 25)) L.push(`| ${fmt(r.gap)} | ${fmt(r.bow)} | ${fmt(r.seq)} | ${fmt(r.cer)} | ${fmt(r.agreement_now)} | ${r.language} | ${r.year || '?'} | ${r.title.slice(0, 40)} | [p.${r.page_number}](${r.image_url}) |`);
  L.push(`\n## Book statistic: median over ALL reference pages vs over PROSE-looking pages only\n`);
  const withProse = rows.filter((r) => r.agreement_prose != null && r.n_ref_prose >= 3);
  const crossUp = withProse.filter((r) => r.agreement_now < 0.85 && r.agreement_prose >= 0.85), crossDown = withProse.filter((r) => r.agreement_now >= 0.85 && r.agreement_prose < 0.85);
  L.push(`Books with ≥3 prose reference pages: ${withProse.length}. Prose-median moves ${crossUp.length} rejected books ABOVE 0.85 (their delivered-page median CER ${fmt(median(crossUp.map((r) => r.cer)))}) and ${crossDown.length} accepted books BELOW it (median CER ${fmt(median(crossDown.map((r) => r.cer)))}). Median |prose − all| = ${fmt(median(withProse.map((r) => Math.abs(r.agreement_prose - r.agreement_now))))}.`);
  L.push(`\n| language | n | median all | median prose | median p75 | books moved up | their CER |\n|---|---|---|---|---|---|---|`);
  for (const lang of LANGS) { const xs = withProse.filter((r) => r.language === lang); if (!xs.length) continue; const up = xs.filter((r) => r.agreement_now < 0.85 && r.agreement_prose >= 0.85); L.push(`| ${lang} | ${xs.length} | ${fmt(median(xs.map((r) => r.agreement_now)))} | ${fmt(median(xs.map((r) => r.agreement_prose)))} | ${fmt(median(xs.map((r) => r.agreement_p75)))} | ${up.length} | ${fmt(median(up.map((r) => r.cer)))} |`); }
  L.push(`\n## Delivery errors: the text is the WRONG PAGE (a neighbouring leaf fits the fresh read better)\n`);
  L.push(`${misaligned.length} of ${rows.length} pages. By band: ${bandNames.map((b) => `${b} ${misaligned.filter((r) => r.band === b).length}/${rows.filter((r) => r.band === b).length}`).join(', ')}. By language: ${LANGS.map((l) => `${l} ${misaligned.filter((r) => r.language === l).length}/${rows.filter((r) => r.language === l).length}`).join(', ')}. Stored (already written) among them: ${misaligned.filter((r) => r.stored).length}.`);
  if (misaligned.length) { L.push(`\n| best neighbour | its seq | delivered seq | agreement_now | offset (share) | language | book | page |\n|---|---|---|---|---|---|---|---|`); for (const r of misaligned.slice(0, 20)) L.push(`| ${r.neighbour_best.d} | ${fmt(r.neighbour_best.seq)} | ${fmt(r.seq)} | ${fmt(r.agreement_now)} | ${r.offset} (${fmt(r.offset_share, 2)}) | ${r.language} | ${r.title.slice(0, 40)} | [p.${r.page_number}](${r.image_url}) |`); }
  L.push(`\n## The instrument\n`);
  const flagged = rows.filter((r) => r.ref_flags?.length);
  const byFlag = {}; for (const r of flagged) for (const f of r.ref_flags) byFlag[f] = (byFlag[f] || 0) + 1;
  L.push(`Flagged references: ${flagged.length} of ${rows.length} (${Object.entries(byFlag).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}). By language: ${LANGS.map((l) => `${l} ${flagged.filter((r) => r.language === l).length}/${rows.filter((r) => r.language === l).length}`).join(', ')}.`);
  const stored = rows.filter((r) => r.stored);
  L.push(`Stored-text check: ${stored.length} pages were read from \`pages.ocr.data\` (source ia_djvu); ${stored.filter((r) => r.stored_matches_regen).length} match the leaf regenerated from the cache exactly after normalisation.`);
  L.push(`Refused references: ${refused.length} (${LANGS.map((l) => `${l} ${refused.filter((r) => r.language === l).length}`).join(', ')}); by band ${bandNames.map((b) => `${b} ${refused.filter((r) => r.band === b).length}`).join(', ')}.`);
  const anchors = all.filter((r) => r.anchor);
  if (anchors.length) { L.push(`\n### Anchor pages (human verdict vs metric)\n\n| verdict | CER | WER | gap | agreement_now | book | page |\n|---|---|---|---|---|---|---|`); for (const r of anchors) L.push(`| ${r.anchor.verdict} | ${fmt(r.cer)} | ${fmt(r.wer)} | ${fmt(r.gap)} | ${fmt(r.agreement_now)} | ${r.title.slice(0, 40)} (${r.year || '?'}) | [p.${r.page_number}](${r.image_url}) |`); }
  L.push(`\n## Worst 15 pages in the ACCEPTED bands (what a reader can hit today)\n\n| CER | gap | agreement_now | language | year | book | page | flags |\n|---|---|---|---|---|---|---|---|`);
  for (const r of clean.filter((r) => r.agreement_now >= 0.85).sort((a, b) => b.cer - a.cer).slice(0, 15)) L.push(`| ${fmt(r.cer)} | ${fmt(r.gap)} | ${fmt(r.agreement_now)} | ${r.language} | ${r.year || '?'} | ${r.title.slice(0, 40)} | [p.${r.page_number}](${r.image_url}) | ${(r.ref_flags || []).join(' ')} |`);
  const md = L.join('\n'); fs.writeFileSync(`${OUT}.md`, md); console.log(md);
}

if (STAGE === 'report') stageReport();
else await withMongo(async (db) => {
  if (STAGE === 'sample' || STAGE === 'all') await stageSample(db);
  if (STAGE === 'ocr' || STAGE === 'all') await stageOcr(db);
  if (STAGE === 'all') stageReport();
}, { timeoutMs: 4 * 60 * 60 * 1000 });
