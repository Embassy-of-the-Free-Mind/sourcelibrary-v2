/**
 * QA-Eval Metrics Library
 *
 * All metric functions for OCR and translation quality evaluation.
 * Extracted from _tmp-ocr-consistency.mjs and extended with BLEU-4, ROUGE-L,
 * CER, MCR, and script-aware tokenization.
 */

// ── Script-aware tokenizers ────────────────────────────────────────

const TOKENIZERS = {
  tibetan: text => text.split(/[་།\s]+/).filter(Boolean),
  cjk: text => [...text].filter(c => c.trim()),
  arabic: text => text.split(/\s+/).filter(Boolean),
  hebrew: text => text.split(/\s+/).filter(Boolean),
  default: text => text.split(/\s+/).filter(Boolean),
};

export function tokenize(text, script = 'default') {
  const fn = TOKENIZERS[script] || TOKENIZERS.default;
  return fn(text);
}

// ── Levenshtein distance (two-row optimized) ───────────────────────

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ── Character similarity ───────────────────────────────────────────

export function charSimilarity(a, b) {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Character Error Rate ───────────────────────────────────────────

export function cer(hypothesis, reference) {
  if (reference.length === 0) return hypothesis.length === 0 ? 0 : 1;
  return levenshtein(hypothesis, reference) / reference.length;
}

// ── Syllable / token similarity ────────────────────────────────────

export function syllableSimilarity(a, b, script = 'default') {
  const sa = tokenize(a, script);
  const sb = tokenize(b, script);
  const maxLen = Math.max(sa.length, sb.length);
  if (maxLen === 0) return 1;
  let matches = 0;
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] === sb[i]) matches++;
  }
  return matches / maxLen;
}

// ── Modal Consistency Rate ─────────────────────────────────────────

export function mcr(runs) {
  if (runs.length === 0) return { rate: 0, modalOutput: '', modeCount: 0 };
  const counts = new Map();
  for (const run of runs) {
    counts.set(run, (counts.get(run) || 0) + 1);
  }
  let modalOutput = '';
  let modeCount = 0;
  for (const [text, count] of counts) {
    if (count > modeCount) {
      modeCount = count;
      modalOutput = text;
    }
  }
  return {
    rate: modeCount / runs.length,
    modalOutput,
    modeCount,
    totalRuns: runs.length,
    uniqueOutputs: counts.size,
  };
}

// ── BLEU-4 ─────────────────────────────────────────────────────────

function ngrams(tokens, n) {
  const grams = new Map();
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n).join(' ');
    grams.set(gram, (grams.get(gram) || 0) + 1);
  }
  return grams;
}

function clippedCount(hypGrams, refGrams) {
  let clipped = 0;
  for (const [gram, count] of hypGrams) {
    clipped += Math.min(count, refGrams.get(gram) || 0);
  }
  return clipped;
}

export function bleu4(hypothesis, reference, script = 'default') {
  const hypTokens = tokenize(hypothesis, script);
  const refTokens = tokenize(reference, script);

  if (hypTokens.length === 0 || refTokens.length === 0) return 0;

  // Brevity penalty
  const bp = hypTokens.length >= refTokens.length
    ? 1
    : Math.exp(1 - refTokens.length / hypTokens.length);

  // Modified precision for n=1..4
  let logSum = 0;
  let validN = 0;
  for (let n = 1; n <= 4; n++) {
    const hypG = ngrams(hypTokens, n);
    const refG = ngrams(refTokens, n);
    const total = Math.max(hypTokens.length - n + 1, 0);
    if (total === 0) continue;
    const clipped = clippedCount(hypG, refG);
    if (clipped === 0) return 0; // Any zero precision → BLEU = 0
    logSum += Math.log(clipped / total);
    validN++;
  }

  if (validN === 0) return 0;
  return bp * Math.exp(logSum / validN);
}

// ── ROUGE-L (longest common subsequence) ───────────────────────────

function lcsLength(a, b) {
  const m = a.length, n = b.length;
  // Space-optimized: two rows
  let prev = new Array(n + 1).fill(0);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1] + 1
        : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function rougeL(hypothesis, reference, script = 'default') {
  const hypTokens = tokenize(hypothesis, script);
  const refTokens = tokenize(reference, script);

  if (hypTokens.length === 0 || refTokens.length === 0) return 0;

  const lcs = lcsLength(hypTokens, refTokens);
  const precision = lcs / hypTokens.length;
  const recall = lcs / refTokens.length;

  if (precision + recall === 0) return 0;
  // F1
  return (2 * precision * recall) / (precision + recall);
}

// ── Cosine similarity (for embedding vectors) ──────────────────────

export function cosineSimilarity(a, b) {
  if (a.length !== b.length) throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b);
}

// ── Text cleaning helpers ──────────────────────────────────────────

const SCRIPT_FILTERS = {
  tibetan: text => text.replace(/[^\u0F00-\u0FFF\n\-]/g, '').replace(/\n{3,}/g, '\n\n').trim(),
};

export function cleanText(text, script) {
  if (!text) return '';
  let cleaned = text
    // Strip XML tags (<language>, <note>, <meta>, <scan-quality>, etc.)
    .replace(/<[^>]+>/g, '')
    // Strip markdown heading markers
    .replace(/^#{1,6}\s+/gm, '')
    // Strip markdown bold/italic
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    // Strip markdown centering syntax (->text<-)
    .replace(/^->\s*|\s*<-$/gm, '')
    // Strip markdown horizontal rules
    .replace(/^-{3,}$/gm, '')
    // Strip markdown blockquote markers
    .replace(/^>\s*/gm, '')
    // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (script && SCRIPT_FILTERS[script]) {
    cleaned = SCRIPT_FILTERS[script](cleaned);
  }
  return cleaned;
}

// ── Pairwise metrics across all pairs in a set ─────────────────────

export function pairwiseMetrics(runs, script = 'default') {
  const pairs = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      pairs.push({
        i, j,
        charSimilarity: charSimilarity(runs[i], runs[j]),
        syllableSimilarity: syllableSimilarity(runs[i], runs[j], script),
      });
    }
  }
  const avgChar = pairs.reduce((s, p) => s + p.charSimilarity, 0) / (pairs.length || 1);
  const avgSyl = pairs.reduce((s, p) => s + p.syllableSimilarity, 0) / (pairs.length || 1);
  return { pairs, avgCharSimilarity: avgChar, avgSyllableSimilarity: avgSyl };
}

// ── CJK OCR vs. canonical-text comparison (ctext ground truth) ──────
// Most of our Chinese editions are COMMENTARY editions: the canonical main text
// is interleaved with small-character annotation that ctext's main-text-only
// transcription lacks. A plain edit distance counts that commentary as error and
// reports false OCR failures (the Book of Odes scored 6% when it was really 99%).
// subsequenceCER() instead matches the reference as an in-order subsequence of the
// OCR, skipping extra OCR characters for free — so it measures OCR error on the
// canonical text without penalizing correctly-read commentary.

const OCR_WRAPPER_BLOCKS = ['meta', 'summary', 'keywords', 'vocab', 'language', 'scan-quality', 'script', 'page-type', 'columns', 'warning'];

/** Strip editorial annotation wrapper blocks (content + tag) and inline gloss tags. */
export function stripWrappers(s) {
  if (!s) return '';
  let t = s;
  for (const w of OCR_WRAPPER_BLOCKS) t = t.replace(new RegExp(`<${w}[^>]*>[\\s\\S]*?</${w}>`, 'gi'), '');
  return t.replace(/<\/?(note|term|margin|gloss|unclear|insert|header|catchword|sig|page-num)[^>]*>/gi, '');
}

/** Reduce CJK text to comparable characters: drop wrappers, punctuation, latin, digits, whitespace.
 * Glyph variants that differ BETWEEN EDITIONS (not OCR errors) are folded to one form. */
const CJK_VARIANTS = { '爲': '為', '靑': '青', '敎': '教', '曓': '暴', '愼': '慎', '鐘': '鍾' };
export function normalizeCJK(s) {
  return stripWrappers(s)
    .replace(/[爲靑敎曓愼鐘]/g, c => CJK_VARIANTS[c])
    .replace(/[。、，；：！？「」『』（）〈〉《》【】\s·．,.;:!?()0-9a-zA-Z○◯●－—\-]/g, '');
}

/**
 * Subsequence character error rate of an OCR string against a canonical reference.
 * Cost = substitutions + reference-character deletions (OCR dropped a main char);
 * OCR-only characters (commentary, marginalia) are skipped at zero cost.
 * Returns { cer, refLen, matched }. cer is a slight LOWER bound on true OCR error
 * (free skips can match a coincidental subsequence), so treat as an optimistic
 * estimate; a high cer (> ~0.30) means the reference is NOT cleanly present —
 * i.e. wrong page/book or a divergent recension, not a salvageable OCR read.
 */
export function subsequenceCER(reference, ocr) {
  return subsequenceErrorRate([...normalizeCJK(reference)], [...normalizeCJK(ocr)], 8);
}

/**
 * Core subsequence-error DP over pre-tokenized units (chars or words).
 * Cost = substitutions + reference-unit deletions; OCR-extra units skip free.
 * `headLen` bounds the OCR side to a window anchored at the reference head so the
 * DP stays cheap and can't match across a whole book.
 */
function subsequenceErrorRate(R, O, headLen) {
  if (!R.length) return { cer: 0, refLen: 0, matched: 0 };
  // Anchor a window around the first occurrence of the reference head.
  const head = R.slice(0, headLen).join(' ');
  const flat = O.map(u => u).join(' ');
  const idx = head ? flat.indexOf(head) : -1;
  const startUnit = idx > 0 ? flat.slice(0, idx).split(' ').length - 1 : 0;
  const cap = R.length * 6 + 60;
  O = idx >= 0 ? O.slice(startUnit, startUnit + cap) : O.slice(0, Math.max(cap, 400));
  const m = R.length, n = O.length;
  let prev = new Array(n + 1).fill(0); // dp[0][j] = 0: leading/extra O skips are free
  for (let i = 1; i <= m; i++) {
    const cur = new Array(n + 1);
    cur[0] = i; // O exhausted → must delete remaining R units
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        cur[j - 1],                                   // skip O[j-1] (commentary) — free
        prev[j - 1] + (R[i - 1] === O[j - 1] ? 0 : 1), // match / substitute
        prev[j] + 1,                                  // delete R[i-1] (OCR dropped it)
      );
    }
    prev = cur;
  }
  const dist = prev[n];
  return { cer: dist / m, refLen: m, matched: m - dist };
}

// ── Script-aware reference comparison (multi-language ground truth) ──
// Generalizes the ctext system (#3212). Two stages:
//   1. IDENTITY GUARD — is the reference passage genuinely present on this page?
//      CJK guards at char level (a ~5,000-char inventory makes coincidental
//      subsequence matches rare). Alphabetic scripts MUST guard at word level:
//      with a ~30-letter alphabet, free-skip char matching accepted a modern
//      Armenian translation of the grabar Buzand at 22-25% CER (measured
//      2026-07-19) — word-level scored the same decoy at 88-96% error.
//   2. SCORE — char-level subsequence CER inside the verified window is the
//      reported OCR accuracy. Char level is fine once identity is guaranteed.
//
// Folding is deliberately conservative and only folds distinctions that vary
// BETWEEN EDITIONS rather than reflecting OCR quality (u/v and long-s in Latin,
// niqqud in Hebrew, polytonic diacritics in Greek, the ew-ligature in Armenian).

const foldDiacritics = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');

export const SCRIPT_DEFS = {
  cjk: null, // handled by normalizeCJK / subsequenceCER
  latin: {
    letters: /[a-z]/,
    // '&' is the et-ligature — early modern printing writes "et" as "&";
    // folding it prevents every printed ampersand counting as a deleted word.
    fold: s => foldDiacritics(s.toLowerCase()).replace(/&/g, ' et ')
      .replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
      .replace(/v/g, 'u').replace(/j/g, 'i').replace(/w/g, 'uu'),
  },
  greek: {
    letters: /[α-ω]/,
    // NFD strip covers polytonic accents/breathings; fold final sigma.
    fold: s => foldDiacritics(s.toLowerCase()).replace(/ς/g, 'σ').replace(/ϲ/g, 'σ'),
  },
  armenian: {
    letters: /[ա-ֆ]/,
    fold: s => s.toLowerCase().replace(/և/g, 'եւ'),
  },
  hebrew: {
    letters: /[א-ת]/,
    // Maqaf-joined pairs split into words FIRST (the cantillation range below
    // contains U+05BE maqaf and would silently delete it); then strip niqqud +
    // cantillation; fold final forms.
    fold: s => s.replace(/[־-]/g, ' ').replace(/[֑-ׇ]/g, '')
      .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ'),
  },
  arabic: {
    letters: /[ء-ي]/,
    // Strip tashkeel + tatweel; fold alef/hamza variants and alef maqsura.
    fold: s => s.replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'),
  },
  devanagari: {
    letters: /[ऀ-ॏक़-९]/,
    fold: s => s.replace(/[।॥]/g, ' '),
  },
  cyrillic: {
    letters: /[а-я]/,
    // Pre-reform orthography folds (ѣ і ѳ ѵ ъ vary between editions).
    fold: s => s.toLowerCase().replace(/ѣ/g, 'е').replace(/і/g, 'и').replace(/ѳ/g, 'ф').replace(/ѵ/g, 'и').replace(/ъ\b/g, ''),
  },
  tibetan: {
    // Consonants (ཀ–ཬ), vowel signs, and subjoined letters (ྐ–ྼ) — one range
    // covers the Sanskrit-transliteration extensions used in mantra/title lines.
    letters: /[ཀ-ྼ]/,
    // The "word" unit is the syllable: tsheg (་ ༌) and shad (། ༎ ༏ ༐ ༑ ༔)
    // become spaces so the generic whitespace split yields syllables.
    fold: s => s.replace(/[་༌]/g, ' ').replace(/[།༎༏༐༑༔]/g, ' '),
  },
};

/**
 * Normalize page/reference text for a script: strip editorial wrappers, apply the
 * script's orthography folding, keep only the script's letters, collapse spaces.
 * Returns a space-separated string (word boundaries preserved).
 */
export function normalizeForScript(s, script) {
  const def = SCRIPT_DEFS[script];
  if (!def) throw new Error(`normalizeForScript: unknown script "${script}" (cjk uses normalizeCJK)`);
  // Rejoin words hyphenated across line breaks (early modern printing uses - or ¬)
  // BEFORE tokenizing, or each break splits one word into two mismatches.
  const dehyphenated = stripWrappers(s || '').replace(/(\p{L})[-¬]\s*\n\s*/gu, '$1');
  const folded = def.fold(dehyphenated);
  return folded
    .split(/\s+/)
    .map(w => [...w].filter(c => def.letters.test(c)).join(''))
    .filter(Boolean)
    .join(' ');
}

/**
 * Word-level subsequence error rate — the identity guard for alphabetic scripts.
 * Reference words matched in order; OCR-extra words (notes, marginalia) skip free.
 */
export function subsequenceWER(reference, ocr, script) {
  const R = normalizeForScript(reference, script).split(' ').filter(w => w.length > 1);
  const O = normalizeForScript(ocr, script).split(' ').filter(w => w.length > 1);
  const r = subsequenceErrorRate(R, O, 3);
  return { wer: r.cer, refWords: r.refLen, matchedWords: r.matched, ...greedySpanStats(R, O) };
}

/**
 * SPAN DISPERSION — a reading-order outcome, separate from accuracy (#3235).
 * Greedy in-order match of reference units against the OCR records where the
 * matches land. spanDispersion = (last − first + 1) / matched: 1.0 means the
 * reference sits contiguously in the output; >>1 means its words are
 * interleaved with other material — the signature of two-column reading-order
 * scrambling, which free-skip alignment deliberately does not penalize in the
 * accuracy score. Greedy matching is a proxy (common words can mis-anchor),
 * so treat as an ordinal signal, not a calibrated quantity.
 */
export function greedySpanStats(R, O) {
  let first = -1, last = -1, matched = 0, j = 0;
  for (let i = 0; i < R.length; i++) {
    while (j < O.length && O[j] !== R[i]) j++;
    if (j >= O.length) break;
    if (first < 0) first = j;
    last = j; matched++; j++;
  }
  if (matched === 0) return { spanUnits: 0, spanDispersion: null, greedyMatched: 0 };
  return {
    spanUnits: last - first + 1,
    spanDispersion: +((last - first + 1) / matched).toFixed(3),
    greedyMatched: matched,
  };
}

/**
 * WINDOWED error rate — the cross-engine-fair companion to subsequenceErrorRate.
 *
 * Free skips are correct at PAGE level: a real page carries headers, marginalia
 * and commentary the reference passage does not, and charging for them would
 * punish an engine for transcribing the page it was given. But free skips must
 * not be free INSIDE the matched span, and that is where the passage-scoped
 * scorer breaks down as an engine comparison.
 *
 * Measured on the anchor pages (2026-07-21): Tesseract scored 91.0% on the
 * Aeneid I page under free-skip scoring while rendering `arma uirumque cano` as
 * `mrmay uiritqcanoya` and `profugus lauiniaque` as `p m imi k`. It emitted 11.8x
 * the reference length; the scorer threaded the surviving correct words through
 * the junk at zero cost. The inflation rose monotonically with output/reference
 * ratio across every anchor page, so it does NOT cancel when two engines are
 * differenced — the noisier engine is flattered more.
 *
 * This measure keeps skips free OUTSIDE the matched span (finding the passage on
 * a busy page) and charges for insertions INSIDE it (junk between the passage's
 * own characters). Window bounds come from greedy in-order matching, which can
 * mis-anchor on common units, so treat the window as a good estimate rather than
 * an exact alignment.
 */
export function windowedErrorRate(refNorm, outNorm) {
  const R = [...(refNorm || '').replace(/ /g, '')];
  const O = [...(outNorm || '').replace(/ /g, '')];
  if (!R.length) return { windowedCer: 0, windowUnits: 0, anchored: true };
  if (!O.length) return { windowedCer: 1, windowUnits: 0, anchored: false };

  // FITTING ALIGNMENT (approximate substring match). Leading and trailing
  // insertions are free — a real page carries headers, apparatus and neighbouring
  // text the reference passage does not, and charging for them would punish an
  // engine for transcribing the page it was given. Interior insertions ARE
  // charged: junk between the passage's own characters is OCR noise.
  //
  // dp[0][j] = 0 lets the match start anywhere; min over the last row lets it end
  // anywhere. No anchor heuristics: head/tail string anchors fail exactly where
  // this matters, because reference tails recur in repetitive text (Genesis 1's
  // "et uidit deus quod esset bonum" matched a later verse and swallowed verses
  // 6-13, scoring a correct transcription at 34%).
  let prev = new Array(O.length + 1).fill(0);
  let cur = new Array(O.length + 1);
  for (let i = 1; i <= R.length; i++) {
    cur[0] = i;                                   // O exhausted: delete rest of R
    const ri = R[i - 1];
    for (let j = 1; j <= O.length; j++) {
      const sub = prev[j - 1] + (ri === O[j - 1] ? 0 : 1);
      const del = prev[j] + 1;                    // reference char missing
      const ins = cur[j - 1] + 1;                 // interior junk — CHARGED
      cur[j] = sub < del ? (sub < ins ? sub : ins) : (del < ins ? del : ins);
    }
    [prev, cur] = [cur, prev];
  }
  let d = Infinity;
  for (let j = 0; j <= O.length; j++) if (prev[j] < d) d = prev[j];
  return { windowedCer: Math.min(1, d / R.length), windowUnits: R.length, anchored: true };
}

// Guard thresholds: measured separation is wide on both sides (right page ~0%,
// wrong text 88%+ at word level; ctext baseline uses 0.30 at char level).
export const GUARD_THRESHOLDS = { cjk: 0.30, word: 0.35 };

/**
 * Two-stage reference comparison. Returns
 *   { aligned, guard, cer, charAccuracy, refLen, matched }
 * `aligned:false` means the reference is not cleanly present (wrong book/page,
 * divergent recension, or a translation decoy) — NOT an OCR failure; such pages
 * must be excluded from accuracy roll-ups, never averaged in.
 *
 * TWO accuracy numbers are returned and they BRACKET the truth; quote both:
 *   charAccuracy         — free-skip subsequence. UPPER bound. Junk between
 *                          reference characters is free, so it flatters noisy
 *                          engines (measured 12.9pp inflation for Tesseract vs
 *                          5.7pp for Gemini on the anchor pages — the noisier
 *                          engine gained 2.3x more, so the bias does NOT cancel
 *                          when two engines are differenced).
 *   charAccuracyWindowed — fitting alignment. LOWER bound. Charges interior
 *                          insertions, which correctly penalises OCR noise but
 *                          also charges for legitimate page material interleaved
 *                          inside the passage (marginal cross-references sitting
 *                          between verses take a correct Vulgate transcription
 *                          from 100% to 65%).
 * The bracket is tight on clean single-column pages (Gemini: 100.0/100.0) and
 * wide where apparatus interleaves — and its WIDTH is itself a useful signal,
 * measuring how much non-reference material sits inside the passage span.
 * For cross-engine comparison use the windowed number, or report both.
 */
export function scoreAgainstReference(reference, ocr, script = 'cjk', thresholds = GUARD_THRESHOLDS) {
  if (script === 'cjk') {
    const r = subsequenceCER(reference, ocr);
    const Rc = [...normalizeCJK(reference)], Oc = [...normalizeCJK(ocr)];
    const span = greedySpanStats(Rc, Oc);
    const w = windowedErrorRate(normalizeCJK(reference), normalizeCJK(ocr));
    return { aligned: r.cer <= thresholds.cjk, guard: { type: 'char', value: r.cer }, ...r,
      charAccuracy: 1 - r.cer,
      charAccuracyWindowed: w.windowedCer == null ? null : 1 - w.windowedCer, ...w,
      spanDispersion: span.spanDispersion };
  }
  const guard = subsequenceWER(reference, ocr, script);
  const aligned = guard.wer <= thresholds.word;
  // Char-level score on space-stripped normalized text (spaces are layout, not OCR).
  const R = [...normalizeForScript(reference, script).replace(/ /g, '')];
  const O = [...normalizeForScript(ocr, script).replace(/ /g, '')];
  const r = subsequenceErrorRate(R, O, 12);
  const w = windowedErrorRate(normalizeForScript(reference, script), normalizeForScript(ocr, script));
  return { aligned, guard: { type: 'word', value: guard.wer, ...guard }, ...r,
    charAccuracy: 1 - r.cer,
    charAccuracyWindowed: w.windowedCer == null ? null : 1 - w.windowedCer, ...w,
    spanDispersion: guard.spanDispersion };
}

// ── Revision-agreement metric (#3235 / #3473) ──────────────────────
// The primary word-level agreement used by revision-agreement-corpus.mjs and
// by reocr-pairing-check.mjs. Kept HERE, in one place, because two copies of a
// metric drift and every number computed with either becomes uncomparable.
//
// HTML entities are not text: a prior revision on Kircher's Arithmologia p9 was
// 24,692 chars of `&nbsp;` padding around 73 real words, and because `nbsp` is a
// letter run it counted as 4,025 body words.
export const deEntity = s => (s || '').replace(/&[a-z]{2,8};/gi, ' ').replace(/&#\d+;/g, ' ');

export const toAgreementWords = s => deEntity(stripWrappers(s || ''))
  .toLowerCase()
  .replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/).filter(w => w.length > 1).slice(0, 800);

/** Normalized word-level Levenshtein agreement, 0..1. null when both sides empty. */
export function agreementWords(a, b) {
  const A = toAgreementWords(a), B = toAgreementWords(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

// ── Script class + the primary agreement selector (#3235 / #3473) ──
// Word tokenization collapses space-less scripts into a handful of huge tokens
// (a Chinese page is ~22 whitespace tokens against ~310 for Latin), so ONE wrong
// glyph invalidates a whole token and the word metric reads catastrophically
// low on text that is largely correct. Measured: Chinese 36.7% word-agreement
// against 72.7% character-agreement.
//
// This bit me directly. reocr-pairing-check.mjs first ran the WORD metric over
// an arm that was 76% Tibetan and reported 86% of pages "mispaired"; 61% of the
// never-re-archived CONTROL pages in the same script scored the same way, which
// is the metric failing rather than the data. Always route through
// `agreementPrimary`, never `agreementWords`, unless you have checked the script.
const SPACELESS_RE = /[\p{Script=Han}\p{Script=Tibetan}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}]/u;

export function scriptClassOf(s) {
  const letters = (s || '').replace(/[^\p{L}]/gu, '');
  if (!letters) return 'unknown';
  let n = 0;
  for (const ch of letters.slice(0, 2000)) if (SPACELESS_RE.test(ch)) n++;
  return n / Math.min(letters.length, 2000) > 0.3 ? 'spaceless' : 'spaced';
}

export const toAgreementChars = s =>
  [...deEntity(stripWrappers(s || '')).toLowerCase().replace(/[^\p{L}]/gu, '')].slice(0, 3000);

export function agreementChars(a, b) {
  const A = toAgreementChars(a), B = toAgreementChars(b);
  if (!A.length && !B.length) return null;
  if (!A.length || !B.length) return 0;
  return 1 - levenshtein(A, B) / Math.max(A.length, B.length);
}

/** Character agreement on space-less scripts, word agreement elsewhere. */
export function agreementPrimary(a, b) {
  const cls = scriptClassOf(b) === 'unknown' ? scriptClassOf(a) : scriptClassOf(b);
  return cls === 'spaceless' ? agreementChars(a, b) : agreementWords(a, b);
}
