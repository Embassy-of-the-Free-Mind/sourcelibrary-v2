#!/usr/bin/env node
/**
 * Phase 0 of issue #3308: mechanical, corpus-scale, $0 measurement of
 * <note> annotation quality. Pure Mongo reads + string matching — NO model
 * calls, NO writes to any database.
 *
 * What it measures (see #3308 for full context):
 *  1. Original-phrase fidelity — for `<note>original: "X"</note>` spans,
 *     does X actually appear (verbatim or near-verbatim) in the SAME page's
 *     ocr.data? This is the fabrication-rate headline for the largest note
 *     class (~31-39% of all notes per sampling).
 *  2. Adjacent-page reference rate — regex family ("previous page",
 *     "continues from", ...) over ALL note spans, the quote-integrity hazard
 *     named in CLAUDE.md's Quote & snippet integrity section.
 *  3. Structural compliance — nested <note>, unbalanced open/close tags,
 *     multi-paragraph notes — mirrors the #3298 baseline (0.4% / 0.8% / 3.7%).
 *  4. Class split (original-phrase / image-desc / explanation / other) to
 *     build the Phase 1 stratified sampling frame.
 *
 * Every count is stratified by translation.model x translation.prompt_version
 * x book.language x century(book.year). Missing values bucket as "unknown".
 *
 * SCALE NOTE: pages has ~19.1M documents and translation.data carries no
 * text index, so a full COLLSCAN with a $regex filter is not viable in a
 * single session. This script instead draws a large random subset via
 * MongoDB's $sample aggregation stage (a pseudo-random storage-engine walk,
 * NOT a COLLSCAN — fast even at this collection size) as the FIRST pipeline
 * stage, then filters/projects only the sampled documents. This is the
 * "random-but-deterministic subset" the issue allows as a Phase-0 fallback:
 * not deterministic by a hash predicate (that would still require a full
 * scan to evaluate), but every sampled page_id is persisted in the output
 * JSONL, so the exact population of THIS run is fully reproducible/auditable
 * even though re-running draws a fresh random sample.
 *
 * Usage:
 *   MONGODB_URI=... node scripts/analysis/note-quality-phase0.mjs
 * Env overrides:
 *   PHASE0_SAMPLE_SIZE  - pages to draw via $sample before filtering (default 250000)
 *   PHASE0_OUT_DIR      - output directory (default scratchpad path below)
 */

import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

const SAMPLE_SIZE = Number(process.env.PHASE0_SAMPLE_SIZE || 250000);
const OUT_DIR =
  process.env.PHASE0_OUT_DIR ||
  '/private/tmp/claude-501/-Users-dereklomas-sourcelibrary/84edbaac-64b7-4a41-9a1e-8b42eb820a0c/scratchpad/note-quality-phase0';
fs.mkdirSync(OUT_DIR, { recursive: true });
const JSONL_PATH = path.join(OUT_DIR, 'notes.jsonl');
const AGG_PATH = path.join(OUT_DIR, 'aggregates.json');
const PROGRESS_LOG = path.join(OUT_DIR, 'progress.log');
const PARTIAL_PATH = path.join(OUT_DIR, 'notes.partial.jsonl');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(PROGRESS_LOG, line + '\n');
}

// ---------------------------------------------------------------------------
// Normalization + fuzzy matching
// ---------------------------------------------------------------------------

const LIGATURES = [
  [/æ/gi, 'ae'],
  [/œ/gi, 'oe'],
  [/ﬁ/g, 'fi'],
  [/ﬂ/g, 'fl'],
  [/ﬀ/g, 'ff'],
  [/ﬃ/g, 'ffi'],
  [/ﬄ/g, 'ffl'],
  [/ĳ/gi, 'ij'],
];

/**
 * Lowercase, fold long-s/ligatures/diacritics, strip punctuation, collapse
 * whitespace. Also folds classical u/v and i/j (early modern printers used
 * these interchangeably — "Judicio"/"Iudicio", "vt"/"ut") since it's applied
 * IDENTICALLY to both the note phrase and the page OCR text, so it can only
 * reduce false MISS verdicts caused by orthographic variance, never inflate
 * false matches. This addition goes beyond the base normalization list
 * because the issue's own 2026-07-22 preliminary run (see #3308 comments)
 * found it necessary to get real fabrication signal out of the 17-20% "not
 * found" residue — without it this pass over-reports fabrication by ~10pp
 * on Latin/German strata (measured: 27.9% -> ~18% strict fabrication after
 * adding the fold, on an 8K-page dry run).
 */
function normalizeForMatch(s) {
  if (!s) return '';
  let out = s.replace(/ſ/g, 's');
  for (const [re, rep] of LIGATURES) out = out.replace(re, rep);
  out = out.toLowerCase();
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  out = out.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  out = out.replace(/j/g, 'i').replace(/v/g, 'u');
  out = out.replace(/\s+/g, ' ').trim();
  return out;
}

function bigrams(s) {
  const b = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    b.set(g, (b.get(g) || 0) + 1);
  }
  return b;
}

function diceSim(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, countA] of A) {
    const countB = B.get(g);
    if (countB) inter += Math.min(countA, countB);
  }
  let totalA = 0,
    totalB = 0;
  for (const c of A.values()) totalA += c;
  for (const c of B.values()) totalB += c;
  return (2 * inter) / (totalA + totalB);
}

// Cap how much OCR text we scan for the sliding window (perf guard against
// pathologically long pages) — Phase 0 is a heuristic first pass, not the
// final verdict (Phase 2 judges do the real accuracy check).
const OCR_SCAN_CAP = 4000;

/** Best-effort fuzzy substring search: bigram-Dice over windows of len(phrase) +/- 20%. */
function slidingWindowBestMatch(normOcr, normPhrase) {
  const L = normPhrase.length;
  if (L === 0 || normOcr.length === 0) return 0;
  const hay = normOcr.length > OCR_SCAN_CAP ? normOcr.slice(0, OCR_SCAN_CAP) : normOcr;
  const minLen = Math.max(2, Math.floor(L * 0.8));
  const maxLen = Math.max(minLen, Math.ceil(L * 1.2));
  const lenStep = Math.max(1, Math.round((maxLen - minLen) / 2));
  const posStep = Math.max(2, Math.round(L / 4));
  let best = 0;
  for (let start = 0; start < hay.length; start += posStep) {
    for (let len = minLen; len <= maxLen; len += lenStep) {
      const end = start + len;
      if (end > hay.length) break;
      const sim = diceSim(hay.slice(start, end), normPhrase);
      if (sim > best) best = sim;
      if (best >= 0.999) return best;
    }
  }
  return best;
}

const FUZZY_THRESHOLD = 0.85;
const OCR_SHORT_THRESHOLD = 20; // normalized chars

// Non-Latin script blocks seen in the corpus (Sanskrit/Hindi -> Devanagari,
// Tibetan, Chinese/Japanese -> Han+Kana, Hebrew, Arabic, Greek). Character-
// level normalization (long-s/ligatures/diacritics/u-v-i-j folding) can never
// bridge a script boundary: a Latin-alphabet ROMANIZATION in the note's
// original: slot cannot substring-match Devanagari/Tibetan/CJK/Hebrew/Arabic
// glyphs no matter how it's normalized. This is "cause 1" (transliteration
// mismatch) from the issue's own 2026-07-22 preliminary comment — flagged
// here so it doesn't inflate the candidate-fabrication headline.
const NON_LATIN_SCRIPT_RE =
  /[\p{Script=Devanagari}\p{Script=Tibetan}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hebrew}\p{Script=Arabic}\p{Script=Greek}\p{Script=Tamil}\p{Script=Bengali}\p{Script=Gujarati}\p{Script=Gurmukhi}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Oriya}\p{Script=Telugu}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Lao}\p{Script=Armenian}\p{Script=Georgian}]/gu;

/** Is the page's OCR predominantly non-Latin-script while the quoted phrase is predominantly Latin letters? */
function isScriptMismatch(rawOcrText, rawPhrase) {
  if (!rawOcrText || !rawPhrase) return false;
  const ocrLetters = rawOcrText.match(/\p{L}/gu) || [];
  if (ocrLetters.length < 20) return false;
  const ocrNonLatin = rawOcrText.match(NON_LATIN_SCRIPT_RE) || [];
  if (ocrNonLatin.length / ocrLetters.length < 0.3) return false;
  const phraseLetters = rawPhrase.match(/\p{L}/gu) || [];
  if (phraseLetters.length === 0) return false;
  const phraseLatin = rawPhrase.match(/[a-zA-Z]/g) || [];
  return phraseLatin.length / phraseLetters.length > 0.6;
}

/** Score a normalized quoted/extracted phrase against the page's normalized OCR text. */
function scorePhraseAgainstOcr(normPhrase, normOcr, rawOcrText, rawPhrase) {
  if (!normPhrase) return { verdict: 'unscoreable', similarity: null };
  if (normOcr.length < OCR_SHORT_THRESHOLD) return { verdict: 'miss_empty_ocr', similarity: 0 };
  if (normOcr.includes(normPhrase)) return { verdict: 'match', similarity: 1 };
  const sim = slidingWindowBestMatch(normOcr, normPhrase);
  if (sim >= FUZZY_THRESHOLD) return { verdict: 'fuzzy_match', similarity: Number(sim.toFixed(3)) };
  if (isScriptMismatch(rawOcrText, rawPhrase)) return { verdict: 'miss_script_mismatch', similarity: Number(sim.toFixed(3)) };
  return { verdict: 'miss', similarity: Number(sim.toFixed(3)) };
}

// ---------------------------------------------------------------------------
// Note extraction / classification
// ---------------------------------------------------------------------------

const NOTE_RE = /<note>([\s\S]*?)<\/note>/gi;

// Real-corpus prefix variants (30K-page probe, 2026-07-22): "original:"
// (99.7%), "original symbol:" (0.3%), "original text:" (rare). Allow an
// optional single word ("symbol"/"phrase"/"text"/…) between "original" and
// the colon so those variants still classify + extract correctly.
const ORIGINAL_PREFIX_RE = /^\s*original[a-z]*\.?\s*(?:[a-z]+\s*)?:\s*/i;

/**
 * Extract the quoted/wrapped source phrase from an `original: ...` note.
 * Handles: straight/curly quotes, markdown emphasis wraps (single or double
 * asterisk), <term> tags, and a bounded fallback for bare (unwrapped)
 * phrases. Real-corpus sample (n=30K pages) showed 90.3% of `original:`
 * notes are quoted; the rest are markdown/<term>-wrapped or bare tokens.
 */
function extractOriginalPhrase(noteText) {
  const prefixMatch = noteText.match(ORIGINAL_PREFIX_RE);
  if (!prefixMatch) return null;
  const rest = noteText.slice(prefixMatch[0].length);

  let m = rest.match(/^["“”]([^"“”]+)["“”]/);
  if (m) return { phrase: m[1], wrap: 'quoted' };

  m = rest.match(/^'([^']+)'/);
  if (m) return { phrase: m[1], wrap: 'quoted' };

  m = rest.match(/^\*{1,2}([^*]+)\*{1,2}/);
  if (m) return { phrase: m[1], wrap: 'markdown' };

  m = rest.match(/^<term>([^<]+)<\/term>/i);
  if (m) return { phrase: m[1], wrap: 'term-tag' };

  m = rest.match(/^([^;()\n]{1,120})/);
  if (m && m[1].trim()) return { phrase: m[1].trim(), wrap: 'unwrapped' };

  return null;
}

const IMAGE_DESC_RE =
  /^\s*(image|illustration|woodcut|engraving|initial|drop-?cap|printer'?s device|diagram|figure|plate|illuminated|decorative)\b/i;
const EXPLANATION_RE = /\b(was a|refers? to|is a|is an|were the|is the)\b/i;
const PROPER_NOUN_HINT_RE = /[A-Z][a-z]{2,}/;

/**
 * Rough class assignment for the Phase 1 sampling frame. Not meant to be
 * exact — "Rough is fine" per the issue; Phase 2 judges do real semantic
 * classification. Order matters: original-phrase check first (most specific
 * prefix match), then image-desc / explanation heuristics, else "other".
 */
function classifyNote(noteText) {
  const trimmed = noteText.trim();
  if (ORIGINAL_PREFIX_RE.test(trimmed)) return 'original-phrase';
  if (IMAGE_DESC_RE.test(trimmed)) return 'image-desc';
  if (EXPLANATION_RE.test(trimmed) && PROPER_NOUN_HINT_RE.test(trimmed)) return 'explanation';
  return 'interpolation-other';
}

const ADJACENT_PATTERNS = [
  ['previous page', /previous page/i],
  ['preceding page', /preceding page/i],
  ['next page', /next page/i],
  ['following page', /following page/i],
  ['continues from', /continues from/i],
  ['continued on', /continued on/i],
  ['identified on', /identified on/i],
  ['see page', /see page/i],
  ['earlier page', /earlier page/i],
  ['prior page', /prior page/i],
];

function matchAdjacentFamilies(noteText) {
  const hits = [];
  for (const [name, re] of ADJACENT_PATTERNS) {
    if (re.test(noteText)) hits.push(name);
  }
  return hits;
}

function centuryBucket(year) {
  if (!year || typeof year !== 'number' || year < 500 || year > 2100) return 'unknown';
  return `${Math.floor((year - 1) / 100) + 1}th`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function strataKey(r) {
  return JSON.stringify({ model: r.model, prompt_version: r.prompt_version, language: r.language, century: r.century });
}

function computeAggregates(records, corpus) {
  const overall = {
    pages_sampled: corpus.pagesSampled,
    pages_with_notes: corpus.pagesWithNotes,
    notes_total: records.length,
    distinct_books: corpus.distinctBooks,
  };

  // --- class distribution ---
  const classCounts = {};
  for (const r of records) classCounts[r.note_class] = (classCounts[r.note_class] || 0) + 1;

  // --- original-phrase fidelity: STRICT (quoted only) + ALL wraps ---
  // n_scoreable/fabrication_rate exclude BOTH miss_empty_ocr (no OCR to check
  // against) and miss_script_mismatch (Latin-alphabet romanization quoted
  // against non-Latin-script OCR — normalization can't bridge a script
  // boundary, so it's never evidence of fabrication; see #3308 preliminary
  // comment). Both are still counted and reported so the residue composition
  // is visible, not just the denominator.
  function fidelityBucket(filterFn) {
    const relevant = records.filter(filterFn);
    const scoreable = relevant.filter(
      r => r.match_verdict && !['unscoreable', 'miss_empty_ocr', 'miss_script_mismatch'].includes(r.match_verdict)
    );
    const emptyOcr = relevant.filter(r => r.match_verdict === 'miss_empty_ocr').length;
    const scriptMismatch = relevant.filter(r => r.match_verdict === 'miss_script_mismatch').length;
    const match = scoreable.filter(r => r.match_verdict === 'match').length;
    const fuzzy = scoreable.filter(r => r.match_verdict === 'fuzzy_match').length;
    const miss = scoreable.filter(r => r.match_verdict === 'miss').length;
    const denom = scoreable.length || 1;
    return {
      n_notes: relevant.length,
      n_scoreable: scoreable.length,
      n_empty_or_short_ocr: emptyOcr,
      n_script_mismatch: scriptMismatch,
      exact_match: match,
      fuzzy_match: fuzzy,
      miss_candidate_fabrication: miss,
      exact_match_rate: match / denom,
      fuzzy_or_exact_rate: (match + fuzzy) / denom,
      fabrication_rate: miss / denom,
    };
  }

  const originalPhraseStrict = fidelityBucket(r => r.note_class === 'original-phrase' && r.wrap === 'quoted');
  const originalPhraseAllWraps = fidelityBucket(r => r.note_class === 'original-phrase' && r.wrap);

  // --- stratified fidelity (strict, quoted only) ---
  const strataMap = new Map();
  for (const r of records) {
    if (!(r.note_class === 'original-phrase' && r.wrap === 'quoted')) continue;
    const key = strataKey(r);
    if (!strataMap.has(key)) {
      strataMap.set(key, { model: r.model, prompt_version: r.prompt_version, language: r.language, century: r.century, records: [] });
    }
    strataMap.get(key).records.push(r);
  }
  const stratifiedFinal = [...strataMap.entries()].map(([, s]) => {
    const relevant = s.records;
    const scoreable = relevant.filter(
      r => !['unscoreable', 'miss_empty_ocr', 'miss_script_mismatch'].includes(r.match_verdict)
    );
    const emptyOcr = relevant.filter(r => r.match_verdict === 'miss_empty_ocr').length;
    const scriptMismatch = relevant.filter(r => r.match_verdict === 'miss_script_mismatch').length;
    const match = scoreable.filter(r => r.match_verdict === 'match').length;
    const fuzzy = scoreable.filter(r => r.match_verdict === 'fuzzy_match').length;
    const miss = scoreable.filter(r => r.match_verdict === 'miss').length;
    const denom = scoreable.length || 1;
    return {
      model: s.model,
      prompt_version: s.prompt_version,
      language: s.language,
      century: s.century,
      n_notes: relevant.length,
      n_scoreable: scoreable.length,
      n_empty_or_short_ocr: emptyOcr,
      n_script_mismatch: scriptMismatch,
      exact_match: match,
      fuzzy_match: fuzzy,
      miss_candidate_fabrication: miss,
      fuzzy_or_exact_rate: scoreable.length ? (match + fuzzy) / denom : null,
      fabrication_rate: scoreable.length ? miss / denom : null,
    };
  });
  stratifiedFinal.sort((a, b) => b.n_notes - a.n_notes);

  // --- adjacent-page reference rate (ALL note spans) ---
  const notesWithAdjacent = records.filter(r => r.adjacent_families.length > 0).length;
  const adjacentFamilyCounts = {};
  for (const r of records) for (const f of r.adjacent_families) adjacentFamilyCounts[f] = (adjacentFamilyCounts[f] || 0) + 1;

  // --- structural compliance, overall + per prompt_version ---
  const notesWithNested = records.filter(r => r.nested).length;
  const notesWithMultiPara = records.filter(r => r.multi_paragraph).length;
  // unbalanced is a PAGE-level flag; dedupe by page_id
  const pageUnbalancedMap = new Map();
  for (const r of records) pageUnbalancedMap.set(r.page_id, r.page_unbalanced);
  const pagesWithUnbalanced = [...pageUnbalancedMap.values()].filter(Boolean).length;
  const pagesConsidered = pageUnbalancedMap.size;

  const byPromptVersion = new Map();
  for (const r of records) {
    if (!byPromptVersion.has(r.prompt_version)) {
      byPromptVersion.set(r.prompt_version, { notes: 0, nested: 0, multiPara: 0, pages: new Map() });
    }
    const b = byPromptVersion.get(r.prompt_version);
    b.notes++;
    if (r.nested) b.nested++;
    if (r.multi_paragraph) b.multiPara++;
    if (!b.pages.has(r.page_id)) b.pages.set(r.page_id, r.page_unbalanced);
  }
  const structuralByPromptVersion = [...byPromptVersion.entries()]
    .map(([pv, b]) => {
      const pagesArr = [...b.pages.values()];
      const unbalancedPages = pagesArr.filter(Boolean).length;
      return {
        prompt_version: pv,
        notes: b.notes,
        pages: pagesArr.length,
        nested_rate: b.notes ? b.nested / b.notes : null,
        multi_paragraph_rate: b.notes ? b.multiPara / b.notes : null,
        unbalanced_page_rate: pagesArr.length ? unbalancedPages / pagesArr.length : null,
      };
    })
    .sort((a, b) => b.notes - a.notes);

  return {
    overall,
    class_distribution: classCounts,
    original_phrase_fidelity: {
      strict_quoted_only: originalPhraseStrict,
      all_wraps: originalPhraseAllWraps,
    },
    original_phrase_fidelity_by_stratum: stratifiedFinal,
    adjacent_page_reference: {
      notes_with_adjacent_reference: notesWithAdjacent,
      rate: records.length ? notesWithAdjacent / records.length : null,
      by_family: adjacentFamilyCounts,
    },
    structural_compliance: {
      overall: {
        nested_rate: records.length ? notesWithNested / records.length : null,
        multi_paragraph_rate: records.length ? notesWithMultiPara / records.length : null,
        unbalanced_page_rate: pagesConsidered ? pagesWithUnbalanced / pagesConsidered : null,
        pages_considered: pagesConsidered,
      },
      by_prompt_version: structuralByPromptVersion,
    },
  };
}

// ---------------------------------------------------------------------------
// Main sweep
// ---------------------------------------------------------------------------

async function main() {
  const t0 = Date.now();
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const pages = db.collection('pages');
  const books = db.collection('books');

  log(
    `Phase 0 sweep starting. SAMPLE_SIZE=${SAMPLE_SIZE} (random subset via $sample; pages collection ~19.1M docs, no text index on translation.data, so a full COLLSCAN is not viable this session).`
  );

  const cursor = pages.aggregate(
    [
      { $sample: { size: SAMPLE_SIZE } },
      { $match: { 'translation.data': { $regex: '<note' } } },
      {
        $project: {
          book_id: 1,
          id: 1,
          'translation.data': 1,
          'translation.model': 1,
          'translation.prompt_version': 1,
          'ocr.data': 1,
        },
      },
    ],
    { allowDiskUse: true }
  );

  const noteRecords = [];
  const bookIds = new Set();
  let pagesWithNotes = 0;
  let notesTotal = 0;

  for await (const doc of cursor) {
    pagesWithNotes++;
    const translationText = doc.translation?.data || '';
    const ocrText = doc.ocr?.data || '';
    const model = doc.translation?.model || 'unknown';
    const promptVersion = doc.translation?.prompt_version || 'unknown';
    const bookId = doc.book_id;
    if (bookId) bookIds.add(bookId);

    const opens = (translationText.match(/<note>/gi) || []).length;
    const closes = (translationText.match(/<\/note>/gi) || []).length;
    const pageUnbalanced = opens !== closes;

    const normOcr = normalizeForMatch(ocrText);

    NOTE_RE.lastIndex = 0;
    let m;
    while ((m = NOTE_RE.exec(translationText)) !== null) {
      notesTotal++;
      const noteText = m[1];
      const noteClass = classifyNote(noteText);
      const nested = /<note[\s>]/i.test(noteText);
      const multiParagraph = /\n[ \t]*\n/.test(noteText);
      const adjacentFamilies = matchAdjacentFamilies(noteText);

      let extraction = null;
      let matchResult = null;
      if (noteClass === 'original-phrase') {
        extraction = extractOriginalPhrase(noteText);
        if (extraction) {
          const normPhrase = normalizeForMatch(extraction.phrase);
          matchResult = scorePhraseAgainstOcr(normPhrase, normOcr, ocrText, extraction.phrase);
        }
      }

      noteRecords.push({
        page_id: doc.id,
        book_id: bookId || null,
        model,
        prompt_version: promptVersion,
        note_class: noteClass,
        note_len: noteText.length,
        wrap: extraction?.wrap || null,
        phrase: extraction?.phrase ? extraction.phrase.slice(0, 200) : null,
        match_verdict: matchResult?.verdict || null,
        match_similarity: matchResult?.similarity ?? null,
        nested,
        multi_paragraph: multiParagraph,
        page_unbalanced: pageUnbalanced,
        adjacent_families: adjacentFamilies,
        // filled in after book metadata batch fetch:
        language: null,
        year: null,
        century: null,
      });
    }

    if (pagesWithNotes % 5000 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      log(`... ${pagesWithNotes} note-bearing pages processed, ${notesTotal} notes extracted, ${elapsed}s elapsed`);
      try {
        fs.writeFileSync(PARTIAL_PATH, noteRecords.map(r => JSON.stringify(r)).join('\n') + '\n');
      } catch (e) {
        log(`WARN: checkpoint write failed: ${e.message}`);
      }
    }
  }

  log(
    `Sweep done: ${pagesWithNotes} note-bearing pages (of ${SAMPLE_SIZE} sampled), ${notesTotal} notes, ${bookIds.size} distinct books. Fetching book metadata...`
  );

  const bookMap = new Map();
  const idArr = [...bookIds];
  const CHUNK = 2000;
  for (let i = 0; i < idArr.length; i += CHUNK) {
    const chunk = idArr.slice(i, i + CHUNK);
    const docs = await books
      .find({ id: { $in: chunk } })
      .project({ id: 1, language: 1, year: 1 })
      .toArray();
    for (const b of docs) bookMap.set(b.id, { language: b.language || 'unknown', year: typeof b.year === 'number' ? b.year : null });
    log(`... book metadata batch ${Math.floor(i / CHUNK) + 1}/${Math.ceil(idArr.length / CHUNK)} (${docs.length} books)`);
  }

  for (const r of noteRecords) {
    const meta = bookMap.get(r.book_id) || { language: 'unknown', year: null };
    r.language = meta.language;
    r.year = meta.year;
    r.century = centuryBucket(meta.year);
  }

  log(`Writing ${noteRecords.length} note records to ${JSONL_PATH}...`);
  const stream = fs.createWriteStream(JSONL_PATH);
  for (const r of noteRecords) stream.write(JSON.stringify(r) + '\n');
  await new Promise((resolve, reject) => stream.end(err => (err ? reject(err) : resolve())));

  const agg = computeAggregates(noteRecords, {
    pagesSampled: SAMPLE_SIZE,
    pagesWithNotes,
    distinctBooks: bookIds.size,
  });
  agg.run_metadata = {
    run_date: new Date().toISOString(),
    sample_size_requested: SAMPLE_SIZE,
    pages_with_notes_found: pagesWithNotes,
    notes_total: notesTotal,
    distinct_books: bookIds.size,
    fuzzy_threshold: FUZZY_THRESHOLD,
    ocr_short_threshold_chars: OCR_SHORT_THRESHOLD,
    elapsed_seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
  };
  fs.writeFileSync(AGG_PATH, JSON.stringify(agg, null, 2));

  try {
    fs.unlinkSync(PARTIAL_PATH);
  } catch {
    /* ignore */
  }

  log(`Wrote aggregates to ${AGG_PATH}`);
  log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
