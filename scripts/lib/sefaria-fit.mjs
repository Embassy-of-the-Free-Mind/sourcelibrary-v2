// PRIOR ART: scripts/lib/derge-tengyur.mjs (#5497, rules v3 #5556) — the read-vs-claim scoring with a
// wrong-page control and the informative/aligned/weak/misaligned classes are ported from it. It does
// not fit as-is: the Esukhia e-text carries the woodblock's folio markers, so a page's text is CLAIMED
// by label, whereas a Sefaria version carries no page breaks of our editions — the span has to be
// FOUND (neighbour anchors, #5560) before it can be verified, and the unit is the Hebrew word, not the
// Tibetan syllable. scripts/lib/ia-ocr-agreement.mjs is the Hebrew pointing strip (POINTING_RE) this
// follows.
//
// sefaria-fit — pure helpers for fitting an openly licensed Sefaria version to pages whose OCR failed
// (#5560): flatten a version, normalise Hebrew, locate neighbour anchors, cut a page's span, and score
// an independent image read against that span with a wrong-page control.
//
// No DB, no network. The driver is scripts/import/sefaria-fit-5560.mjs.

import { createHash } from 'node:crypto';

export const sha16 = (t) => createHash('sha256').update(t || '').digest('hex').slice(0, 16);

/** Sefaria licence strings this lane may write (#5560: PD / CC0 / CC-BY only — never -NC, -SA is not asked for). */
export function licenceAllowed(licence) {
  const l = String(licence || '').trim().toLowerCase();
  return l === 'public domain' || l === 'cc0' || l === 'cc-by' || l === 'cc-by 4.0' || l === 'cc-by-4.0';
}

/**
 * A Sefaria version JSON (sefaria-export `json/…/Hebrew/<versionTitle>.json`) → ordered segments.
 * Walks the schema's node order (the `text` object is keyed by node title), then the jagged arrays
 * depth-first. `ref` is `Node Title 1:2:3` (1-based), the form Sefaria's own refs take.
 */
export function flattenVersion(json) {
  const out = [];
  const walk = (val, ref) => {
    if (val == null) return;
    if (typeof val === 'string') { if (val.trim()) out.push({ ref: ref.join(' ').replace(/ (\d)/g, ' $1').trim(), text: val }); return; }
    if (Array.isArray(val)) { val.forEach((v, i) => walk(v, [...ref.slice(0, 1), [...ref.slice(1), i + 1].join(':')])); return; }
  };
  const visitNode = (node, textObj, prefix) => {
    if (node.nodes?.length) {
      for (const c of node.nodes) {
        const title = c.enTitle || c.title || (c.titles || []).find((t) => t.primary && t.lang === 'en')?.text;
        const key = title in (textObj || {}) ? title : (c.key ?? title);
        visitNode(c, textObj?.[key], [...prefix, title]);
      }
      // A node can also carry a default child keyed by "".
      if (textObj && '' in textObj && !node.nodes.some((c) => (c.enTitle || c.title) === '')) walkNode(textObj[''], prefix);
      return;
    }
    walkNode(textObj, prefix);
  };
  const walkNode = (val, prefix) => {
    const base = prefix.filter(Boolean).join(', ');
    const rec = (v, idx) => {
      if (v == null) return;
      if (typeof v === 'string') { if (v.trim()) out.push({ ref: `${base}${idx.length ? ' ' + idx.join(':') : ''}`, text: v }); return; }
      if (Array.isArray(v)) v.forEach((x, i) => rec(x, [...idx, i + 1]));
      else if (typeof v === 'object') for (const [k, x] of Object.entries(v)) rec(x, idx); // unexpected shape: keep order
    };
    rec(val, []);
  };
  if (json.schema?.nodes?.length) visitNode(json.schema, json.text, []);
  else walk(json.text, []);
  return out;
}

// Hebrew niqqud + cantillation (and the Arabic block ia-ocr-agreement strips alongside). EDITION-level
// pointing, not text: Sefaria's "Vocalized" versions point what the print does not.
export const POINTING_RE = /[֑-ׇֽֿׁׂׅׄ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Sefaria segment markup → plain text (tags dropped, entities decoded). Stored text, not scoring. */
export function cleanSegment(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<sup[^>]*>.*?<\/sup>/gi, ' ')          // footnote markers
    .replace(/<i class="footnote"[^>]*>.*?<\/i>/gi, ' ') // inline footnotes
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .normalize('NFC')
    .trim();
}

/**
 * Normalise for MATCHING only (never stored): NFC, pointing stripped, maqaf → space, final letters
 * folded, abbreviation marks (geresh/gershayim/quotes) dropped so ר"ש and רש agree, every
 * non-Hebrew-letter → space, spaces collapsed.
 */
export function normHe(text) {
  return String(text || '').normalize('NFC')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
    .replace(POINTING_RE, '')
    .replace(/־/g, ' ')
    .replace(/["'׳״‘’“”]/g, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[^א-ת]+/g, ' ')
    .trim();
}



/**
 * The version as one matchable stream. `letters` is the normalised text with spaces removed;
 * `seg[i]` is the segment index and `off[i]` the char offset IN THE CLEANED SEGMENT TEXT of letter i,
 * so a letter range maps back to stored text exactly.
 */
export function buildStream(segments) {
  const clean = segments.map((s) => cleanSegment(s.text));
  const letters = [];
  const seg = [];
  const off = [];
  clean.forEach((t, si) => {
    // Walk the cleaned text char by char so offsets stay exact.
    for (let i = 0; i < t.length; i++) {
      let c = t[i].normalize('NFC');
      if (!/[א-ת]/.test(c)) continue;
      c = FINALS[c] || c;
      letters.push(c); seg.push(si); off.push(i);
    }
  });
  return { segments, clean, letters: letters.join(''), seg: Int32Array.from(seg), off: Int32Array.from(off) };
}

/** k-gram → positions index over `letters`. */
export function buildIndex(letters, k = 6) {
  const idx = new Map();
  for (let i = 0; i + k <= letters.length; i++) {
    const g = letters.slice(i, i + k);
    const a = idx.get(g);
    if (a) { if (a.length < 64) a.push(i); } else idx.set(g, [i]); // cap: very common grams carry no location
  }
  return { k, idx };
}

/**
 * Locate a query (letters, no spaces) in the stream by k-gram offset voting. Returns the best implied
 * START position of the query, the share of the query's grams that voted for it (± `slack` letters),
 * and the runner-up — a query that matches two places equally is ambiguous and must not anchor.
 * `lo`/`hi` restrict the search to a window.
 */
export function locate(query, index, { lo = 0, hi = Infinity, slack = 8 } = {}) {
  const { k, idx } = index;
  const votes = new Map();
  const n = Math.max(0, query.length - k + 1);
  for (let j = 0; j < n; j++) {
    const ps = idx.get(query.slice(j, j + k));
    if (!ps || ps.length >= 64) continue;
    for (const p of ps) {
      if (p < lo || p > hi) continue;
      const s = Math.round((p - j) / slack);
      votes.set(s, (votes.get(s) || 0) + 1);
    }
  }
  if (!votes.size || !n) return { pos: null, share: 0, second: 0, grams: n };
  // Sum each bucket with its neighbours (an indel shifts the implied start by a few letters).
  const sum = (s) => (votes.get(s - 1) || 0) + (votes.get(s) || 0) + (votes.get(s + 1) || 0);
  let best = null, bv = -1;
  for (const s of votes.keys()) { const v = sum(s); if (v > bv) { bv = v; best = s; } }
  let second = 0;
  for (const s of votes.keys()) if (Math.abs(s - best) > 3) second = Math.max(second, sum(s));
  return { pos: best * slack, share: bv / n, second: second / n, grams: n };
}

/**
 * Semi-global alignment of `q` inside `t` (free leading/trailing text in t; match 2, mismatch -1,
 * gap -1). Returns the end index in t (exclusive) of the best placement and the share of q's letters
 * matched on that path.
 */
export function fitEnd(q, t) {
  const n = q.length, m = t.length;
  if (!n || !m) return { end: null, identity: 0 };
  let prevS = new Int32Array(m + 1), prevM = new Int32Array(m + 1);
  let curS = new Int32Array(m + 1), curM = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    curS[0] = -i; curM[0] = 0;
    const qi = q[i - 1];
    for (let j = 1; j <= m; j++) {
      const eq = qi === t[j - 1];
      const d = prevS[j - 1] + (eq ? 2 : -1);
      const u = prevS[j] - 1;
      const l = curS[j - 1] - 1;
      if (d >= u && d >= l) { curS[j] = d; curM[j] = prevM[j - 1] + (eq ? 1 : 0); }
      else if (u >= l) { curS[j] = u; curM[j] = prevM[j]; }
      else { curS[j] = l; curM[j] = curM[j - 1]; }
    }
    [prevS, curS] = [curS, prevS];
    [prevM, curM] = [curM, prevM];
  }
  let bj = 0;
  for (let j = 1; j <= m; j++) if (prevS[j] > prevS[bj]) bj = j;
  return { end: bj, identity: prevM[bj] / n };
}

/**
 * Anchor at the END of a page whose text we hold (`side: 'end'`), or at its START (`side: 'start'`).
 * Coarse: the page's last (first) `coarse` letters located by k-gram offset voting — robust to a noisy
 * OCR (measured: the stored Gemini reading of these Rashi-type prints confuses א/ל, ה/ק, ס/ש freely,
 * so a 60-letter exact anchor found nothing on 3 books). Fine: the last (first) `fine` letters aligned
 * semi-globally in a ±`radius` window around the coarse estimate. Returns the stream position just
 * AFTER the page (end) or AT its first letter (start), with the evidence.
 */
export function anchorAt(q, index, stream, { side = 'end', coarse = 600, fine = 150, radius = 400, lo: wlo = 0, hi: whi = Infinity } = {}) {
  if (q.length < 200) return { pos: null, reason: 'too-short', share: 0, second: 0, identity: 0 };
  const piece = side === 'end' ? q.slice(-coarse) : q.slice(0, coarse);
  const r = locate(piece, index, { slack: 16, lo: wlo, hi: whi });
  if (r.pos == null) return { ...r, pos: null, reason: 'no-match', identity: 0 };
  const est = side === 'end' ? r.pos + piece.length : r.pos;
  const lo = Math.max(0, est - radius), hi = Math.min(stream.letters.length, est + radius);
  const win = stream.letters.slice(lo, hi);
  let pos, identity;
  if (side === 'end') {
    const f = fitEnd(q.slice(-fine), win);
    pos = f.end == null ? null : lo + f.end; identity = f.identity;
  } else {
    // Align the reversed head inside the reversed window: its "end" there is the start here.
    const rev = (s) => [...s].reverse().join('');
    const f = fitEnd(rev(q.slice(0, fine)), rev(win));
    pos = f.end == null ? null : hi - f.end; identity = f.identity;
  }
  return { pos, share: r.share, second: r.second, identity, coarse_pos: est };
}

/**
 * Stored text for a letter range [a, b) of the stream: the cleaned segment text from the letter's
 * segment offset, extended to word boundaries (a page break inside a word belongs to the page that
 * holds most of it — here, the page the word STARTS on), one segment per line.
 */
export function spanText(stream, a, b) {
  if (b <= a) return '';
  const { clean, seg, off } = stream;
  const s0 = seg[a], s1 = seg[b - 1];
  let o0 = off[a];
  // Back up to the start of the word containing letter a.
  while (o0 > 0 && !/\s/.test(clean[s0][o0 - 1])) o0--;
  let o1 = off[b - 1] + 1;
  // Forward to the end of the word containing letter b-1.
  while (o1 < clean[s1].length && !/\s/.test(clean[s1][o1])) o1++;
  const parts = [];
  for (let s = s0; s <= s1; s++) {
    const t = clean[s];
    parts.push(t.slice(s === s0 ? o0 : 0, s === s1 ? o1 : t.length).trim());
  }
  return parts.filter(Boolean).join('\n');
}

/** The letters of a Kraken read (run with --base-dir R, so already in logical order), normalised. */
export function krakenLetters(text) {
  return normHe(text).replace(/ /g, '');
}

/**
 * Letter k-gram multiset of a letter string. ORDER-FREE on purpose: Kraken's line/column order on a
 * two-column page is not the edition's (measured on Zohar Chadash p13: the same lines, columns
 * swapped), and Sefaria's segment order can differ from a print's column layout.
 */
export function gramBag(letters, k = 4) {
  const m = new Map();
  for (let i = 0; i + k <= letters.length; i++) { const g = letters.slice(i, i + k); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}

/** Share of A's grams (with multiplicity) also present in B. 0 for an empty A — the caller must treat that as UNJUDGEABLE. */
export function containment(A, B) {
  let n = 0, t = 0;
  for (const [g, c] of A) { t += c; n += Math.min(c, B.get(g) || 0); }
  return t ? n / t : 0;
}

/**
 * Rules v1 — fixed 2026-10-01 BEFORE the pilot's scores were seen (calibration: three Kraken reads,
 * Zohar Chadash p13, Pardes p38, Tikkunei p33, each against its located span and shifted spans).
 *
 * Anchors: a text page (stored OCR, or a Kraken read of its image when the OCR does not locate)
 * must locate MONOTONE with its stored-OCR neighbours; its boundary letters must align at ≥
 * anchorIdentity (chance, measured against far windows: 0.26–0.37). A span must be within spanRatio
 * of (book median letters per page × pages in the run).
 *
 * Verification (per page): score = F1 of letter-4-gram precision (read ⊂ span) and recall (span ⊂
 * read). UNINFORMATIVE when the read has < minReadLetters letters or its best F1 in the window is <
 * informativeFloor (the reader failed — unjudgeable, not negative). VERIFIED only when the fitted
 * span (shift 0) is the best of shifts −3…+3 page-lengths AND beats the best wrong-page control
 * (|shift| ≥ 2 and a far span) by ≥ minMargin absolute AND ≥ minRatio × (calibration: located spans
 * 0.22 vs controls 0.09–0.10; the Tikkunei page, whose print carries a commentary Sefaria lacks,
 * 0.10 vs 0.10 — refused, as it should be). Everything else is refused.
 */
export const FIT_RULES = Object.freeze({
  version: 1, minTextLetters: 300, anchorIdentity: 0.45, spanRatio: [0.5, 1.8],
  minReadLetters: 300, informativeFloor: 0.12, minMargin: 0.08, minRatio: 1.8,
});

export function fitClass(score, rules = FIT_RULES) {
  if (!score || score.read_letters < rules.minReadLetters) return 'uninformative';
  const best = score.by_shift?.[score.best_shift] ?? score.f1;
  if (best < rules.informativeFloor) return 'uninformative';
  if (score.best_shift !== 0) return 'misaligned';
  return score.f1 - score.control >= rules.minMargin && score.f1 >= rules.minRatio * score.control ? 'verified' : 'weak';
}
