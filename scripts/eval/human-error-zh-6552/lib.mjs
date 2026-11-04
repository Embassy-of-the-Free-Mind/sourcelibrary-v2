// PRIOR ART: ground-truth-5935/lib.mjs bodyCer (fitting alignment, returns runs but over folded text only: this keeps each
// character's raw form and position so a span can be cropped and shown); zh-skqs-5568-kanripo.mjs fold (imported table);
// results/human-ceiling-5762-2026-10/transcription/cjk-recurring-pairs.json (the glyph pairs, imported).
// #6552: differences between a typed text and a read as units for a blind reader. Text stays under $JOB_SCRATCH.
import fs from 'node:fs';
const PAIRS = JSON.parse(fs.readFileSync(new URL('../results/human-ceiling-5762-2026-10/transcription/cjk-recurring-pairs.json', import.meta.url), 'utf8')).pairs;
const VAR = { 徳: '德', 増: '增', 䘮: '喪', 録: '錄', 説: '說', 衞: '衛', 庿: '廟', 蔵: '藏', 逺: '遠', 嵗: '歲', 圎: '圓', 曽: '曾', 黄: '黃', 爲: '為', 𤣥: '玄', 摠: '總', 盖: '蓋', 却: '卻', 卽: '即', 旣: '既', 敎: '教', 毎: '每', 靑: '青', 呉: '吳', 别: '別', 兾: '冀', 竒: '奇', 着: '著', 隂: '陰', 恊: '協' };
for (const [a, b] of PAIRS) if (a !== b && !VAR[b]) VAR[b] = a;
export const foldCh = (c) => VAR[c] || c;
export const hanChars = (s) => [...String(s || '').normalize('NFC')].filter((c) => /\p{Script=Han}/u.test(c));

// Near-glyph pairs, shaped like real keying and reading slips (#5762's 使/便, 住/往, 已/己 and the usual lookalikes).
const GROUPS = ['已己巳', '未末', '日曰', '大太犬', '天夭', '土士', '王玉主', '人入八', '于干千', '刀力', '右石', '今令', '使便', '住往', '侍待持特', '博傅', '陳陣', '夫失', '矢失', '東束', '田由甲申', '目自白百', '子孑', '才木本', '分兮', '云去', '牛午', '民氏', '手毛', '代伐', '作非', '問間聞', '微徵徽', '衰哀', '宜宣', '貝具見', '免兔', '思恩', '受愛', '枝技', '根報', '復後', '徒徙', '辨辯', '蓋盡', '諸請', '常當', '時特', '聖望', '則財'];
const NEAR = new Map();
for (const g of GROUPS) for (const c of g) NEAR.set(c, [...g].filter((x) => x !== c && foldCh(x) !== foldCh(c)));
export const nearOf = (c) => NEAR.get(c) || [];

/** Fitting alignment of B inside A (A's edges free). A, B: arrays of raw chars. Returns aligned pairs [i|null, j|null]. */
export function align(A, B) {
  const n = A.length, m = B.length, W = m + 1;
  const dp = new Int32Array((n + 1) * W), bt = new Uint8Array((n + 1) * W);
  for (let j = 1; j <= m; j++) { dp[j] = j; bt[j] = 2; }
  for (let i = 1; i <= n; i++) {
    const fa = foldCh(A[i - 1]);
    for (let j = 1; j <= m; j++) {
      const s = dp[(i - 1) * W + j - 1] + (fa === foldCh(B[j - 1]) ? 0 : 1), u = dp[(i - 1) * W + j] + 1, l = dp[i * W + j - 1] + 1;
      const v = Math.min(s, u, l); dp[i * W + j] = v; bt[i * W + j] = v === s ? 0 : v === u ? 1 : 2;
    }
  }
  let i = 0; for (let k = 1; k <= n; k++) if (dp[k * W + m] < dp[i * W + m]) i = k;
  const end = i; let j = m; const out = [];
  while (j > 0) { const b = bt[i * W + j]; if (i > 0 && b === 0) { out.push([--i, --j]); } else if (i > 0 && b === 1) { out.push([--i, null]); } else { out.push([null, --j]); } }
  return { pairs: out.reverse(), start: i, end, edits: dp[end * W + m] };
}

/** Difference runs. Equal-length runs up to 4 chars split 1:1. Long or reordered runs are structure, not readings. */
export function diffRuns(typed, ocr) {
  const { pairs, start, end, edits } = align(typed, ocr);
  const runs = []; let cur = null, equal = 0; const agreed = [];
  pairs.forEach(([i, j], k) => {
    const same = i != null && j != null && foldCh(typed[i]) === foldCh(ocr[j]);
    if (same) { equal++; agreed.push({ i, j, k }); cur = null; return; }
    if (!cur) { cur = { t: [], o: [], k0: k, ti: i, oj: j }; runs.push(cur); }
    if (i != null) { cur.t.push(typed[i]); cur.ti ??= i; }
    if (j != null) { cur.o.push(ocr[j]); cur.oj ??= j; }
    cur.k1 = k;
  });
  const consensus = (k, dir, n) => { const s = []; for (let q = k + dir; q >= 0 && q < pairs.length && s.length < n; q += dir) { const [i, j] = pairs[q]; if (i != null && j != null && foldCh(typed[i]) === foldCh(ocr[j])) s.push(ocr[j]); else s.push('□'); } return (dir < 0 ? s.reverse() : s).join(''); };
  const out = [];
  for (const r of runs) {
    if (r.t.length === r.o.length && r.t.length <= 4) {
      r.t.forEach((c, x) => out.push({ t: c, o: r.o[x], k: r.k0 + x, kind: 'sub' }));
    } else out.push({ t: r.t.join(''), o: r.o.join(''), k: r.k0, kind: 'run', len: Math.max(r.t.length, r.o.length) });
  }
  const pool = (side, self) => runs.filter((r) => r !== self).flatMap((r) => r[side]);
  for (const d of out) {
    d.left = consensus(d.k, -1, 8); d.right = consensus(d.k + ((d.kind === 'run' ? [...d.t].length + [...d.o].length : 1) - 1), 1, 8);
    if (d.kind === 'run') {
      const own = runs.find((r) => r.k0 === d.k), side = own.t.length >= own.o.length ? 'o' : 't', chars = own[side === 'o' ? 't' : 'o'], others = pool(side, own);
      const hit = chars.filter((c) => others.includes(c)).length;
      d.structure = d.len > 12 ? 'long' : (d.len >= 4 && hit / chars.length >= 0.7 ? 'reorder' : null);
    }
  }
  return { diffs: out, agreed, pairs, typedChars: end - start, ocrChars: ocr.length, edits, consensus };
}
export const mulberry = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const shuffled = (a, rng) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
