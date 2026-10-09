/**
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs (#4850) — an EXACT periodic run covering ≥ half of a body of
 * ≥ 300 characters. Reused here (`periodicRuns`/`coveredChars`), but on its own it misses all three gate-0
 * failures of #5660: they are short (a title leaf is ~60 syllables) and the cursive loop repeats with
 * variation (`de ltar yang dga' mnan` / `… mnano` / `… dga' ba mnano`), which no exact period matches.
 * scripts/lib/blank-page-guard.mjs (#4149) — ink coverage of the whole image. Reused in shape, but it measures
 * the whole frame: a palm-leaf or pothi leaf photographed on a dark measuring board reads as "covered in ink"
 * because the board is darker than the leaf, so the blank leaf of #5660 gate 0 passes it. Here the leaf is
 * found first (the largest bright region, Otsu on a blurred copy) and only its pixels are measured, as TEXTURE
 * (a pixel ≥ 14 grey levels darker than its neighbourhood) rather than darkness: red woodblock ink on grey
 * paper is barely darker than the paper, but it is sharp. scripts/audit/detect-fabricated-ocr.mjs (#4149 audit) — same image
 * idea, books-wide screen with prose heuristics; not a per-page verdict. #3878 re-read loops and the #4523
 * track-C fabrication detector compare against a PRIOR read; first OCR has none, which is the gap this fills.
 *
 * first-ocr-guard.mjs — a rules-only ($0) screen for the three ways a vision OCR engine invented text on FIRST
 * OCR in #5660 gate 0 (Yigdzin, Tibetan) and the one way Paddle did (Chinese, 清文鑑 p69):
 *
 *   punct_noise      a leaf with (almost) nothing on it, read as shad/tsheg marks plus a few syllables
 *   dominant_unit    one syllable (or character) is a large share of a short page — the title leaf + དགེའོ ×9
 *   repeated_line    the same line, or the same 1–2-unit line, emitted several times — lone 金 lines
 *   line_loop        one LINE repeats a unit 3-gram ≥ 6× and overruns the page's median line length ≥ 1.4× — a loop
 *                    WITH variation (the cursive page: `de ltar yang …` ×9 in one line). A page-level 3-gram count
 *                    cannot be used: Prajñāpāramitā lists repeat སྟོང་པ་ཉིད every few syllables, and it flagged 20 %
 *                    of shard 0; the per-line + overrun form flags 0.6 %.
 *   exact_loop       ocr-loop-guard's exact periodic run, at a lower floor (short pages)
 *   blank_leaf       the leaf carries almost no ink texture (≤ 0.2 % of leaf pixels) but the text claims ≥ 60 units,
 *                    more than a title leaf holds (needs the image). Calibrated on shard 0: the 48 leaves under the
 *                    texture floor are blank, title, placeholder and English front-matter leaves; those carrying
 *                    ≥ 60 Tibetan syllables were read as invented text. Stains keep a truly blank leaf ABOVE the
 *                    floor (the gate-0 blank leaf measures 1.5 %), so `punct_noise` is what catches that one.
 *
 * It only SCREENS. A flag is evidence to look, or to withhold a page from first write; it never writes. Units are
 * Tibetan syllables when the body is mostly Tibetan script, else code points (Han characters), so one
 * function serves both lanes. Thresholds are fixed in this file and calibrated in #5660 (resume) against the
 * gate-0 positives and by-eye-clean negatives — see scripts/eval/results/gpu-resume-5660/.
 */
import sharp from 'sharp';
import { periodicRuns, coveredChars } from './ocr-loop-guard.mjs';

const TIB = /[ཀ-ྼ]/u;
// Tibetan punctuation and marks that are not syllables: head marks ༄༅, shad ། ༎, ter tsheg ༔, rinchen spungs shad ༑, ༈ etc.
const TIB_PUNCT = /[ༀ-༔༴༶༸༺-༽]/gu;
const TIB_SPLIT = /[་༌ༀ-༔\s]+/u;

export const T = {
  punctMin: 8, punctSylMax: 6, punctRatio: 0.5, // punct_noise: ≥ 8 marks and ≤ 6 syllables, or syllables < 0.5 × marks
  domMinCount: 5, domShare: 0.2, domMaxUnits: 400, // dominant_unit: top unit ≥ 5× and ≥ 20 % of units, page ≤ 400 units
  lineMinUnits: 6, lineRepeats: 2, // repeated_line: a ≥ 6-unit line seen ≥ 2× more (3 total)
  shortLineRepeats: 3, // repeated_line: ≥ 3 lines that are the same 1–2 units
  ngramN: 3, lineNgramMin: 6, overrun: 1.4, // line_loop: one line repeats a 3-gram ≥ 6× and is ≥ 1.4× the median line
  exactMinBody: 60, exactShare: 0.3, // exact_loop
  texMax: 0.002, texMinUnits: 60, // blank_leaf
};

/** Units of a text body: Tibetan syllables, or code points of letters (Han etc.). */
export function units(body) {
  const tib = (body.match(/[ༀ-࿿]/gu) || []).length;
  const letters = (body.match(/[\p{L}\p{N}]/gu) || []).length;
  if (tib > 0.5 * Math.max(1, letters + (body.match(TIB_PUNCT) || []).length) || tib > letters * 0.5) {
    return { script: 'tibetan', list: body.split(TIB_SPLIT).map(s => s.replace(/[^ཀ-ྼ]/gu, '')).filter(s => TIB.test(s)), punct: (body.match(TIB_PUNCT) || []).length };
  }
  return { script: 'other', list: [...body].filter(ch => /[\p{L}\p{N}]/u.test(ch)), punct: (body.match(/[\p{P}]/gu) || []).length };
}

const lineUnits = (line, script) => script === 'tibetan'
  ? line.split(TIB_SPLIT).map(s => s.replace(/[^ཀ-ྼ]/gu, '')).filter(s => TIB.test(s))
  : [...line].filter(ch => /[\p{L}\p{N}]/u.test(ch));

/** Text-only features + flags. `text` is the body to be served (tags already stripped by the caller if any). */
export function textVerdict(text, t = T) {
  const body = String(text || '');
  const u = units(body);
  const n = u.list.length;
  const flags = [];
  const f = { script: u.script, units: n, punct: u.punct };
  // punct_noise
  if (u.script === 'tibetan' && u.punct >= t.punctMin && (n <= t.punctSylMax || n < t.punctRatio * u.punct)) flags.push('punct_noise');
  // dominant_unit
  const freq = new Map(); for (const x of u.list) freq.set(x, (freq.get(x) || 0) + 1);
  let top = ['', 0]; for (const e of freq) if (e[1] > top[1]) top = e;
  f.top_unit = top[0]; f.top_count = top[1]; f.top_share = n ? +(top[1] / n).toFixed(3) : 0;
  // Han: 之/也/曰 recur legitimately; only Tibetan uses the dominance rule
  if (u.script === 'tibetan' && n <= t.domMaxUnits && top[1] >= t.domMinCount && top[1] / n >= t.domShare) flags.push('dominant_unit');
  // repeated lines
  const lines = body.split(/\n+/).map(l => lineUnits(l, u.script)).filter(l => l.length);
  const lc = new Map(), sc = new Map();
  for (const l of lines) {
    const k = l.join('|');
    if (l.length >= t.lineMinUnits) lc.set(k, (lc.get(k) || 0) + 1);
    else if (l.length <= 2) sc.set(k, (sc.get(k) || 0) + 1);
  }
  f.max_line_repeat = Math.max(0, ...lc.values()); f.max_short_line_repeat = Math.max(0, ...sc.values());
  if (f.max_line_repeat >= 1 + t.lineRepeats || f.max_short_line_repeat >= t.shortLineRepeats) flags.push('repeated_line');
  // line loop (with variation): the repeats sit in ONE line, and that line overruns its siblings
  let lm = 0, lmLine = -1, lmGram = '';
  lines.forEach((l, li) => { const g = new Map(); for (let i = 0; i + t.ngramN <= l.length; i++) { const k = l.slice(i, i + t.ngramN).join('|'); const c = (g.get(k) || 0) + 1; g.set(k, c); if (c > lm) { lm = c; lmLine = li; lmGram = k; } } });
  const lens = lines.map(l => l.length).filter(x => x >= 3).sort((a, b) => a - b);
  const med = lens.length >= 3 ? lens[Math.floor(lens.length / 2)] : 0;
  f.line_ngram_max = lm; f.line_ngram = lmGram; f.line_overrun = med && lmLine >= 0 ? +(lines[lmLine].length / med).toFixed(2) : 0;
  if (lm >= t.lineNgramMin && f.line_overrun >= t.overrun) flags.push('line_loop');
  // exact periodic loop (ocr-loop-guard) at a short-page floor
  const cp = [...body.replace(/\s+/g, ' ').trim()];
  if (cp.length >= t.exactMinBody) {
    const runs = periodicRuns(cp); const cov = coveredChars(runs);
    f.exact_share = +(cov / cp.length).toFixed(3);
    if (runs.length && f.exact_share >= t.exactShare) flags.push('exact_loop');
  }
  return { flag: flags.length > 0, flags, ...f };
}

/**
 * Ink texture INSIDE the leaf. The leaf is the largest connected bright region of a heavily blurred copy (Otsu
 * threshold), eroded 6 px so its edge is not counted; a frame that is ≥ 92 % bright is all leaf. Returns the share
 * of leaf pixels at least `D` grey levels darker than their 4-px-blurred neighbourhood, or null when the image
 * cannot be read or no leaf is found. (sharp returns 3 channels from .blur() on 1-channel raw input — hence the
 * extractChannel calls; without them every index is misaligned and every leaf reads as covered in ink.)
 */
export async function leafTexture(buf, D = 14) {
  try {
    const { data, info } = await sharp(buf, { failOn: 'none' }).greyscale().resize(600, 600, { fit: 'inside' }).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, N = W * H;
    const raw = { raw: { width: W, height: H, channels: 1 } };
    const bl = await sharp(data, raw).blur(4).extractChannel(0).raw().toBuffer();
    const big = await sharp(data, raw).blur(8).extractChannel(0).raw().toBuffer();
    const h = new Float64Array(256); for (const v of big) h[v]++;
    let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
    let sB = 0, wB = 0, best = 0, th = 128;
    for (let t = 0; t < 256; t++) { wB += h[t]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += t * h[t]; const mB = sB / wB, mF = (sum - sB) / wF; const b = wB * wF * (mB - mF) ** 2; if (b > best) { best = b; th = t; } }
    let brightN = 0; for (const v of big) if (v > th) brightN++;
    const mask = new Uint8Array(N);
    if (best / N / N < 50 || brightN / N > 0.92) mask.fill(1);
    else {
      const lab = new Int32Array(N).fill(-1); let bestLab = -1, bestSize = 0, cur = 0;
      for (let i = 0; i < N; i++) {
        if (lab[i] !== -1 || big[i] <= th) continue;
        const st = [i]; lab[i] = cur; let size = 0;
        while (st.length) {
          const p = st.pop(); size++; const x = p % W, y = (p / W) | 0;
          for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && lab[q] === -1 && big[q] > th) { lab[q] = cur; st.push(q); }
        }
        if (size > bestSize) { bestSize = size; bestLab = cur; }
        cur++;
      }
      for (let i = 0; i < N; i++) if (lab[i] === bestLab) mask[i] = 1;
    }
    let m = mask;
    for (let k = 0; k < 6; k++) { const n = new Uint8Array(N); for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; n[p] = m[p] & m[p - 1] & m[p + 1] & m[p - W] & m[p + W]; } m = n; }
    let hit = 0, tot = 0;
    for (let i = 0; i < N; i++) if (m[i]) { tot++; if (bl[i] - data[i] >= D) hit++; }
    return tot > N * 0.03 ? { tex: +(hit / tot).toFixed(5), leaf: +(tot / N).toFixed(3) } : null;
  } catch { return null; }
}

/** Text verdict plus the blank-leaf check when image bytes are given. */
export async function firstOcrVerdict(text, imageBuf, t = T) {
  const v = textVerdict(text, t);
  if (imageBuf) {
    const lt = await leafTexture(imageBuf);
    v.leaf_tex = lt?.tex ?? null;
    if (lt && lt.tex <= t.texMax && v.units >= t.texMinUnits) { v.flags.push('blank_leaf'); v.flag = true; }
  }
  return v;
}
