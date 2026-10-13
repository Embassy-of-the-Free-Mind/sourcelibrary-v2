// PRIOR ART: scripts/eval/lib/metrics.mjs (levenshtein, used here) and scripts/lib/language-content-classify.mjs
// (stripOcrMetadata). The pure parts of scripts/batch/ocr-convergence/driver.mjs (#6420 lane B), kept apart so the
// tests can import them without starting the driver.
import { createHash } from 'node:crypto';
import { levenshtein } from '../../eval/lib/metrics.mjs';
import { stripOcrMetadata } from '../../lib/language-content-classify.mjs';

// Language groups in the order #6420 names them. A book's group is the first word of `language`.
export const GROUPS = [['latin', /^latin\b/i], ['greek', /^(ancient |koine )?greek\b/i], ['german', /^(early new high |middle high |old )?german\b/i], ['chinese', /^(classical )?chinese\b/i], ['arabic', /^arabic\b/i], ['hebrew', /^hebrew\b/i]];
export const groupOf = (language) => GROUPS.find(([, re]) => re.test(String(language || '').trim()))?.[0] ?? null;

// Statuses in which a translate lane picks a book up and re-translates every page whose OCR is newer than its English
// (translate-worker processBook; pipeline-orchestrator Phase 4 gap-fill below 90%). An OCR write there is a paid
// re-translation queued at once, which #6420 keeps for lane C: those writes are deferred, not made.
const TRANSLATING = ['ocr_complete', 'translate_partial', 'translate_submitted', 'translating', 'ocr_running', 'ocr_submitted'];
const GAPFILL_STATUSES = ['translate_partial', 'translate_complete', 'chapters_complete', 'complete'];
export function translationLaneReason(book) {
  const st = book?.pipeline_auto?.status;
  if (book?.pipeline_auto?.hold || st === 'held') return 'book is held';
  if (TRANSLATING.includes(st)) return `status ${st}: a translate lane would re-translate the page`;
  const denom = (book?.pages_ocr || 0) - (book?.pages_blank || 0);
  // 0.92, not 0.9: a recount after the write must not tip the book under the gap-fill line.
  if (GAPFILL_STATUSES.includes(st) && denom > 0 && (book.pages_translated || 0) / denom < 0.92) return `${Math.round(100 * (book.pages_translated || 0) / denom)}% translated: gap-fill would re-queue it`;
  return null;
}

/** Text for comparison: tags and metadata out, the long s and ligatures folded, whitespace collapsed. */
export function normaliseForCer(t) {
  return stripOcrMetadata(String(t || ''))
    .normalize('NFC')
    .replace(/[*_#>`|]/g, '')
    .replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/Æ/g, 'Ae').replace(/Œ/g, 'Oe')
    .replace(/[̀-ͯ]/g, (c) => c) // diacritics are kept: Greek accents and Hebrew points are content
    .replace(/-\s*\n\s*/g, '').replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Symmetric CER: edit distance over the longer text. Long pages are compared in aligned windows to bound the cost. */
export function pairCer(a, b) {
  const x = normaliseForCer(a), y = normaliseForCer(b);
  const n = Math.max(x.length, y.length);
  if (!n) return { cer: 0, len_stored: 0, len_cli: 0 };
  let d;
  if (x.length * y.length <= 64e6) d = levenshtein(x, y);
  else { // > 8K chars each: 4K windows, proportionally aligned; an upper bound good enough to call "disagree"
    d = 0; const W = 4000, k = Math.ceil(n / W);
    for (let i = 0; i < k; i++) d += levenshtein(x.slice(Math.floor(i * x.length / k), Math.floor((i + 1) * x.length / k)), y.slice(Math.floor(i * y.length / k), Math.floor((i + 1) * y.length / k)));
  }
  return { cer: d / n, len_stored: x.length, len_cli: y.length };
}

const tokens = (t) => {
  const x = stripOcrMetadata(String(t || '')).replace(/ſ/g, 's');
  // CJK has no spaces: compare by character there; elsewhere by word.
  return /[㐀-鿿]/.test(x) ? [...x.replace(/\s+/g, '')] : x.split(/\s+/).filter(Boolean);
};
/** Word-level differing spans (LCS), at most `max`, as "A: … | B: …" strings: a pointer for the adjudicator. */
export function diffSpans(a, b, max = 40) {
  const A = tokens(a).slice(0, 3000), B = tokens(b).slice(0, 3000);
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0, da = [], db = [];
  const sep = /[㐀-鿿]/.test(A.join('') + B.join('')) ? '' : ' ';
  const flush = () => { if (da.length || db.length) out.push(`A: ${da.join(sep) || '∅'} | B: ${db.join(sep) || '∅'}`); da = []; db = []; };
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { flush(); i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) db.push(B[j++]);
    else da.push(A[i++]);
  }
  flush();
  return { spans: out.slice(0, max).map((s) => (s.length > 300 ? s.slice(0, 300) + '…' : s)), total: out.length };
}
export const sideOf = (pageId, seed) => (parseInt(createHash('sha1').update(`${seed}:${pageId}`).digest('hex').slice(0, 8), 16) % 2 === 0 ? 'stored-is-A' : 'cli-is-A');

