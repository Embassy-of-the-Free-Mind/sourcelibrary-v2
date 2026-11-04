// PRIOR ART: scripts/eval/lib/plant-ocr-errors.mjs (#7611: number / noun / line plants, European print only: its
// word and inflection rules cannot plant into unpunctuated Chinese); scripts/eval/pro-translate-6545/plant.mjs (English
// translations only); zh-punct-8140/lib.mjs on PR #8146 (stripForInput / LCS alignment: the alignment idea is reused
// below, rewritten because that file is not on main); scripts/eval/lib/paired-stats.mjs (makeRng, bootstrapRatioCI:
// imported). No planter for Chinese source text exists in scripts/eval (searched INDEX.md for "plant", "perturb").
/**
 * #8171 — planted edits in Chinese source text, and whether a model's output follows them.
 *
 *   clean(text)            Han characters only (and 〓, 丨): every mark, space, note bracket and non-Han sign removed.
 *                          This is what every arm sees: our served Chinese is unpunctuated, so the reference is too.
 *   candidates(t)          every place the rules below can plant, deterministic.
 *   chooseEdits(t, cands, seed, max)  seeded choice of 2-3 sites >= 10 characters apart, types spread.
 *   applyEdits(t, edits)   the edited text, and each edit's offset IN THE EDITED TEXT.
 *   outcomeInCopy(input, edit, outputChars)  task P: did a copy of the input keep the edit, restore the original,
 *                          or do something else? Exact, from an LCS alignment of the output's characters to the input.
 *
 * Edit types (each a substitution, insertion or deletion of 1-3 characters):
 *   neg_del   不X -> X        (a 不 before a Han character is removed; fixed words with 不 are skipped)
 *   neg_add   X -> 不X        (X in 可 能 敢 欲 足, not already negated)
 *   neg_swap  有 <-> 無       (outside fixed words)
 *   num       二-九 -> another of 二-九  (outside fixed number words such as 五行, 三界)
 *   name      a listed person / place / state for another of the same list and length, not already in the passage
 */
import crypto from 'crypto';
import { makeRng } from '../lib/paired-stats.mjs';

export { makeRng };
export const isHan = (c) => /\p{Script=Han}/u.test(c) || c === '〓';
/** Han only. Bracketed notes keep their text (the brackets go): a reference's inline notes are part of its page. */
export function clean(text) {
  return [...String(text || '').normalize('NFC').replace(/&KR\d+;/g, '〓')].filter(isHan).join('');
}
export const hanCount = (t) => [...String(t || '')].filter((c) => /\p{Script=Han}/u.test(c)).length;

const NEG = new Set(['不', '未', '無', '莫', '弗', '非', '毋', '勿', '否', '靡', '罔']);
const NEG_DEL_SKIP = ['不肖', '不穀', '不才', '不佞', '不朽', '不二', '不周', '不韋', '不疑', '不害', '不違', '不識', '不惑', '不庭', '不律', '不托', '不聿', '不亦', '不得已', '不寧', '不啻', '不翅', '不惟', '不唯', '不特', '不但', '不過', '不覺', '不意', '不圖', '不日', '不時', '不然'];
const NEG_ADD_BEFORE = new Set(['可', '能', '敢', '欲', '足']);
const SWAP_SKIP = ['無量', '無上', '無為', '無明', '無生', '無我', '無常', '無住', '無相', '南無', '無漏', '無間', '無礙', '無邊', '無數', '無非', '無不', '無所', '無有', '有無', '無無', '有有', '有情', '有為', '有漏', '有司', '所有', '無極', '無忌', '無垢', '無畏', '無著', '無盡', '無學', '有學', '無餘', '有餘', '無央', '無色', '有色', '無心', '無念', '無事', '無字', '無妨', '無端', '無奈', '無恙', '無聊', '無論', '無他', '無已', '無窮', '無疆', '無算', '有若', '有子', '有虞', '有夏', '有殷', '有周', '有苗', '有扈', '有莘', '有娀', '有巢', '有熊', '無可奈', '無奈何', '無乃', '無寧', '無論', '有頃', '有間', '有年', '有司', '有方'];
const DIGITS = ['二', '三', '四', '五', '六', '七', '八', '九'];
const NUM_SKIP = ['三寶', '三界', '三昧', '三世', '四諦', '五蘊', '六根', '六塵', '六道', '八正', '三乘', '二乘', '四大', '五戒', '十善', '五行', '五經', '六經', '四書', '三代', '三皇', '五帝', '四海', '九州', '八卦', '六合', '三才', '七情', '六藝', '四方', '五常', '三綱', '三王', '五霸', '四時', '五色', '五音', '五味', '六親', '三光', '二儀', '九泉', '四夷', '三公', '九卿', '八音', '五嶽', '四瀆', '七政', '二氣', '五官', '六律', '五刑', '三軍', '六書', '三禮', '五倫', '四德', '三從', '八方', '九族', '三省', '六部', '三國', '五代', '六朝', '二帝', '三清', '五臟', '六腑', '三焦', '五運', '六氣', '七曜', '五星', '二十', '三十', '四十', '五十', '六十', '七十', '八十', '九十', '三尺', '四庫', '八股', '九泉', '三藏', '四衆', '四眾', '八部', '六度', '三毒', '五濁', '十地', '三身', '四智', '五眼', '六通', '八識', '七佛', '二諦', '三學', '三歸', '五逆', '十惡', '三途', '四生', '六趣', '九品', '三賢', '二祖', '三祖', '四祖', '五祖', '六祖', '七祖', '三玄', '三要', '四料', '五位', '三關', '九流', '三教', '四靈', '五方', '二十八', '三百', '五百', '八百', '三千', '八萬', '四萬', '九天', '九重', '五湖', '三江', '五陵', '三秦', '三吳', '三楚', '三晉', '七國', '六國', '四民', '五服', '九鼎', '三事', '三老', '五更', '五兵', '六師', '六軍', '五采', '五彩'];
const NAME_GROUPS = [
  { g: 'state', items: ['秦', '楚', '魏', '趙', '韓', '吳', '鄭', '蔡', '魯'] },
  { g: 'sage', items: ['堯', '舜', '禹', '桀', '紂'] },
  { g: 'person2', items: ['孔子', '孟子', '老子', '莊子', '荀子', '墨子', '管仲', '晏子', '伊尹', '周公', '太公', '文王', '武王', '成王', '顏淵', '顏回', '子路', '子貢', '曾子', '子夏', '子張', '子游', '冉有', '宰我', '伯夷', '叔齊', '微子', '箕子', '比干', '召公', '韓信', '張良', '蕭何', '項羽', '曹操', '劉備', '孫權', '關羽'] },
  { g: 'bud3', items: ['舍利弗', '須菩提', '目犍連', '富樓那'] },
  { g: 'bud2', items: ['迦葉', '阿難', '文殊', '普賢', '彌勒', '觀音'] },
  { g: 'chan2', items: ['馬祖', '黃檗', '臨濟', '趙州', '雲門', '洞山', '曹山', '雪峰', '德山', '南泉', '溈山', '仰山', '藥山', '慧能', '神秀', '達磨', '慧可', '玄沙', '汾陽', '楊岐', '圓悟', '虛堂', '夾山', '投子', '睦州', '雲居', '鏡清', '翠巖', '香林'] },
  { g: 'place2', items: ['長安', '洛陽', '江南', '河南', '河北', '山東', '山西', '江西', '浙江', '湖南', '揚州', '杭州', '蘇州', '成都', '金陵', '建康', '臨安', '幽州', '荊州', '益州', '涼州', '并州', '冀州', '青州', '徐州', '兗州', '豫州', '雍州', '梁州', '交州', '廣州', '福州', '泉州', '會稽', '吳興', '嶺南', '河東', '河西', '隴西'] },
];
export const EDIT_TYPES = ['neg_del', 'neg_add', 'neg_swap', 'num', 'name'];
export const CATEGORY = { neg_del: 'neg', neg_add: 'neg', neg_swap: 'neg', num: 'num', name: 'name' };

const within = (s, i, words) => words.some((w) => { for (let k = 0; k < w.length; k++) if (s.slice(i - k, i - k + w.length) === w) return true; return false; });

/** Every plantable site: { type, at, before, choices } with `at` the offset in t and `before` the span replaced. */
export function candidates(t) {
  const c = [...t]; const s = c.join(''); const out = [];
  const han = (i) => i >= 0 && i < c.length && /\p{Script=Han}/u.test(c[i]);
  for (let i = 1; i < c.length - 1; i++) {
    const ch = c[i];
    if (ch === '不' && han(i - 1) && han(i + 1) && !NEG.has(c[i - 1]) && !NEG.has(c[i + 1]) && !within(s, i, NEG_DEL_SKIP)) out.push({ type: 'neg_del', at: i, before: '不', after: '' });
    if (NEG_ADD_BEFORE.has(ch) && han(i - 1) && han(i + 1) && !NEG.has(c[i - 1])) out.push({ type: 'neg_add', at: i, before: '', after: '不' });
    if ((ch === '有' || ch === '無') && han(i - 1) && han(i + 1) && !within(s, i, SWAP_SKIP) && !NEG.has(c[i - 1])) out.push({ type: 'neg_swap', at: i, before: ch, after: ch === '有' ? '無' : '有' });
    if (DIGITS.includes(ch) && han(i - 1) && han(i + 1) && !within(s, i, NUM_SKIP)) out.push({ type: 'num', at: i, before: ch, choices: DIGITS.filter((d) => d !== ch) });
  }
  for (const { g, items } of NAME_GROUPS) {
    const L = items[0].length;
    for (const w of items) {
      let from = 0, k;
      while ((k = s.indexOf(w, from)) >= 0) {
        from = k + 1;
        const at = [...s.slice(0, k)].length;
        if (at < 1 || at + L >= c.length) continue;
        // a single-character name next to another name of its list (秦楚, 堯舜) would double up: skip
        if (L === 1 && (items.includes(c[at - 1]) || items.includes(c[at + 1]))) continue;
        const choices = items.filter((x) => x !== w && !s.includes(x));
        if (choices.length) out.push({ type: 'name', group: g, at, before: w, choices });
      }
    }
  }
  // two rules can hit one character (有 before 可): keep the first by offset then type order
  const seen = new Set();
  return out.sort((a, b) => a.at - b.at || EDIT_TYPES.indexOf(a.type) - EDIT_TYPES.indexOf(b.type)).filter((x) => { const k = x.at; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Seeded choice: shuffle, then take sites >= `gap` apart and >= 5 from either end, preferring an unused category. */
export function chooseEdits(t, cands, seed, max = 3, gap = 10) {
  const n = [...t].length; const rng = makeRng(seed);
  const pool = cands.filter((x) => x.at >= 5 && x.at + (x.before || '').length <= n - 5).map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
  const picked = [];
  const ok = (x) => picked.every((p) => Math.abs(p.at - x.at) >= gap);
  while (picked.length < max) {
    const used = new Set(picked.map((p) => CATEGORY[p.type]));
    const next = pool.find((x) => ok(x) && !used.has(CATEGORY[x.type])) || pool.find(ok);
    if (!next) break;
    pool.splice(pool.indexOf(next), 1);
    const e = { ...next };
    if (e.choices) { e.after = e.choices[Math.floor(rng() * e.choices.length)]; delete e.choices; }
    picked.push(e);
  }
  return picked.sort((a, b) => a.at - b.at);
}

/** Apply edits (sorted by `at`). Returns { text, edits } with each edit's `pos` = its offset in the edited text. */
export function applyEdits(t, edits) {
  const c = [...t]; let out = ''; let i = 0; const res = [];
  for (const e of [...edits].sort((a, b) => a.at - b.at)) {
    out += c.slice(i, e.at).join('');
    const pos = [...out].length;
    out += e.after;
    i = e.at + [...e.before].length;
    res.push({ ...e, pos, lenEdited: [...e.after].length, lenOrig: [...e.before].length });
  }
  out += c.slice(i).join('');
  return { text: out, edits: res };
}

/** LCS alignment of two code-point arrays: pairs [i, j]. */
export function align(A, O) {
  const n = A.length, m = O.length, W = m + 1;
  const L = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === O[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === O[j]) { pairs.push([i, j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++; }
  return pairs;
}

/**
 * Task P outcome for one edit. `input` = the edited text the arm saw; `out` = the arm's output with every non-Han sign
 * removed (clean()). The anchors are the nearest input characters before and after the edited span that align to the
 * output; the output's characters between them are compared with the edited span ('follow'), the original span
 * ('revert') or neither ('other'). An anchor more than 3 characters from the span, or a missing output, is 'unjudged'.
 */
export function outcomeInCopy(input, edit, out, pairs) {
  const A = [...input], O = [...out];
  if (!O.length) return { outcome: 'unjudged', why: 'empty output' };
  pairs = pairs || align(A, O);
  const mapA = new Map(pairs);
  const lo = edit.pos - 1, hi = edit.pos + edit.lenEdited; // the anchors' wanted positions
  let l = lo, r = hi;
  while (l >= 0 && !mapA.has(l)) l--;
  while (r < A.length && !mapA.has(r)) r++;
  if (l < 0 || r >= A.length || lo - l > 3 || r - hi > 3) return { outcome: 'unjudged', why: 'anchors not aligned' };
  const between = O.slice(mapA.get(l) + 1, mapA.get(r)).join('');
  const pre = A.slice(l + 1, edit.pos).join(''), post = A.slice(hi, r).join('');
  const edited = pre + edit.after + post, orig = pre + edit.before + post;
  if (between === edited) return { outcome: 'follow', between };
  if (between === orig) return { outcome: 'revert', between };
  return { outcome: 'other', between };
}

/** Two independent groups of units (passages): ratio of sums in each, and the bootstrap CI of the difference a - b. */
export function diffRatioCI(a, b, seed = 8171, iters = 4000) {
  const rng = makeRng(seed);
  const ratio = (u) => { const n = u.reduce((s, x) => s + x[0], 0), d = u.reduce((s, x) => s + x[1], 0); return d ? n / d : NaN; };
  const draw = (u) => Array.from({ length: u.length }, () => u[Math.floor(rng() * u.length)]);
  const out = [];
  for (let i = 0; i < iters; i++) { const v = ratio(draw(a)) - ratio(draw(b)); if (Number.isFinite(v)) out.push(v); }
  out.sort((x, y) => x - y);
  return { diff: ratio(a) - ratio(b), ci: [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]] };
}
export function ratioCI(u, seed = 8171, iters = 4000) {
  const rng = makeRng(seed);
  const ratio = (v) => { const n = v.reduce((s, x) => s + x[0], 0), d = v.reduce((s, x) => s + x[1], 0); return d ? n / d : NaN; };
  const out = [];
  for (let i = 0; i < iters; i++) { const v = ratio(Array.from({ length: u.length }, () => u[Math.floor(rng() * u.length)])); if (Number.isFinite(v)) out.push(v); }
  out.sort((x, y) => x - y);
  return { rate: ratio(u), ci: [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]], units: u.length, denom: u.reduce((s, x) => s + x[1], 0) };
}

// ── group C site check (verify.mjs) ──
export const siteSeed = (slug) => 8171 ^ parseInt(crypto.createHash('sha256').update(`sites:${slug}`).digest('hex').slice(0, 8), 16);
/** Up to 6 sites per C passage, seeded, 10 apart: the ones shown to the image check. */
export function sitesToCheck(text, slug) { return chooseEdits(text, candidates(text), siteSeed(slug), 6, 10); }
/** Where the decoy sits among n+1 strings. (The first run used a signed seed % (n+1); plant.mjs re-maps from `answers`.) */
export const decoyIndex = (slug, n) => { const k = siteSeed(slug) % (n + 1); return k < 0 ? Math.max(n + k, 0) : k; };
export const windowOf = (text, e) => { const c = [...text]; return c.slice(Math.max(0, e.at - 4), e.at + [...e.before].length + 4).join(''); };

