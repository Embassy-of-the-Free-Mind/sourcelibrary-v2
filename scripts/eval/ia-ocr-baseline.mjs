#!/usr/bin/env node
/**
 * IA-OCR corpus baseline (#3235 — "IA-OCR corpus baseline" entry in
 * .claude/docs/ocr-memorization-paper.md, priority 2 after the calibration
 * scorecard).
 *
 * Internet Archive publishes its own OCR (ABBYY/Tesseract-class, non-generative
 * — it cannot recite memorized canonical text) for most scans we imported. This
 * harvests that text, page-aligns it against our own `pages.ocr.data` by TEXT
 * MATCHING (never index arithmetic — split-page books map two-of-ours to
 * one-of-IA), and measures word/char agreement by script × century.
 *
 * MUST be scoped by the Tesseract-typography lesson (measured 2026-07-20,
 * scripts/eval/results/tesseract-baseline-2026-07-20.md): a non-generative
 * baseline's competence tracks TYPOGRAPHY, not language — clean on 19th/20th-c
 * roman type, collapses on 16th-c ligatures and CJK. A stratum where IA's OCR
 * comes back empty/garbage is UNMEASURABLE, never evidence of "our OCR is much
 * better" — it just means the control had nothing to compare against.
 *
 * Zero AI cost. Mongo reads + polite HTTP fetches (2s delay, descriptive UA,
 * one retry on 5xx) + local compute only.
 *
 * Stages (run separately so a long fetch can be detached):
 *   node scripts/eval/ia-ocr-baseline.mjs --stage=sample [--total=200]
 *   node scripts/eval/ia-ocr-baseline.mjs --stage=fetch  [--cache-dir=...]
 *   node scripts/eval/ia-ocr-baseline.mjs --stage=score
 *   node scripts/eval/ia-ocr-baseline.mjs --stage=all      (all three, in order)
 *
 * Env: set -a; source .env.production.local; set +a
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { levenshtein } from './lib/metrics.mjs';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.production.local directly if MONGODB_URI isn't already in the
// environment (normal invocation sources it via shell per CLAUDE.md; this is
// a fallback for harnesses where `source` isn't available).
if (!process.env.MONGODB_URI) {
  const candidates = [
    path.join(__dirname, '..', '..', '.env.production.local'),
    '/Users/dereklomas/sourcelibrary/.env.production.local',
  ];
  const envPath = candidates.find(p => fs.existsSync(p));
  if (envPath) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m) continue;
      let val = m[2];
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = val;
    }
  }
}

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
}));
const STAGE = args.stage || 'all';
const DATE = args.date || '2026-07-23';
const TOTAL_CAP = parseInt(args.total || '200');
const OUT_DIR = args['out-dir'] || path.join(__dirname, 'results');
const SCRATCH_DIR = args['cache-dir'] ||
  '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/31e565ee-fb8a-48e9-ba4e-3337437be4fb/scratchpad/ia-cache';
const SAMPLE_SPEC = args['sample-spec'] || path.join(OUT_DIR, `ia-ocr-baseline-sample-spec-${DATE}.json`);
const FETCH_MANIFEST = path.join(SCRATCH_DIR, 'fetch-manifest.json');
const JSONL_OUT = path.join(OUT_DIR, `ia-ocr-baseline-pilot-${DATE}.jsonl`);
const REPORT_OUT = path.join(OUT_DIR, `ia-ocr-baseline-pilot-${DATE}.md`);
const CONTACT_EMAIL = 'derek@sourcelibrary.org';
const USER_AGENT = `SourceLibraryResearch/1.0 (IA-OCR corpus baseline pilot, #3235; contact ${CONTACT_EMAIL})`;
const DELAY_MS = 2000;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SCRATCH_DIR, { recursive: true });

// ── stratified sample spec ─────────────────────────────────────────
// Per-language century bands, chosen to span typography (early modern print
// with ligatures/blackletter vs 19th/20th-c roman type) rather than exhaustively
// covering every available century — the 200-book pilot cap forces a subset.
// Hebrew is pooled across all its centuries (only ~40 IA-linked books total).
// Chinese is the expected-collapse CJK control (Tesseract/ABBYY chi_* is known
// weak on historical woodblock/print regardless of era — see the 2026-07-20
// Tesseract baseline, which excluded Chinese from its subsidy table for the
// same reason).
const STRATA = [
  { language: 'Latin', centuries: [1500], n: 20, label: 'Latin 1500s (early print, ligatures)' },
  { language: 'Latin', centuries: [1800], n: 15, label: 'Latin 1800s (roman type)' },
  { language: 'English', centuries: [1600], n: 15, label: 'English 1600s (early modern)' },
  { language: 'English', centuries: [1900], n: 15, label: 'English 1900s (modern roman)' },
  { language: 'German', centuries: [1600], n: 15, label: 'German 1600s (Fraktur likely)' },
  { language: 'German', centuries: [1900], n: 15, label: 'German 1900s (Fraktur/roman mix)' },
  { language: 'French', centuries: [1600], n: 15, label: 'French 1600s' },
  { language: 'French', centuries: [1800], n: 15, label: 'French 1800s' },
  { language: 'Greek', centuries: [1500], n: 15, label: 'Greek 1500s (polytonic print)' },
  { language: 'Greek', centuries: [1800], n: 15, label: 'Greek 1800s' },
  { language: 'Hebrew', centuries: [1400, 1500, 1600, 1700, 1800, 1900], n: 15, label: 'Hebrew (all centuries, pooled — sparse corpus)' },
  { language: 'Chinese', centuries: [1600], n: 15, label: 'Chinese 1600s — EXPECTED-COLLAPSE control' },
  { language: 'Chinese', centuries: [1800], n: 15, label: 'Chinese 1800s — EXPECTED-COLLAPSE control' },
];

async function stageSample() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const sampled = [];
  const strataReport = [];
  for (const s of STRATA) {
    const filter = {
      // NOTE: two `$ne` keys in one object literal silently collapse to the
      // LAST one in JS (duplicate object keys), which let `ia_identifier: null`
      // books through a first draft of this filter (caught 2026-07-23 when the
      // fetch stage received literal `null` as an identifier). $nin covers both.
      ia_identifier: { $exists: true, $nin: [null, ''] },
      pages_ocr: { $gt: 0 },
      language: s.language,
      year: { $type: 'number' },
      $or: s.centuries.map(c => ({ year: { $gte: c, $lt: c + 100 } })),
    };
    const avail = await books.countDocuments(filter);
    const rows = await books.aggregate([
      { $match: filter },
      { $sample: { size: Math.min(s.n, avail) } },
      { $project: { id: 1, slug: 1, ia_identifier: 1, language: 1, year: 1, pages_count: 1, pages_ocr: 1, script: 1, text_role: 1 } },
    ]).toArray();
    for (const r of rows) {
      sampled.push({
        book_id: r.id,
        slug: r.slug,
        ia_identifier: r.ia_identifier,
        language: r.language,
        year: r.year,
        century: Math.floor(r.year / 100) * 100,
        pages_count: r.pages_count,
        pages_ocr: r.pages_ocr,
        text_role: r.text_role || null,
        stratum: s.label,
      });
    }
    strataReport.push({ stratum: s.label, language: s.language, centuries: s.centuries, target_n: s.n, available: avail, sampled: rows.length });
    console.log(`  ${s.label}: sampled ${rows.length}/${s.n} (available ${avail})`);
  }
  await client.close();

  const spec = {
    date: DATE,
    total_cap: TOTAL_CAP,
    total_sampled: sampled.length,
    note: 'Random $sample per stratum. Extend the full run by adding strata / raising n here, re-running --stage=sample, and diffing book_id against this file to fetch only new books.',
    strata: strataReport,
    books: sampled,
  };
  fs.writeFileSync(SAMPLE_SPEC, JSON.stringify(spec, null, 1));
  console.log(`\nSampled ${sampled.length} books across ${STRATA.length} strata → ${SAMPLE_SPEC}`);
}

// ── fetch stage ─────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

// `_djvu.txt` on modern IA derivatives is a single un-delimited blob (no form-feed
// page breaks — verified 2026-07-23 across Google-Books-derived and IA-native
// scans alike), so it cannot be page-aligned at all. `_djvu.xml` instead, which
// every tested item carries, wraps one <OBJECT>...</OBJECT> per physical scan
// page with a <HIDDENTEXT> word-box tree (or a self-closing <HIDDENTEXT/> for
// blank/textless pages) — exactly the page-indexed structure this pipeline needs,
// with IA's own OCR confidence per word as a bonus diagnostic.
const FETCH_TIMEOUT_MS = 120000; // some djvu.xml derivatives run 30-50MB; a hung
// connection must not stall the whole polite queue indefinitely.
// Multi-volume/composite items can carry a 70MB+ djvu.xml (measured 2026-07-23:
// one item's derivative was 72MB) — fine to align/score, but downloading dozens
// of those would make a "pilot" run for hours on a handful of outliers. Skip by
// declared Content-Length before pulling the body; a big book is still sampled,
// just recorded as unmeasured-for-cost-reasons rather than silently eating the
// whole politeness budget.
const MAX_XML_BYTES = 40 * 1024 * 1024;

async function fetchOne(ia) {
  const url = `https://archive.org/download/${ia}/${ia}_djvu.xml`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 404) return { ok: false, reason: 'no_djvu_xml (404)' };
      if (res.status >= 500) {
        if (attempt === 0) { await sleep(3000); continue; }
        return { ok: false, reason: `server_error_${res.status}_twice` };
      }
      if (!res.ok) return { ok: false, reason: `http_${res.status}` };
      const declaredLen = parseInt(res.headers.get('content-length') || '0', 10);
      if (declaredLen > MAX_XML_BYTES) {
        res.body?.cancel?.();
        return { ok: false, reason: `djvu_xml_too_large_${(declaredLen / 1024 / 1024).toFixed(0)}MB` };
      }
      const text = await res.text();
      if (text.length > MAX_XML_BYTES) return { ok: false, reason: `djvu_xml_too_large_${(text.length / 1024 / 1024).toFixed(0)}MB_undeclared` };
      if (!text || text.trim().length < 20 || !text.includes('<OBJECT')) return { ok: false, reason: 'empty_or_malformed_djvu_xml' };
      return { ok: true, text };
    } catch (e) {
      const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      if (attempt === 0) { await sleep(3000); continue; }
      return { ok: false, reason: isTimeout ? `timeout_after_${FETCH_TIMEOUT_MS}ms_twice` : `fetch_error: ${String(e.message || e).slice(0, 150)}` };
    }
  }
  return { ok: false, reason: 'unreachable' };
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXmlEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const cp = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return XML_ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * Parse a djvu.xml blob into one text string per <OBJECT> (= one physical scan
 * page, 0-based, in document order — blank/textless pages yield an empty
 * string, keeping index alignment with the scan sequence intact).
 */
function parseDjvuXmlPages(xml) {
  const pages = [];
  const objRe = /<OBJECT\b[^>]*>([\s\S]*?)<\/OBJECT>/g;
  let m;
  while ((m = objRe.exec(xml))) {
    const words = [];
    const wordRe = /<WORD\b[^>]*>([^<]*)<\/WORD>/g;
    let w;
    while ((w = wordRe.exec(m[1]))) words.push(decodeXmlEntities(w[1]));
    pages.push(words.join(' '));
  }
  return pages;
}

async function stageFetch() {
  const spec = JSON.parse(fs.readFileSync(SAMPLE_SPEC, 'utf8'));
  let manifest = {};
  if (fs.existsSync(FETCH_MANIFEST)) manifest = JSON.parse(fs.readFileSync(FETCH_MANIFEST, 'utf8'));

  const total = spec.books.length;
  let done = 0, ok = 0, skip = 0;
  for (const b of spec.books) {
    done++;
    if (!b.ia_identifier) {
      manifest['(missing)_' + b.book_id] = { ok: false, reason: 'no_ia_identifier_on_book' };
      skip++;
      continue;
    }
    const cacheFile = path.join(SCRATCH_DIR, `${b.ia_identifier}.xml`);
    if (manifest[b.ia_identifier]?.ok || (manifest[b.ia_identifier] && manifest[b.ia_identifier].ok === false)) {
      // already attempted (success or recorded permanent failure) — skip re-fetch
      if (manifest[b.ia_identifier].ok) ok++; else skip++;
      continue;
    }
    if (fs.existsSync(cacheFile)) {
      manifest[b.ia_identifier] = { ok: true, cached: true };
      ok++;
      continue;
    }
    process.stdout.write(`[${done}/${total}] ${b.ia_identifier} (${b.language} ${b.century}s) ... `);
    const r = await fetchOne(b.ia_identifier);
    if (r.ok) {
      fs.writeFileSync(cacheFile, r.text);
      manifest[b.ia_identifier] = { ok: true, bytes: r.text.length };
      ok++;
      console.log(`OK (${(r.text.length / 1024).toFixed(0)} KB)`);
    } else {
      manifest[b.ia_identifier] = { ok: false, reason: r.reason };
      skip++;
      console.log(`SKIP (${r.reason})`);
    }
    // persist manifest after every book so a killed job resumes cleanly
    fs.writeFileSync(FETCH_MANIFEST, JSON.stringify(manifest, null, 1));
    await sleep(DELAY_MS);
  }
  console.log(`\nFetch complete: ${ok} ok, ${skip} skipped, ${total} total → cache ${SCRATCH_DIR}`);
}

// ── text metrics (local, self-contained — see revision-agreement-corpus.mjs
// for the pattern this follows; not imported directly because that module
// executes main() unconditionally at import time) ──────────────────────────
const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');

const toWords = (s, cap = 800) => deEntity(stripEditorialWrappers(s || ''))
  .toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1).slice(0, cap);

function agreement(a, b, cap = 800) {
  const A = toWords(a, cap), B = toWords(b, cap);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

const toChars = (s, cap = 3000) => [...deEntity(stripEditorialWrappers(s || '')).toLowerCase().replace(/[^\p{L}]/gu, '')].slice(0, cap);
function agreementChar(a, b, cap = 3000) {
  const A = toChars(a, cap), B = toChars(b, cap);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

const SPACELESS_RE = /[\p{Script=Han}\p{Script=Tibetan}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;
function scriptClass(s) {
  const letters = (s || '').replace(/[^\p{L}]/gu, '');
  if (!letters) return 'unknown';
  let n = 0;
  for (const ch of letters.slice(0, 2000)) if (SPACELESS_RE.test(ch)) n++;
  return n / Math.min(letters.length, 2000) > 0.3 ? 'spaceless' : 'spaced';
}

// Degenerate screen (repetition loops): same shape as revision-agreement-corpus.
function repetitionRatio(s) {
  const w = deEntity(stripEditorialWrappers(s || '')).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(x => x.length > 1);
  if (w.length < 120) return null;
  return new Set(w).size / w.length;
}
const DEGENERATE = 0.15;

// Body word count (post-wrapper-strip) — used for the image_only screen (covers,
// plates: near-empty on our side or IA's side means nothing to compare).
function bodyWordCount(s) {
  return deEntity(stripEditorialWrappers(s || '')).replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1).length;
}
const IMAGE_ONLY_MAX = 15;

function entityPaddingFrac(raw) {
  const de = deEntity(raw || '');
  if (!raw || !raw.length) return 0;
  return Math.max(0, (raw.length - de.length)) / raw.length;
}

// Fingerprint for candidate search: cheap word-set Jaccard over the first N
// normalized words of a page. Precomputed once per IA page (whole book), then
// reused for every probe — O(pages) per probe rather than O(pages × 800²).
function fingerprintWords(s, n = 150) {
  return deEntity(s || '').toLowerCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2).slice(0, n);
}
function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// ── alignment ────────────────────────────────────────────────────────
/**
 * Align our OCR'd pages against IA's djvu.xml, parsed into one string per
 * physical scan page (see `parseDjvuXmlPages`) — index = 0-based physical-scan
 * position (blank/textless pages yield an empty string, keeping indices meaningful).
 * `ourPages` = our pages sorted by page_number, each with substantial OCR text.
 * Returns { aligned: bool, reason, scale, intercept, probeDebug } — never trusts
 * index arithmetic; the offset/scale is DISCOVERED by matching probe text
 * against IA page text, then verified for consistency across probes.
 */
function alignBook(ourPages, iaPages) {
  if (ourPages.length < 5) return { aligned: false, reason: 'fewer_than_5_ocr_pages' };
  if (iaPages.length < 3) return { aligned: false, reason: 'ia_text_too_short_or_no_pages' };

  const iaFingerprints = iaPages.map(p => new Set(fingerprintWords(p)));

  // The regression axis is `page_number` (our own physical page position), NOT
  // array rank. Many sampled books have partial OCR coverage (e.g. 25 of 462
  // pages processed) — if coverage is non-contiguous, rank-in-array drifts
  // arbitrarily far from physical position and manufactures a false scale
  // mismatch even when every page-for-page correspondence is exactly 1:1.
  // page_number is still only an AXIS to place discovered matches on — the
  // actual ia_index for each probe comes from TEXT MATCHING below, never
  // assumed from page_number arithmetic directly.
  const fracs = [0.1, 0.3, 0.5, 0.7, 0.9];
  const probes = [];
  for (const f of fracs) {
    let rank = Math.min(ourPages.length - 1, Math.max(0, Math.round(f * (ourPages.length - 1))));
    // nudge to nearest page with enough usable text (after wrapper/preamble strip)
    let found = -1;
    for (let d = 0; d < ourPages.length; d++) {
      for (const cand of [rank + d, rank - d]) {
        if (cand < 0 || cand >= ourPages.length) continue;
        const cleaned = stripEditorialWrappers(ourPages[cand].text || '');
        if (cleaned.replace(/\s+/g, ' ').trim().length >= 150) { found = cand; break; }
      }
      if (found >= 0) break;
    }
    if (found >= 0 && !probes.some(p => p.rank === found)) {
      probes.push({ rank: found, pos: ourPages[found].page_number, frac: f });
    }
  }
  if (probes.length < 3) return { aligned: false, reason: 'insufficient_probe_text' };

  const probeDebug = [];
  for (const probe of probes) {
    const ourText = ourPages[probe.rank].text;
    const probeSet = new Set(fingerprintWords(ourText));
    if (probeSet.size < 5) { probeDebug.push({ ...probe, matched: false, reason: 'probe_fingerprint_too_small' }); continue; }
    // candidate search via cheap Jaccard, refine top-K with real agreement()
    const scored = iaFingerprints.map((fp, idx) => ({ idx, jac: jaccard(probeSet, fp) }));
    scored.sort((a, b) => b.jac - a.jac);
    const top = scored.slice(0, 6).filter(c => c.jac > 0);
    if (!top.length) { probeDebug.push({ ...probe, matched: false, reason: 'no_jaccard_candidates' }); continue; }
    let best = null;
    for (const c of top) {
      const a = agreement(ourText, iaPages[c.idx], 300);
      if (a != null && (!best || a > best.score)) best = { idx: c.idx, score: a, jac: c.jac };
    }
    if (!best || best.score < 0.08) {
      probeDebug.push({ ...probe, matched: false, reason: 'below_match_threshold', best });
      continue;
    }
    probeDebug.push({ ...probe, matched: true, ia_index: best.idx, score: +best.score.toFixed(3) });
  }

  const matched = probeDebug.filter(p => p.matched);
  if (matched.length < 3) {
    return { aligned: false, reason: `only_${matched.length}_of_${probes.length}_probes_matched`, probeDebug };
  }
  if (matched.some(p => typeof p.pos !== 'number')) {
    return { aligned: false, reason: 'missing_page_number_on_matched_probe', probeDebug };
  }

  // pairwise slopes between matched probes, ordered by physical position
  matched.sort((a, b) => a.pos - b.pos);
  const slopes = [];
  for (let i = 1; i < matched.length; i++) {
    const dPos = matched[i].pos - matched[i - 1].pos;
    const dIA = matched[i].ia_index - matched[i - 1].ia_index;
    if (dPos === 0) continue;
    slopes.push(dIA / dPos);
  }
  if (!slopes.length) return { aligned: false, reason: 'degenerate_positions', probeDebug };

  const CANDIDATES = [1, 0.5, 2];
  let bestScale = null, bestErr = Infinity;
  for (const s of CANDIDATES) {
    const err = slopes.reduce((sum, sl) => sum + Math.abs(sl - s), 0) / slopes.length;
    if (err < bestErr) { bestErr = err; bestScale = s; }
  }
  // tolerance scaled to the candidate itself (±35%) — split-page books are the
  // most common non-1:1 case (2-of-ours → 1-of-IA)
  if (bestErr > bestScale * 0.35 + 0.15) {
    return { aligned: false, reason: 'inconsistent_offsets_across_probes', slopes, probeDebug };
  }

  // intercept: average across matched probes given the chosen scale
  const intercepts = matched.map(p => p.ia_index - bestScale * p.pos);
  const intercept = intercepts.reduce((a, b) => a + b, 0) / intercepts.length;

  return { aligned: true, scale: bestScale, intercept, probeDebug, matchedProbes: matched.length, totalProbes: probes.length };
}

async function stageScore() {
  const spec = JSON.parse(fs.readFileSync(SAMPLE_SPEC, 'utf8'));
  const manifest = fs.existsSync(FETCH_MANIFEST) ? JSON.parse(fs.readFileSync(FETCH_MANIFEST, 'utf8')) : {};

  let client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  let pagesCol = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
  // Atlas drops long-idle connections during the compute-heavy per-book scoring
  // (ECONNRESET killed two full runs) — retry each book's read on a fresh client.
  const findPagesWithRetry = async (query, options) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await pagesCol.find(query, options).sort({ page_number: 1 }).toArray();
      } catch (e) {
        if (attempt >= 3) throw e;
        console.log(`  ! mongo read failed (${e.code || e.message.slice(0, 40)}), reconnecting (attempt ${attempt})`);
        try { await client.close(); } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 2000 * attempt));
        client = new MongoClient(process.env.MONGODB_URI);
        await client.connect();
        pagesCol = client.db(process.env.MONGODB_DB || 'bookstore').collection('pages');
      }
    }
  };

  const out = fs.createWriteStream(JSONL_OUT, { flags: 'w' });
  const bookOutcomes = []; // per-book: stratum, aligned/unalignable/skipped + reason
  const strataAgg = new Map(); // `${scriptClass}|${century}` -> {n, wordSum, charSum, charN}
  let pageRows = 0;

  for (const b of spec.books) {
    const m = manifest[b.ia_identifier];
    if (!m || !m.ok) {
      bookOutcomes.push({ ...b, status: 'skipped', reason: m?.reason || 'not_fetched' });
      continue;
    }
    const cacheFile = path.join(SCRATCH_DIR, `${b.ia_identifier}.xml`);
    if (!fs.existsSync(cacheFile)) {
      bookOutcomes.push({ ...b, status: 'skipped', reason: 'cache_file_missing' });
      continue;
    }
    const iaRaw = fs.readFileSync(cacheFile, 'utf8');
    const iaPages = parseDjvuXmlPages(iaRaw);

    const ourPagesDocs = await findPagesWithRetry(
      { book_id: b.book_id, 'ocr.data': { $type: 'string', $ne: '' } },
      { projection: { id: 1, page_number: 1, 'ocr.data': 1 } },
    );
    const ourPages = ourPagesDocs
      .map(p => ({ id: p.id, page_number: p.page_number, text: p.ocr.data }))
      .filter(p => stripEditorialWrappers(p.text).replace(/\s+/g, ' ').trim().length >= 80);

    const alignResult = alignBook(ourPages, iaPages);
    if (!alignResult.aligned) {
      bookOutcomes.push({ ...b, status: 'unalignable', reason: alignResult.reason, debug: alignResult.probeDebug || null });
      continue;
    }

    // up to 20 evenly-spaced pages across the whole eligible sequence, mapped
    // via the discovered (scale, intercept), each re-verified rather than
    // trusted blind
    const N = Math.min(20, ourPages.length);
    const idxs = new Set();
    for (let i = 0; i < N; i++) idxs.add(Math.round(i * (ourPages.length - 1) / Math.max(1, N - 1)));

    let scored = 0;
    for (const rank of idxs) {
      const our = ourPages[rank];
      if (typeof our.page_number !== 'number') continue;
      const predictedIdx = Math.round(alignResult.scale * our.page_number + alignResult.intercept);
      if (predictedIdx < 0 || predictedIdx >= iaPages.length) continue;

      // LOCAL REFINEMENT: the book-level (scale, intercept) is a global fit
      // across 3-5 probes; a single inserted plate/blank leaf between two
      // probes shifts the true offset by ±1-2 pages locally without breaking
      // the global fit. Re-verify by TEXT MATCHING within a small window
      // around the prediction rather than trusting the linear formula blind —
      // this is the same "align by matching, not arithmetic" rule applied per
      // page instead of just at the 5 probe points. Window kept small (±3)
      // so cost stays O(pages_scored × 7), not O(pages_scored × book length).
      const ourCleanForSearch = stripEditorialWrappers(our.text);
      let bestIdx = predictedIdx, bestScore = -1;
      for (let d = -3; d <= 3; d++) {
        const cand = predictedIdx + d;
        if (cand < 0 || cand >= iaPages.length) continue;
        const a = agreement(ourCleanForSearch, iaPages[cand], 400);
        if (a != null && a > bestScore) { bestScore = a; bestIdx = cand; }
      }
      const iaText = iaPages[bestIdx];

      const ourClean = stripEditorialWrappers(our.text);
      const iaClean = stripEditorialWrappers(iaText);
      const cls = scriptClass(ourClean) === 'unknown' ? scriptClass(iaClean) : scriptClass(ourClean);

      const ourBody = bodyWordCount(our.text);
      const iaBody = bodyWordCount(iaText);
      const ourRep = repetitionRatio(our.text);
      const iaRep = repetitionRatio(iaText);
      const screens = [];
      if (ourBody < IMAGE_ONLY_MAX && iaBody < IMAGE_ONLY_MAX) screens.push('image_only_both');
      else if (ourBody < IMAGE_ONLY_MAX) screens.push('our_image_only');
      else if (iaBody < IMAGE_ONLY_MAX) screens.push('ia_image_only');
      if (ourRep != null && ourRep < DEGENERATE) screens.push('our_degenerate_repetition');
      if (iaRep != null && iaRep < DEGENERATE) screens.push('ia_degenerate_repetition');
      if (entityPaddingFrac(our.text) > 0.3) screens.push('our_entity_padding');
      if (entityPaddingFrac(iaText) > 0.3) screens.push('ia_entity_padding');

      const wordAgr = agreement(ourClean, iaClean, 800);
      const charAgr = agreementChar(ourClean, iaClean, 3000);
      const primary = cls === 'spaceless' ? charAgr : wordAgr;

      const row = {
        book_id: b.book_id,
        book_slug: b.slug,
        ia_identifier: b.ia_identifier,
        language: b.language,
        year: b.year,
        century: b.century,
        stratum: b.stratum,
        page_number: our.page_number,
        page_id: our.id,
        ia_page_index: bestIdx,
        ia_page_index_predicted: predictedIdx,
        local_refinement_shift: bestIdx - predictedIdx,
        script_class: cls,
        agreement_word: wordAgr == null ? null : +wordAgr.toFixed(4),
        agreement_char: charAgr == null ? null : +charAgr.toFixed(4),
        agreement_primary: primary == null ? null : +primary.toFixed(4),
        our_len: our.text.length,
        ia_len: iaText.length,
        our_body_words: ourBody,
        ia_body_words: iaBody,
        screens_tripped: screens,
      };
      out.write(JSON.stringify(row) + '\n');
      pageRows++;

      if (!screens.length && primary != null) {
        const key = `${cls}|${b.language}|${b.century}s`;
        if (!strataAgg.has(key)) strataAgg.set(key, { n: 0, sum: 0, script: cls, language: b.language, century: b.century });
        const agg = strataAgg.get(key);
        agg.n++; agg.sum += primary;
      }
      scored++;
    }

    bookOutcomes.push({
      ...b, status: 'aligned', scale: alignResult.scale, intercept: +alignResult.intercept.toFixed(2),
      matched_probes: alignResult.matchedProbes, total_probes: alignResult.totalProbes, pages_scored: scored,
    });
  }

  await new Promise(r => out.end(r));
  await client.close();

  // ── book-count summary per stratum ──────────────────────────────
  const byStratum = new Map();
  for (const b of bookOutcomes) {
    if (!byStratum.has(b.stratum)) byStratum.set(b.stratum, { aligned: 0, unalignable: 0, skipped: 0, reasons: {} });
    const s = byStratum.get(b.stratum);
    s[b.status] = (s[b.status] || 0) + 1;
    if (b.status !== 'aligned') s.reasons[b.reason] = (s.reasons[b.reason] || 0) + 1;
  }

  const scriptCenturyTable = [...strataAgg.values()]
    .map(a => ({ ...a, mean_agreement: a.sum / a.n }))
    .sort((a, b) => a.script.localeCompare(b.script) || a.century - b.century);

  const summary = {
    date: DATE,
    books_total: spec.books.length,
    books_aligned: bookOutcomes.filter(b => b.status === 'aligned').length,
    books_unalignable: bookOutcomes.filter(b => b.status === 'unalignable').length,
    books_skipped: bookOutcomes.filter(b => b.status === 'skipped').length,
    page_rows: pageRows,
    by_stratum: Object.fromEntries(byStratum),
    script_century_agreement: scriptCenturyTable,
  };
  fs.writeFileSync(path.join(OUT_DIR, `ia-ocr-baseline-pilot-${DATE}.json`), JSON.stringify({ summary, book_outcomes: bookOutcomes }, null, 1));

  writeReport(summary, bookOutcomes, spec);
  console.log(`\nAligned ${summary.books_aligned}/${summary.books_total} books, ${pageRows} page rows → ${JSONL_OUT}`);
  console.log(`Report → ${REPORT_OUT}`);
}

function writeReport(summary, bookOutcomes, spec) {
  const skipReasonCounts = {};
  for (const b of bookOutcomes) if (b.status !== 'aligned') skipReasonCounts[b.reason] = (skipReasonCounts[b.reason] || 0) + 1;
  const topSkipReasons = Object.entries(skipReasonCounts).sort((a, b) => b[1] - a[1]);

  const CJK_STRATA = new Set(Object.keys(summary.by_stratum).filter(k => k.startsWith('Chinese')));

  const md = [];
  md.push(`# IA-OCR corpus baseline — pilot (${DATE})`, '');
  md.push(`Internet Archive's own OCR (ABBYY/Tesseract-class, non-generative — it cannot`);
  md.push(`recite memorized canonical text) fetched for the same scans we hold, page-aligned`);
  md.push(`by TEXT MATCHING against our \`pages.ocr.data\`, and scored for word/char agreement`);
  md.push(`by script × century. Zero AI cost: Mongo reads + polite HTTP fetches + local`);
  md.push(`compute only. Script: \`scripts/eval/ia-ocr-baseline.mjs\`. Sample spec:`);
  md.push(`\`${path.basename(SAMPLE_SPEC)}\`. Rows: \`${path.basename(JSONL_OUT)}\`.`, '');

  md.push('## Interpretation — read this before the table', '');
  md.push('Where IA is competent (clean 19th/20th-c roman type), ours-vs-IA disagreement is an');
  md.push('**upper bound on combined error** — IA is an INDEPENDENT, non-generative reading a');
  md.push('skeptical outsider can reproduce themselves from a public archive.org URL, with no');
  md.push('memorization channel. **Agreement is not accuracy** — a page where both sides mis-');
  md.push('transcribe the same word in the same way still "agrees"; a page where our OCR is');
  md.push('correct and IA garbles a ligature "disagrees" while our text is fine. Treat this');
  md.push('table as a bound and a corroboration signal, not a scorecard.', '');
  md.push('Where the baseline COLLAPSES (empty/near-empty/garbage IA text — expected on 16th-c');
  md.push('ligatures and on CJK per the 2026-07-20 Tesseract-typography finding), the resulting');
  md.push('low agreement or high unalignable rate is **UNMEASURABLE, not evidence our OCR is');
  md.push('better**. Those strata are called out explicitly below.', '');

  md.push('## Book counts', '');
  md.push(`- sampled: **${summary.books_total}**`);
  md.push(`- aligned (probes matched, scored): **${summary.books_aligned}**`);
  md.push(`- unalignable (fetched OK, page-align failed): **${summary.books_unalignable}**`);
  md.push(`- skipped (never fetched — no djvu.txt, HTTP error, etc.): **${summary.books_skipped}**`);
  md.push(`- page rows scored: **${summary.page_rows}**`, '');

  md.push('### Top skip/unalignable reasons', '');
  md.push('| reason | books |', '|---|---:|');
  for (const [reason, n] of topSkipReasons.slice(0, 15)) md.push(`| ${reason} | ${n} |`);
  md.push('');

  md.push('### Per-stratum book outcomes', '');
  md.push('| stratum | aligned | unalignable | skipped | top reason |', '|---|---:|---:|---:|---|');
  for (const [stratum, s] of Object.entries(summary.by_stratum)) {
    const top = Object.entries(s.reasons).sort((a, b) => b[1] - a[1])[0];
    const flag = CJK_STRATA.has(stratum) ? ' **[EXPECTED-COLLAPSE CONTROL]**' : '';
    md.push(`| ${stratum}${flag} | ${s.aligned || 0} | ${s.unalignable || 0} | ${s.skipped || 0} | ${top ? `${top[0]} (${top[1]})` : '—'} |`);
  }
  md.push('');

  md.push('## Script × century agreement (ours vs IA)', '');
  md.push('Only pages with **no screens tripped** on either side (not image-only, not');
  md.push('degenerate/repetition-looping, not entity-padded) enter this table — see the JSONL');
  md.push('for the full row-level detail including screened-out pages.', '');
  md.push('| script class | language | century | n pages | mean agreement |', '|---|---|---:|---:|---:|');
  for (const r of summary.script_century_agreement) {
    const collapseFlag = r.language === 'Chinese' ? ' ⚠ UNMEASURABLE (expected baseline collapse)' : '';
    md.push(`| ${r.script} | ${r.language} | ${r.century}s | ${r.n} | ${(r.mean_agreement * 100).toFixed(1)}%${collapseFlag} |`);
  }
  if (!summary.script_century_agreement.length) md.push('| _(no scoreable page pairs — see book counts above)_ | | | | |');
  md.push('');

  md.push('## What the full run needs', '');
  md.push('- **Extend the sample spec, don\'t restart it.** `--stage=sample` re-samples fresh');
  md.push('  random books per stratum; to grow the corpus, raise each stratum\'s `n` in');
  md.push('  `STRATA` (or add new language/century strata) and diff `book_id` against the');
  md.push(`  existing \`${path.basename(SAMPLE_SPEC)}\` so already-fetched books aren't re-downloaded.`);
  md.push('- **Download time dominates wall-clock more than the 2s politeness delay.**');
  md.push('  `_djvu.xml` (word-boxed, page-indexed — see script header) runs 1-40MB per book');
  md.push('  in this sample, some derivatives well over that for multi-volume works; a 200-book');
  md.push('  pilot took on the order of an hour. Run fetch detached (nohup) with the manifest\'s');
  md.push('  resume-on-restart behavior — a killed job loses nothing already cached — and budget');
  md.push('  proportionally more wall-clock (not more request volume) for a multi-thousand-book run.');
  md.push('- **CJK and pre-1500 strata need a different instrument, not more IA fetches.**');
  md.push('  If IA\'s OCR is structurally near-empty on those pages, no amount of additional');
  md.push('  sampling produces a measurement — see the degradation/occlusion pilot and the');
  md.push('  within-work canonicity pairs in the paper doc for how those get evidence instead.');
  md.push('- **Consider Kraken for the CJK/manuscript gap.** Kraken has historical-script');
  md.push('  models and might not collapse the way IA\'s engine does — worth a small side-check');
  md.push('  before concluding those strata are unmeasurable corpus-wide.');
  md.push('- **hOCR instead of djvu.txt** would carry per-word bounding boxes, enabling a');
  md.push('  region-level (not just page-level) agreement check — deferred for the pilot.');
  md.push('');

  fs.writeFileSync(REPORT_OUT, md.join('\n'));
}

async function main() {
  if (STAGE === 'sample' || STAGE === 'all') { console.log('== stage: sample =='); await stageSample(); }
  if (STAGE === 'fetch' || STAGE === 'all') { console.log('\n== stage: fetch =='); await stageFetch(); }
  if (STAGE === 'score' || STAGE === 'all') { console.log('\n== stage: score =='); await stageScore(); }
}

main().catch(e => { console.error(e); process.exit(1); });
