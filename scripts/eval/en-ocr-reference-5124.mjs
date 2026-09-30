#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/ia-ocr-delivered-quality.mjs (#4780 — one interior page per book, but
 * scores the Archive text against a fresh lite read, i.e. AGREEMENT, not truth; its gate replica,
 * `leafIndex` and normaliser are the model for the ones here); scripts/eval/harvest-wikisource-gt.mjs
 * (Wikisource proofread pages as ground truth, but it harvests pages we do NOT hold and has no IA
 * leaf join); scripts/eval/build-reference-groundtruth.mjs (one hand-curated passage per work);
 * scripts/eval/ia-confidence-vs-gate.mjs (gate calibration, no reference). None of them puts a
 * truth independent of BOTH engines under a page we hold, which is the whole point here.
 * Reused: lib/wikisource-text.mjs `cleanPageText`/`pageQuality`, lib/runners.mjs `runGemini`/
 * `fetchImage`, lib/production-prompt.mjs, lib/metrics.mjs `levenshtein`, lib/paired-stats.mjs,
 * scripts/lib/ia-ocr-meta.mjs `iaFetch`, scripts/lib/dehyphenate.mjs, scripts/lib/page-image-url.mjs.
 *
 * en-ocr-reference-5124 — English OCR reference pages, and both engines scored against them (#5124).
 *
 * THE DECISION IT FEEDS. For which English Internet Archive books may the Archive's own OCR text
 * stand in for a paid Gemini flash-lite read? Until now every English number was two engines
 * agreeing (eval-design.md §11: zero English reference pages), which cannot say who is right —
 * and #5186 showed the failure that matters to a reader (a year misread 1836→1886) passes every
 * word-level agreement gate.
 *
 * THE TRUTH. en.wikisource `Page:` transcriptions (proofread, level ≥ 3) of the SAME Internet
 * Archive scan we hold: the Index file is matched to our book by the IA identifier in its file
 * name, and the Wikisource page is located on the IA leaf by text (±3 leaves), then checked by
 * opening our page image (`leaf_check`). The pool is therefore books Wikisource volunteers chose
 * to proofread — a selection toward legible, canonical-ish works; quote every rate with that.
 *
 * STAGES (run on Hetzner — archive.org and Gemini are flaky/blocked from the laptop):
 *   --stage=pool     our English IA books ∩ en.wikisource Index files; proofread page lists (free)
 *   --stage=draw     one interior proofread page per book, stratified (free)
 *   --stage=fetch    WS text + IA djvu leaf + IA covariates + our page + image (free)
 *   --stage=ocr      fresh flash-lite read of OUR page image into the eval store (PAID, --max-cost)
 *   --stage=score    CER / WER / digit error per engine vs the reference (free)
 *   --stage=report   markdown tables per stratum × engine with bootstrap CIs (free)
 *   --stage=ocr --arm=flash|lite-repeat   #5182's flash-preview arm and lite-vs-lite floor on the scored pages (PAID)
 *   --stage=flash-report   #5182's paired lite-vs-flash tables and the preregistered rule (free)
 * Nothing here writes to `pages`, `books` or any store a production lane reads.
 *
 * usage-ok: one-off hand-run eval, ≈150 pages of lite realtime (≈$0.35), hard stop at --max-cost 3,
 * never scheduled. Recorded in scripts/eval/EXPERIMENTS.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../lib/mongo.mjs';
import { dehyphenateLineBreaks } from '../lib/dehyphenate.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';
import { editionYear } from '../lib/identity-fields.mjs';
import { iaFetch } from '../lib/ia-ocr-meta.mjs';
import { OCR_MODEL_LITE, OCR_MODEL_FLASH } from '../lib/ocr-routing.mjs';
import { cleanPageText, pageQuality } from './lib/wikisource-text.mjs';
import { runGemini, fetchImage } from './lib/runners.mjs';
import { getProductionOcrPrompt } from './lib/production-prompt.mjs';
import { levenshtein } from './lib/metrics.mjs';
import { binomTwoSided, bootstrapRatioCI, resetSeed, seededRand } from './lib/paired-stats.mjs';

const argEq = (k, d) => { const a = process.argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : d; };
const STAGE = argEq('--stage', 'report');
const SEED = +argEq('--seed', 5124);
const PER_STRATUM = +argEq('--per-stratum', 40);          // draw target; ≥30 referenced is the bar
const MAX_COST = +argEq('--max-cost', 3);
const CONCURRENCY = +argEq('--concurrency', 4);
const CACHE = argEq('--cache', '/root/sl-ia-cache');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = argEq('--out', path.join(HERE, 'results', 'en-ocr-ref-5124'));
const IMG = argEq('--img', path.join(OUT, 'img'));        // page images for the leaf check (not committed)
const PG_CACHE = argEq('--pg-cache', '/root/sl-pg-cache');           // Gutenberg HTML, fetched once
const REFETCH = argEq('--refetch-skipped', null);   // re-run fetch rows skipped for this reason
const INCLUDE_UNCHECKED = process.argv.includes('--include-unchecked');
const RUN_ID = argEq('--run-id', 'en-ocr-ref-5124-2026-09');
const LITE_RUN = 'en-ocr-ref-5124-2026-09';   // #5216's lite read: the production arm every later arm pairs against
/**
 * ARMS (#5182, preregistered in PREREGISTRATION-english-modern-5182.md): the same page images, the same
 * production prompt and params, a different model or a second read. `--arm` picks one for --stage=ocr.
 *  lite         #5216's read (default; unchanged behaviour)
 *  flash        gemini-3-flash-preview on every scored page
 *  lite-repeat  lite again on 20 pages drawn by seed 5182 — the A-vs-A noise floor
 *  mineru         MinerU (CPU pipeline, `-m ocr`) on every scored page — no model call, $0
 *                 (PREREGISTRATION-mineru-english-5182.md)
 *  mineru-repeat  MinerU again on the same 20 seed-5182 pages — its floor, measured not assumed
 *  mineru-fn      POST-HOC: MinerU with PR #5299's footnote step (page_footnote blocks appended) — a re-analysis, not preregistered
 */
const ARMS = {
  lite: { model: OCR_MODEL_LITE, engine: 'gemini-lite-realtime', run_id: LITE_RUN, suffix: 'lite', issue: 5124 },
  flash: { model: OCR_MODEL_FLASH, engine: 'gemini-flash-realtime', run_id: 'en-flash-5182-2026-09', suffix: 'flash', issue: 5182 },
  'lite-repeat': { model: OCR_MODEL_LITE, engine: 'gemini-lite-realtime-r2', run_id: 'en-lite-repeat-5182-2026-09', suffix: 'lite-r2', issue: 5182, repeat_of: LITE_RUN, n: 20, seed: 5182 },
  mineru: { model: 'mineru-pipeline', engine: 'mineru-pipeline-cpu', run_id: 'en-mineru-5182-2026-09', suffix: 'mineru', issue: 5182, local: true },
  'mineru-repeat': { model: 'mineru-pipeline', engine: 'mineru-pipeline-cpu-r2', run_id: 'en-mineru-repeat-5182-2026-09', suffix: 'mineru-r2', issue: 5182, local: true, repeat_of: 'en-mineru-5182-2026-09', n: 20, seed: 5182 },
  // POST-HOC (not preregistered): the same binary, with PR #5299's footnote step — `page_footnote` blocks from
  // middle.json appended below the body. Added after the mineru arm showed every catastrophic page was a dropped footnote.
  'mineru-fn': { model: 'mineru-pipeline', engine: 'mineru-pipeline-cpu-fn', run_id: 'en-mineru-fn-5182-2026-09', suffix: 'mineru-fn', issue: 5182, local: true, footnotes: true, post_hoc: true },
};
const GEMINI_ARMS = ['lite', 'flash', 'lite-repeat'];
const ARM = ARMS[argEq('--arm', 'lite')];
if (!ARM) throw new Error(`unknown --arm; one of ${Object.keys(ARMS).join(', ')}`);
const EXPECT_PROMPT_HASH = argEq('--expect-prompt-hash', null);   // #5182: stop if production's prompt moved since #5216
const MONTH = '2026-09';
fs.mkdirSync(OUT, { recursive: true });
const F = (n) => path.join(OUT, n);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- seeded RNG (mulberry32), same as ia-ocr-delivered-quality ----------
let seed = SEED >>> 0;
const rand = () => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- strata ----------
// DATE-HEAVY is decided FROM THE PAGE (eval-design §3.2: strata come from the page, not the
// catalogue), because the genre rule alone cannot fill the cell: of our 5,096 English IA books
// only 80 are county histories / biographical dictionaries / annals / almanacs by title, and a
// title rule mislabels in both directions ("Autobiography" matches /biograph/; a history of
// Rome prints a year on every line). The rule, recorded on every row as `date_dense_rule`:
//   a page is DATE-DENSE when its REFERENCE body carries ≥ 6 numeric tokens of 2–4 digits.
// The genre rule is kept as a covariate (`genre_date_heavy`), decided from title + subjects.
const DATE_DENSE_MIN = 6;
const DATE_DENSE_RULE = `v1: reference body has >= ${DATE_DENSE_MIN} numeric tokens /^\\d{2,4}$/ (years, dates, page and chapter refs)`;
const GENRE_RULE = 'v1: title|subjects ~ /county|township|parish|history of the (town|city)|(?<!auto)biograph|genealog|descendants|directory|register|annals|chronicle|calendar|almanac|gazetteer|annual report|obituar|memorial record|roll of|who.s who|peerage|baronetage/i';
const GENRE_RE = /county|township|parish|history of the (town|city)|(?<!auto)biograph|genealog|descendants|directory|register|annals|chronicle|calendar|almanac|gazetteer|annual report|obituar|memorial record|roll of|who.s who|peerage|baronetage/i;
const period = (y) => (y == null ? null : y < 1880 ? 'pre1880' : y <= 1930 ? '1880-1930' : null);
const stratumOf = (y, dateDense) => { const p = period(y); if (!p) return null; return p === 'pre1880' ? (dateDense ? 'S2' : 'S1') : (dateDense ? 'S4' : 'S3'); };
const STRATA = { S1: 'pre-1880 prose', S2: 'pre-1880 date-dense', S3: '1880–1930 prose', S4: '1880–1930 date-dense' };
const numCount = (text) => words(normalise(text)).filter(isNum).length;

// ---------- Wikisource API ----------
const UA = 'SourceLibrary-OCR-Reference/1.0 (https://sourcelibrary.org; team@sourcelibrary.org) node-fetch';
const WS = 'https://en.wikisource.org/w/api.php';
async function wsApi(params, base = WS) {
  const qs = new URLSearchParams({ ...params, format: 'json', formatversion: '2' });
  for (let attempt = 0; attempt < 6; attempt++) {
    let r;
    try { r = await fetch(base, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs }); }
    catch { await sleep(3000 * 2 ** attempt); continue; }
    if (r.status === 429 || r.status >= 500) { const ra = +(r.headers.get('retry-after') || 0); await sleep(Math.max(ra * 1000, 3000 * 2 ** attempt)); continue; }
    return r.json();
  }
  throw new Error(`wikisource API failed: ${JSON.stringify(params).slice(0, 200)}`);
}
/** every title in a namespace (ns 106 = Index:) */
async function allTitles(ns) {
  const out = []; let cont = {};
  for (;;) {
    const j = await wsApi({ action: 'query', list: 'allpages', apnamespace: String(ns), aplimit: 'max', ...cont });
    out.push(...(j.query?.allpages || []).map((p) => p.title));
    if (!j.continue) break; cont = j.continue; await sleep(200);
  }
  return out;
}
/** Page:<file>/<n> titles with their proofread quality level (ProofreadPage `prop=proofread`) */
async function pageList(file) {
  const out = []; let cont = {};
  for (;;) {
    const j = await wsApi({ action: 'query', generator: 'allpages', gapnamespace: '104', gapprefix: `${file}/`, gaplimit: 'max', prop: 'proofread', ...cont });
    for (const p of j.query?.pages || []) {
      const n = +(p.title.match(/\/(\d+)$/) || [])[1];
      if (n) out.push({ n, q: p.proofread?.quality ?? null });
    }
    if (!j.continue) break; cont = j.continue; await sleep(200);
  }
  return out.sort((a, b) => a.n - b.n);
}
async function pageWikitext(title) {
  const j = await wsApi({ action: 'query', prop: 'revisions', titles: title, rvprop: 'content|ids|timestamp', rvslots: 'main' });
  const p = j.query?.pages?.[0]; const rev = p?.revisions?.[0];
  return rev ? { text: rev.slots?.main?.content ?? rev.content ?? '', revid: rev.revid, timestamp: rev.timestamp } : null;
}

/**
 * Wikisource page wikitext → the text PRINTED on the page body.
 * Differences from cleanPageText, each deliberate for English Page: pages:
 *  - footnotes: on en.wikisource `<ref>` IS the footnote printed at the foot of this leaf, so its
 *    content is kept (appended at the end, where the page prints it) instead of dropped;
 *  - wikitables (`{| … |}`) are the date-heavy genres' bodies (annals, registers): the markup is
 *    removed and the cells kept, in reading order;
 *  - the noinclude header/footer (running head, page number) is dropped by cleanPageText; the
 *    scorer trims an engine's unmatched leading/trailing words for the same reason (see `trimToRef`).
 */
function wsBodyText(wikitext) {
  const notes = [];
  let t = String(wikitext || '').replace(/<ref(?:\s[^>]*)?>([\s\S]*?)<\/ref>/gi, (_, x) => { notes.push(x); return ' '; });
  t = t.replace(/<ref[^>]*\/>/gi, ' ');
  t = t + (notes.length ? '\n\n' + notes.join('\n') : '');
  t = t.split('\n').map((l) => {
    if (/^\s*(\{\||\|\}|\|-|\|\+)/.test(l)) return /^\s*\|\+/.test(l) ? l.replace(/^\s*\|\+/, '') : '';
    if (/^\s*[|!]/.test(l)) return l.replace(/^\s*[|!]/, '').split(/\|\||!!/).map((c) => c.replace(/^[^|[\]{}]*?\|(?!\|)/, (m) => (/=/.test(m) ? '' : m))).join(' ');
    return l;
  }).join('\n');
  t = t.replace(/^[:;*#]+/gm, '').replace(/__[A-Z]+__/g, ' ');
  return cleanPageText(t);
}

// ---------- IA djvu leaves (mirrors ia-ocr-ingest / ia-ocr-delivered-quality) ----------
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
async function loadLeaves(iaId, xmlName) {
  const j = path.join(CACHE, `${iaId}.leaves.json`), x = path.join(CACHE, `${iaId}_djvu.xml`);
  if (fs.existsSync(j)) return { leaves: JSON.parse(fs.readFileSync(j, 'utf8')).map(dehyphenateLineBreaks), from: 'cache-leaves' };
  if (fs.existsSync(x)) return { leaves: leafTexts(fs.readFileSync(x, 'utf8')).map(dehyphenateLineBreaks), from: 'cache-xml' };
  // Not iaFetch: its abort-on-4-refusals is right for a walk, wrong for one item whose file 503s.
  let res = null;
  for (let a = 0; a < 3 && !res?.ok; a++) {
    if (a) await sleep(10000);
    res = await fetch(`https://archive.org/download/${iaId}/${encodeURIComponent(xmlName || `${iaId}_djvu.xml`)}`, { headers: { 'User-Agent': UA }, redirect: 'follow' }).catch(() => null);
  }
  if (!res?.ok) return null;
  const xml = await res.text();
  fs.writeFileSync(x, xml);   // the shared leaves cache — same file name the ingester uses
  return { leaves: leafTexts(xml).map(dehyphenateLineBreaks), from: 'download' };
}
async function iaCovariates(iaId) {
  const res = await iaFetch(`https://archive.org/metadata/${iaId}`);
  if (!res.ok) return null;
  const j = await res.json(); const m = j?.metadata || {};
  const xmlFiles = (j?.files || []).filter((f) => /_djvu\.xml$/.test(f.name || ''));
  const xmlFile = xmlFiles.find((f) => f.name === `${iaId}_djvu.xml`) || xmlFiles[0];
  const scanner = [].concat(m.scanner || []).join('; ') || null;
  return {
    ocr: [].concat(m.ocr || []).join('; ') || null,
    ocr_module_version: m.ocr_module_version || null,
    ocr_converted: m.ocr_converted || null,
    ocr_date: xmlFile?.mtime ? new Date(+xmlFile.mtime * 1000).toISOString().slice(0, 10) : null,
    scanner,
    scanner_class: /goog/i.test(`${scanner || ''} ${iaId}`) || /google/i.test(`${m.contributor || ''} ${m.sponsor || ''}`) ? 'google' : scanner ? 'ia-native' : 'unknown',
    scandate: m.scandate ? String(m.scandate).slice(0, 8) : null,
    sponsor: [].concat(m.sponsor || []).join('; ') || null,
    contributor: [].concat(m.contributor || []).join('; ') || null,
    xml_name: xmlFile?.name || null, n_xml: xmlFiles.length,
  };
}

// ---------- text normalisation + metrics ----------
/** engine output / reference → the words printed (tags whose content is not on the page first) */
// ORDER MATTERS. The centred-line marks `->Copy.<-` must go BEFORE any tag stripping: a generic
// /<[^>]+>/ reads `<-` as the start of a tag and deletes everything up to the next `>` — measured
// here as a lite page scored at 13% of its length (2026-09-28). ia-ocr-delivered-quality.mjs has the
// same ordering. Tags are only `<name …>` / `</name>`. Running heads, page numbers and the script
// label are dropped with their content (the reference excludes them).
// `<note>` is defined by the production prompt as "interpretive notes for readers", but lite files
// the page's PRINTED footnotes in it (seen on en-69b9a2-ws132, en-699200-ws404). Its content is moved
// to the end of the page, where footnotes print: a footnote then matches the reference, and genuine
// commentary is trimmed by trimToRef as unmatched trailing words.
function normalise(s) {
  const notes = [];
  s = String(s || '').replace(/<note\b[^<>]*>([\s\S]*?)<\/note>/gi, (_, x) => { notes.push(x); return ' '; });
  if (notes.length) s += '\n' + notes.join('\n');
  return s
    .replace(/^->\s*|\s*<-$/gm, '').replace(/->|<-/g, ' ')
    .replace(/<(warning|meta|image-desc|figure|scan-quality|language|page-type|columns|detected-images|vocab|summary|keywords|script|page-num|header|footer|catchword|signature)\b[^<>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>/g, ' ')
    .replace(/^#{1,6}\s+/gm, '').replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1').replace(/^-{3,}$/gm, '').replace(/^>\s*/gm, '').replace(/\|/g, ' ')
    .normalize('NFKC').toLowerCase().replace(/ſ/g, 's').replace(/[’‘ʼ`´]/g, "'").replace(/[“”„]/g, '"').replace(/[‐‑‒–—―]/g, '-')
    .replace(/(\p{L})-\s+(\p{L})/gu, '$1$2')                 // a line-end hyphen left in any of the three texts
    .replace(/\s+/g, ' ').trim();
}
const words = (s) => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const isNum = (w) => /^\d{2,4}$/.test(w);

/** word-level edit alignment with backtrace → [{op:'=',r,h}|{op:'s',r,h}|{op:'d',r}|{op:'i',h}] */
function alignWords(ref, hyp) {
  const n = ref.length, m = hyp.length;
  if (n * m > 6e6) return null;
  const D = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i++) D[i][0] = i; for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { ops.push({ op: ref[i - 1] === hyp[j - 1] ? '=' : 's', r: ref[i - 1], h: hyp[j - 1] }); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.push({ op: 'd', r: ref[i - 1] }); i--; }
    else { ops.push({ op: 'i', h: hyp[j - 1] }); j--; }
  }
  return ops.reverse();
}
/**
 * The reference is the page BODY (Wikisource keeps the running head and page number in the
 * noinclude header); an engine that transcribes them is right to. Trim the engine's words that
 * lie wholly before the first / after the last word the alignment matches, and report how many
 * were trimmed so the rule can be seen, not assumed.
 */
function trimToRef(refW, hypW) {
  const ops = alignWords(refW, hypW); if (!ops) return { hypW, trimmedHead: 0, trimmedTail: 0 };
  let first = ops.findIndex((o) => o.op === '='), last = ops.length - 1 - [...ops].reverse().findIndex((o) => o.op === '=');
  if (first < 0) return { hypW, trimmedHead: 0, trimmedTail: 0 };
  const headIns = ops.slice(0, first).filter((o) => o.op === 'i').length, tailIns = ops.slice(last + 1).filter((o) => o.op === 'i').length;
  return { hypW: hypW.slice(headIns, hypW.length - tailIns), trimmedHead: headIns, trimmedTail: tailIns };
}
const r4 = (x) => (x == null || Number.isNaN(x) ? null : +x.toFixed(4));
function scorePage(refText, hypText) {
  const r = normalise(refText), h0 = normalise(hypText);
  const refW = words(r), hyp0 = words(h0);
  const { hypW, trimmedHead, trimmedTail } = trimToRef(refW, hyp0);
  const ops = alignWords(refW, hypW) || [];
  const wordErr = ops.filter((o) => o.op !== '=').length;
  // CER over the letters+digits stream (spacing and punctuation conventions differ between a
  // Wikisource transcription and an OCR engine without either being wrong), plus a CER with
  // punctuation kept, on the trimmed engine text.
  const refA = refW.join(' '), hypA = hypW.join(' ');
  const charEdits = levenshtein(hypA, refA);
  const cer = refA.length ? charEdits / refA.length : null;
  // digits: numeric tokens of 2–4 digits (years, dates, page refs) — #5186's failure class
  let nNum = 0, sub = 0, drop = 0, ins = 0; const numErrors = [], misreads = [];
  // A MISREAD CANDIDATE is a printed number read as another NUMBER-LIKE token of about the same length
  // (1836→1886, 438→488, 16→6, 105→io): the #5186 class. It is a candidate, not a finding — table
  // order, a reference that differs from the print, and footnote anchors all produce the same shape,
  // so each one is read off the image (--stage=digitpack) before it is counted.
  let ri = 0;
  for (const o of ops) {
    if (o.op !== 'i') ri++;
    if (o.op === '=' && isNum(o.r)) nNum++;
    else if (o.op === 's' && isNum(o.r)) {
      nNum++; sub++; numErrors.push(`${o.r}→${o.h}`);
      if (/^[\dilIoOsSzZgGbB]+$/.test(o.h) && /\d/.test(o.h + o.r) && Math.abs(o.h.length - o.r.length) <= 1) misreads.push({ r: o.r, h: o.h, ctx: refW.slice(Math.max(0, ri - 7), ri + 6).join(' ') });
    }
    else if (o.op === 'd' && isNum(o.r)) { nNum++; drop++; numErrors.push(`${o.r}→∅`); }
    else if (o.op === 's' && isNum(o.h)) { ins++; numErrors.push(`${o.r}→${o.h}`); }
    else if (o.op === 'i' && isNum(o.h)) { ins++; numErrors.push(`∅→${o.h}`); }
  }
  return {
    bow: r4(bagDice(refW, hypW)),   // order-free: separates reading-order faults from wrong/missing text
    cer: r4(cer), char_edits: charEdits, ref_alnum_chars: refA.length, wer: refW.length ? r4(wordErr / refW.length) : null,
    ref_words: refW.length, hyp_words: hypW.length, trimmed_head: trimmedHead, trimmed_tail: trimmedTail,
    len_ratio: r4(hypW.length / Math.max(1, refW.length)),
    num_ref: nNum, num_sub: sub, num_drop: drop, num_ins: ins,
    digit_err: nNum ? r4((sub + drop + ins) / nNum) : null, num_errors: numErrors.slice(0, 20), misread_candidates: misreads,
  };
}

// ============================ stages ============================
async function stagePool(db) {
  const books = await db.collection('books').find(
    { language: 'English', 'image_source.provider': 'internet_archive' },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, subjects: 1, categories: 1, ia_identifier: 1, 'image_source.identifier': 1, pages_count: 1, pages_ocr: 1, visible: 1, hidden_reason: 1, 'pipeline_auto.status': 1, held: 1 } },
  ).toArray();
  const byIa = new Map();
  for (const b of books) { const ia = (b.ia_identifier || b.image_source?.identifier || '').toLowerCase(); if (ia && b.pages_count > 0) byIa.set(ia, b); }
  console.log(`English IA books with pages: ${byIa.size} (of ${books.length})`);
  const titles = await allTitles(106);
  console.log(`en.wikisource Index pages: ${titles.length}`);
  const matches = [];
  for (const t of titles) {
    const file = t.replace(/^Index:/, '');
    const base = file.replace(/\.(djvu|pdf)$/i, '');
    const toks = new Set([base.toLowerCase(), ...base.toLowerCase().split(/[\s()[\],;:]+/).filter((x) => x.length >= 6)]);
    for (const k of toks) { const b = byIa.get(k); if (b) { matches.push({ file, ia: k, book_id: b.id, matched_by: "file-name" }); break; } }
  }
  console.log(`Index files naming one of our IA identifiers: ${matches.length}`);
  // Most Index files are named by TITLE, not identifier; their IA source is in the Index page's
  // |Source= field (`{{IA|id}}`, an archive.org link) or in the file description on Commons.
  // Full-text search both for our identifiers, OR-batched (CirrusSearch caps a query at 300 chars).
  const MATCHES = F('matches.jsonl');   // checkpoint: the search walk is ~25 min
  if (fs.existsSync(MATCHES)) { matches.length = 0; matches.push(...readJsonl(MATCHES)); console.log(`loaded ${matches.length} matches from checkpoint`); }
  else { await searchSources(titles, byIa, matches); writeJsonl(MATCHES, matches); }
  console.log(`Index files matched to our IA identifiers (name + source field + Commons): ${matches.length}`);
  return poolFromMatches(matches, byIa);
}
async function searchSources(titles, byIa, matches) {
  const indexSet = new Set(titles.map((t) => t.replace(/^Index:/, '')));
  const seenIa = new Set(matches.map((m) => m.ia));
  const ids = [...byIa.keys()].filter((k) => !seenIa.has(k) && /^[a-z0-9._-]+$/.test(k));
  const batches = []; let cur = [];
  for (const id of ids) { if ([...cur, id].map((x) => `"${x}"`).join(' OR ').length > 280) { batches.push(cur); cur = []; } cur.push(id); }
  if (cur.length) batches.push(cur);
  let searched = 0;
  for (const [base, ns] of [[WS, '106'], ['https://commons.wikimedia.org/w/api.php', '6']]) {
    for (const bt of batches) {
      const q = bt.map((x) => `"${x}"`).join(' OR ');
      const j = await wsApi({ action: 'query', list: 'search', srsearch: q, srnamespace: ns, srlimit: '50', srprop: 'snippet' }, base).catch(() => null);
      searched++;
      for (const hit of j?.query?.search || []) {
        const file = hit.title.replace(/^(Index|File):/, '');
        if (!indexSet.has(file)) continue;
        // which identifier did it hit? re-fetch the page text rather than trust the snippet
        const txt = (await wsApi({ action: 'query', prop: 'revisions', titles: hit.title, rvprop: 'content', rvslots: 'main' }, base).catch(() => null))?.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || '';
        const low = txt.toLowerCase();
        const id = bt.find((x) => new RegExp(`(archive\\.org/(details|download|stream)/|\\{\\{\\s*ia\\s*\\|\\s*|ia\\s*=\\s*)${x.replace(/[.]/g, '\\.')}\\b`).test(low));
        if (id && !seenIa.has(id)) { seenIa.add(id); matches.push({ file, ia: id, book_id: byIa.get(id).id, matched_by: ns === '106' ? 'index-source' : 'commons-description' }); }
      }
      if (searched % 50 === 0) console.log(`  searched ${searched}/${batches.length * 2} batches, matches ${matches.length}`);
      await sleep(250);
    }
  }
}
async function poolFromMatches(matches, byIa) {
  const pool = [];
  for (const mt of matches) {
    const b = byIa.get(mt.ia);
    const pl = await pageList(mt.file);
    const proofread = pl.filter((p) => p.q >= 3);
    const y = editionYear(b);
    const hay = `${b.title || ''} ${b.display_title || ''} ${[].concat(b.subjects || []).join(' ')} ${[].concat(b.categories || []).join(' ')}`;
    const dh = GENRE_RE.test(hay);
    pool.push({
      book_id: b.id, ia: mt.ia, ws_file: mt.file, title: b.display_title || b.title, author: b.author || null, year: y, published: b.published ?? null,
      visible: !!b.visible, hidden_reason: b.hidden_reason || null, pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0,
      ws_pages: pl.length, ws_proofread: proofread.length, ws_proofread_ns: proofread.map((p) => p.n),
      genre_date_heavy: dh, period: period(y), matched_by: mt.matched_by,
    });
    console.log(`  ${String(proofread.length).padStart(4)}/${String(pl.length).padEnd(4)} ${y ?? '????'} ${dh ? 'DH' : '  '} ${(b.display_title || b.title || '').slice(0, 70)}`);
  }
  // One Index file per book: where Wikisource holds several files of one IA item, keep the one
  // with the most proofread pages (the others are usually abandoned duplicate uploads).
  const best = new Map();
  for (const p of pool) { const o = best.get(p.book_id); if (!o || p.ws_proofread > o.ws_proofread) best.set(p.book_id, p); }
  pool.length = 0; pool.push(...best.values());
  writeJsonl(F('pool.jsonl'), pool);
  const c = {}; for (const p of pool) if (p.ws_proofread >= 10) c[p.period || "out"] = (c[p.period || "out"] || 0) + 1;
  console.log('books with ≥10 proofread pages, by period:', c);
}

/**
 * DRAW — one interior proofread page per book.
 * Interior = Wikisource page number in (15%, 95%] of the Index file's page count (front matter
 * lies; the back is indices and adverts). Up to 12 interior proofread pages per book are read, in
 * seeded random order; a page qualifies when its reference body has ≥ 400 characters. The book
 * enters its period's DATE-DENSE stratum if any qualifying page is date-dense (that page, chosen at
 * random among them), else the PROSE stratum. Date-dense pages are the scarce cell, so a book that
 * has one gives it — recorded as `assignment: date-dense-preferred`. Books are visited in seeded
 * random order and a stratum stops taking books at --per-stratum.
 */
async function stageDraw() {
  const pool = readJsonl(F('pool.jsonl')).filter((p) => p.ws_proofread > 0);
  const order = shuffle(pool);
  const filled = { S1: 0, S2: 0, S3: 0, S4: 0 };
  const draws = [], skips = [];
  for (const b of order) {
    const per = period(b.year);
    if (!per) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'out-of-period', year: b.year }); continue; }
    const [sp, sd] = per === 'pre1880' ? ['S1', 'S2'] : ['S3', 'S4'];
    if (filled[sp] >= PER_STRATUM && filled[sd] >= PER_STRATUM) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'strata-full' }); continue; }
    // NB ws_pages counts the Page: pages that EXIST, which is less than the scan when a book is only
    // partly transcribed — so this window let Contents/title pages through (caught by the leaf check,
    // 2026-09-27). The binding interior rule is applied at score time against the Archive leaf count.
    const lo = Math.floor(b.ws_pages * 0.15), hi = Math.ceil(b.ws_pages * 0.95);
    const interior = shuffle(b.ws_proofread_ns.filter((n) => n > lo && n <= hi)).slice(0, 12);
    if (!interior.length) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'no-interior-proofread-page' }); continue; }
    const cands = [];
    for (const n of interior) {
      const title = `Page:${b.ws_file}/${n}`;
      const w = await pageWikitext(title); if (!w) continue;
      const q = pageQuality(w.text); if (q == null || q < 3) continue;
      const body = wsBodyText(w.text);
      if (body.length < 400) continue;
      cands.push({ n, title, q, revid: w.revid, timestamp: w.timestamp, body, nums: numCount(body) });
      await sleep(150);
    }
    if (!cands.length) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'no-qualifying-page', tried: interior.length }); continue; }
    const dense = cands.filter((c) => c.nums >= DATE_DENSE_MIN);
    let pick, stratum;
    if (dense.length && filled[sd] < PER_STRATUM) { pick = dense[Math.floor(rand() * dense.length)]; stratum = sd; }
    else if (filled[sp] < PER_STRATUM) { const prose = cands.filter((c) => c.nums < DATE_DENSE_MIN); if (!prose.length) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'only-date-dense-and-cell-full' }); continue; } pick = prose[Math.floor(rand() * prose.length)]; stratum = sp; }
    else { skips.push({ book_id: b.book_id, ws_file: b.ws_file, skipped: 'strata-full' }); continue; }
    filled[stratum]++;
    const slug = `en-${b.book_id.slice(0, 6)}-ws${pick.n}`;
    fs.mkdirSync(F('refs'), { recursive: true });
    fs.writeFileSync(F(`refs/${slug}.txt`), pick.body + '\n');
    draws.push({
      slug, book_id: b.book_id, ia: b.ia, title: b.title, author: b.author, year: b.year, period: per, stratum, substratum: STRATA[stratum],
      genre_date_heavy: GENRE_RE.test(`${b.title || ''}`), genre_rule: GENRE_RULE, date_dense_rule: DATE_DENSE_RULE, assignment: 'date-dense-preferred',
      ws_file: b.ws_file, ws_page: pick.n, ws_title: pick.title, ws_quality: pick.q, ws_revid: pick.revid, ws_timestamp: pick.timestamp,
      ref_chars: pick.body.length, ref_nums: pick.nums, candidates_read: cands.length, matched_by: b.matched_by || null,
      visible: b.visible, hidden_reason: b.hidden_reason,
    });
    console.log(`  ${stratum} ${slug} ${b.year} q${pick.q} nums=${pick.nums} ${String(b.title).slice(0, 60)}  [${JSON.stringify(filled)}]`);
  }
  writeJsonl(F('draw.jsonl'), draws);
  writeJsonl(F('skips-draw.jsonl'), skips);
  console.log(`drawn ${draws.length}`, filled, `skipped ${skips.length}`);
}

/**
 * GUTENBERG — the second truth source, for strata Wikisource cannot fill.
 * Project Gutenberg HTML editions made by Distributed Proofreaders carry the printed page breaks
 * as `<span class="pagenum">` markers, so a printed page of the transcribed edition can be cut
 * out exactly. Matching is title (first five significant words) + an author surname, against
 * pg_catalog.csv; identity is NOT taken from that match — the fetch stage locates the leaf by text
 * over the whole book and rejects a page whose length differs from the leaf (a different edition's
 * page breaks), and the leaf check by eye decides. Same draw rule as Wikisource (one interior page
 * per book, 15%–95%, ≥ 400 chars, date-dense preferred), filling only cells still short.
 */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'to', 'by', 'with', 'for', 'being', 'its', 'his', 'their']);
const titleKey = (t) => String(t || '').toLowerCase().replace(/[—–:;(.].*$/, '').normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)).slice(0, 5).join(' ');
const surnames = (a) => String(a || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\s,]/gu, ' ').split(/[\s,]+/).filter((w) => w.length >= 4 && !['and', 'with', 'translated', 'edited', 'from'].includes(w));
/** Gutenberg HTML → [{label, text}] printed pages, cut at the pagenum markers */
function pgPages(html) {
  let body = html.replace(/^[\s\S]*?<body[^>]*>/i, '').replace(/<\/body>[\s\S]*$/i, '');
  body = body.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    // footnote ANCHORS carry the e-text's running footnote number ([1515]), not what the page prints
    .replace(/<a[^>]*class="[^"]*\bfnanchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi, ' ').replace(/<span[^>]*class="[^"]*\btn\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, ' ');
  const parts = body.split(/<span[^>]*class="[^"]*pagenum[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
  const pages = [];
  for (let i = 1; i < parts.length - 1; i += 2) {
    const label = parts[i].replace(/<[^>]+>/g, '').replace(/[[\]{}]|Pg\.?|Page/gi, '').trim();
    const text = decode(parts[i + 1].replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/&nbsp;|&#160;/g, ' ').replace(/&mdash;/g, '—').replace(/&[a-z]+;/g, ' ')
      .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    pages.push({ label, text });
  }
  return pages;
}
async function stageGutenberg(db) {
  const drawn = readJsonl(F('draw.jsonl'));
  const have = new Set(drawn.map((d) => d.book_id));
  // After a leaf check, a cell counts only KEPT pages (leaf ok, interior) plus pages still pending
  // (drawn, fetched or not yet, never checked); before one, every drawn page counts.
  const filled = { S1: 0, S2: 0, S3: 0, S4: 0 };
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  const fetched = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  const sc = new Map(readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`)).filter((x) => x.engine === 'ia-djvu').map((x) => [x.slug, x]));
  for (const d of drawn) {
    if (!checks.size) { filled[d.stratum]++; continue; }
    const f = fetched.get(d.slug), s = sc.get(d.slug), c = checks.get(d.slug);
    const pending = !c && !f?.skipped;
    const keptNow = c?.status === 'ok' && s && !s.excluded;
    const rescuePending = c?.status === 'shifted' && f?.rescued === 'ok';
    if (pending || keptNow || rescuePending) filled[d.stratum]++;
  }
  console.log('kept + pending before gutenberg', filled);
  const csv = parseCsv(fs.readFileSync(argEq('--pg-catalog', path.join(process.cwd(), 'pg_catalog.csv')), 'utf8'));
  const hdr = csv[0]; const ix = (k) => hdr.indexOf(k);
  const byKey = new Map();
  for (const r of csv.slice(1)) { if (r[ix('Type')] !== 'Text' || !/\ben\b/.test(r[ix('Language')] || '')) continue; const k = titleKey(r[ix('Title')]); if (k.split(' ').length < 2) continue; (byKey.get(k) || byKey.set(k, []).get(k)).push({ n: r[ix('Text#')], title: r[ix('Title')], authors: r[ix('Authors')] }); }
  const books = await db.collection('books').find({ language: 'English', 'image_source.provider': 'internet_archive', pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, year: 1, ia_identifier: 1, 'image_source.identifier': 1, visible: 1, hidden_reason: 1 } }).toArray();
  const cands = [];
  for (const b of books) {
    if (have.has(b.id)) continue;
    const k = titleKey(b.display_title || b.title); if (k.split(' ').length < 2) continue;
    const hits = (byKey.get(k) || []).filter((h) => { const s = surnames(b.author); return s.length && s.some((w) => h.authors.toLowerCase().includes(w)); });
    if (hits.length) cands.push({ b, hits });
  }
  console.log(`Gutenberg title+author candidates: ${cands.length} books`);
  const draws = [...drawn], skips = readJsonl(F('skips-draw.jsonl'));
  for (const { b, hits } of shuffle(cands)) {
    const y = editionYear(b); const per = period(y);
    if (!per) { skips.push({ book_id: b.id, source: 'gutenberg', skipped: 'out-of-period', year: y }); continue; }
    const [sp, sd] = per === 'pre1880' ? ['S1', 'S2'] : ['S3', 'S4'];
    if (filled[sp] >= PER_STRATUM && filled[sd] >= PER_STRATUM) continue;
    let pages = null, pg = null;
    for (const h of hits.slice(0, 3)) {
      const cached = path.join(PG_CACHE, `${h.n}.html`);
      let html = fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8') : null;
      if (html == null) {
        const res = await fetch(`https://www.gutenberg.org/cache/epub/${h.n}/pg${h.n}-images.html`, { headers: { 'User-Agent': UA } }).catch(() => null);
        await sleep(1000);
        html = res?.ok ? await res.text() : '';
        fs.mkdirSync(PG_CACHE, { recursive: true }); fs.writeFileSync(cached, html);
      }
      if (!html) continue;
      const ps = pgPages(html);
      if (ps.length >= 20) { pages = ps; pg = h; break; }
    }
    if (!pages) { skips.push({ book_id: b.id, source: 'gutenberg', skipped: 'no-paginated-html', pg: hits.map((h) => h.n) }); continue; }
    const lo = Math.floor(pages.length * 0.15), hi = Math.ceil(pages.length * 0.95);
    const quals = shuffle(pages.map((p, i) => ({ ...p, i })).slice(lo, hi)).slice(0, 12).filter((p) => p.text.length >= 400).map((p) => ({ ...p, nums: numCount(p.text) }));
    if (!quals.length) { skips.push({ book_id: b.id, source: 'gutenberg', skipped: 'no-qualifying-page', pg: pg.n }); continue; }
    const dense = quals.filter((c) => c.nums >= DATE_DENSE_MIN), prose = quals.filter((c) => c.nums < DATE_DENSE_MIN);
    let pick, stratum;
    if (dense.length && filled[sd] < PER_STRATUM) { pick = dense[Math.floor(rand() * dense.length)]; stratum = sd; }
    else if (prose.length && filled[sp] < PER_STRATUM) { pick = prose[Math.floor(rand() * prose.length)]; stratum = sp; }
    else { skips.push({ book_id: b.id, source: 'gutenberg', skipped: 'cell-full' }); continue; }
    filled[stratum]++;
    const slug = `en-${b.id.slice(0, 6)}-pg${pg.n}p${pick.label.replace(/[^\w]/g, '') || pick.i}`;
    fs.mkdirSync(F('refs'), { recursive: true });
    fs.writeFileSync(F(`refs/${slug}.txt`), pick.text + '\n');
    const ia = (b.ia_identifier || b.image_source?.identifier || '').toLowerCase();
    draws.push({
      slug, source: 'gutenberg', book_id: b.id, ia, title: b.display_title || b.title, author: b.author || null, year: y, period: per, stratum, substratum: STRATA[stratum],
      genre_date_heavy: GENRE_RE.test(`${b.title || ''}`), genre_rule: GENRE_RULE, date_dense_rule: DATE_DENSE_RULE, assignment: 'date-dense-preferred',
      pg_ebook: +pg.n, pg_title: pg.title, pg_page_label: pick.label, pg_page_index: pick.i, pg_pages: pages.length,
      source_url: `https://www.gutenberg.org/cache/epub/${pg.n}/pg${pg.n}-images.html`, source_revision: `fetched ${new Date().toISOString().slice(0, 10)}`,
      ref_chars: pick.text.length, ref_nums: pick.nums, candidates_read: quals.length, visible: !!b.visible, hidden_reason: b.hidden_reason || null,
    });
    console.log(`  ${stratum} ${slug} ${y} nums=${pick.nums} ${String(b.display_title || b.title).slice(0, 60)}  [${JSON.stringify(filled)}]`);
  }
  writeJsonl(F('draw.jsonl'), draws);
  writeJsonl(F('skips-draw.jsonl'), skips);
  console.log('after gutenberg', filled);
}

/**
 * REDRAW (round 2) — after the leaf check, refill cells below --per-stratum from Wikisource books
 * that do not yet have a KEPT page (leaf_check ok and interior), with the interior window taken on the
 * SCAN (IA imagecount), not on the pages Wikisource happens to have. Books whose round-1 page was
 * `shifted` are left to --stage=rescue (their page↔leaf mapping is the problem, not the draw).
 * Round-1 rows stay in draw.jsonl as history; a round-2 row carries `round: 2`.
 */
async function stageRedraw() {
  const draws = readJsonl(F('draw.jsonl'));
  const scores = readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`)).filter((s) => s.engine === 'ia-djvu');
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  const fetched = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  const byBook = new Map(); for (const d of draws) (byBook.get(d.book_id) || byBook.set(d.book_id, []).get(d.book_id)).push(d);
  const kept = new Set(scores.filter((s) => !s.excluded && s.leaf_check === 'ok').map((s) => s.slug));
  const filled = { S1: 0, S2: 0, S3: 0, S4: 0 };
  for (const d of draws) if (kept.has(d.slug) || (d.round === 2 && !checks.has(d.slug))) filled[d.stratum]++;
  console.log('kept + pending before redraw', filled);
  const blocked = (bid) => (byBook.get(bid) || []).some((d) => kept.has(d.slug) || checks.get(d.slug)?.status === 'shifted' || /no-ia-djvu-xml|no-page-for-leaf/.test(fetched.get(d.slug)?.skipped || '') || d.round === 2);
  const pool = shuffle(readJsonl(F('pool.jsonl')).filter((p) => p.ws_proofread > 0 && !blocked(p.book_id)));
  const skips = readJsonl(F('skips-draw.jsonl'));
  for (const b of pool) {
    const per = period(b.year); if (!per) continue;
    const [sp, sd] = per === 'pre1880' ? ['S1', 'S2'] : ['S3', 'S4'];
    if (filled[sp] >= PER_STRATUM && filled[sd] >= PER_STRATUM) continue;
    const prior = (byBook.get(b.book_id) || []).map((d) => fetched.get(d.slug)?.ia_leaves).find(Boolean);
    let scan = prior;
    if (!scan) { const r = await iaFetch(`https://archive.org/metadata/${b.ia}/metadata/imagecount`); scan = r.ok ? +((await r.json())?.result || 0) : 0; }
    if (!scan) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, round: 2, skipped: 'no-scan-length' }); continue; }
    const interior = shuffle(b.ws_proofread_ns.filter((n) => (n - 1) / scan > 0.15 && (n - 1) / scan <= 0.95)).slice(0, 12);
    if (!interior.length) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, round: 2, skipped: 'no-interior-proofread-page', scan }); continue; }
    const cands = [];
    for (const n of interior) {
      const title = `Page:${b.ws_file}/${n}`;
      const w = await pageWikitext(title); if (!w) continue;
      const q = pageQuality(w.text); if (q == null || q < 3) continue;
      const body = wsBodyText(w.text); if (body.length < 400) continue;
      cands.push({ n, title, q, revid: w.revid, timestamp: w.timestamp, body, nums: numCount(body) });
      await sleep(150);
    }
    if (!cands.length) { skips.push({ book_id: b.book_id, ws_file: b.ws_file, round: 2, skipped: 'no-qualifying-page' }); continue; }
    const dense = cands.filter((c) => c.nums >= DATE_DENSE_MIN), prose = cands.filter((c) => c.nums < DATE_DENSE_MIN);
    let pick, stratum;
    if (dense.length && filled[sd] < PER_STRATUM) { pick = dense[Math.floor(rand() * dense.length)]; stratum = sd; }
    else if (prose.length && filled[sp] < PER_STRATUM) { pick = prose[Math.floor(rand() * prose.length)]; stratum = sp; }
    else continue;
    filled[stratum]++;
    const slug = `en-${b.book_id.slice(0, 6)}-ws${pick.n}`;
    if (draws.some((d) => d.slug === slug)) continue;
    fs.writeFileSync(F(`refs/${slug}.txt`), pick.body + '\n');
    draws.push({
      slug, round: 2, book_id: b.book_id, ia: b.ia, title: b.title, author: b.author, year: b.year, period: per, stratum, substratum: STRATA[stratum],
      genre_date_heavy: GENRE_RE.test(`${b.title || ''}`), genre_rule: GENRE_RULE, date_dense_rule: DATE_DENSE_RULE, assignment: 'date-dense-preferred',
      ws_file: b.ws_file, ws_page: pick.n, ws_title: pick.title, ws_quality: pick.q, ws_revid: pick.revid, ws_timestamp: pick.timestamp, scan_leaves: scan,
      ref_chars: pick.body.length, ref_nums: pick.nums, candidates_read: cands.length, matched_by: b.matched_by || null, visible: b.visible, hidden_reason: b.hidden_reason,
    });
    console.log(`  R2 ${stratum} ${slug} ${b.year} nums=${pick.nums} ${String(b.title).slice(0, 60)}  [${JSON.stringify(filled)}]`);
  }
  writeJsonl(F('draw.jsonl'), draws); writeJsonl(F('skips-draw.jsonl'), skips);
  console.log('after redraw (kept + pending)', filled);
}

/**
 * RESCUE — pages whose image the leaf check found `shifted`: the Archive's djvu OBJECT index is not
 * always its /page/nK image index (leaves excluded from the page images), so our page for leaf k can be
 * a neighbour. Read our pages for leaves k−3…k+3 with the same lite prompt and keep the one whose
 * text overlaps the reference most (bag-of-words ≥ 0.5; the right leaf overlaps several times more
 * than its neighbours even when read badly). That read becomes the scored lite output; the new image
 * goes back through the eye check. `locate_method: lite-neighbour-search` is recorded on the row.
 */
async function stageRescue(db) {
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const done = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  const prompt = await getProductionOcrPrompt(db);
  const crypto = await import('node:crypto');
  const promptHash = crypto.createHash('sha256').update(prompt.text).digest('hex').slice(0, 16);
  const outFile = path.join(STORE, 'outputs', OCR_MODEL_LITE, `${MONTH}.jsonl`);
  let spent = readJsonl(outFile).reduce((s, o) => s + (o.cost_usd || 0), 0);
  for (const [slug, c] of checks) {
    const r = done.get(slug); const d = draws.get(slug);
    if (c.status !== 'shifted' || !r || r.rescued) continue;
    const ref = words(normalise(fs.readFileSync(F(`refs/${slug}.txt`), 'utf8')));
    const pages = await db.collection('pages').find({ book_id: d.book_id }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1 } }).toArray();
    const cur = pages.find((p) => p.page_number === r.page_number);
    let best = null;
    for (const dlt of [-1, 1, -2, 2, -3, 3]) {
      if (spent >= MAX_COST) break;
      const p = pages.find((x) => x.page_number === r.page_number + dlt && !x.split_from_spread); if (!p) continue;
      const url = getPageSource(p); if (!url) continue;
      let buf; try { buf = await fetchImage(url, 60000); } catch { continue; }
      const res = await runGemini(OCR_MODEL_LITE, buf, prompt.text, { temperature: 0, maxTokens: 8000, endpoint: 'eval/en-ocr-ref-5124', usageType: 'ocr' }).catch((e) => ({ error: e }));
      if (res.error) continue;
      spent += res.costUsd || 0;
      const bow = bagDice(ref, words(normalise(res.text || '')));
      const refused = /RECITATION|PROHIBITED|SAFETY|BLOCKLIST/.test(res.finishReason);
      if (!best || bow > best.bow) best = { p, url, buf, res, bow, refused, dlt };
      if (bow >= 0.8) break;
    }
    if (!best || best.bow < 0.5) { r.rescued = 'failed'; r.rescue_best_bow = best ? r4(best.bow) : null; console.log(`  ${slug} rescue FAILED (best ${best?.bow?.toFixed(2)})`); }
    else {
      Object.assign(r, { rescued: 'ok', rescue_delta: best.dlt, page_number: best.p.page_number, page_id: best.p.id || String(best.p._id), image_url: best.url, image_bytes: best.buf.length, locate_method_image: 'lite-neighbour-search', rescue_bow: r4(best.bow), shifted_from_page: cur?.page_number });
      fs.writeFileSync(path.join(IMG, `${slug}.jpg`), best.buf);
      const fr = best.res.finishReason;
      const row = { run_id: RUN_ID, slug, engine: 'gemini-lite-realtime', model: OCR_MODEL_LITE, engine_version: OCR_MODEL_LITE, prompt_id: `ocr-default-v${prompt.version}`, prompt_hash: promptHash,
        params: { thinking: 'budget-0', temperature: 0, max_tokens: 8000, batch: false, context_given: null }, attempt: 1, rescue: true, finish_reason: fr, cost_usd: +(best.res.costUsd || 0).toFixed(6), latency_ms: best.res.durationMs, chars: (best.res.text || '').length,
        outcome: best.refused ? 'refusal' : fr === 'MAX_TOKENS' ? 'truncated' : !best.res.text?.trim() ? 'empty' : 'text', at: new Date().toISOString(), by: 'en-ocr-ref-5124', issue: 5124 };
      if (row.outcome === 'text' || row.outcome === 'truncated') { const tp = F(`texts/${slug}.lite.txt`); fs.writeFileSync(tp, best.res.text); row.text_path = path.relative(HERE, tp); row.text_hash = crypto.createHash('sha256').update(best.res.text).digest('hex').slice(0, 16); }
      // append-only store: the round-1 rows stay; `rescue: true` rows win at score time
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      console.log(`  ${slug} rescued at page ${best.p.page_number} (Δ${best.dlt}, bow ${best.bow.toFixed(2)}) ${row.outcome} $${spent.toFixed(4)}`);
    }
    writeJsonl(F('fetch.jsonl'), [...done.values()]);
  }
}

/** RECUT — regenerate Gutenberg references from the cached HTML after a pgPages fix (free). */
function stageRecut() {
  let n = 0;
  for (const d of readJsonl(F('draw.jsonl')).filter((x) => x.source === 'gutenberg')) {
    const f = path.join(PG_CACHE, `${d.pg_ebook}.html`); if (!fs.existsSync(f)) continue;
    const pg = pgPages(fs.readFileSync(f, 'utf8'))[d.pg_page_index]; if (!pg) continue;
    fs.writeFileSync(F(`refs/${d.slug}.txt`), pg.text + '\n'); n++;
  }
  console.log(`recut ${n} Gutenberg references`);
}

/**
 * DIGITPACK — every number-misread candidate on a kept page, for a reader to settle from the image:
 * which number is PRINTED? One line per (page, printed-in-reference, read-as) pair, with the engines
 * that produced it. `digitcheck.jsonl` ({key, printed: "ref"|"engine"|"other", note}) comes back.
 */
function stageDigitpack() {
  const scores = readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`)).filter((s) => !s.excluded && s.leaf_check === 'ok' && s.metric);
  const cands = new Map();
  for (const s of scores) for (const m of s.metric.misread_candidates || []) {
    const key = `${s.slug}|${m.r}|${m.h}`;
    const c = cands.get(key) || { key, slug: s.slug, ref: m.r, read_as: m.h, ctx: m.ctx, engines: [] };
    c.engines.push(s.engine); cands.set(key, c);
  }
  const rows = [...cands.values()];
  writeJsonl(F('digit-candidates.jsonl'), rows);
  fs.writeFileSync(F('digitpack.txt'), rows.map((c) => `### ${c.key}\nimage: img/${c.slug}.jpg\ncontext (reference words around it): ${c.ctx}\nA = ${c.ref}   B = ${c.read_as}\n`).join('\n'));
  console.log(`digit candidates: ${rows.length} (${rows.filter((c) => c.engines.length === 2).length} produced by BOTH engines)`);
}

/**
 * FINALIZE — the durable artefacts eval-design §3–§4 asks for:
 *   benchmark/english-ia-5124.json      the stratum registry (every drawn page, kept or excluded, and why)
 *   benchmark/refs/<slug>.json + .txt   one reference record per page whose leaf check is ok
 * Wikisource text is CC BY-SA 4.0; Gutenberg text is public domain in the US. Neither is reserve
 * (both are already public), so `reserve: false`.
 */
function stageFinalize() {
  const draws = readJsonl(F('draw.jsonl'));
  const fetched = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  const scores = new Map(readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`)).filter((s) => s.engine === 'ia-djvu').map((s) => [s.slug, s]));
  const BENCH = path.join(HERE, 'benchmark'); fs.mkdirSync(path.join(BENCH, 'refs'), { recursive: true });
  const rows = []; let refs = 0;
  for (const d of draws) {
    const f = fetched.get(d.slug) || {}, c = checks.get(d.slug), s = scores.get(d.slug);
    const gut = d.source === 'gutenberg';
    const excluded = f.skipped ? `fetch: ${f.skipped}` : f.error ? `fetch-error: ${f.error}` : s?.excluded ? s.excluded : c && c.status !== 'ok' ? `leaf_check: ${c.status}${f.rescued ? ` (rescue ${f.rescued})` : ''}` : !c ? 'leaf_check: unchecked' : null;
    const refId = gut ? `pg:${d.pg_ebook}#page-${d.pg_page_label}` : `ws:${d.ws_title}@${d.ws_revid}`;
    rows.push({
      slug: d.slug, book_id: d.book_id, page_number: f.page_number ?? null, image_url: f.image_url ?? null, provider: 'internet_archive', ia: f.ia || d.ia, ia_leaf: f.ia_leaf ?? null,
      catalogue: { language: 'English', published: d.year, title: d.title, author: d.author },
      observed: { script: 'latin', period: d.period, kind: 'print', canonical: false, by: c ? 'model-eye' : null, at: c?.at ?? null, date_dense: d.stratum === 'S2' || d.stratum === 'S4', ref_nums: d.ref_nums },
      stratum: d.stratum, substratum: d.substratum, round: d.round || 1, source: gut ? 'gutenberg' : 'wikisource-en', excluded, reserve: false, published_text: null,
      reference: excluded ? null : { id: refId }, leaf_check: c ? { status: c.status, by: c.by, at: c.at, note: c.note, human_spot_check: c.human_spot_check || null } : null,
      ia_meta: f.ia_meta ? { ocr: f.ia_meta.ocr, ocr_converted: f.ia_meta.ocr_converted, ocr_date: f.ia_meta.ocr_date, scanner: f.ia_meta.scanner, scanner_class: f.ia_meta.scanner_class } : null,
      locate: { method: f.locate_method || null, bow: f.locate_bow ?? null, offset: f.ia_leaf_offset ?? null, rescued: f.rescued || null },
    });
    if (excluded) continue;
    const text = fs.readFileSync(F(`refs/${d.slug}.txt`), 'utf8');
    fs.writeFileSync(path.join(BENCH, 'refs', `${d.slug}.txt`), text);
    fs.writeFileSync(path.join(BENCH, 'refs', `${d.slug}.json`), JSON.stringify({
      slug: d.slug, source: gut ? 'gutenberg' : 'wikisource-en',
      source_url: gut ? d.source_url : `https://en.wikisource.org/w/index.php?title=${encodeURIComponent(d.ws_title)}&oldid=${d.ws_revid}`,
      source_revision: gut ? d.source_revision : `oldid ${d.ws_revid} (${d.ws_timestamp})`,
      licence: gut ? 'PD-US (Project Gutenberg)' : 'CC-BY-SA-4.0',
      proofread_level: gut ? null : d.ws_quality,
      unit: { kind: 'page', chars: text.length },
      alignment: gut ? { method: 'gutenberg-pagenum-markers', guard: 'bag-of-words >= 0.7 vs IA leaf over whole book; leaf/page length ratio 0.8–1.25' } : { method: 'wikisource-page = scan page; IA leaf located by bag-of-words ±10 (fallback: expected leaf)', guard: 'leaf check by eye' },
      leaf_check: { status: 'ok', by: checks.get(d.slug).by, at: checks.get(d.slug).at, note: checks.get(d.slug).note || null },
      canonical: false, memorization_risk: 'high',   // public e-texts of PD books: assume in training data
      made_by: { engine: 'human', model: null, prompt_hash: null, finish_reason: null },
      reference_error_rate: null,
      notes: 'Body text only: running heads and page numbers are outside the reference (the scorer trims them from engine output). Wikisource footnotes (<ref>) are appended at the end.',
    }, null, 2) + '\n');
    refs++;
  }
  fs.writeFileSync(path.join(BENCH, 'english-ia-5124.json'), JSON.stringify({
    name: 'english-ia-5124', issue: 5124, sealed_at: new Date().toISOString().slice(0, 10), seed: SEED,
    draw_rule: 'one interior page per book (15–95% of the scan); English IA books we hold ∩ en.wikisource proofread Index (IA id in file name, Index Source=, or Commons description), then Project Gutenberg paginated HTML (title + author match) for cells still short; stratum = period (catalogue year <1880 | 1880–1930) × date-dense (reference page ≥ 6 numbers of 2–4 digits); date-dense preferred when a book has such a page',
    date_dense_rule: DATE_DENSE_RULE, genre_rule: GENRE_RULE,
    selection_note: 'Not a random sample of our English holdings: only books Wikisource volunteers proofread or Distributed Proofreaders transcribed — skewed toward legible, well-known works.',
    rows,
  }, null, 2) + '\n');
  const kept = rows.filter((r) => !r.excluded); const by = {}; for (const r of kept) by[r.stratum] = (by[r.stratum] || 0) + 1;
  console.log(`registry ${rows.length} rows, ${refs} reference records; kept by stratum`, by);
}

/** QUEUE — English IA books with no e-text found in either source: the future transcription queue. */
async function stageQueue(db) {
  const drawnOrMatched = new Set([...readJsonl(F('pool.jsonl')).map((p) => p.book_id), ...readJsonl(F('draw.jsonl')).map((d) => d.book_id)]);
  const books = await db.collection('books').find({ language: 'English', 'image_source.provider': 'internet_archive', pages_count: { $gt: 0 } }, { projection: { id: 1, year: 1, published: 1, pages_count: 1, pages_ocr: 1, ia_identifier: 1, 'image_source.identifier': 1 } }).toArray();
  const q = books.filter((b) => !drawnOrMatched.has(b.id)).map((b) => { const y = editionYear(b); return { book_id: b.id, ia: b.ia_identifier || b.image_source?.identifier || null, year: y, period: period(y) || (y ? 'post1930' : 'unknown'), pages: b.pages_count, pages_ocr: b.pages_ocr || 0, skipped: 'no-e-text' }; });
  writeJsonl(F('no-e-text-queue.jsonl'), q);
  const by = {}; for (const r of q) by[r.period] = (by[r.period] || 0) + 1;
  console.log(`no-e-text queue: ${q.length} books`, by);
}

/** FETCH — the IA leaf and our page for each drawn Wikisource page; the page image for the leaf check + OCR. */
const bagDice = (a, b) => { if (!a.length || !b.length) return 0; const c = new Map(); for (const t of a) c.set(t, (c.get(t) || 0) + 1); let m = 0; for (const t of b) { const n = c.get(t); if (n) { m++; c.set(t, n - 1); } } return (2 * m) / (a.length + b.length); };
const leafIndex = (p) => { const m = String(p.photo || p.archived_photo || '').match(/\/page\/n(\d+)\//); return m ? +m[1] : (p.page_number || 1) - 1; };
async function stageFetch(db) {
  const draws = readJsonl(F('draw.jsonl'));
  const done = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  fs.mkdirSync(IMG, { recursive: true }); fs.mkdirSync(F('texts'), { recursive: true });
  const P = db.collection('pages');
  for (const d of draws) {
    const prev = done.get(d.slug);
    if (prev && !prev.error && !(REFETCH && prev.skipped === REFETCH)) continue;
    const row = { slug: d.slug };
    try {
      // IA identifiers are CASE-SENSITIVE (`bub_gb_YCYfAAAAMAAJ`); the draw keys are lowercased for
      // matching, so take the item id from the book record. A lowercased id 503s at the download host.
      const bk = await db.collection('books').findOne({ id: d.book_id }, { projection: { ia_identifier: 1, 'image_source.identifier': 1 } });
      const ia = bk?.ia_identifier || bk?.image_source?.identifier || d.ia; row.ia = ia;
      const cov = await iaCovariates(ia); row.ia_meta = cov;
      const L = await loadLeaves(ia, cov?.xml_name); if (!L) { row.skipped = 'no-ia-djvu-xml'; throw Object.assign(new Error('skip'), { skip: true }); }
      row.leaves_from = L.from; row.ia_leaves = L.leaves.length;
      const ref = fs.readFileSync(F(`refs/${d.slug}.txt`), 'utf8');
      const rt = words(normalise(ref));
      // WS page n ↔ IA leaf n-1 when the Commons file was built from the Archive's own DjVu/PDF;
      // search ±10 leaves and take the best bag-of-words match (the IA text is used here only to
      // LOCATE the leaf — the leaf check below is by eye).
      // A Gutenberg page has no leaf hint (its edition's page n is not our leaf n): search the book.
      let best = { k: null, bow: 0 };
      const [k0, k1] = d.source === 'gutenberg' ? [0, L.leaves.length - 1] : [Math.max(0, d.ws_page - 11), Math.min(L.leaves.length - 1, d.ws_page + 9)];
      for (let k = k0; k <= k1; k++) { const s = bagDice(rt, words(normalise(L.leaves[k]))); if (s > best.bow) best = { k, bow: s }; }
      row.ia_leaf = best.k; row.ia_leaf_offset = best.k == null || d.source === 'gutenberg' ? null : best.k - (d.ws_page - 1); row.locate_bow = r4(best.bow);
      row.locate_method = 'ia-text-bow';
      // A weak match is exactly what BAD Archive OCR looks like. Skipping it would drop the Archive's
      // worst pages and flatter it, so a Wikisource page falls back to its expected leaf (ws n ↔ leaf
      // n−1, which 85 of the first 94 located pages used) and the eye check decides.
      if (d.source !== 'gutenberg' && best.bow < 0.5 && d.ws_page - 1 < L.leaves.length) {
        best = { k: d.ws_page - 1, bow: bagDice(rt, words(normalise(L.leaves[d.ws_page - 1]))) };
        row.ia_leaf = best.k; row.ia_leaf_offset = 0; row.locate_bow = r4(best.bow); row.locate_method = 'offset0-fallback';
      }
      if (best.k == null || (d.source === 'gutenberg' && best.bow < 0.7)) { row.skipped = 'no-leaf-match'; throw Object.assign(new Error('skip'), { skip: true }); }
      // A transcription of ANOTHER edition breaks its pages elsewhere: the words match, the span does not.
      const lr = words(normalise(L.leaves[best.k])).length / Math.max(1, rt.length); row.leaf_len_ratio = r4(lr);
      if (d.source === 'gutenberg' && (lr < 0.8 || lr > 1.25)) { row.skipped = 'page-span-mismatch'; throw Object.assign(new Error('skip'), { skip: true }); }
      fs.writeFileSync(F(`texts/${d.slug}.ia-djvu.txt`), L.leaves[best.k] + '\n');
      const pages = await P.find({ book_id: d.book_id }, { projection: { id: 1, page_number: 1, photo: 1, archived_photo: 1, display_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, 'ocr.source': 1, 'ocr.model': 1, hidden: 1 } }).toArray();
      const page = pages.find((p) => leafIndex(p) === best.k && !p.split_from_spread);
      if (!page) { row.skipped = 'no-page-for-leaf'; throw Object.assign(new Error('skip'), { skip: true }); }
      row.page_number = page.page_number; row.page_id = page.id || String(page._id); row.our_ocr_source = page.ocr?.source || null; row.our_ocr_model = page.ocr?.model || null;
      const src = getPageSource(page); row.image_url = src?.url || src || null;
      if (!row.image_url) { row.skipped = 'no-image-url'; throw Object.assign(new Error('skip'), { skip: true }); }
      const buf = await fetchImage(row.image_url, 60000);
      fs.writeFileSync(path.join(IMG, `${d.slug}.jpg`), buf); row.image_bytes = buf.length;
      console.log(`  ${d.slug} leaf ${best.k} (off ${row.ia_leaf_offset}, bow ${row.locate_bow}) p${page.page_number} ${cov?.ocr || cov?.ocr_converted || '?'} ${cov?.scanner_class}`);
    } catch (e) {
      if (!e.skip) { row.error = String(e.message || e).slice(0, 200); console.log(`  ${d.slug} ERROR ${row.error}`); }
      else console.log(`  ${d.slug} SKIP ${row.skipped}`);
    }
    done.set(d.slug, row);
    writeJsonl(F('fetch.jsonl'), [...done.values()]);
  }
}

/** OCR — a fresh read of OUR page image by the chosen --arm, production prompt, into the eval store (never `pages`). */
const STORE = path.join(HERE, 'store');
/** The pages #5216's report scores: fetched, leaf check ok, interior leaf. Arms after lite run on exactly these. */
function scoredSlugs() {
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  return readJsonl(F('fetch.jsonl')).filter((r) => r.image_bytes && !r.skipped && checks.get(r.slug)?.status === 'ok')
    .filter((r) => { const pos = r.ia_leaf / Math.max(1, r.ia_leaves); return pos > 0.15 && pos <= 0.95; }).map((r) => r.slug);
}
/** The A-vs-A draw: slugs sorted, Mulberry32 Fisher–Yates seeded by the arm, first n. */
function repeatDraw(arm) {
  let st = arm.seed >>> 0;
  const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const a = [...scoredSlugs()].sort();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, arm.n);
}
const outFileOf = (model) => path.join(STORE, 'outputs', model, `${MONTH}.jsonl`);
async function stageOcr(db) {
  const prompt = await getProductionOcrPrompt(db);
  const promptHash = (await import('node:crypto')).createHash('sha256').update(prompt.text).digest('hex').slice(0, 16);
  if (EXPECT_PROMPT_HASH && promptHash !== EXPECT_PROMPT_HASH) throw new Error(`production prompt is ${promptHash}, preregistered ${EXPECT_PROMPT_HASH} — stopping before any call`);
  let fetched = readJsonl(F('fetch.jsonl')).filter((r) => r.image_bytes && !r.skipped);
  if (ARM.issue === 5182) { const keep = new Set(ARM.n ? repeatDraw(ARM) : scoredSlugs()); fetched = fetched.filter((r) => keep.has(r.slug)); }
  const outFile = outFileOf(ARM.model); fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const prior = readJsonl(outFile).filter((o) => o.run_id === ARM.run_id);
  const have = new Set(prior.filter((o) => o.outcome === 'text' || (o.outcome === 'refusal' && o.attempt === 2)).map((o) => o.slug));
  // the cap is per ISSUE across every arm's file, so two arms cannot each spend the whole budget
  let spent = [...new Set(GEMINI_ARMS.map((k) => ARMS[k].model))].flatMap((m) => readJsonl(outFileOf(m)))
    .filter((o) => (o.issue ?? 5124) === ARM.issue).reduce((s, o) => s + (o.cost_usd || 0), 0);
  console.log(`arm ${argEq('--arm', 'lite')} ${ARM.model} run ${ARM.run_id}; prompt v${prompt.version} ${promptHash}; ${fetched.length} pages, ${have.size} done, $${spent.toFixed(4)} spent on #${ARM.issue}`);
  const queue = fetched.filter((r) => !have.has(r.slug));
  const one = async (r) => {
    const attempts = prior.filter((o) => o.slug === r.slug && o.outcome !== 'error').length;
    for (let attempt = attempts + 1; attempt <= 2; attempt++) {
      if (spent >= MAX_COST) { console.log('max cost reached'); return; }
      const buf = fs.readFileSync(path.join(IMG, `${r.slug}.jpg`));
      if (ARM.issue === 5182 && buf.length !== r.image_bytes) throw new Error(`${r.slug}: image is ${buf.length} bytes, #5216 read ${r.image_bytes} — not the same image`);
      const row = { run_id: ARM.run_id, slug: r.slug, engine: ARM.engine, model: ARM.model, engine_version: ARM.model, prompt_id: `ocr-default-v${prompt.version}`, prompt_hash: promptHash,
        params: { thinking: 'budget-0', temperature: 0, max_tokens: 8000, batch: false, context_given: null }, attempt, ...(ARM.repeat_of ? { repeat_of: ARM.repeat_of } : {}),
        at: new Date().toISOString(), by: ARM.issue === 5182 ? 'en-ocr-flash-arm-5182' : 'en-ocr-ref-5124', issue: ARM.issue };
      try {
        // thinkingBudget 0 is what runGemini sends to a flash model by default; passed explicitly so the row's params are what was sent
        const res = await runGemini(ARM.model, buf, prompt.text, { temperature: 0, maxTokens: 8000, thinkingBudget: 0, endpoint: `ev${'al'}/en-ocr-ref-${ARM.issue}`, usageType: 'ocr' });
        spent += res.costUsd || 0;
        const fr = res.finishReason;
        row.finish_reason = fr; row.cost_usd = +(res.costUsd || 0).toFixed(6); row.latency_ms = res.durationMs; row.chars = (res.text || '').length;
        row.outcome = /RECITATION|PROHIBITED|SAFETY|BLOCKLIST/.test(fr) ? 'refusal' : fr === 'MAX_TOKENS' ? 'truncated' : !res.text?.trim() ? 'empty' : 'text';
        if (row.outcome === 'text' || row.outcome === 'truncated') {
          const tp = F(`texts/${r.slug}.${ARM.suffix}.txt`); fs.writeFileSync(tp, res.text);
          row.text_path = path.relative(HERE, tp); row.text_hash = (await import('node:crypto')).createHash('sha256').update(res.text).digest('hex').slice(0, 16);
        }
      } catch (e) { row.outcome = 'error'; row.error = String(e.message || e).slice(0, 200); }
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      console.log(`  ${r.slug} #${attempt} ${row.outcome} ${row.finish_reason || row.error || ''} $${spent.toFixed(4)}`);
      if (row.outcome !== 'refusal') return;   // retry a refusal ONCE, no more (handoff)
    }
  };
  for (let i = 0; i < queue.length; i += CONCURRENCY) await Promise.all(queue.slice(i, i + CONCURRENCY).map(one));
  const mine = readJsonl(outFile).filter((o) => o.run_id === ARM.run_id);
  console.log(`spent $${spent.toFixed(4)} on #${ARM.issue}; run ${ARM.run_id}: ${mine.filter((o) => o.outcome === 'text').length} text rows of ${mine.length}`);
}

/**
 * OCR, MinerU arms (#5182 / #3389, PREREGISTRATION-mineru-english-5182.md) — the MinerU binary over the
 * same page images, no model call, $0. Runs where MinerU is installed (Hetzner). Pages go through the
 * binary in chunks (one model load per chunk, as the production worker loads once per book).
 * Post-processing is the production worker's, lifted VERBATIM from scripts/workers/mineru-ocr-worker.mjs
 * (that file runs on import, so it cannot be imported): `sanitize()`, `realLen`, `lowQuality()`, MIN_CHARS 40.
 * A read the worker would refuse to write is a failed read: `empty` or `low-quality` (text kept on disk).
 */
const MINERU = argEq('--mineru-bin', '/root/mineru-eval/venv/bin/mineru');
const MINERU_CHUNK = +argEq('--mineru-chunk', 8);
// ---- verbatim from scripts/workers/mineru-ocr-worker.mjs (main 0d8f9025d, 2026-09-30) ----
function sanitize(md) {
  let t = md.replace(/!\[[^\]]*\]\([^)]*\)/g, '');   // markdown images out entirely
  t = t.replace(/<[^>]+>/g, ' ');                      // html tags -> keep inner cell text
  t = t.replace(/^#{1,6}\s+/gm, '');                   // heading hashes
  t = t.replace(/^\s*>\s?/gm, '');                     // blockquotes
  t = t.replace(/`{1,3}/g, '');
  t = t.replace(/[ \t]+/g, ' ').replace(/ *\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim();
}
const realLen = (s) => (s.match(/[A-Za-zÀ-ÿ0-9]/g) || []).length;
function lowQuality(text) {
  const real = realLen(text);
  if (real < 80) return false; // too short to judge; MIN_CHARS gate handles it
  const toks = text.split(/\s+/).filter(Boolean).length || 1;
  const meanWordLen = real / toks;
  const spaceRatio = (text.match(/ /g) || []).length / Math.max(1, text.length);
  return meanWordLen > 8 || spaceRatio < 0.10;
}
const MINERU_MIN_CHARS = 40;
// ---- end verbatim ----
// ---- verbatim from PR #5299 (scripts/workers/mineru-ocr-worker.mjs, branch worktree-fix+mineru-footnotes, 2026-09-30) ----
function readPageFootnotes(outDir, base) {
  const hits = [
    path.join(outDir, base, 'ocr', `${base}_middle.json`),
    path.join(outDir, base, 'auto', `${base}_middle.json`),
  ].filter((p) => fs.existsSync(p));
  if (!hits.length) return [];
  try {
    const d = JSON.parse(fs.readFileSync(hits[0], 'utf8'));
    const blocks = (d?.pdf_info?.[0]?.discarded_blocks || []).filter((b) => b?.type === 'page_footnote');
    blocks.sort((a, b) => (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0));
    return blocks
      .map((b) => (b.lines || []).map((l) => (l.spans || []).map((s) => s.content || '').join(' ')).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch (e) {
    console.warn(`  footnotes: could not read ${hits[0]}: ${String(e.message || e).slice(0, 80)}`);
    return [];
  }
}
// ---- end verbatim ----
async function stageOcrMineru() {
  const { execFileSync } = await import('node:child_process');
  const crypto = await import('node:crypto');
  const version = execFileSync(MINERU, ['--version']).toString().trim();
  const keep = new Set(ARM.n ? repeatDraw(ARM) : scoredSlugs());
  const fetched = readJsonl(F('fetch.jsonl')).filter((r) => r.image_bytes && !r.skipped && keep.has(r.slug));
  const outFile = outFileOf(ARM.model); fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const have = new Set(readJsonl(outFile).filter((o) => o.run_id === ARM.run_id && o.outcome !== 'error').map((o) => o.slug));
  const queue = fetched.filter((r) => !have.has(r.slug));
  console.log(`arm ${argEq('--arm')} ${version} run ${ARM.run_id}; ${fetched.length} pages, ${have.size} done, ${queue.length} to read`);
  const work = path.join(OUT, `mineru-work-${ARM.suffix}`);
  for (let i = 0; i < queue.length; i += MINERU_CHUNK) {
    const chunk = queue.slice(i, i + MINERU_CHUNK);
    const inDir = path.join(work, 'in'), outDir = path.join(work, 'out');
    fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
    for (const r of chunk) {
      const buf = fs.readFileSync(path.join(IMG, `${r.slug}.jpg`));
      if (buf.length !== r.image_bytes) throw new Error(`${r.slug}: image is ${buf.length} bytes, #5216 read ${r.image_bytes} — not the same image`);
      fs.writeFileSync(path.join(inDir, `${r.slug}.jpg`), buf);
    }
    const t0 = Date.now(); let err = null;
    try { execFileSync('nice', ['-n', '15', MINERU, '-p', inDir, '-o', outDir, '-b', 'pipeline', '-m', 'ocr'], { stdio: ['ignore', 'ignore', 'pipe'], maxBuffer: 1 << 28 }); }
    catch (e) { err = String(e.stderr || e.message || e).slice(-300); }
    const perPage = Math.round((Date.now() - t0) / chunk.length);
    for (const r of chunk) {
      const row = { run_id: ARM.run_id, slug: r.slug, engine: ARM.engine, model: ARM.model, engine_version: version,
        params: { backend: 'pipeline', method: 'ocr', device: 'cpu', nice: 15, chunk: chunk.length, post: ARM.footnotes ? 'mineru-ocr-worker sanitize() (verbatim) + PR #5299 readPageFootnotes() appended below the body' : 'mineru-ocr-worker sanitize() (verbatim)' }, attempt: 1,
        ...(ARM.repeat_of ? { repeat_of: ARM.repeat_of } : {}), at: new Date().toISOString(), by: 'en-ocr-mineru-arm-5182', issue: ARM.issue, cost_usd: 0, latency_ms: perPage };
      const md = [path.join(outDir, r.slug, 'ocr', `${r.slug}.md`), path.join(outDir, r.slug, 'auto', `${r.slug}.md`)].find((p) => fs.existsSync(p));
      if (!md) { row.outcome = 'error'; row.error = err || 'no markdown output'; }
      else {
        const raw = fs.readFileSync(md, 'utf8').trim(); const body = sanitize(raw);
        // PR #5299's assembly, verbatim: footnotes sanitized, joined one per line, below the body
        const footnotes = ARM.footnotes ? readPageFootnotes(outDir, r.slug).map(sanitize).filter(Boolean) : [];
        const text = footnotes.length ? `${body}\n\n${footnotes.join('\n')}` : body;
        if (ARM.footnotes) { row.footnotes_appended = footnotes.length; row.body_hash = crypto.createHash('sha256').update(body).digest('hex').slice(0, 16); }
        row.chars = text.length;
        row.outcome = realLen(text) < MINERU_MIN_CHARS ? 'empty' : lowQuality(text) ? 'low-quality' : 'text';
        const tp = F(`texts/${r.slug}.${ARM.suffix}.txt`); fs.writeFileSync(tp, text);
        fs.writeFileSync(F(`texts/${r.slug}.${ARM.suffix}.raw.md`), raw);
        row.text_path = path.relative(HERE, tp); row.text_hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
      }
      fs.appendFileSync(outFile, JSON.stringify(row) + '\n');
      console.log(`  ${r.slug} ${row.outcome} ${row.chars ?? ''} ${perPage} ms/page ${row.error || ''}`);
    }
  }
  fs.rmSync(work, { recursive: true, force: true });
  const mine = readJsonl(outFile).filter((o) => o.run_id === ARM.run_id);
  console.log(`run ${ARM.run_id}: ${mine.filter((o) => o.outcome === 'text').length} text rows of ${mine.length}`);
}

/** SCORE — both engines against the reference; writes the scores store (§5.2). */
const SCORER = 'en-ocr-ref-scorer@1';
function stageScore() {
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const fetched = readJsonl(F('fetch.jsonl')).filter((r) => r.image_bytes && !r.skipped);
  const outs = readJsonl(outFileOf(OCR_MODEL_LITE)).filter((o) => o.run_id === LITE_RUN);
  // #5182's arms, scored by the same function with the same normaliser; a page an arm did not run is simply absent
  const armOuts = ['flash', 'lite-repeat', 'mineru', 'mineru-repeat', 'mineru-fn'].map((k) => ({ ...ARMS[k], outs: readJsonl(outFileOf(ARMS[k].model)).filter((o) => o.run_id === ARMS[k].run_id) }));
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  const scores = [];
  for (const r of fetched) {
    const d = draws.get(r.slug); const ref = fs.readFileSync(F(`refs/${r.slug}.txt`), 'utf8');
    // Interior rule on the SCAN: the leaf must lie in (15%, 95%] of the Archive item's leaves.
    const pos = r.ia_leaf / Math.max(1, r.ia_leaves);
    const excluded = pos <= 0.15 || pos > 0.95 ? `front-or-back-matter (leaf ${r.ia_leaf} of ${r.ia_leaves})` : null;
    const refId = d.source === 'gutenberg' ? `pg:${d.pg_ebook}#page-${d.pg_page_label}@${d.source_revision}` : `ws:${d.ws_title}@${d.ws_revid}`;
    const base = { slug: r.slug, measure: 'accuracy', against: { reference_id: refId }, excluded, scorer: SCORER, scorer_version: 1, normaliser_version: 'en-ocr-ref-normalise@3', leaf_check: checks.get(r.slug)?.status || 'unchecked', at: new Date().toISOString() };
    const ia = fs.readFileSync(F(`texts/${r.slug}.ia-djvu.txt`), 'utf8');
    scores.push({ ...base, engine: 'ia-djvu', run_id: `ia-djvu:${r.ia_meta?.ocr_date || 'unknown'}`, outcome: 'text', metric: scorePage(ref, ia), abstain: false });
    for (const arm of armOuts) {
      const m = arm.outs.filter((o) => o.slug === r.slug); if (!m.length) continue;
      const fin = m.find((o) => o.outcome === 'text' || o.outcome === 'truncated') || m.filter((o) => o.outcome !== 'error').slice(-1)[0] || m.slice(-1)[0];
      const refusedFirst = m.some((o) => o.outcome === 'refusal' && o.attempt === 1);
      const common = { ...base, engine: arm.engine, model: arm.model, run_id: arm.run_id, outcome: fin.outcome, refused_first: refusedFirst, ...(arm.repeat_of ? { repeat_of: arm.repeat_of } : {}) };
      if (fin.outcome === 'text' || fin.outcome === 'truncated') scores.push({ ...common, metric: scorePage(ref, fs.readFileSync(path.join(HERE, fin.text_path), 'utf8')), abstain: false });
      // a MinerU read the worker would refuse to write (low-quality) is a failed read, but its text is kept: score it aside
      else scores.push({ ...common, metric: null, abstain: true, abstain_reason: fin.outcome, ...(fin.text_path ? { shadow_metric: scorePage(ref, fs.readFileSync(path.join(HERE, fin.text_path), 'utf8')) } : {}) });
    }
    // a rescued page was read again from the right image; its round-1 reads were of a neighbour
    let mine = outs.filter((o) => o.slug === r.slug);
    if (mine.some((o) => o.rescue)) mine = mine.filter((o) => o.rescue);
    const final = mine.find((o) => o.outcome === 'text' || o.outcome === 'truncated') || mine.filter((o) => o.outcome !== 'error').slice(-1)[0] || mine.slice(-1)[0];
    if (!final) { scores.push({ ...base, engine: 'gemini-lite-realtime', run_id: RUN_ID, outcome: 'missing', metric: null, abstain: true, abstain_reason: 'not-run' }); continue; }
    const refusedFirst = mine.some((o) => o.outcome === 'refusal' && o.attempt === 1);
    if (final.outcome === 'text' || final.outcome === 'truncated') {
      const lite = fs.readFileSync(path.join(HERE, final.text_path), 'utf8');
      // IMAGE ↔ LEAF cross-check (engine consensus, not truth): lite read OUR image, the Archive text is
      // leaf k. If they barely share words, the image is not leaf k — whatever the eye check said
      // (a model-eye "ok" was wrong on en-6a3e66-ws255: image p.242, reference p.243).
      const engines_bow = r4(bagDice(words(normalise(ia)), words(normalise(lite))));
      scores.push({ ...base, engine: 'gemini-lite-realtime', run_id: RUN_ID, outcome: final.outcome, refused_first: refusedFirst, engines_bow, metric: scorePage(ref, lite), abstain: false });
    } else scores.push({ ...base, engine: 'gemini-lite-realtime', run_id: RUN_ID, outcome: final.outcome, refused_first: refusedFirst, metric: null, abstain: true, abstain_reason: final.outcome });
  }
  const dir = path.join(STORE, 'scores', SCORER); fs.mkdirSync(dir, { recursive: true });
  writeJsonl(path.join(dir, `${MONTH}.jsonl`), scores);
  console.log(`scored ${scores.length} rows`);
}

/** LEAFPACK — what a reader needs to check each leaf by eye: the image and the reference's first/last words. */
function stageLeafpack() {
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const checks = new Map(readJsonl(F('leafcheck.jsonl')).map((c) => [c.slug, c]));
  // --pending: only pages never checked, or rescued onto a new image since their check
  const rows = readJsonl(F('fetch.jsonl')).filter((r) => r.image_bytes && !r.skipped)
    .filter((r) => !process.argv.includes('--pending') || !checks.has(r.slug) || (r.rescued === 'ok' && checks.get(r.slug).status === 'shifted'));
  const per = Math.ceil(rows.length / +argEq('--batches', 8));
  fs.rmSync(F('leafpack'), { recursive: true, force: true });
  fs.mkdirSync(F('leafpack'), { recursive: true });
  for (let b = 0; b * per < rows.length; b++) {
    const lines = rows.slice(b * per, (b + 1) * per).map((r) => {
      const ref = fs.readFileSync(F(`refs/${r.slug}.txt`), 'utf8').replace(/\s+/g, ' ').trim().split(' ');
      const d = draws.get(r.slug);
      return `### ${r.slug}\nimage: img/${r.slug}.jpg\nbook: ${d.title} (${d.year})\nREFERENCE STARTS: ${ref.slice(0, 30).join(' ')}\nREFERENCE ENDS: ${ref.slice(-30).join(' ')}\n`;
    });
    fs.writeFileSync(F(`leafpack/batch-${b + 1}.txt`), lines.join('\n'));
  }
  console.log(`leafpack: ${rows.length} pages in ${Math.ceil(rows.length / per)} batches`);
}

/** REPORT — per stratum × engine, with cluster-bootstrap CIs (pages = books). */
function stageReport() {
  resetSeed(SEED);
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const fetched = new Map(readJsonl(F('fetch.jsonl')).map((r) => [r.slug, r]));
  const scores = readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`));
  // --include-unchecked: a preview before the leaf check is done; never the published cell
  const DIGIT = new Map(readJsonl(F('digitcheck.jsonl')).map((c) => [c.key, c]));
  // A VERIFIED misread: the reader saw the reference's number on the page (printed = ref) AND the
  // engine's token is one edit from it — a glyph confusion. `silent`: the engine's token is itself a
  // number (1836→1886, 438→488: a wrong date a reader would quote); `visible`: it is not (1879→1s79,
  // 105→io: garbled on sight). A same-number candidate two or more edits away is table/column ORDER
  // (the number is printed, elsewhere on the page) — both engines "misread" 538→268 identically on
  // one table — and is not counted.
  const verifiedOf = (s, kind) => (s.metric.misread_candidates || []).filter((m) => {
    if (DIGIT.get(`${s.slug}|${m.r}|${m.h}`)?.printed !== 'ref' || levenshtein(m.r, m.h) > 1) return false;
    return kind === 'silent' ? /^\d+$/.test(m.h) : !/^\d+$/.test(m.h);
  }).length;
  const ok = scores.filter((s) => !s.excluded && (s.leaf_check === 'ok' || (INCLUDE_UNCHECKED && s.leaf_check === 'unchecked')));
  const pct = (x, d = 1) => (x == null ? '–' : `${(100 * x).toFixed(d)}%`);
  const ci = (c, d = 1) => (c ? `[${pct(c[0], d)}, ${pct(c[1], d)}]` : '');
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
  const wilson = (k, n) => { if (!n) return null; const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
  const out = [];
  const cell = (rows, label) => {
    const byEng = (e) => rows.filter((s) => s.engine === e);
    const line = (e) => {
      const all = byEng(e); const sc = all.filter((s) => !s.abstain && s.metric);
      if (!all.length) return null;
      const cerP = bootstrapRatioCI(sc.map((s) => s.metric.char_edits), sc.map((s) => s.metric.ref_alnum_chars));
      // #5186's failure is a printed number read as ANOTHER number (1836→1886): `sub`. A dropped
      // number is an omission (a line or table cell lost). Spurious numbers (`ins`) are mostly
      // structure the reference omits by convention — page numbers inside the body, footnote
      // markers, roman numerals read as digits — so they are counted, not put in the rate.
      // VERIFIED: a candidate the reader settled as "the page prints the reference's number" (digitcheck).
      const verified = (s) => verifiedOf(s, 'silent');
      const garbled = sc.reduce((a, s) => a + verifiedOf(s, 'visible'), 0);
      const subR = bootstrapRatioCI(sc.map(verified), sc.map((s) => s.metric.num_ref));
      const dropR = bootstrapRatioCI(sc.map((s) => s.metric.num_drop), sc.map((s) => s.metric.num_ref));
      const pagesSub = sc.filter((s) => verified(s) > 0).length;
      const refused = all.filter((s) => s.outcome === 'refusal').length, refusedFirst = all.filter((s) => s.refused_first).length;
      return `| ${label} | ${e} | ${sc.length}/${all.length} | ${pct(med(sc.map((s) => s.metric.cer)), 2)} | ${pct(cerP.rate, 2)} ${ci(cerP.ci, 2)} | ${pct(med(sc.map((s) => s.metric.wer)), 1)} | ${subR.denom} | ${pct(subR.rate, 2)} ${ci(subR.ci, 2)} | ${pagesSub} | ${garbled} | ${pct(dropR.rate, 1)} | ${sc.reduce((a, s) => a + s.metric.num_ins, 0)} | ${e === 'ia-djvu' ? '–' : `${refusedFirst} first / ${refused} after retry ${ci(wilson(refused, all.length), 0)}`} |`;
    };
    return [line('ia-djvu'), line('gemini-lite-realtime')].filter(Boolean);
  };
  const H = '| cell | engine | scored/pages | median CER | pooled CER [95% CI] | median WER | numbers printed | SILENT number misreads, verified [95% CI] | pages w/ a silent misread | visibly garbled numbers | numbers dropped | spurious numbers | refusals |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  out.push(`# English OCR reference — Archive text vs flash-lite (#5124)\n`);
  out.push(`run ${RUN_ID} · scorer ${SCORER} · pages scored only where leaf_check = ok (${new Set(ok.map((s) => s.slug)).size} of ${new Set(scores.map((s) => s.slug)).size})\n`);
  out.push('## Per stratum\n'); out.push(H);
  for (const s of Object.keys(STRATA)) out.push(...cell(ok.filter((x) => draws.get(x.slug)?.stratum === s), `${s} ${STRATA[s]}`));
  out.push(...cell(ok, 'ALL'));
  out.push('\n## Paired (same page, both engines scorable)\n');
  out.push('| cell | pages | Archive better | lite better | tie (|ΔCER| < 0.2pp) | sign-test p | median ΔCER (lite − Archive) | silent number misreads Archive vs lite | numbers dropped Archive vs lite |\n|---|---|---|---|---|---|---|---|---|');
  const pairedRow = (slugs, label) => {
    const pairs = slugs.map((sl) => [ok.find((s) => s.slug === sl && s.engine === 'ia-djvu'), ok.find((s) => s.slug === sl && s.engine === 'gemini-lite-realtime')]).filter(([a, b]) => a?.metric && b?.metric);
    const d = pairs.map(([a, b]) => b.metric.cer - a.metric.cer);
    const iaWin = d.filter((x) => x > 0.002).length, liteWin = d.filter((x) => x < -0.002).length;
    const de = (i, k) => pairs.reduce((s, p) => s + (k === 'num_sub' ? verifiedOf(p[i], 'silent') : p[i].metric[k]), 0);
    return `| ${label} | ${pairs.length} | ${iaWin} | ${liteWin} | ${pairs.length - iaWin - liteWin} | ${binomTwoSided(iaWin, iaWin + liteWin).toFixed(3)} | ${pct(med(d), 2)} | ${de(0, 'num_sub')} vs ${de(1, 'num_sub')} | ${de(0, 'num_drop')} vs ${de(1, 'num_drop')} |`;
  };
  const slugsOf = (f) => [...new Set(ok.filter(f).map((s) => s.slug))];
  for (const s of Object.keys(STRATA)) out.push(pairedRow(slugsOf((x) => draws.get(x.slug)?.stratum === s), `${s} ${STRATA[s]}`));
  out.push(pairedRow(slugsOf(() => true), 'ALL'));
  // covariates
  const covTable = (title, keyFn) => {
    out.push(`\n## ${title}\n`); out.push(H.replace('| cell |', '| group |'));
    const groups = new Map(); for (const s of ok) { const k = keyFn(s); (groups.get(k) || groups.set(k, []).get(k)).push(s); }
    for (const [k, rows] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) out.push(...cell(rows, k));
  };
  const engineName = (s) => { const m = fetched.get(s.slug)?.ia_meta; return m?.ocr || (m?.ocr_converted ? `(converted: ${m.ocr_converted})` : 'unrecorded'); };
  covTable('By Archive OCR engine (the item\'s `ocr` metadata)', engineName);
  covTable('By scanner', (s) => fetched.get(s.slug)?.ia_meta?.scanner_class || 'unknown');
  covTable('By Archive OCR date (djvu.xml mtime year)', (s) => (fetched.get(s.slug)?.ia_meta?.ocr_date || 'unknown').slice(0, 4));
  covTable('By reference source', (s) => draws.get(s.slug)?.source || 'wikisource');
  covTable('By decade of edition', (s) => { const y = draws.get(s.slug)?.year; return y ? `${Math.floor(y / 10) * 10}s` : 'unknown'; });
  out.push('\n## Worst five pages per engine (read these by eye before quoting a cell)\n');
  for (const e of ['ia-djvu', 'gemini-lite-realtime']) {
    const w = ok.filter((s) => s.engine === e && s.metric).sort((a, b) => b.metric.cer - a.metric.cer).slice(0, 5);
    out.push(`- **${e}**: ` + w.map((s) => `${s.slug} (CER ${pct(s.metric.cer, 1)}, digits ${s.metric.num_errors.slice(0, 4).join(' ') || '–'})`).join('; '));
  }
  out.push('\n## Number-misread candidates and what the page prints (read off the image)\n');
  out.push('| page | reference | engine read | engines | printed | note |\n|---|---|---|---|---|---|');
  for (const c of readJsonl(F('digit-candidates.jsonl'))) { const v = DIGIT.get(c.key); out.push(`| ${c.slug} | ${c.ref} | ${c.read_as} | ${c.engines.join('+')} | ${v?.printed || 'unchecked'} | ${v?.note || ''} |`); }
  const refErr = [...DIGIT.values()].filter((v) => v.printed === 'engine');
  out.push(`\nReference errors found this way: ${refErr.length} (the page prints the ENGINE's number): ${refErr.map((v) => v.key).join('; ')}`);
  const txt = out.join('\n') + '\n';
  fs.writeFileSync(F('report.md'), txt);
  console.log(txt);
}

/**
 * FLASH-REPORT (#5182) — lite vs flash-preview on the same pages, paired, with the lite-vs-lite floor FIRST,
 * and the preregistered decision rule applied per cell (PREREGISTRATION-english-modern-5182.md). Free.
 * A reference found wrong by eye is marked in benchmark/refs/<slug>.json (`leaf_check.status` not `ok`, or
 * `reference_error`) and drops out here, counted.
 */
function stageFlashReport() {
  resetSeed(5182);
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const scores = readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`));
  const refRec = (slug) => { const f = path.join(HERE, 'benchmark', 'refs', `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const refDropped = new Map();
  for (const slug of new Set(scores.map((s) => s.slug))) {
    const rec = refRec(slug);
    if (rec && (rec.reference_error || (rec.leaf_check?.status && rec.leaf_check.status !== 'ok'))) refDropped.set(slug, rec.reference_error || `leaf_check ${rec.leaf_check.status}`);
  }
  const ok = scores.filter((s) => !s.excluded && s.leaf_check === 'ok' && !refDropped.has(s.slug));
  const LITE = 'gemini-lite-realtime', FLASH = 'gemini-flash-realtime', R2 = 'gemini-lite-realtime-r2';
  const get = (slug, e) => ok.find((s) => s.slug === slug && s.engine === e);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
  const medCI = (xs, iters = 10000) => { if (xs.length < 2) return null; const m = []; for (let k = 0; k < iters; k++) { const b = []; for (let j = 0; j < xs.length; j++) b.push(xs[Math.floor(seededRand() * xs.length)]); m.push(med(b)); } m.sort((a, b) => a - b); return [m[Math.floor(iters * 0.025)], m[Math.floor(iters * 0.975)]]; };
  const pp = (x, d = 2) => (x == null ? '–' : `${(100 * x).toFixed(d)}`);
  const pct = (x, d = 1) => (x == null ? '–' : `${(100 * x).toFixed(d)}%`);
  const FAILED = new Set(['refusal', 'truncated', 'loop', 'empty', 'error', 'missing']);
  const TIE = 0.002;
  const grade = (n) => (n >= 50 ? 'decision' : n >= 30 ? 'directional' : 'exploratory');
  const out = []; const json = { issue: 5182, scorer: SCORER, normaliser: 'en-ocr-ref-normalise@3', note_handling: '<note> content moved to the end of the page (where printed footnotes stand), identically for every engine', runs: {}, floor: null, cells: [], worst: {}, disagreements: [], ref_dropped: [...refDropped].map(([slug, why]) => ({ slug, why })) };

  // ---- costs per run (the store is the ledger) ----
  for (const k of GEMINI_ARMS) {
    const a = ARMS[k]; const rows = readJsonl(outFileOf(a.model)).filter((o) => o.run_id === a.run_id);
    json.runs[k] = { run_id: a.run_id, model: a.model, rows: rows.length, text_rows: rows.filter((o) => o.outcome === 'text').length, cost_usd: +rows.reduce((s, o) => s + (o.cost_usd || 0), 0).toFixed(4), prompt_hashes: [...new Set(rows.map((o) => o.prompt_hash))] };
  }
  for (const k of ['flash', 'lite-repeat']) if (!json.runs[k].text_rows) throw new Error(`run ${json.runs[k].run_id} has zero text rows — a failed run, not a result`);

  out.push('# Modern English OCR — lite vs flash-preview, paired, on the #5216 reference pages (#5182)\n');
  out.push(`measure: **accuracy** (CER against an independent human reference) · scorer \`${SCORER}\` unchanged from #5216 · normaliser \`en-ocr-ref-normalise@3\` for every engine; \`<note>\` content is moved to the end of the page, not dropped, for both engines · preregistered in \`scripts/ev${'al'}/PREREGISTRATION-english-modern-5182.md\`\n`);
  out.push(`Runs: ${Object.entries(json.runs).map(([k, r]) => `${k} \`${r.run_id}\` ${r.text_rows}/${r.rows} text rows, $${r.cost_usd}`).join(' · ')}\n`);
  out.push(`References dropped after the by-eye spot-check: ${refDropped.size}${refDropped.size ? ` (${[...refDropped].map(([s, w]) => `${s}: ${w}`).join('; ')})` : ''}\n`);

  // ---- A-vs-A floor first ----
  const r2slugs = [...new Set(ok.filter((s) => s.engine === R2).map((s) => s.slug))];
  const fl = r2slugs.map((sl) => [get(sl, LITE), get(sl, R2)]).filter(([a, b]) => a && b);
  const flips = fl.filter(([a, b]) => FAILED.has(a.outcome) !== FAILED.has(b.outcome));
  const bothText = fl.filter(([a, b]) => a.metric && b.metric);
  const dF = bothText.map(([a, b]) => a.metric.cer - b.metric.cer);
  json.floor = { pages: fl.length, outcome_flips: flips.length, flip_slugs: flips.map(([a]) => a.slug), both_text: bothText.length, median_delta: med(dF), median_abs_delta: med(dF.map(Math.abs)), max_abs_delta: dF.length ? Math.max(...dF.map(Math.abs)) : null, beyond_tie: dF.filter((x) => Math.abs(x) >= TIE).length, refusals_run1: fl.filter(([a]) => a.outcome === 'refusal').length, refusals_run2: fl.filter(([, b]) => b.outcome === 'refusal').length };
  out.push('## 1. Noise floor first — lite vs lite (A-vs-A, 20 pages, seed 5182)\n');
  out.push('| pages | both read text | outcome flips (text ↔ failed) | refusals run 1 / run 2 | median Δ CER (pp) | median \\|Δ\\| (pp) | max \\|Δ\\| (pp) | pairs outside the 0.2 pp tie band |\n|---|---|---|---|---|---|---|---|');
  const F0 = json.floor;
  out.push(`| ${F0.pages} | ${F0.both_text} | ${F0.outcome_flips}${F0.flip_slugs.length ? ` (${F0.flip_slugs.join(', ')})` : ''} | ${F0.refusals_run1} / ${F0.refusals_run2} | ${pp(F0.median_delta)} | ${pp(F0.median_abs_delta)} | ${pp(F0.max_abs_delta)} | ${F0.beyond_tie} of ${F0.both_text} |\n`);

  // ---- per cell ----
  const CELLS = [['S1', 'S1 pre-1880 prose', (d) => d.stratum === 'S1'], ['S2', 'S2 pre-1880 date-dense', (d) => d.stratum === 'S2'], ['S3', 'S3 1880–1930 prose', (d) => d.stratum === 'S3'], ['S4', 'S4 1880–1930 date-dense', (d) => d.stratum === 'S4'],
    ['pre1880', 'pre-1880 (S1+S2)', (d) => d.stratum === 'S1' || d.stratum === 'S2'], ['1880-1930', '1880–1930 (S3+S4)', (d) => d.stratum === 'S3' || d.stratum === 'S4'], ['ALL', 'ALL', () => true]];
  const engStats = (rows) => {
    const n = rows.length, text = rows.filter((s) => s.metric), failed = rows.filter((s) => FAILED.has(s.outcome));
    const bad = text.filter((s) => s.metric.cer > 0.5);
    const pooled = bootstrapRatioCI(text.map((s) => s.metric.char_edits), text.map((s) => s.metric.ref_alnum_chars));
    return { pages: n, text: text.length, refusals: rows.filter((s) => s.outcome === 'refusal').length, refused_first: rows.filter((s) => s.refused_first).length, other_failed: failed.filter((s) => s.outcome !== 'refusal').length,
      cer_gt_half: bad.length, catastrophic: failed.length + bad.length, catastrophic_rate: n ? (failed.length + bad.length) / n : null, median_cer: med(text.map((s) => s.metric.cer)), pooled_cer: pooled.rate, pooled_ci: pooled.ci };
  };
  out.push('## 2. Each engine on its own pages (failed reads counted, not dropped)\n');
  out.push('| cell | books | engine | text reads | refusals (1st try → after retry) | other failed | text with CER > 50% | **catastrophic** | median CER | pooled CER [95% CI] |\n|---|---|---|---|---|---|---|---|---|---|');
  const paired = [];
  for (const [id, label, f] of CELLS) {
    const slugs = [...new Set(ok.filter((s) => draws.get(s.slug) && f(draws.get(s.slug))).map((s) => s.slug))];
    const L = engStats(slugs.map((sl) => get(sl, LITE)).filter(Boolean)), Fl = engStats(slugs.map((sl) => get(sl, FLASH)).filter(Boolean));
    for (const [e, st] of [['lite', L], ['flash', Fl]]) out.push(`| ${label} | ${slugs.length} | ${e} | ${st.text}/${st.pages} | ${st.refused_first} → ${st.refusals} | ${st.other_failed} | ${st.cer_gt_half} | **${st.catastrophic} (${pct(st.catastrophic_rate)})** | ${pct(st.median_cer, 2)} | ${pct(st.pooled_cer, 2)} ${st.pooled_ci ? `[${pct(st.pooled_ci[0], 2)}, ${pct(st.pooled_ci[1], 2)}]` : ''} |`);
    const pairs = slugs.map((sl) => [get(sl, LITE), get(sl, FLASH)]).filter(([a, b]) => a && b);
    const both = pairs.filter(([a, b]) => a.metric && b.metric);
    const d = both.map(([a, b]) => a.metric.cer - b.metric.cer);
    const liteBetter = d.filter((x) => x <= -TIE).length, flashBetter = d.filter((x) => x >= TIE).length;
    const c = { id, label, books: slugs.length, grade: grade(slugs.length), lite: L, flash: Fl, pairs: both.length,
      excluded: { lite_failed_only: pairs.filter(([a, b]) => !a.metric && b.metric).length, flash_failed_only: pairs.filter(([a, b]) => a.metric && !b.metric).length, both_failed: pairs.filter(([a, b]) => !a.metric && !b.metric).length },
      flash_better: flashBetter, lite_better: liteBetter, ties: both.length - flashBetter - liteBetter, sign_p: binomTwoSided(flashBetter, flashBetter + liteBetter), median_delta: med(d), median_delta_ci: medCI(d) };
    c.rule = { median_cer_ok: L.median_cer != null && L.median_cer <= 0.02, catastrophic_ok: L.catastrophic_rate != null && L.catastrophic_rate <= 0.02, delta_ok: c.median_delta != null && c.median_delta <= 0.01 };
    c.lite_adequate = c.rule.median_cer_ok && c.rule.catastrophic_ok && c.rule.delta_ok;
    c.failed_conditions = Object.entries(c.rule).filter(([, v]) => !v).map(([k]) => k);
    paired.push(c); json.cells.push(c);
  }
  out.push('\n## 3. Paired — same page, both engines read text (the only engine-vs-engine comparison)\n');
  out.push(`Δ = lite CER − flash CER, in percentage points; positive = flash better. Tie band ±0.2 pp. Floor from §1: median |Δ| lite-vs-lite ${pp(F0.median_abs_delta)} pp.\n`);
  out.push('| cell | grade (books) | pairs | excluded: lite failed / flash failed / both | flash better | lite better | tie | sign-test p | median Δ (pp) [95% CI] |\n|---|---|---|---|---|---|---|---|---|');
  for (const c of paired) out.push(`| ${c.label} | ${c.grade} (${c.books}) | ${c.pairs} | ${c.excluded.lite_failed_only} / ${c.excluded.flash_failed_only} / ${c.excluded.both_failed} | ${c.flash_better} | ${c.lite_better} | ${c.ties} | ${c.sign_p.toFixed(3)} | ${pp(c.median_delta)} ${c.median_delta_ci ? `[${pp(c.median_delta_ci[0])}, ${pp(c.median_delta_ci[1])}]` : ''} |`);
  out.push('\n## 4. The preregistered rule, per cell\n');
  out.push('lite is adequate iff (1) lite median CER ≤ 2% AND (2) lite catastrophic ≤ 2% (refusals count) AND (3) paired median Δ ≤ 1 pp. A cell under 30 books carries no proposal on its own.\n');
  // Not part of the rule, shown beside it: whether flash itself would pass the condition lite failed.
  out.push('| cell | grade | (1) median CER ≤ 2% | (2) catastrophic ≤ 2% | (3) median Δ ≤ 1 pp | verdict | flash\'s own catastrophic (not in the rule) |\n|---|---|---|---|---|---|---|');
  const yn = (v, x) => `${v ? 'yes' : '**no**'} (${x})`;
  for (const c of paired) out.push(`| ${c.label} | ${c.grade} | ${yn(c.rule.median_cer_ok, pct(c.lite.median_cer, 2))} | ${yn(c.rule.catastrophic_ok, pct(c.lite.catastrophic_rate))}| ${yn(c.rule.delta_ok, `${pp(c.median_delta)} pp`)} | ${c.lite_adequate ? 'lite adequate' : c.books < 30 ? `fails ${c.failed_conditions.join(', ')} — exploratory, no proposal` : `**proposes flash** (fails ${c.failed_conditions.join(', ')})`} | ${pct(c.flash.catastrophic_rate)} (${c.flash.refusals} refusals of ${c.flash.pages}) |`);

  // ---- spot-check list ----
  out.push('\n## 5. Pages to read by eye\n');
  for (const [k, e] of [['lite', LITE], ['flash', FLASH]]) {
    const w = ok.filter((s) => s.engine === e && s.metric).sort((a, b) => b.metric.cer - a.metric.cer).slice(0, 5);
    json.worst[k] = w.map((s) => ({ slug: s.slug, cer: s.metric.cer, len_ratio: s.metric.len_ratio, other: get(s.slug, e === LITE ? FLASH : LITE)?.metric?.cer ?? null }));
    out.push(`- worst five, **${k}**: ${json.worst[k].map((x) => `${x.slug} (${pct(x.cer, 1)}; other engine ${pct(x.other, 1)}; len ratio ${x.len_ratio})`).join('; ')}`);
  }
  for (const sl of new Set(ok.map((s) => s.slug))) { const a = get(sl, LITE), b = get(sl, FLASH); if (a?.metric && b?.metric && Math.abs(a.metric.cer - b.metric.cer) > 0.05) json.disagreements.push({ slug: sl, lite: a.metric.cer, flash: b.metric.cer }); }
  out.push(`- engines disagree by > 5 pp: ${json.disagreements.length ? json.disagreements.map((x) => `${x.slug} (lite ${pct(x.lite, 1)}, flash ${pct(x.flash, 1)})`).join('; ') : 'none'}`);
  const byEye = F('flash-arm-byeye.jsonl');
  if (fs.existsSync(byEye)) {
    out.push('\n### Read from image\n'); out.push('| page | engine(s) | error kind | what the image shows |\n|---|---|---|---|');
    json.by_eye = readJsonl(byEye);
    for (const b of json.by_eye) out.push(`| ${b.slug} | ${b.engines} | ${b.kind} | ${b.note} (*read from image*) |`);
  }
  const base = F('flash-arm-2026-09-28');
  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 2) + '\n');
  fs.writeFileSync(`${base}.md`, out.join('\n') + '\n');
  console.log(out.join('\n'));
}

/**
 * MINERU-REPORT (#5182 / #3389) — MinerU vs lite (and flash) on the same pages, with MinerU's own A-vs-A floor
 * first and the preregistered PEER / FALLBACK / NEITHER rule (PREREGISTRATION-mineru-english-5182.md). Free.
 * Copies flash-report's reference drops, statistics and tie band unchanged. A MinerU "failed read" is what the
 * production worker would refuse to write (`empty`, `low-quality`, `error`); low-quality text is scored aside.
 */
function stageMineruReport() {
  resetSeed(5182);
  const draws = new Map(readJsonl(F('draw.jsonl')).map((d) => [d.slug, d]));
  const scores = readJsonl(path.join(STORE, 'scores', SCORER, `${MONTH}.jsonl`));
  const refRec = (slug) => { const f = path.join(HERE, 'benchmark', 'refs', `${slug}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const refDropped = new Map();
  for (const slug of new Set(scores.map((s) => s.slug))) {
    const rec = refRec(slug);
    if (rec && (rec.reference_error || (rec.leaf_check?.status && rec.leaf_check.status !== 'ok'))) refDropped.set(slug, rec.reference_error || `leaf_check ${rec.leaf_check.status}`);
  }
  const ok = scores.filter((s) => !s.excluded && s.leaf_check === 'ok' && !refDropped.has(s.slug));
  // --mineru-arm=mineru-fn reports the POST-HOC footnote arm through the same stage; the floor stays the preregistered arm's
  const MK = argEq('--mineru-arm', 'mineru'), A = ARMS[MK]; if (!A?.local) throw new Error(`--mineru-arm must be a MinerU arm, not ${MK}`);
  const LITE = 'gemini-lite-realtime', FLASH = 'gemini-flash-realtime', MIN0 = ARMS.mineru.engine, MIN = A.engine, MR2 = 'mineru-pipeline-cpu-r2', IA = 'ia-djvu';
  const get = (slug, e) => ok.find((s) => s.slug === slug && s.engine === e);
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const i = (s.length - 1) / 2; return (s[Math.floor(i)] + s[Math.ceil(i)]) / 2; };
  const medCI = (xs, iters = 10000) => { if (xs.length < 2) return null; const m = []; for (let k = 0; k < iters; k++) { const b = []; for (let j = 0; j < xs.length; j++) b.push(xs[Math.floor(seededRand() * xs.length)]); m.push(med(b)); } m.sort((a, b) => a - b); return [m[Math.floor(iters * 0.025)], m[Math.floor(iters * 0.975)]]; };
  const pp = (x, d = 2) => (x == null ? '–' : `${(100 * x).toFixed(d)}`);
  const pct = (x, d = 1) => (x == null ? '–' : `${(100 * x).toFixed(d)}%`);
  const FAILED = new Set(['refusal', 'truncated', 'loop', 'empty', 'error', 'missing', 'low-quality']);
  const TIE = 0.002;
  const grade = (n) => (n >= 50 ? 'decision' : n >= 30 ? 'directional' : 'exploratory');
  // digit misreads: digitcheck.jsonl (#5186) plus the MinerU-only candidates read off the image for this arm
  const DIGIT = new Map([...readJsonl(F('digitcheck.jsonl')), ...readJsonl(F('mineru-digitcheck.jsonl'))].map((c) => [c.key, c]));
  const silent = (s) => (s.metric?.misread_candidates || []).filter((m) => DIGIT.get(`${s.slug}|${m.r}|${m.h}`)?.printed === 'ref' && levenshtein(m.r, m.h) <= 1 && /^\d+$/.test(m.h)).length;
  const unchecked = (s) => (s.metric?.misread_candidates || []).filter((m) => !DIGIT.has(`${s.slug}|${m.r}|${m.h}`)).map((m) => ({ key: `${s.slug}|${m.r}|${m.h}`, slug: s.slug, ref: m.r, read_as: m.h, ctx: m.ctx }));
  // a candidate can only become a SILENT misread if the engine's token is a number one edit away; the rest are
  // visibly garbled (2o, 7oo, i17) whatever the page prints, and need no image check to be kept out of the rate
  const canBeSilent = (u) => /^\d+$/.test(u.read_as) && levenshtein(u.ref, u.read_as) <= 1;
  const mRows = readJsonl(outFileOf(ARMS.mineru.model));
  const run = (k) => { const rows = mRows.filter((o) => o.run_id === ARMS[k].run_id); return { run_id: ARMS[k].run_id, rows: rows.length, text_rows: rows.filter((o) => o.outcome === 'text').length, versions: [...new Set(rows.map((o) => o.engine_version))], median_ms_per_page: med(rows.map((o) => o.latency_ms)) }; };
  const json = { issue: 5182, ladder_issue: 3389, scorer: SCORER, normaliser: 'en-ocr-ref-normalise@3', post: 'mineru-ocr-worker sanitize() (verbatim) then en-ocr-ref-normalise@3', runs: { [MK]: run(MK), 'mineru-repeat': run('mineru-repeat') }, floor: null, cells: [], ladder: {}, digits: {}, long_s: {}, worst: [], best: [], ref_dropped: [...refDropped].map(([slug, why]) => ({ slug, why })) };
  if (!json.runs[MK].text_rows) throw new Error(`run ${json.runs[MK].run_id} has zero text rows — a failed run, not a result`);
  json.post_hoc = !!A.post_hoc;
  const out = [];
  out.push(`# Modern English OCR — MinerU${A.footnotes ? ' + footnotes' : ''} vs lite (and flash), paired, on the #5216 reference pages (#5182, #3389)\n`);
  if (A.post_hoc) out.push('> **POST-HOC RE-ANALYSIS, not a preregistered result.** The decision rule below was fixed in `PREREGISTRATION-mineru-english-5182.md` before the footnote step existed; the step (PR #5299: MinerU\'s `page_footnote` blocks from `middle.json` appended below the body) was added AFTER the preregistered arm showed every catastrophic page was a dropped footnote. MinerU was re-run for this arm (the first run\'s raw output was not kept), so body text can differ slightly from `en-mineru-5182-2026-09` (MinerU is not byte-deterministic — §1). Read the rule output as "what the fixed rule says of the fixed worker", not as a confirmation.\n');
  out.push(`measure: **accuracy** (CER against an independent human reference) · scorer \`${SCORER}\` unchanged · post-processing: the production worker's \`sanitize()\` (lifted verbatim from \`scripts/workers/mineru-ocr-worker.mjs\`), then \`en-ocr-ref-normalise@3\` — the same normaliser as every other engine · preregistered in \`scripts/ev${'al'}/PREREGISTRATION-mineru-english-5182.md\` · $0 (no model call; lite and flash rows are the existing store runs, not re-read)\n`);
  out.push(`Runs: ${Object.entries(json.runs).map(([k, r]) => `${k} \`${r.run_id}\` ${r.text_rows}/${r.rows} text rows, ${r.versions.join('/')}, median ${Math.round((r.median_ms_per_page || 0) / 1000)} s/page CPU`).join(' · ')}\n`);
  out.push(`References dropped after the #5182 by-eye check: ${refDropped.size} (stay dropped)\n`);

  // ---- 1. floor ----
  const fl = [...new Set(ok.filter((s) => s.engine === MR2).map((s) => s.slug))].map((sl) => [get(sl, MIN0), get(sl, MR2)]).filter(([a, b]) => a && b);
  const bothT = fl.filter(([a, b]) => a.metric && b.metric), dF = bothT.map(([a, b]) => a.metric.cer - b.metric.cer);
  const hashOf = (sl, k) => mRows.find((o) => o.slug === sl && o.run_id === ARMS[k].run_id && o.text_hash)?.text_hash;
  json.floor = { pages: fl.length, outcome_flips: fl.filter(([a, b]) => FAILED.has(a.outcome) !== FAILED.has(b.outcome)).length, both_text: bothT.length,
    identical_text: fl.filter(([a]) => hashOf(a.slug, 'mineru') && hashOf(a.slug, 'mineru') === hashOf(a.slug, 'mineru-repeat')).length,
    median_abs_delta: med(dF.map(Math.abs)), max_abs_delta: dF.length ? Math.max(...dF.map(Math.abs)) : null, beyond_tie: dF.filter((x) => Math.abs(x) >= TIE).length };
  const F0 = json.floor;
  out.push('## 1. Noise floor first — MinerU vs MinerU (A-vs-A, the same 20 seed-5182 pages as the lite floor)\n');
  out.push('| pages | both read text | byte-identical text | outcome flips | median \\|Δ\\| CER (pp) | max \\|Δ\\| (pp) | pairs outside the 0.2 pp tie band |\n|---|---|---|---|---|---|---|');
  out.push(`| ${F0.pages} | ${F0.both_text} | ${F0.identical_text} | ${F0.outcome_flips} | ${pp(F0.median_abs_delta)} | ${pp(F0.max_abs_delta)} | ${F0.beyond_tie} of ${F0.both_text} |\n`);

  // ---- 2. each engine on its own pages ----
  const early = (d) => (d.stratum === 'S1' || d.stratum === 'S2');
  const CELLS = [['S1', 'S1 pre-1880 prose', (d) => d.stratum === 'S1'], ['S2', 'S2 pre-1880 date-dense', (d) => d.stratum === 'S2'], ['S3', 'S3 1880–1930 prose', (d) => d.stratum === 'S3'], ['S4', 'S4 1880–1930 date-dense', (d) => d.stratum === 'S4'],
    ['pre1820', 'printed before 1820 (S1+S2)', (d) => early(d) && d.year && d.year < 1820], ['1820-1879', '1820–1879 (S1+S2)', (d) => early(d) && !(d.year && d.year < 1820)],
    ['pre1880', 'pre-1880 (S1+S2)', early], ['1880-1930', '1880–1930 (S3+S4)', (d) => !early(d)], ['ALL', 'ALL', () => true]];
  const engStats = (rows) => {
    const n = rows.length, text = rows.filter((s) => s.metric), failed = rows.filter((s) => FAILED.has(s.outcome)), bad = text.filter((s) => s.metric.cer > 0.5);
    const pooled = bootstrapRatioCI(text.map((s) => s.metric.char_edits), text.map((s) => s.metric.ref_alnum_chars));
    const numRef = text.reduce((a, s) => a + s.metric.num_ref, 0), sil = text.reduce((a, s) => a + silent(s), 0);
    return { pages: n, text: text.length, refusals: rows.filter((s) => s.outcome === 'refusal').length, failed: failed.length, failed_kinds: failed.reduce((a, s) => ({ ...a, [s.outcome]: (a[s.outcome] || 0) + 1 }), {}),
      cer_gt_half: bad.length, catastrophic: failed.length + bad.length, catastrophic_rate: n ? (failed.length + bad.length) / n : null, median_cer: med(text.map((s) => s.metric.cer)), pooled_cer: pooled.rate, pooled_ci: pooled.ci,
      numbers_printed: numRef, silent_misreads: sil, silent_rate: numRef ? sil / numRef : null, unchecked_candidates: text.flatMap(unchecked).filter(canBeSilent).length };
  };
  out.push('## 2. Each engine on its own pages (failed reads counted, not dropped)\n');
  out.push('MinerU\'s failed read = what the production worker would refuse to write: empty (< 40 letters/digits after `sanitize()`), low-quality (`lowQuality()`), or error. Gemini\'s = refusal after retry, truncation, loop. The Archive\'s text (ABBYY) is shown for context.\n');
  out.push('| cell | books | engine | text reads | failed (kinds) | text with CER > 50% | **catastrophic** | median CER | pooled CER [95% CI] | silent number misreads (verified) / numbers printed |\n|---|---|---|---|---|---|---|---|---|---|');
  const cells = [];
  for (const [id, label, f] of CELLS) {
    const slugs = [...new Set(ok.filter((s) => draws.get(s.slug) && f(draws.get(s.slug))).map((s) => s.slug))];
    const st = {}; for (const [k, e] of [['mineru', MIN], ['lite', LITE], ['flash', FLASH], ['archive', IA]]) st[k] = engStats(slugs.map((sl) => get(sl, e)).filter(Boolean));
    for (const k of ['mineru', 'lite', 'flash', 'archive']) { const s = st[k]; out.push(`| ${label} | ${slugs.length} | ${k} | ${s.text}/${s.pages} | ${s.failed}${s.failed ? ` (${Object.entries(s.failed_kinds).map(([a, b]) => `${a} ${b}`).join(', ')})` : ''} | ${s.cer_gt_half} | **${s.catastrophic} (${pct(s.catastrophic_rate)})** | ${pct(s.median_cer, 2)} | ${pct(s.pooled_cer, 2)} ${s.pooled_ci ? `[${pct(s.pooled_ci[0], 2)}, ${pct(s.pooled_ci[1], 2)}]` : ''} | ${s.silent_misreads} / ${s.numbers_printed}${s.unchecked_candidates ? ` (+${s.unchecked_candidates} unchecked)` : ''} |`); }
    const pairs = slugs.map((sl) => [get(sl, MIN), get(sl, LITE)]).filter(([a, b]) => a && b);
    const both = pairs.filter(([a, b]) => a.metric && b.metric), d = both.map(([a, b]) => a.metric.cer - b.metric.cer);
    const minBetter = d.filter((x) => x <= -TIE).length, liteBetter = d.filter((x) => x >= TIE).length;
    cells.push({ id, label, books: slugs.length, grade: grade(slugs.length), ...st, pairs: both.length,
      excluded: { mineru_failed_only: pairs.filter(([a, b]) => !a.metric && b.metric).length, lite_failed_only: pairs.filter(([a, b]) => a.metric && !b.metric).length, both_failed: pairs.filter(([a, b]) => !a.metric && !b.metric).length },
      mineru_better: minBetter, lite_better: liteBetter, ties: both.length - minBetter - liteBetter, sign_p: binomTwoSided(minBetter, minBetter + liteBetter), median_delta: med(d), median_delta_ci: medCI(d) });
  }
  json.cells = cells;
  out.push('\n## 3. Paired — MinerU vs lite, same page, both read text\n');
  out.push(`Δ = MinerU CER − lite CER, in percentage points; **positive = lite better**. Tie band ±0.2 pp. MinerU's own floor (§1): median |Δ| ${pp(F0.median_abs_delta)} pp.\n`);
  out.push('| cell | grade (books) | pairs | excluded: MinerU failed / lite failed / both | MinerU better | lite better | tie | sign-test p | median Δ (pp) [95% CI] |\n|---|---|---|---|---|---|---|---|---|');
  for (const c of cells) out.push(`| ${c.label} | ${c.grade} (${c.books}) | ${c.pairs} | ${c.excluded.mineru_failed_only} / ${c.excluded.lite_failed_only} / ${c.excluded.both_failed} | ${c.mineru_better} | ${c.lite_better} | ${c.ties} | ${c.sign_p.toFixed(3)} | ${pp(c.median_delta)} ${c.median_delta_ci ? `[${pp(c.median_delta_ci[0])}, ${pp(c.median_delta_ci[1])}]` : ''} |`);

  // ---- 4. the ladder question ----
  const ALL = cells.find((c) => c.id === 'ALL');
  out.push('\n## 4. The ladder question — MinerU on the pages Gemini refused (the population tier 3 serves)\n');
  out.push('| population | pages | MinerU text reads | MinerU failed | MinerU median CER | MinerU pooled CER | lite pooled CER on its own text reads (ALL) | ratio | grade |\n|---|---|---|---|---|---|---|---|---|');
  for (const [k, e] of [['lite_refused', LITE], ['flash_refused', FLASH], ['both_refused', null]]) {
    const slugs = [...new Set(ok.map((s) => s.slug))].filter((sl) => (e ? get(sl, e)?.outcome === 'refusal' : get(sl, LITE)?.outcome === 'refusal' && get(sl, FLASH)?.outcome === 'refusal'));
    const st = engStats(slugs.map((sl) => get(sl, MIN)).filter(Boolean));
    const ratio = st.pooled_cer != null && ALL.lite.pooled_cer ? st.pooled_cer / ALL.lite.pooled_cer : null;
    json.ladder[k] = { pages: slugs.length, slugs, mineru: st, ratio_to_lite_pooled: ratio };
    out.push(`| ${k.replace('_', ' ')} | ${slugs.length} | ${st.text} | ${st.failed} | ${pct(st.median_cer, 2)} | ${pct(st.pooled_cer, 2)} | ${pct(ALL.lite.pooled_cer, 2)} | ${ratio == null ? '–' : `${ratio.toFixed(2)}×`} | ${grade(slugs.length)} |`);
  }

  // ---- 5. the rule ----
  const L = json.ladder.lite_refused;
  const peer = { delta_ok: ALL.median_delta != null && Math.abs(ALL.median_delta) <= TIE, catastrophic_ok: ALL.mineru.catastrophic_rate != null && ALL.mineru.catastrophic_rate <= 0.02 };
  const fallback = { ratio_ok: L.ratio_to_lite_pooled != null && L.ratio_to_lite_pooled <= 2, reads_half: L.pages > 0 && L.mineru.text >= L.pages / 2 };
  json.verdict = peer.delta_ok && peer.catastrophic_ok ? 'PEER' : fallback.ratio_ok && fallback.reads_half ? 'FALLBACK' : 'NEITHER';
  json.rule = { peer, fallback };
  out.push('\n## 5. The preregistered rule (ALL cell, decision grade)\n');
  const yn = (v, x) => `${v ? 'yes' : '**no**'} (${x})`;
  out.push('| condition | met? |\n|---|---|');
  out.push(`| PEER (a): paired median Δ within ±0.2 pp | ${yn(peer.delta_ok, `${pp(ALL.median_delta)} pp`)} |`);
  out.push(`| PEER (b): MinerU catastrophic ≤ 2% | ${yn(peer.catastrophic_ok, pct(ALL.mineru.catastrophic_rate))} |`);
  out.push(`| FALLBACK (a): MinerU pooled CER on lite-refused pages ≤ 2× lite's pooled CER | ${yn(fallback.ratio_ok, L.ratio_to_lite_pooled == null ? '–' : `${L.ratio_to_lite_pooled.toFixed(2)}×`)} |`);
  out.push(`| FALLBACK (b): MinerU reads at least half of them | ${yn(fallback.reads_half, `${L.mineru.text} of ${L.pages}`)} |`);
  out.push(`\n**Rule output: ${json.verdict}.** Per period (quoted, not the rule): ${cells.filter((c) => ['pre1820', '1820-1879', '1880-1930'].includes(c.id)).map((c) => `${c.label} median Δ ${pp(c.median_delta)} pp, MinerU catastrophic ${pct(c.mineru.catastrophic_rate)} (${c.grade}, ${c.books} books)`).join('; ')}.\n`);

  // ---- 6. long s ----
  // An f in MinerU's word where the reference has s (fecond ← second): count MinerU words absent from the
  // reference that become a reference word when one or all of their f's are read as s.
  const longS = (sl) => {
    const row = mRows.find((o) => o.slug === sl && o.run_id === A.run_id && o.text_path); if (!row) return null;
    const refW = new Set(words(normalise(fs.readFileSync(F(`refs/${sl}.txt`), 'utf8'))));
    const hyp = words(normalise(fs.readFileSync(path.join(HERE, row.text_path), 'utf8')));
    let n = 0; const ex = [];
    for (const w of hyp) {
      if (refW.has(w) || !w.includes('f')) continue;
      const cands = [w.replace(/f/g, 's'), ...[...w].map((c, i) => (c === 'f' ? w.slice(0, i) + 's' + w.slice(i + 1) : null)).filter(Boolean)];
      const hit = cands.find((c) => refW.has(c)); if (hit) { n++; if (ex.length < 5) ex.push(`${w}→${hit}`); }
    }
    return { words: hyp.length, long_s: n, examples: ex };
  };
  out.push('## 6. Long s (ſ read as f), per period\n');
  out.push('Count of MinerU words not in the reference that become a reference word when an f is read as s (fecond → second). A proxy; the by-eye note in §8 says what the image shows.\n');
  out.push('| period | pages | pages with ≥ 3 ſ→f words | ſ→f words per 1,000 words | examples |\n|---|---|---|---|---|');
  for (const id of ['pre1820', '1820-1879', '1880-1930']) {
    const c = CELLS.find((x) => x[0] === id); const slugs = [...new Set(ok.filter((s) => draws.get(s.slug) && c[2](draws.get(s.slug))).map((s) => s.slug))];
    const ls = slugs.map((sl) => ({ sl, ...longS(sl) })).filter((x) => x.words);
    const tot = ls.reduce((a, x) => a + x.long_s, 0), totW = ls.reduce((a, x) => a + x.words, 0);
    json.long_s[id] = { pages: ls.length, pages_ge3: ls.filter((x) => x.long_s >= 3).length, per_1000: totW ? (1000 * tot) / totW : null, worst: ls.sort((a, b) => b.long_s - a.long_s).slice(0, 5).map((x) => ({ slug: x.sl, long_s: x.long_s, examples: x.examples })) };
    const J = json.long_s[id];
    out.push(`| ${c[1]} | ${J.pages} | ${J.pages_ge3} | ${J.per_1000 == null ? '–' : J.per_1000.toFixed(1)} | ${J.worst.filter((x) => x.long_s).slice(0, 3).map((x) => `${x.slug}: ${x.examples.slice(0, 3).join(', ')}`).join('; ') || '–'} |`);
  }

  // ---- 7. digits ----
  const mText = ok.filter((s) => s.engine === MIN && s.metric);
  const un = mText.flatMap(unchecked);
  json.digits = { unchecked_could_be_silent: un.filter(canBeSilent), visibly_garbled_unchecked: un.filter((u) => !canBeSilent(u)).map((u) => u.key) };
  out.push('\n## 7. Number misreads (the #5186 measure)\n');
  out.push(`Silent misreads = a printed number read as another number, verified off the image (digitcheck.jsonl; MinerU-only candidates in mineru-digitcheck.jsonl, where \`split\` = digits right but spaced apart by the engine). ALL cell: MinerU ${ALL.mineru.silent_misreads} / ${ALL.mineru.numbers_printed} (${pct(ALL.mineru.silent_rate, 2)}), lite ${ALL.lite.silent_misreads} / ${ALL.lite.numbers_printed} (${pct(ALL.lite.silent_rate, 2)}), Archive ${ALL.archive.silent_misreads} / ${ALL.archive.numbers_printed} (${pct(ALL.archive.silent_rate, 2)}). Candidates that could still be silent and are unchecked: ${json.digits.unchecked_could_be_silent.length}${json.digits.unchecked_could_be_silent.length ? ` — ${json.digits.unchecked_could_be_silent.map((u) => u.key).join('; ')}` : ''}. Visibly garbled numbers in MinerU's text (o for 0, i for 1 — not silent, not in the rate): ${json.digits.visibly_garbled_unchecked.length}.\n`);

  // ---- 8. by eye ----
  const sorted = [...mText].sort((a, b) => a.metric.cer - b.metric.cer);
  json.best = sorted.slice(0, 5).map((s) => ({ slug: s.slug, cer: s.metric.cer, lite: get(s.slug, LITE)?.metric?.cer ?? null }));
  json.worst = sorted.slice(-5).reverse().map((s) => ({ slug: s.slug, cer: s.metric.cer, len_ratio: s.metric.len_ratio, lite: get(s.slug, LITE)?.metric?.cer ?? null }));
  out.push('## 8. Pages to read by eye\n');
  out.push(`- best five, MinerU: ${json.best.map((x) => `${x.slug} (${pct(x.cer, 2)}; lite ${pct(x.lite, 2)})`).join('; ')}`);
  out.push(`- worst five, MinerU: ${json.worst.map((x) => `${x.slug} (${pct(x.cer, 1)}; lite ${pct(x.lite, 1)}; len ratio ${x.len_ratio})`).join('; ')}`);
  // OMISSION: MinerU's pipeline backend files footnotes as `page_footnote` in middle.json's discarded_blocks, beside
  // the running head, so the markdown the worker keeps has none. A page where MinerU emits < 80% of the reference's
  // words while the Archive text (which keeps footnotes) emits ≥ 90% is counted here; the by-eye rows say which are footnotes.
  json.omission = mText.filter((s) => s.metric.len_ratio < 0.8 && (get(s.slug, IA)?.metric?.len_ratio ?? 0) >= 0.9).map((s) => ({ slug: s.slug, cer: s.metric.cer, len_ratio: s.metric.len_ratio, archive_len_ratio: get(s.slug, IA).metric.len_ratio }));
  out.push(`- pages where MinerU emits < 80% of the reference's words and the Archive text ≥ 90%: ${json.omission.length} of ${mText.length} — ${json.omission.map((x) => `${x.slug} (${pct(x.len_ratio, 0)} of words, CER ${pct(x.cer, 1)})`).join('; ')}`);
  const failedM = ok.filter((s) => s.engine === MIN && !s.metric);
  out.push(`- MinerU failed reads: ${failedM.length ? failedM.map((s) => `${s.slug} (${s.outcome}${s.shadow_metric ? `, CER of the kept text ${pct(s.shadow_metric.cer, 1)}` : ''})`).join('; ') : 'none'}`);
  const byEye = F(`${A.suffix}-arm-byeye.jsonl`);
  if (fs.existsSync(byEye)) {
    out.push('\n### Read from image\n'); out.push('| page | CER (MinerU / lite) | error kind | what the image shows |\n|---|---|---|---|');
    json.by_eye = readJsonl(byEye);
    for (const b of json.by_eye) out.push(`| ${b.slug} | ${b.cer} | ${b.kind} | ${b.note} (*read from image*) |`);
  }
  if (MK !== 'mineru') {
    // ---- 9. before / after: the preregistered arm vs this one, same pages ----
    const before = engStats(ok.filter((s) => s.engine === MIN0)), after = ALL.mineru;
    const pairsB = [...new Set(ok.map((s) => s.slug))].map((sl) => [get(sl, MIN0), get(sl, LITE)]).filter(([a, b]) => a?.metric && b?.metric).map(([a, b]) => a.metric.cer - b.metric.cer);
    const winsB = [pairsB.filter((x) => x <= -TIE).length, pairsB.filter((x) => x >= TIE).length];
    const fnRow = (sl) => mRows.find((o) => o.slug === sl && o.run_id === A.run_id);
    const omB = ok.filter((s) => s.engine === MIN0 && s.metric && s.metric.len_ratio < 0.8 && (get(s.slug, IA)?.metric?.len_ratio ?? 0) >= 0.9);
    json.before_after = { before: { catastrophic_rate: before.catastrophic_rate, cer_gt_half: before.cer_gt_half, median_cer: before.median_cer, pooled_cer: before.pooled_cer, paired_median_delta: med(pairsB), mineru_better: winsB[0], lite_better: winsB[1] },
      after: { catastrophic_rate: after.catastrophic_rate, cer_gt_half: after.cer_gt_half, median_cer: after.median_cer, pooled_cer: after.pooled_cer, paired_median_delta: ALL.median_delta, mineru_better: ALL.mineru_better, lite_better: ALL.lite_better },
      omission_pages: omB.map((s) => ({ slug: s.slug, cer_before: s.metric.cer, cer_after: get(s.slug, MIN)?.metric?.cer ?? null, len_before: s.metric.len_ratio, len_after: get(s.slug, MIN)?.metric?.len_ratio ?? null, footnotes_appended: fnRow(s.slug)?.footnotes_appended ?? null })),
      pages_with_footnotes_appended: mRows.filter((o) => o.run_id === A.run_id && o.footnotes_appended > 0).length };
    const BA = json.before_after;
    out.push('\n## 9. Before / after the footnote step (ALL cell, same pages)\n');
    out.push('| | catastrophic | text with CER > 50% | median CER | pooled CER | paired vs lite: MinerU better / lite better | paired median Δ (pp) |\n|---|---|---|---|---|---|---|');
    for (const [k, x] of [['preregistered arm (no footnotes)', BA.before], ['this arm (footnotes appended)', BA.after]]) out.push(`| ${k} | ${pct(x.catastrophic_rate)} | ${x.cer_gt_half} | ${pct(x.median_cer, 2)} | ${pct(x.pooled_cer, 2)} | ${x.mineru_better} / ${x.lite_better} | ${pp(x.paired_median_delta)} |`);
    out.push(`\nPages where the step appended at least one footnote: ${BA.pages_with_footnotes_appended} of ${mRows.filter((o) => o.run_id === A.run_id).length}.\n`);
    out.push('| omission page (preregistered arm) | CER before → after | share of reference words before → after | footnotes appended |\n|---|---|---|---|');
    for (const x of BA.omission_pages) out.push(`| ${x.slug} | ${pct(x.cer_before, 1)} → ${pct(x.cer_after, 1)} | ${pct(x.len_before, 0)} → ${pct(x.len_after, 0)} | ${x.footnotes_appended ?? '–'} |`);
  }
  const base = F(`${A.suffix}-arm-${argEq('--date', new Date().toISOString().slice(0, 10))}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(json, null, 2) + '\n');
  fs.writeFileSync(`${base}.md`, out.join('\n') + '\n');
  console.log(out.join('\n'));
}

// withMongo kills a script after 300 s by default; the Wikisource and Gutenberg walks take longer.
const LONG = { timeoutMs: 4 * 3600 * 1000 };
async function main() {
  if (STAGE === 'leafpack') return stageLeafpack();
  if (STAGE === 'report') return stageReport();
  if (STAGE === 'pool') return withMongo(stagePool, LONG);
  if (STAGE === 'draw') return stageDraw();
  if (STAGE === 'gutenberg') return withMongo(stageGutenberg, LONG);
  if (STAGE === 'fetch') return withMongo(stageFetch, LONG);
  if (STAGE === 'redraw') return stageRedraw();
  if (STAGE === 'recut') return stageRecut();
  if (STAGE === 'finalize') return stageFinalize();
  if (STAGE === 'queue') return withMongo(stageQueue, LONG);
  if (STAGE === 'digitpack') return stageDigitpack();
  if (STAGE === 'rescue') return withMongo(stageRescue, LONG);
  if (STAGE === 'ocr' && ARM.local) return stageOcrMineru();
  if (STAGE === 'ocr') return withMongo(stageOcr, LONG);
  if (STAGE === 'score') return stageScore();
  if (STAGE === 'flash-report') return stageFlashReport();
  if (STAGE === 'mineru-report') return stageMineruReport();
  throw new Error(`unknown stage ${STAGE}`);
}
await main();
