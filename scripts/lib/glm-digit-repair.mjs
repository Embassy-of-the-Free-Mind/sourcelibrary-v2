// PRIOR ART: scripts/eval/kraken-refused-4686/analyze.mjs (counts digit strings and aligns reference lines
// to an arm, but only to MEASURE; it never edits text); scripts/lib/ocr-loop-guard.mjs (a pure verdict over
// one engine's text); the #5660 r3 / #5830 GLM-OCR work (reads GLM text, never merges it with another
// engine). Nothing in the repo merges two engines' reads of one page token by token.
/**
 * glm-digit-repair.mjs — put GLM-OCR's NUMBERS into Kraken's text, and nothing else (#4686).
 *
 * WHY. On 17th-century English print Kraken CATMuS-Print reads the letters better than anything else we
 * have (CER 0.009 on the refused Phil Trans pages), but it reads old-style figures as letters: "66 or 67" →
 * "cé or éy", "10." → "io.", "5°" → "g°". Only 78.5 % of printed digit strings survive. GLM-OCR reads the
 * figures as figures, but drops page furniture and substitutes plausible words. So the page keeps
 * Kraken's text and takes only GLM's number tokens, where the two reads align.
 *
 * THE RULE (preregistered in PREREGISTRATION-kraken-refused-4686.md, Amendment 1, before any GLM output
 * on the eval pages existed):
 *   1. Tokens are whitespace-separated. Each is lead + core + trail, core running from the first to the last
 *      letter-or-number character. Tokens are compared folded (lower case, ſ→s, core only).
 *   2. Kraken's and GLM's token sequences are aligned by longest common subsequence. Only the GAPS between
 *      matched tokens are candidates; a token both engines agree on is never touched.
 *   3. In a gap with the same number of tokens on both sides (≤ 6), each pair (k, g) is replaced when
 *      g's core has a decimal digit and at most 3 letters, k's core differs, and k is number-confusable:
 *      k's core has a digit, or it is ≤ 4 characters and within one character of g's length (never a
 *      spelled number or roman numeral: "ten" → "10" would be GLM normalising the print, not reading it).
 *      The result is k's lead + g's core + (k's trail, or g's if k has none).
 *   4. In a gap of 1–3 tokens a side with unequal counts, all on one Kraken line: replaced as a whole by
 *      GLM's tokens when every GLM token is a number token (rule 3) or bare punctuation, at least one is a
 *      number, and every Kraken token's core has a digit or is at most 2 characters ("cé", "g", "io").
 *   5. Nothing else changes: GLM's words never enter, a token GLM omitted is kept, a Kraken line GLM does
 *      not have (running heads, catchwords, page numbers) is kept as Kraken read it, and line breaks are
 *      Kraken's.
 */

// A combining mark belongs to the letter before it: Kraken writes some accents decomposed ("ce\u0301"), and a
// mark left in the trail would survive the repair as "66\u0301" (found on the eval, p. 702, after scoring).
const isWordChar = (c) => /[\p{L}\p{N}\p{M}]/u.test(c);
const LETTERS = /\p{L}/gu;
const DIGIT = /\p{Nd}/u;

/** lead / core / trail of one whitespace token. */
export function splitToken(tok) {
  const cs = [...tok];
  let a = 0, b = cs.length;
  while (a < b && !isWordChar(cs[a])) a++;
  while (b > a && !isWordChar(cs[b - 1])) b--;
  return { lead: cs.slice(0, a).join(''), core: cs.slice(a, b).join(''), trail: cs.slice(b).join('') };
}
const fold = (s) => String(s).normalize('NFC').toLowerCase().replace(/ſ/g, 's');
const keyOf = (tok) => { const { core } = splitToken(tok); return core ? fold(core) : tok; };
const letterCount = (s) => (String(s).match(LETTERS) || []).length;

/** g is a number token: core has a decimal digit and at most 3 letters ("5th", "8vo", "2½", "10"). */
export function isNumberToken(g) {
  const { core } = splitToken(g);
  return DIGIT.test(core) && letterCount(core) <= 3;
}
/** k could be a misread number: has a digit, or is short (≤ 4 chars). `lenOf` tightens rule 3. */
const NUMBER_WORDS = /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|first|unus|duo|tres|sex|septem|octo|novem|decem|vi|vii|viii|ix|x|xi|xii|ii|iii|iv)$/;
function confusable(kCore, gCore) {
  if (DIGIT.test(kCore)) return true;
  if (NUMBER_WORDS.test(fold(kCore))) return false;   // a spelled number or numeral GLM normalised — Kraken's is the print
  const kl = [...kCore].length;
  if (kl === 0 || kl > 4) return false;
  return gCore == null || Math.abs(kl - [...gCore].length) <= 1;
}

/**
 * GLM-OCR's "Text Recognition:" output is near-plain text but can carry LaTeX for a degree sign or a
 * superscript, and markdown emphasis. Folded to plain characters before tokenising.
 */
export function plainGlm(s) {
  return String(s || '').normalize('NFC')
    .replace(/\$\s*\^\s*\{?\\circ\}?\s*\$/g, '°').replace(/\^\s*\{?\\circ\}?/g, '°').replace(/\\circ/g, '°')
    .replace(/\\frac\{(\d+)\}\{(\d+)\}/g, '$1/$2')
    .replace(/\$([^$\n]{0,40})\$/g, '$1').replace(/\\[()[\]]/g, '')
    .replace(/[{}]/g, '').replace(/\*\*|__/g, '').replace(/^#+\s*/gm, '');
}

function tokens(text, withLines) {
  const out = [];
  const lines = String(text).split('\n');
  lines.forEach((line, li) => {
    const re = /\S+/g; let m;
    while ((m = re.exec(line))) out.push(withLines ? { t: m[0], line: li, start: m.index, end: m.index + m[0].length } : { t: m[0] });
  });
  return { lines, toks: out };
}

/** LCS over keys; returns matched index pairs in order. */
function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  const W = m + 1;
  const dp = new Uint16Array((n + 1) * W);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i * W + j] = a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  }
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * repairDigits(krakenText, glmText) → { text, changes: [{ line, from, to, rule }] }
 * Pure. With an empty GLM text it returns Kraken's text unchanged.
 */
export function repairDigits(krakenText, glmText) {
  const K = tokens(krakenText, true), G = tokens(plainGlm(glmText), false);
  if (!K.toks.length || !G.toks.length) return { text: String(krakenText), changes: [] };
  const kk = K.toks.map(x => keyOf(x.t)), gk = G.toks.map(x => keyOf(x.t));
  // keys to small ints so the DP compares numbers
  const ids = new Map(); const id = (s) => { if (!ids.has(s)) ids.set(s, ids.size); return ids.get(s); };
  const pairs = lcsPairs(kk.map(id), gk.map(id));
  const edits = []; // { tokIdx: [from..to], replacement, rule }
  const gaps = []; let pi = 0, pj = 0;
  for (const [i, j] of [...pairs, [K.toks.length, G.toks.length]]) { if (i > pi || j > pj) gaps.push([pi, i, pj, j]); pi = i + 1; pj = j + 1; }
  for (const [i0, i1, j0, j1] of gaps) {
    const nk = i1 - i0, ng = j1 - j0;
    if (!nk || !ng) continue;
    if (nk === ng && nk <= 6) {
      for (let x = 0; x < nk; x++) {
        const k = K.toks[i0 + x].t, g = G.toks[j0 + x].t;
        if (!isNumberToken(g)) continue;
        const ks = splitToken(k), gs = splitToken(g);
        if (fold(ks.core) === fold(gs.core) || !confusable(ks.core, gs.core)) continue;
        edits.push({ from: i0 + x, to: i0 + x, replacement: ks.lead + gs.core + (ks.trail || gs.trail), rule: 3 });
      }
      continue;
    }
    if (nk <= 3 && ng <= 3) {
      const kt = K.toks.slice(i0, i1), gt = G.toks.slice(j0, j1).map(x => x.t);
      if (new Set(kt.map(x => x.line)).size !== 1) continue;
      const gOk = gt.every(g => isNumberToken(g) || !splitToken(g).core) && gt.some(isNumberToken);
      const kOk = kt.every(x => { const c = splitToken(x.t).core; return DIGIT.test(c) || ([...c].length <= 2 && !NUMBER_WORDS.test(fold(c))); });
      if (gOk && kOk) edits.push({ from: i0, to: i1 - 1, replacement: gt.join(' '), rule: 4 });
    }
  }
  if (!edits.length) return { text: String(krakenText), changes: [] };
  // apply right-to-left per line so offsets stay valid
  const lines = [...K.lines];
  const changes = [];
  for (const e of edits.sort((a, b) => b.from - a.from)) {
    const a = K.toks[e.from], b = K.toks[e.to];
    const line = lines[a.line];
    changes.unshift({ line: a.line, from: line.slice(a.start, b.end), to: e.replacement, rule: e.rule });
    lines[a.line] = line.slice(0, a.start) + e.replacement + line.slice(b.end);
  }
  return { text: lines.join('\n'), changes };
}
