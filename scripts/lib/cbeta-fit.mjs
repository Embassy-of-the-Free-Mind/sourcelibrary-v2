// PRIOR ART: scripts/works-catalog/import-cbeta-text.mjs (#2554) extracts CBETA TEI P5 into pages but
// segments on Taishō <pb>, keeps <cb:mulu> (the TOC, which then prints twice) and drops every <note>,
// including the inline notes the block actually prints; its gaiji rule (unicode-char > normal) is
// kept here. scripts/lib/derge-tengyur.mjs (#5497) is the alignment shape (claim → measure against
// an independent read → wrong-page control → refuse); its folio LABELS do not exist for a woodblock
// print of a different edition, so the claim here comes from neighbour anchors (#5560's method).
// The kyūjitai/shinjitai pairs are scripts/eval/benchmark-score.mjs's KYU_SHIN (#4743), which is a
// private const of a CLI and cannot be imported; scripts/works-catalog/lib.mjs CJK_VARIANTS is a
// title fold for catalogue matching. Both lists are merged below with the Chinese variant pairs a
// Song/Yuan woodblock prints against the Taishō's forms.
//
// cbeta-fit — pure helpers for fitting CBETA's typed text to the pages of a scanned print (#5566).
//
//   extractTei(xml, gaiji)   TEI P5 body → reading text (+ inline notes, verse lines, paragraphs) and,
//                            for every character, the Taishō line (`lb`) it sits on
//   foldHan(text)            the Han characters only, variant-folded, with a map back into the text
//   fitBook(reads, F)        locate each page's independent read in the folded text, then cut each
//                            page's span between its NEIGHBOURS' anchors (never its own read)
//   verifyPage(...)          score the page's own read against its span and against wrong pages
//
// No DB, no network. The importer is scripts/import/cbeta-chan-import.mjs.

import { createHash } from 'node:crypto';

// ── variant fold ─────────────────────────────────────────────────────────────
// Pairs (a, b) are merged into one class; every member folds to the class's first-seen member.
// Folding is for MATCHING only — stored text is CBETA's, untouched.
const PAIRS = [
  // scripts/eval/benchmark-score.mjs KYU_SHIN (kyūjitai → shinjitai), verbatim
  '氣気觸触發発傳伝禮礼醫医體体國国學学會会當当對対經経藥薬寶宝齊斉齋斎變変邊辺圓円廣広應応惡悪榮栄營営藝芸壓圧鹽塩澤沢擇択譯訳驛駅釋釈澁渋濕湿實実寫写收収從従縱縦讀読續続賣売讓譲亂乱亞亜圍囲爲為僞偽衞衛舊旧兒児條条處処與与齒歯齡齢壽寿圖図團団晝昼點点黨党燈灯獨独樂楽靈霊勞労勵励歷歴曆暦龍竜隸隷兩両獵猟錄録麥麦滿満萬万默黙彌弥譽誉餘余豫予嚴厳髓髄隨随數数樞枢聲声靜静濟済劑剤攝摂淺浅錢銭賤賎踐践纖繊專専戰戦禪禅單単彈弾斷断遲遅廳庁徵徴聽聴鎭鎮鐵鉄轉転屆届縣県驗験險険檢検劍剣顯顕權権勸勧觀観歡歓鑛鉱鑄鋳絲糸獸獣敍叙將将奬奨狀状乘乗剩剰淨浄燒焼稱称證証囑嘱眞真盡尽竊窃說説拜拝廢廃佛仏拂払辯弁辨弁步歩豐豊每毎黑黒龜亀假仮價価繪絵壞壊懷懐覺覚舉挙歸帰據拠徑径輕軽莖茎繼継惠恵鷄鶏缺欠儉倹圈圏獻献效効號号碎砕櫻桜參参慘惨產産蠶蚕贊賛殘残辭辞肅粛緖緒涉渉疊畳醉酔雙双壯壮莊荘裝装藏蔵臟臓總総騷騒增増屬属帶帯滯滞臺台擔担膽胆蟲虫貳弐惱悩腦脳霸覇髮髪拔抜晚晩蠻蛮濱浜搖揺樣様謠謡來来賴頼覽覧樓楼灣湾淚涙沒没稻稲廐厩冨富鬪闘關関陷陥隱隠靑青淸清敎教卽即槪概旣既溉漑硏研卷巻內内册冊咒呪曾曽溫温縕緼醬醤獎奨妝粧姊姉曉暁迴回廻回瀧滝籠篭鬭闘',
  // scripts/works-catalog/lib.mjs CJK_VARIANTS (title fold)
  '黙默寳寶厯歷戸戶畧略䟽疏徳德紀記叙敘寛寬勅敕顔顏虚虛',
  // Chinese print variants met against the Taishō (Song/Yuan blocks, Gozan reprints)
  '衆眾峯峰却卻羣群鉢缽囘回徧遍凢凡祕秘啓啟黃黄呑吞彥彦顚顛姸妍兎兔箇個竝並襍雜甞嘗脚腳雞鷄麁麤蹤踪縂總舘館碍礙渓溪谿溪菴庵盃杯閒間䇿策筭算畫画鑪爐炉爐銕鐵鉄鐵灮光恠怪亊事揔總惣總斈學敎教壻婿昬昏冝宜弃棄觧解蔵藏髙高隣鄰穉稚稺稚凾函鼔鼓皷鼓牀床艸草咲笑囙因亾亡丗世卋世笇算凖準况況効效',
];
const FOLD = new Map();
(() => {
  const parent = new Map();
  const find = (c) => { while (parent.get(c) !== c) c = parent.get(c); return c; };
  const add = (c) => { if (!parent.has(c)) parent.set(c, c); };
  for (const s of PAIRS) {
    const cs = [...s];
    for (let i = 0; i + 1 < cs.length; i += 2) {
      add(cs[i]); add(cs[i + 1]);
      const a = find(cs[i]), b = find(cs[i + 1]);
      if (a !== b) parent.set(b, a);
    }
  }
  for (const c of parent.keys()) { const r = find(c); if (r !== c) FOLD.set(c, r); }
})();

const HAN = /[\p{Script=Han}〇]/u;
export const foldChar = (c) => FOLD.get(c) || c;

/**
 * The Han characters of `text`, variant-folded, with `map[i]` = index in `text` of folded char i.
 * Kana (kunten, okurigana), Latin, digits, punctuation and layout are dropped. An empty result means
 * the text cannot be judged on Han (non-latin-text-operations.md) — callers must treat it as
 * UNJUDGEABLE, never as a mismatch.
 */
export function foldHan(text) {
  const chars = [];
  const map = [];
  let i = 0;
  for (const ch of String(text || '')) {
    if (HAN.test(ch)) { chars.push(foldChar(ch)); map.push(i); }
    i += ch.length;
  }
  return { f: chars, map };
}

// ── TEI extraction ───────────────────────────────────────────────────────────
// Dropped with their content: editorial notes (anything but place="inline"), variant readings
// (<rdg>, keep <lem>), the TOC (<cb:mulu>, it duplicates the head), the work number, the back
// matter, <sic> (keep <corr>), <orig> (keep <reg>). Kept and printed: inline notes (the block's
// double-line small characters) as （…）, verse lines, list items, heads, bylines, juan heads.
const SKIP = new Set(['rdg', 'cb:mulu', 'cb:docNumber', 'back', 'sic', 'orig', 'teiHeader', 'figure', 'cb:tt', 'cb:yin', 'cb:fan']);
const BLOCK = new Set(['p', 'head', 'byline', 'l', 'item', 'cb:jhead', 'trailer', 'row', 'lg', 'cb:juan', 'cb:div', 'list', 'table', 'cb:docNumber']);
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** CBETA gaiji id → character: the Unicode character, else the normalised form, else a visible marker. */
export function gaijiChar(gaiji, id) {
  const e = gaiji?.[id];
  if (!e) return `〔${id}〕`;
  return e['unicode-char'] || e.normal || `〔${e.zzs || id}〕`;
}

/**
 * @param {string} xml  one CBETA TEI P5 file
 * @param {object} gaiji  CBETA gaiji.json
 * @returns {{ text: string, lbs: {at: number, lb: string}[], juans: {at: number, n: number}[], title: string|null, author: string|null, unresolvedGaiji: number }}
 *   `lbs` / `juans` are change points: the Taishō line (or juan) in force from text offset `at`.
 */
export function extractTei(xml, gaiji) {
  const title = (xml.match(/<title level="m" xml:lang="zh-Hant">([^<]+)/) || xml.match(/<title level="m"[^>]*>([^<]+)/) || [])[1] || null;
  const author = (xml.match(/<author>([^<]+)<\/author>/) || [])[1] || null;
  const start = xml.indexOf('<body');
  if (start < 0) throw new Error('cbeta-fit: no <body>');
  const body = xml.slice(start);
  let out = '';
  const lbs = [];
  const juans = [];
  const stack = [];       // open element names, to match closes to SKIP / note
  let skipDepth = 0;
  let unresolvedGaiji = 0;
  const emit = (s) => { if (!skipDepth) out += s; };
  const newline = () => { if (!skipDepth && out && !out.endsWith('\n')) out = out.replace(/[ 　]+$/, '') + '\n'; };
  const re = /<(\/?)([A-Za-z:]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(body))) {
    const [, close, name, attrs, selfClose, txt] = m;
    if (txt != null) { emit(decode(txt).replace(/[ \t\r\n]+/g, '')); continue; }
    if (close) {
      const open = stack.pop();
      if (!open) continue;
      if (open.skip) skipDepth--;
      if (open.name === 'note' && !open.skip) emit('）');
      if (BLOCK.has(open.name)) newline();
      continue;
    }
    if (name === 'lb') { const n = (attrs.match(/\bn="([^"]+)"/) || [])[1]; const ed = (attrs.match(/\bed="([^"]+)"/) || [])[1]; if (n && !skipDepth && (!ed || ed === 'T' || ed === 'X' || ed.length === 1 || /^[A-Z]+$/.test(ed))) lbs.push({ at: out.length, lb: n }); continue; }
    if (name === 'milestone') { const n = (attrs.match(/\bn="(\d+)"/) || [])[1]; if (/unit="juan"/.test(attrs) && n) juans.push({ at: out.length, n: Number(n) }); continue; }
    if (name === 'g') {
      const id = (attrs.match(/ref="#([^"]+)"/) || [])[1];
      const c = gaijiChar(gaiji, id);
      if (c.startsWith('〔')) unresolvedGaiji++;
      emit(c);
      if (!selfClose) stack.push({ name, skip: true }), skipDepth++;   // <g>…</g> carries a fallback form; the map decides
      continue;
    }
    if (name === 'space' || name === 'caesura') { emit('　'); continue; }
    if (selfClose) { if (name === 'pb' || name === 'anchor') continue; if (BLOCK.has(name)) newline(); continue; }
    let skip = SKIP.has(name);
    if (name === 'note') skip = !/place="inline/.test(attrs);
    stack.push({ name, skip });
    if (skip) { skipDepth++; continue; }
    if (name === 'note') emit('（');
    if (BLOCK.has(name)) newline();
  }
  return { text: out.replace(/\n{2,}/g, '\n').trim(), lbs, juans, title, author, unresolvedGaiji };
}

/** The value in force at text offset `at` from a change-point list ({at, …}), by binary search. */
export function changeAt(points, at, key) {
  let lo = 0, hi = points.length - 1, best = null;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (points[mid].at <= at) { best = points[mid][key]; lo = mid + 1; } else hi = mid - 1; }
  return best;
}

// ── locating a read ──────────────────────────────────────────────────────────
const K = 3;   // seed length (folded Han characters)

/** Index of every K-gram of the folded work: gram → positions. */
export function buildIndex(F) {
  const idx = new Map();
  for (let i = 0; i + K <= F.length; i++) {
    const g = F.slice(i, i + K).join('');
    let a = idx.get(g);
    if (!a) idx.set(g, (a = []));
    a.push(i);
  }
  return idx;
}

/**
 * Local alignment (Smith-Waterman; match +2, mismatch −1, gap −1) of the read against F[from, to).
 * Returns the aligned stretch of F and how many READ characters it accounts for.
 */
export function alignLocal(R, F, from, to) {
  from = Math.max(0, from); to = Math.min(F.length, to);
  const n = R.length, m = to - from;
  if (!n || m <= 0) return { score: 0, matches: 0, fStart: from, fEnd: from, rStart: 0, rEnd: 0 };
  // Full matrices are fine at page scale (n ≤ ~1,500, m ≤ ~4,000) and give an exact traceback.
  const W = m + 1;
  const H = new Int32Array((n + 1) * W);
  let best = 0, bi = 0, bj = 0;
  for (let i = 1; i <= n; i++) {
    const ri = R[i - 1];
    for (let j = 1; j <= m; j++) {
      const d = H[(i - 1) * W + j - 1] + (ri === F[from + j - 1] ? 2 : -1);
      const u = H[(i - 1) * W + j] - 1;
      const l = H[i * W + j - 1] - 1;
      const v = Math.max(0, d, u, l);
      H[i * W + j] = v;
      if (v > best) { best = v; bi = i; bj = j; }
    }
  }
  let i = bi, j = bj, matches = 0;
  while (i > 0 && j > 0 && H[i * W + j] > 0) {
    const v = H[i * W + j];
    const eq = R[i - 1] === F[from + j - 1];
    if (v === H[(i - 1) * W + j - 1] + (eq ? 2 : -1)) { if (eq) matches++; i--; j--; }
    else if (v === H[(i - 1) * W + j] - 1) i--;
    else j--;
  }
  return { score: best, matches, fStart: from + j, fEnd: from + bj, rStart: i, rEnd: bi };
}

/**
 * Where in F does this read sit? Seeds (K-grams occurring ≤ maxOcc times in F) vote for a diagonal;
 * the densest diagonal band (within `window` of `hint` when given, else anywhere) is then aligned
 * exactly. Returns null when fewer than `minSeeds` seeds agree — the read cannot anchor anything.
 */
export function locate(R, F, idx, { hint = null, window = 30000, maxOcc = 40, minSeeds = 6 } = {}) {
  if (R.length < K) return null;
  const votes = new Map();
  const BAND = 64;
  for (let i = 0; i + K <= R.length; i++) {
    const ps = idx.get(R.slice(i, i + K).join(''));
    if (!ps || ps.length > maxOcc) continue;
    for (const p of ps) {
      const d = p - i;
      if (hint != null && Math.abs(d - hint) > window) continue;
      const b = Math.floor(d / BAND);
      votes.set(b, (votes.get(b) || 0) + 1);
    }
  }
  let bestB = null, bestV = 0;
  for (const [b, v] of votes) {
    const tot = v + (votes.get(b - 1) || 0) + (votes.get(b + 1) || 0);
    if (tot > bestV) { bestV = tot; bestB = b; }
  }
  if (bestB == null || bestV < minSeeds) return null;
  const d0 = bestB * BAND;
  const a = alignLocal(R, F, d0 - BAND - 40, d0 + R.length + 2 * BAND + 40);
  return { ...a, seeds: bestV };
}

// ── fitting ──────────────────────────────────────────────────────────────────
/**
 * Fit rules. History, all on the T2076 pilot before anything was written:
 *  - v1 cut a page's span from the end of the previous anchor to the start of the next one. That put
 *    the characters NEITHER read covered on BOTH pages (49 of 594 boundaries had 9–376 such chars).
 *  - v2/v3 required the two reads to meet within 8 characters, splitting small gaps by edge
 *    evidence. The by-eye check then found 2 of 20 page edges off by one or two characters: an
 *    edge character that the read MISREADS (慶 for 麼, 堪 for 恁) is trimmed by a local alignment,
 *    so "where the read ends" was a guess at exactly the place the boundary is decided.
 *  - v4 (current) decides each boundary by the EDGE COLUMNS. The last text column of the earlier
 *    page and the first text column of the later one are each aligned to the typed text with a
 *    FITTING alignment (every character of the column consumed, misreads as substitutions), which
 *    gives where the column ends / begins even when its edge characters are misread. Each column read
 *    is one vote; a structural boundary of the typed text (its start or end, a juan) is a vote; a
 *    second engine's read of the same column (`evidence`) is a vote. A boundary is set where ≥ 2
 *    votes agree EXACTLY and no other position has as many; otherwise both pages are refused. One
 *    exception, measured on the pilot's refusals: when BOTH engines agree on BOTH columns and 1–8
 *    typed characters lie between them, the print does not carry those characters (an edition
 *    variant, or characters printed faintly that neither engine read); the column geometry places
 *    them (see `slack`), and the gap is recorded on the boundary (variant_gap).
 *  - v5: an edge column must also lie inside the text frame horizontally (margin labels refused).
 *  - v4 edge columns are chosen by GEOMETRY (`edgeColumn`): a column that starts at the frame top,
 *    however short — a paragraph's last line is a real edge column, a margin label is not.
 *
 *  - an ANCHOR is a located read whose aligned stretch accounts for ≥ anchorIdentity of its Han
 *    characters and ≥ anchorMin of them, and that lies after the previous anchor (monotone); only an
 *    anchored page is fitted, and a boundary is only sought between pages whose anchors are no more
 *    than gapMax characters apart (or overlap by no more than overlapMax);
 *  - the page is WRITTEN only if its own read, aligned to its span, accounts for ≥ minIdentity of
 *    the read, covers ≥ minCoverage of the span, beats the best wrong-page control (spans two or
 *    more pages away, plus one far span) by ≥ minMargin, and the span is not implausibly long or
 *    short for the read (lengthRatio).
 */
export const FIT_RULES = Object.freeze({
  version: 5,
  anchorIdentity: 0.5, anchorMin: 40,
  minIdentity: 0.6, minCoverage: 0.6, minMargin: 0.3,
  lengthRatio: [0.6, 1.7],
  gapMax: 40, overlapMax: 8,
  edgeColumnMin: 5, edgeColumnIdentity: 0.5, columnTopSlack: 3.5,
  variantGapMax: 8,
  monotoneSlack: 24,
});

/**
 * Fitting alignment: every character of L is consumed (misreads as substitutions, match +2,
 * mismatch −1, gap −2), F[from, to) is free at both ends. Returns where L begins and ends in F.
 */
export function fitAlign(L, F, from, to) {
  from = Math.max(0, from); to = Math.min(F.length, to);
  const n = L.length, m = to - from, W = m + 1;
  if (!n || m <= 0) return { fStart: from, fEnd: from, matches: 0, identity: 0 };
  const H = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) H[i * W] = -2 * i;
  for (let i = 1; i <= n; i++) {
    const li = L[i - 1];
    for (let j = 1; j <= m; j++) {
      const d = H[(i - 1) * W + j - 1] + (li === F[from + j - 1] ? 2 : -1);
      H[i * W + j] = Math.max(d, H[(i - 1) * W + j] - 2, H[i * W + j - 1] - 2);
    }
  }
  let bj = 0;
  for (let j = 1; j <= m; j++) if (H[n * W + j] > H[n * W + bj]) bj = j;
  let i = n, j = bj, matches = 0;
  while (i > 0) {
    const v = H[i * W + j];
    const eq = j > 0 && L[i - 1] === F[from + j - 1];
    if (j > 0 && v === H[(i - 1) * W + j - 1] + (eq ? 2 : -1)) { if (eq) matches++; i--; j--; }
    else if (v === H[(i - 1) * W + j] - 2) i--;
    else j--;
  }
  return { fStart: from + j, fEnd: from + bj, matches, identity: matches / n };
}

/**
 * The page's first (side 'first') or last ('last') physical TEXT column, by geometry.
 *  - The edge line is the first/last line in reading order that starts at the top of the printed
 *    frame (an indented heading a few characters below it). A marginal label (伝第十二), a date
 *    written in the margin or a stamp starts mid-page and is skipped.
 *  - The COLUMN is every line that overlaps that line horizontally: an interlinear note (two
 *    half-width sub-columns) and the main characters after it are separate lines in NDL's layout,
 *    and the column's end is the end of the LAST of them. Ordered top to bottom, right sub-column
 *    first.
 *  - A very short column (a paragraph's last line) is joined to its neighbour.
 * @param {{f: string[], h: number, x0?: number, x1?: number, y0?: number, y1?: number}[]} lines  in reading order
 * @returns {{ idx: number[], f: string[], top: number, bottom: number, charH: number, box: number[]|null }|null}
 */
export function edgeColumn(lines, side, rules = FIT_RULES) {
  if (!lines?.length) return null;
  const maxH = Math.max(...lines.map((l) => l.h || 0));
  const tall = lines.filter((l) => l.f.length >= 3 && (l.h || 0) >= 0.6 * maxH);
  if (!tall.length) return null;
  const med = (xs) => { const t = [...xs].sort((x, y) => x - y); return t[Math.floor(t.length / 2)]; };
  const top = med(tall.map((l) => l.y0 ?? 0));
  const bottom = med(tall.map((l) => l.y1 ?? 0));
  const charH = med(tall.map((l) => l.h / l.f.length));
  // v5: a column lies inside the text frame horizontally. Library labels and handwritten marks in
  // the outer margins (支那, 撰述, 文明 on the 1657 圓悟語錄) start at the frame top too.
  const framed = tall.filter((l) => l.x0 != null);
  const colW = framed.length ? med(framed.map((l) => l.x1 - l.x0)) : 0;
  const fx0 = framed.length ? Math.min(...framed.map((l) => l.x0)) - 0.6 * colW : -Infinity;
  const fx1 = framed.length ? Math.max(...framed.map((l) => l.x1)) + 0.6 * colW : Infinity;
  const inFrame = (l) => l.x0 == null || ((l.x0 + l.x1) / 2 >= fx0 && (l.x0 + l.x1) / 2 <= fx1);
  const isColStart = (l) => l.f.length >= 1 && inFrame(l) && (l.y0 == null || l.y0 <= top + rules.columnTopSlack * charH);
  const order = side === 'first' ? lines.map((_, k) => k) : lines.map((_, k) => lines.length - 1 - k);
  const starts = order.filter((k) => isColStart(lines[k]));
  if (!starts.length) return null;
  const overlap = (a, b) => a.x0 == null || b.x0 == null ? a === b
    : Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) >= 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
  const cluster = (k) => lines.map((l, j) => j).filter((j) => overlap(lines[k], lines[j]));
  const used = new Set();
  const cols = [];
  for (const k of starts) {
    if (used.has(k)) continue;
    const c = cluster(k);
    c.forEach((j) => used.add(j));
    cols.push(c);
    const n = cols.flat().reduce((m, j) => m + lines[j].f.length, 0);
    if (n >= rules.edgeColumnMin) break;
  }
  const idx = [...new Set(cols.flat())].sort((i, j) => (lines[i].y0 ?? i) - (lines[j].y0 ?? j) || (lines[j].x0 ?? 0) - (lines[i].x0 ?? 0));
  // Several clusters (a short column joined to its neighbour): reading order is right column first.
  if (cols.length > 1) {
    const ordered = (side === 'first' ? cols : [...cols].reverse()).map((c) => c.sort((i, j) => (lines[i].y0 ?? i) - (lines[j].y0 ?? j) || (lines[j].x0 ?? 0) - (lines[i].x0 ?? 0)));
    idx.splice(0, idx.length, ...ordered.flat());
  }
  const xs = idx.filter((j) => lines[j].x0 != null);
  const box = xs.length ? [Math.min(...xs.map((j) => lines[j].x0)), top, Math.max(...xs.map((j) => lines[j].x1)), bottom] : null;
  return { idx, f: idx.flatMap((j) => lines[j].f), top, bottom, charH, box };
}

/** One column read → where it ends ('last') or begins ('first') in F, near `at`; null if it does not fit there. */
export function edgeVote(col, F, at, side, rules = FIT_RULES) {
  if (!col || col.length < rules.edgeColumnMin) return null;
  const span = 3 * col.length + rules.gapMax + 10;
  const r = side === 'last' ? fitAlign(col, F, at - span, at + rules.gapMax + 10) : fitAlign(col, F, at - rules.gapMax - 10, at + span);
  if (r.identity < rules.edgeColumnIdentity) return null;
  return side === 'last' ? r.fEnd : r.fStart;
}

/** The value with the most votes when it has ≥ 2 and no other value ties it; else null. */
export function decideVotes(votes) {
  const c = new Map();
  for (const v of votes) if (v != null) c.set(v, (c.get(v) || 0) + 1);
  const sorted = [...c.entries()].sort((x, y) => y[1] - x[1]);
  if (!sorted.length || sorted[0][1] < 2) return null;
  if (sorted[1] && sorted[1][1] === sorted[0][1]) return null;
  return sorted[0][0];
}

/**
 * @param {{read: string[], lines: {f: string[], h: number}[]}[]} pages  folded reads, page order
 * @param {string[]} F  folded work
 * @param {number[]} structural  F offsets of structural boundaries (0, F.length, each juan start)
 * @param {Map<string,string[]>} evidence  a second engine's read of an edge column, keyed `${page}:first|last`
 * @returns {{ pages: object[], boundaries: object[] }}  per page { anchor, span|null, why? };
 *   per boundary i (between page i and i+1) { position|null, votes, needs: ['i:last', 'i+1:first'] }
 */
export function fitBook(pages, F, idx, structural = [0, F.length], evidence = new Map(), rules = FIT_RULES) {
  const loc = [];
  let hint = null;
  for (const p of pages) {
    const R = p.read;
    if (!R.length) { loc.push(null); continue; }
    let a = locate(R, F, idx, { hint });
    if (!a && hint != null) a = locate(R, F, idx);
    const ok = a && a.matches >= rules.anchorMin && a.matches / R.length >= rules.anchorIdentity;
    loc.push(ok ? a : (a ? { ...a, rejected: 'weak' } : null));
    if (ok) hint = a.fStart;
  }
  // Monotone: an anchor that sits before the previous anchor's end (by more than the slack) is a
  // misplacement (repeated text, a quoted passage) — it anchors nothing.
  let lastEnd = -1;
  for (let i = 0; i < loc.length; i++) {
    const a = loc[i];
    if (!a || a.rejected) continue;
    if (a.fStart < lastEnd - rules.monotoneSlack) { loc[i] = { ...a, rejected: 'non-monotone' }; continue; }
    lastEnd = a.fEnd;
  }
  const isAnchor = (a) => a && !a.rejected;
  const nearStruct = (x) => structural.filter((s) => Math.abs(s - x) <= rules.gapMax);
  const colVotes = (i, side, at) => {
    const c = edgeColumn(pages[i].lines, side, rules);
    const own = c ? edgeVote(c.f, F, at, side, rules) : null;
    const ev = evidence.get(`${i}:${side}`);
    const second = ev ? edgeVote(ev, F, at, side, rules) : null;
    return { own, second, line: c ? c.idx : null, col: c };
  };
  // Where, in characters, a column starts below the frame top ('first') or ends above the frame
  // bottom ('last'): the room an unread character could occupy.
  const slack = (i, side, c) => {
    if (!c) return null;
    const ls = c.idx.map((j) => pages[i].lines[j]).filter((l) => l.y0 != null);
    if (!ls.length) return null;
    return side === 'first' ? (Math.min(...ls.map((l) => l.y0)) - c.top) / c.charH : (c.bottom - Math.max(...ls.map((l) => l.y1))) / c.charH;
  };
  // boundaries[i] = between page i and page i+1; boundaries[-1] / [n-1] are the text's own edges
  const boundaries = [];
  for (let i = -1; i < loc.length; i++) {
    const a = i >= 0 ? loc[i] : null, b = i + 1 < loc.length ? loc[i + 1] : null;
    const A = isAnchor(a), B = isAnchor(b);
    if (!A && !B) { boundaries.push({ position: null, why: 'no-anchor' }); continue; }
    let at, gap = null;
    if (A && B) {
      gap = b.fStart - a.fEnd;
      if (gap > rules.gapMax || gap < -rules.overlapMax) { boundaries.push({ position: null, gap, why: `reads-${gap > 0 ? 'gap' : 'overlap'}-${Math.abs(gap)}` }); continue; }
      at = a.fEnd;
    } else at = A ? a.fEnd : b.fStart;
    const last = A ? colVotes(i, 'last', at) : { own: null, second: null };
    const first = B ? colVotes(i + 1, 'first', at) : { own: null, second: null };
    // A structural edge votes only beside a page with no anchor (the text's start or end, a juan
    // opening on a fresh leaf after a blank) — between two anchored pages the columns decide.
    const struct = !A || !B ? nearStruct(at) : [];
    const votes = { last: last.own, first: first.own, last2: last.second, first2: first.second, structural: struct.length === 1 ? struct[0] : null };
    let position = decideVotes(Object.values(votes));
    // Both engines agree where each column ends/begins, and a few typed characters sit between the
    // two columns: the print does not carry them (an edition variant — 帝意彌堅 is in the Taishō,
    // not on the Gozan block), so no column can claim them. They close the earlier page.
    // Where they go is read from the page: room at the top of the later column (a faint or worn
    // character — the pilot's 是) puts them on the later page; room at the foot of the earlier
    // column puts them there; room in both is undecidable (refused); room in neither means the
    // print does not carry them, and they close the earlier page.
    let variantGap = null;
    if (position == null && votes.last != null && votes.last === votes.last2 && votes.first != null && votes.first === votes.first2
      && votes.first - votes.last > 0 && votes.first - votes.last <= rules.variantGapMax) {
      const g = votes.first - votes.last;
      const top = slack(i + 1, 'first', first.col), foot = slack(i, 'last', last.col);
      const roomTop = top != null && top >= g - 0.5, roomFoot = foot != null && foot >= g - 0.5;
      if (roomTop && !roomFoot) { position = votes.last; variantGap = { chars: g, placed: 'later-page-unread', top: +top.toFixed(2) }; }
      else if (roomFoot && !roomTop) { position = votes.first; variantGap = { chars: g, placed: 'earlier-page-unread', foot: +foot.toFixed(2) }; }
      else if (!roomTop && !roomFoot && top != null && foot != null) { position = votes.first; variantGap = { chars: g, placed: 'absent-from-print', top: +top.toFixed(2), foot: +foot.toFixed(2) }; }
    }
    const needs = [];
    if (position == null) { if (A && !evidence.has(`${i}:last`) && last.line != null) needs.push(`${i}:last`); if (B && !evidence.has(`${i + 1}:first`) && first.line != null) needs.push(`${i + 1}:first`); }
    boundaries.push({ position, gap, votes: variantGap ? { ...votes, variant_gap: variantGap } : votes, needs, why: position == null ? 'votes-disagree' : null });
  }
  const B = (i) => boundaries[i + 1];   // boundary after page i (i = -1 → before page 0)
  const out = loc.map((a, i) => {
    const base = { anchor: a };
    if (!pages[i].read.length) return { ...base, span: null, why: 'no-read' };
    if (!a) return { ...base, span: null, why: 'not-located' };
    if (!isAnchor(a)) return { ...base, span: null, why: `own-read-${a.rejected}` };
    const s = B(i - 1), e = B(i);
    if (s.position == null) return { ...base, span: null, why: `start-${s.why}` };
    if (e.position == null) return { ...base, span: null, why: `end-${e.why}` };
    if (e.position <= s.position) return { ...base, span: null, why: 'empty-span' };
    return { ...base, span: [s.position, e.position], edges: [s.votes, e.votes] };
  });
  return { pages: out, boundaries: boundaries.slice(1) };
}

/** Fraction of `R` accounted for by an alignment against F[s,e), and the share of the span covered. */
export function scoreAgainst(R, F, s, e) {
  if (!R.length || e <= s) return { identity: 0, coverage: 0 };
  const a = alignLocal(R, F, s, e);
  return { identity: a.matches / R.length, coverage: a.matches / (e - s), matches: a.matches };
}

/**
 * Verify page i: its own read against its span, and against wrong pages' spans (≥ 2 pages away,
 * plus the span half a book away). `spans` is every page's span (null where unfitted).
 */
export function verifyPage(i, reads, spans, F, rules = FIT_RULES) {
  const R = reads[i];
  const [s, e] = spans[i];
  const own = scoreAgainst(R, F, s, e);
  const ctrlIdx = [];
  for (const d of [-3, -2, 2, 3]) if (spans[i + d]) ctrlIdx.push(i + d);
  const farI = (i + Math.floor(spans.length / 2)) % spans.length;
  if (spans[farI] && Math.abs(farI - i) >= 2) ctrlIdx.push(farI);
  const controls = ctrlIdx.map((j) => ({ page: j, ...scoreAgainst(R, F, spans[j][0], spans[j][1]) }));
  const control = controls.length ? Math.max(...controls.map((c) => c.identity)) : null;
  const ratio = (e - s) / R.length;
  const reasons = [];
  if (control == null) reasons.push('no-control');
  if (own.identity < rules.minIdentity) reasons.push(`identity ${own.identity.toFixed(3)} < ${rules.minIdentity}`);
  if (own.coverage < rules.minCoverage) reasons.push(`coverage ${own.coverage.toFixed(3)} < ${rules.minCoverage}`);
  if (control != null && own.identity - control < rules.minMargin) reasons.push(`margin ${(own.identity - control).toFixed(3)} < ${rules.minMargin}`);
  if (ratio < rules.lengthRatio[0] || ratio > rules.lengthRatio[1]) reasons.push(`span/read length ${ratio.toFixed(2)} outside ${rules.lengthRatio.join('–')}`);
  const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    pass: reasons.length === 0, reasons,
    identity: r3(own.identity), coverage: r3(own.coverage), control: r3(control), margin: r3(control == null ? null : own.identity - control),
    span_chars: e - s, read_chars: R.length, controls: controls.map((c) => ({ page: c.page, identity: r3(c.identity) })),
  };
}

/**
 * The stored text for a span: from the first Han character of the page to just before the first Han
 * character of the next page, with an opening bracket or a line break that leads into the next page
 * handed to the next page.
 */
export function spanText(text, map, s, e, F) {
  let a = map[s];
  let b = e < F.length ? map[e] : text.length;
  while (a > 0 && /[「『（〔《【]/.test(text[a - 1])) a--;
  while (b > a && /[\s「『（〔《【]/.test(text[b - 1])) b--;
  return text.slice(a, b).trim();
}

export const sha16 = (t) => createHash('sha256').update(t || '').digest('hex').slice(0, 16);
