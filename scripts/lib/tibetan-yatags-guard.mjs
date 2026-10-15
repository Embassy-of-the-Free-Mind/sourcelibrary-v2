// PRIOR ART: scripts/eval/tibetan-correct-6560/alignpairs.py (the Needleman–Wunsch syllable aligner the #6560 eval
// scored with; Python, returns pairs but no text offsets, so it cannot revert a change in place) and
// scripts/lib/block-drift.mjs (compares Yigdzin recurrences, no alignment). This ports the same aligner to JS with
// character offsets, for the write path: cli-ocr.mjs apply --correct needs to list and revert single syllables.
/**
 * The ya-btags guard for a model correction of a Tibetan read (#6560).
 *
 * The 30-folio test found the one systematic way a corrector writes the canonical text instead of the leaf: it adds
 * a subjoined ya to མ (མི → མྱི, མེད → མྱེད), the old orthography the Derge print uses, where the leaf has the plain
 * form (Pro 21 times, Flash low twice on seq 23). Every change that only adds or removes a ya-btags under མ is held
 * here and kept only if a reader with the image open confirms it from the leaf.
 *
 *   syllableTokens(text)          -> [{ syl, start, end }] in text order (tsheg, shad and whitespace separate)
 *   alignSyllables(a, b)          -> [[i, j]] with null for a gap (scores 2/−1/−1, same tie-breaking as alignpairs.py)
 *   diffSyllables(draft, next)    -> { pairs, hunks, changed, draftN, nextN }: hunks are the runs that differ
 *   yatagsHits(draft, next)       -> [{ k, line, draft, next, ctxBefore, ctxAfter }] one per substituted syllable
 *                                    whose two forms differ only by ྱ under མ
 *   revertHits(next, hits, keepK) -> next with every hit NOT in keepK put back to the draft syllable
 */

const SEP = /[༁-༊་།-༗༚-༟༺-༽྾-࿏\s]+/u;
const SEP_G = new RegExp(SEP.source, 'gu');
const MA_YA = /མྱ/gu; // མ + subjoined ya

export function syllableTokens(text) {
  const t = String(text).normalize('NFC');
  const out = [];
  let pos = 0;
  for (const m of t.matchAll(SEP_G)) {
    if (m.index > pos) out.push({ syl: t.slice(pos, m.index), start: pos, end: m.index });
    pos = m.index + m[0].length;
  }
  if (pos < t.length) out.push({ syl: t.slice(pos), start: pos, end: t.length });
  // a tag line (<leaf-break/>) is not a syllable
  return out.filter((x) => !/^<.*>$/.test(x.syl) && /[ཀ-ྼ]/u.test(x.syl));
}

export function alignSyllables(a, b) {
  const n = a.length, m = b.length;
  if (!n || !m) return [...a.map((_, i) => [i, null]), ...b.map((_, j) => [null, j])];
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  let prev = new Int32Array(m + 1);
  for (let j = 1; j <= m; j++) { prev[j] = -j; back[0][j] = 2; }
  for (let i = 1; i <= n; i++) {
    const cur = new Int32Array(m + 1);
    cur[0] = -i; back[i][0] = 1;
    for (let j = 1; j <= m; j++) {
      const d = prev[j - 1] + (a[i - 1] === b[j - 1] ? 2 : -1), u = prev[j] - 1, l = cur[j - 1] - 1;
      if (d >= u && d >= l) { cur[j] = d; back[i][j] = 0; } else if (u >= l) { cur[j] = u; back[i][j] = 1; } else { cur[j] = l; back[i][j] = 2; }
    }
    prev = cur;
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const k = back[i][j];
    if (i > 0 && j > 0 && k === 0) { pairs.push([i - 1, j - 1]); i--; j--; } else if (i > 0 && (k === 1 || j === 0)) { pairs.push([i - 1, null]); i--; } else { pairs.push([null, j - 1]); j--; }
  }
  return pairs.reverse();
}

export function diffSyllables(draft, next) {
  const A = syllableTokens(draft), B = syllableTokens(next);
  const pairs = alignSyllables(A.map((x) => x.syl), B.map((x) => x.syl));
  const hunks = [];
  let cur = null, same = 0;
  for (const [i, j] of pairs) {
    const eq = i !== null && j !== null && A[i].syl === B[j].syl;
    if (eq) { same++; if (cur) { hunks.push(cur); cur = null; } continue; }
    cur ??= { a: [], b: [] };
    if (i !== null) cur.a.push(i);
    if (j !== null) cur.b.push(j);
  }
  if (cur) hunks.push(cur);
  return { A, B, pairs, hunks, same, draftN: A.length, nextN: B.length, changed: Math.max(A.length, B.length) - same };
}

const lineOf = (text, off) => String(text).normalize('NFC').slice(0, off).split('\n').length;

export function yatagsHits(draft, next) {
  const { A, B, pairs } = diffSyllables(draft, next);
  const hits = [];
  for (const [i, j] of pairs) {
    if (i === null || j === null) continue;
    const a = A[i].syl, b = B[j].syl;
    if (a === b) continue;
    if (!a.includes('མྱ') && !b.includes('མྱ')) continue;
    if (a.replace(MA_YA, 'མ') !== b.replace(MA_YA, 'མ')) continue;
    hits.push({
      k: hits.length, j, line: lineOf(next, B[j].start), draft: a, next: b,
      ctxBefore: B.slice(Math.max(0, j - 4), j).map((x) => x.syl).join('་'),
      ctxAfter: B.slice(j + 1, j + 5).map((x) => x.syl).join('་'),
    });
  }
  return hits;
}

export function revertHits(next, hits, keepK) {
  const t = String(next).normalize('NFC');
  const B = syllableTokens(t);
  let out = t;
  for (const h of [...hits].sort((x, y) => y.j - x.j)) {
    if (keepK.has(h.k)) continue;
    const tok = B[h.j];
    if (!tok || tok.syl !== h.next) throw new Error(`revertHits: syllable ${h.j} is not ${h.next}`);
    out = out.slice(0, tok.start) + h.draft + out.slice(tok.end);
  }
  return out;
}
