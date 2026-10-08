// Shared pieces of the #5935 ground-truth study: body text, edge-free aligned CER, covariates.
//
// PRIOR ART: scripts/eval/lib/metrics.mjs (`windowedErrorRate` is the same fitting alignment with free
// edges, but it scores a short PASSAGE inside a long page and returns no span or diff; here the page is
// the query and the reference window is the longer side, the span is needed to charge text the page
// left out, and the floor review needs the diff); scripts/eval/zh-skqs-5568-kanripo.mjs (`fold`, the
// Han variant table, imported, not copied); scripts/import/cbeta-chan-import.mjs (META_BLOCKS / cleanOcr:
// the margin blocks dropped before a body comparison, copied below because that file is a CLI);
// scripts/eval/quality-covariates.mjs (periodOf, resBand: copied, that file is a script with side
// effects on import); lib/agreement-stats.mjs (wilson) and lib/paired-stats.mjs (makeRng) imported.

import { fold as foldHanKanripo } from '../zh-skqs-5568-kanripo.mjs';
export { makeRng } from '../lib/paired-stats.mjs';
export { wilson } from '../lib/agreement-stats.mjs';

export const CATASTROPHIC_CER = 0.5;   // the house threshold (benchmark-dashboard-data.mjs)
export const NORMALISER_VERSION = 1;

// ── body text ───────────────────────────────────────────────────────────────
// Margins and metadata blocks are not body text: the 版心 header and leaf number, running heads,
// signatures, catchwords, marginalia, footnotes (a PTS page's apparatus is not in VRI's reading text),
// and every tag-only line the OCR prompt writes. Interlinear notes (<note>, small double-line text in
// Chinese prints) ARE body: Kanripo and CBETA both carry them inline.
const MARGIN_BLOCKS = /<(vocab|warning|page-num|language|script|page-type|columns|header|footer|sig|signature|catchword|meta|image-desc|scan-quality|summary|keywords|detected-images|margin|marginalia|footnote|footnotes|figure|caption)\b[^>]*>[\s\S]*?<\/\1>/gi;
export const bodyText = (t) => String(t || '')
  .replace(MARGIN_BLOCKS, '\n')
  .replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
  .replace(/^#+\s*/gm, '')
  .replace(/&[a-z]{2,8};|&#\d+;/gi, ' ');

/** Chinese: Han characters only, Kanripo's variant table folded (徳/德 …). */
export const foldHan = (t) => foldHanKanripo(t);

/**
 * Pali in roman script: lower case, editions' conventions folded, letters only.
 * Niggahita is ṃ in VRI, ṁ or ŋ in older PTS; circumflex long vowels (â î û) in some 19th-century
 * prints are ā ī ū. Spaces, hyphens, punctuation and digits are layout (PTS hyphenates compounds and
 * sandhi that VRI writes solid).
 */
export function foldPali(t) {
  return String(t || '').normalize('NFC').toLowerCase()
    .replace(/[ṁŋṃ]/g, 'ṃ').replace(/â/g, 'ā').replace(/î/g, 'ī').replace(/û/g, 'ū')
    .replace(/[^\p{L}]/gu, '')
    .normalize('NFC');
}

// ── aligned CER ─────────────────────────────────────────────────────────────
/**
 * Fitting alignment of the page reading Q inside a reference window W: every character of Q is
 * charged (insertions inside the page are errors), the window's edges are free (references break pages
 * differently). Returns the edit distance, the reference span [start, end) it matched, and the edit
 * script as runs, for the floor review.
 */
export function fitAlign(Q, W, { ops = false } = {}) {
  const q = [...Q], w = [...W];
  const n = q.length, m = w.length;
  if (!n) return { d: 0, start: 0, end: 0, runs: [] };
  if (!m) return { d: n, start: 0, end: 0, runs: ops ? [{ op: 'ins', ours: Q, ref: '' }] : [] };
  const tb = ops ? new Uint8Array((n + 1) * (m + 1)) : null;   // 1 diag, 2 up (ins: Q char unmatched), 3 left (del: W char missing)
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  const st = [new Int32Array(m + 1), new Int32Array(m + 1)];      // start column of the path ending here
  for (let j = 0; j <= m; j++) { prev[j] = 0; st[0][j] = j; }
  for (let i = 1; i <= n; i++) {
    const ps = st[(i - 1) & 1], cs = st[i & 1];
    cur[0] = i; cs[0] = 0;
    if (tb) tb[i * (m + 1)] = 2;
    const qi = q[i - 1];
    for (let j = 1; j <= m; j++) {
      const dg = prev[j - 1] + (qi === w[j - 1] ? 0 : 1);
      const up = prev[j] + 1;
      const lf = cur[j - 1] + 1;
      if (dg <= up && dg <= lf) { cur[j] = dg; cs[j] = ps[j - 1]; if (tb) tb[i * (m + 1) + j] = 1; }
      else if (up <= lf) { cur[j] = up; cs[j] = ps[j]; if (tb) tb[i * (m + 1) + j] = 2; }
      else { cur[j] = lf; cs[j] = cs[j - 1]; if (tb) tb[i * (m + 1) + j] = 3; }
    }
    [prev, cur] = [cur, prev];
  }
  let end = 0;
  for (let j = 1; j <= m; j++) if (prev[j] < prev[end]) end = j;
  const d = prev[end], start = st[n & 1][end];
  let runs = [];
  if (tb) {
    const steps = [];
    let i = n, j = end;
    while (i > 0) {
      const t = tb[i * (m + 1) + j];
      if (t === 1) { steps.push(q[i - 1] === w[j - 1] ? ['eq', q[i - 1], w[j - 1]] : ['sub', q[i - 1], w[j - 1]]); i--; j--; }
      else if (t === 2 || j === 0) { steps.push(['ins', q[i - 1], '']); i--; }
      else { steps.push(['del', '', w[j - 1]]); j--; }
    }
    steps.reverse();
    // Runs of non-equal steps, with 6 characters of context on each side (reference side).
    let k = 0;
    while (k < steps.length) {
      if (steps[k][0] === 'eq') { k++; continue; }
      let e = k;
      while (e < steps.length && steps[e][0] !== 'eq') e++;
      const ctx = (a, b) => steps.slice(Math.max(0, a), Math.max(0, b)).map((s) => s[2] || s[1]).join('');
      runs.push({ at: k, ours: steps.slice(k, e).map((s) => s[1]).join(''), ref: steps.slice(k, e).map((s) => s[2]).join(''), before: ctx(k - 6, k), after: ctx(e, e + 6) });
      k = e;
    }
  }
  return { d, start, end, runs };
}

/**
 * Body CER of a page reading against a reference window. `expected` is the reference's own length for
 * this page where the reference knows it (the Kanripo page, the span between two fitted neighbours);
 * text the reading left out beyond 10% of it is charged as deletions, so a half-read page cannot score
 * well by matching half a window. Capped at 1 (a reading that is mostly invented).
 */
export function bodyCer(Q, W, { expected = null, ops = false } = {}) {
  const qn = [...Q].length;
  if (!qn) return { cer: 1, d: expected || 0, span: 0, q_chars: 0, omitted: expected || 0, empty: true, runs: [] };
  const a = fitAlign(Q, W, { ops });
  const span = a.end - a.start;
  const omitted = expected ? Math.max(0, Math.round(expected * 0.9) - span) : 0;
  const denom = Math.max(expected || 0, span, 1);
  return { cer: Math.min(1, (a.d + omitted) / denom), d: a.d, span, q_chars: qn, omitted, start: a.start, end: a.end, runs: a.runs };
}

// ── covariates (definitions shared with quality-covariates.mjs, #5623/#5643) ─
export const PERIODS = ['pre-1500', '1500s', '1600s', '1700s', '1800s', '1900+', 'unknown'];
const bucket = (y) => (y < 1500 ? 'pre-1500' : y < 1600 ? '1500s' : y < 1700 ? '1600s' : y < 1800 ? '1700s' : y < 1900 ? '1800s' : '1900+');
export function periodOf(published, fallbackYear = null) {
  const s = String(published ?? '').trim();
  if (/^-\d/.test(s) || /\bB\.?C\.?E?\b/i.test(s)) return 'unknown';
  const one = (ys) => { const bs = new Set(ys.map(bucket)); return bs.size === 1 ? [...bs][0] : 'unknown'; };
  if (/century/i.test(s)) {
    const cs = [...s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi)].map((m) => (Number(m[1]) - 1) * 100 + 50);
    if (cs.length) return one(cs);
  }
  const uu = s.match(/\b(1\d)uu\b/i);
  if (uu) return bucket(Number(uu[1]) * 100 + 50);
  const four = [...s.matchAll(/(?<![\d])(\d{4})(?![\d])/g)].map((m) => Number(m[1])).filter((y) => y >= 1000 && y <= 2030);
  const years = four.length ? four : [...s.matchAll(/(?<![\d])(\d{3})(?![\d])/g)].map((m) => Number(m[1])).filter((y) => y >= 300);
  if (years.length) return one(years);
  return typeof fallbackYear === 'number' && Number.isFinite(fallbackYear) ? bucket(fallbackYear) : 'unknown';
}
export const RES_BANDS = ['<1500 px', '1500–2499 px', '≥2500 px', 'unknown'];
export const resBand = (w, h) => { const e = Math.max(Number(w) || 0, Number(h) || 0); return !e ? 'unknown' : e < 1500 ? '<1500 px' : e < 2500 ? '1500–2499 px' : '≥2500 px'; };

/** The engine family a served reading came from (ocr.model, else ocr.source). */
export function engineOf(ocr) {
  const m = String(ocr?.model || ocr?.engine?.model || '').toLowerCase();
  const s = String(ocr?.source || '').toLowerCase();
  if (/paddle/.test(m) || s === 'paddle') return 'paddleocr-vl';
  if (/flash-lite/.test(m)) return 'gemini-flash-lite';
  if (/gemini-3-flash|gemini-2\.5-flash|gemini-2\.0-flash|gemini-flash/.test(m)) return 'gemini-flash';
  if (/gemini.*pro/.test(m)) return 'gemini-pro';
  if (/mistral/.test(m)) return 'mistral-ocr';
  if (/kraken/.test(m)) return 'kraken';
  if (s === 'ia' || /ia-ocr|abbyy/.test(m + s)) return 'archive-ocr';
  return m || s || 'unknown';
}

/** Kind of page: the page's own script_type when present, else the book-level fallback. */
export const kindOf = (scriptType, fallback = 'unknown') => {
  const s = String(scriptType || '').toLowerCase();
  if (/hand|manuscript/.test(s)) return 'handwritten';
  if (/print|typeset|woodblock/.test(s)) return 'printed';
  return fallback;
};

export const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Interior page: skip the first 15% and the last 5% of the book (front matter lies; eval-design §3.2). */
export const isInterior = (pn, pagesCount) => pn > Math.floor(pagesCount * 0.15) && pn <= Math.ceil(pagesCount * 0.95);
