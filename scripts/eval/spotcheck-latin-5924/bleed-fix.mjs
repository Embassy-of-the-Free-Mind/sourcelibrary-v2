#!/usr/bin/env node
/**
 * spotcheck-latin-5924/bleed-fix.mjs — two prototype fixes for facing-page bleed in Latin print OCR (#5924).
 * Prereg: scripts/eval/PREREGISTRATION-facing-bleed-5924.md (bar committed before scoring).
 *
 * PRIOR ART: scripts/lib/gutter-detect.mjs — its per-column transitions profile (text = ink/paper alternation, per-column
 *   threshold, min(R,G,B) as ink) is reimplemented here for the OUTER edges; its own search window is the central 30–70%
 *   and it finds a spread's gutter, not a 3–20% strip of the facing leaf. scripts/eval/latin-repair-census-5924/
 *   detectors.mjs (PR #7173) `marginStrip` — the fragment test, reused for fix (a)(i).
 *
 *   detect <img dir> <out.json>                 edge-strip verdict per image ($0)
 *   fix    <reads.jsonl.gz> <detect.json> <nbr.json> <out.jsonl>    fix (a), text only, on stored reads ($0)
 *   crop   <img dir> <detect.json> <out dir>    fix (b): write the cropped leaf for pages where a strip was found
 * Read only: nothing here writes to Mongo or calls a model.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

/**
 * A strip of the facing leaf at the left or right edge: after trimming the dark scanner background, a run of text
 * columns touching the edge, 1–20% of the leaf wide, separated from the main text block (≥ 40% wide) by a non-text
 * gap. The page's OWN side-notes fail this, because paper (a blank margin) lies between them and the edge.
 * @returns {{left: null|{cut:number, width:number}, right: null|{cut:number, width:number}, w:number, h:number}}
 *   cut — the x (original pixels) to crop at; width — strip width as a share of the trimmed leaf.
 */
export async function edgeStrip(buf) {
  const meta = await sharp(buf).metadata();
  const W = 800, ratio = W / meta.width, H = Math.round(meta.height * ratio);
  const raw = await sharp(buf).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const y0 = Math.round(H * 0.15), y1 = Math.round(H * 0.85), rows = y1 - y0;
  const trans = new Float32Array(W), lum = new Float32Array(W), col = new Uint8Array(rows);
  for (let x = 0; x < W; x++) {
    let l = 0;
    for (let y = y0, r = 0; y < y1; y++, r++) { const i = (y * W + x) * 3; col[r] = Math.min(raw[i], raw[i + 1], raw[i + 2]); l += (raw[i] + raw[i + 1] + raw[i + 2]) / 3; }
    lum[x] = l / rows;
    const paper = Uint8Array.from(col).sort()[Math.floor(rows * 0.8)];
    const dark = Math.max(40, Math.min(150, paper - 55));
    let t = 0, prev = col[0] < dark;
    for (let r = 1; r < rows; r++) { const d = col[r] < dark; if (d !== prev) t++; prev = d; }
    trans[x] = paper < 90 ? 0 : t / rows;             // scanner background / binding: never text
  }
  const sm = (a, h) => { const o = new Float32Array(W); for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let i = Math.max(0, x - h); i <= Math.min(W - 1, x + h); i++) { s += a[i]; n++; } o[x] = s / n; } return o; };
  const text = sm(trans, 2), lumS = sm(lum, 3);
  // the leaf: trim dark scanner background (mean luminance < 70) and white padding (> 248, no text) from both sides
  const bg = x => lumS[x] < 70 || (lumS[x] > 248 && text[x] === 0);
  let L = 0, R = W - 1; while (L < W - 1 && bg(L)) L++; while (R > 0 && bg(R)) R--;
  const leafW = Math.max(1, R - L + 1);
  const paperMed = [...lumS.slice(L, R + 1)].sort((a, b) => a - b)[Math.floor(leafW * 0.6)] || 255;
  const isText = x => text[x] >= 0.05, isGap = x => text[x] < 0.02;
  const meanText = (a, b) => { let s = 0, n = 0; for (let i = Math.min(a, b); i <= Math.max(a, b); i++) { s += text[i]; n++; } return n ? s / n : 0; };
  const side = (dir) => {
    const step = dir === 'left' ? 1 : -1, edge = dir === 'left' ? L : R, end = dir === 'left' ? R : L;
    const reach = Math.round(leafW * 0.22), pad = Math.round(leafW * 0.015);
    const at = k => edge + step * k;
    // route 1 (gap): [edge pad ≤ 1.5%] → strip text run 1–20% → non-text gap ≥ 0.6% → main block ≥ 40% text columns
    // route 2 (shadow): a page-edge / binding shadow (luminance ≥ 20 below the paper) inside the outer 22%, with
    //   faint text (mean transitions ≥ 0.006) between it and the edge — sparse side-note fragments never reach 0.05
    let g0 = -1, m0 = -1, s0 = -1, how = null;
    { let k = 0; while (k < pad && !isText(at(k))) k++;
      if (isText(at(k))) { s0 = k; while (k < reach && !isGap(at(k))) k++;
        if (k - s0 >= leafW * 0.01 && k < reach) { const g = k; while (k < reach + pad && isGap(at(k))) k++;
          if (k - g >= leafW * 0.006) { g0 = g; m0 = k; how = 'gap'; } } } }
    if (how == null) {
      let k = pad; while (k < reach && !(lumS[at(k)] < paperMed - 20)) k++;
      if (k < reach) { const g = k; while (k < reach + pad && lumS[at(k)] < paperMed - 20) k++;
        if (k - g >= leafW * 0.005 && g >= leafW * 0.015 && meanText(at(0), at(g - 1)) >= 0.006) { s0 = 0; g0 = g; m0 = k; how = 'shadow'; } }
    }
    if (how == null) return null;
    let tx = 0; for (let k = m0, n = 0; n < leafW && at(k) !== end; k++, n++) if (isText(at(k))) tx++;
    if (tx < leafW * 0.40) return null;
    // cut in the gap: at the darkest column (page edge / binding shadow), else the gap centre
    let best = g0, bl = Infinity; for (let k = g0; k < m0; k++) if (lumS[at(k)] < bl) { bl = lumS[at(k)]; best = k; }
    const mid = Math.round((g0 + m0) / 2), cutK = (lumS[at(mid)] - bl >= 15 || how === 'shadow') ? best : mid;
    return { cut: Math.round(at(cutK) / ratio), width: Math.round(((g0 - s0) / leafW) * 1000) / 1000, how };
  };
  return { left: side('left'), right: side('right'), w: meta.width, h: meta.height };
}

// ---------------------------------------------------------------- fix (a): text only
const letters = s => (String(s).match(/\p{L}/gu) || []).length;
const fold = s => String(s).toLowerCase().replace(/ſ/g, 's').normalize('NFD').replace(/\p{M}/gu, '').replace(/v/g, 'u').replace(/j/g, 'i').replace(/[^\p{L}]/gu, '');
const grams = (s, k) => { const g = new Set(); for (let i = 0; i + k <= s.length; i++) g.add(s.slice(i, i + k)); return g; };
const share = (a, B) => { const g = grams(a, 4); if (!g.size) return 0; let h = 0; for (const x of g) if (B.has(x)) h++; return h / g.size; };
const lineLen = t => { const L = String(t).replace(/<[^>]+>/g, '\n').split('\n').map(letters).filter(n => n >= 3).sort((a, b) => a - b); return L.length ? L[L.length >> 1] : 0; };

/**
 * @param text stored OCR read
 * @param o.strip edgeStrip() verdict for the image (or null), o.nbr [prevText, nextText], o.marginStrip/o.lex census fragment test
 * @returns {{text, changed, rules: string[]}}
 */
export function fixText(text, { strip, nbr = [], marginStrip, marginStripFires, lex } = {}) {
  let t = String(text || ''); const rules = [];
  const nbG = grams(fold(nbr.filter(Boolean).join(' ').replace(/<[^>]+>/g, ' ')), 4);
  // (i) census margin strip: fragments filed as side-notes → drop the fragment notes
  if (marginStrip && lex) {
    const ms = marginStrip(t, lex);
    if (marginStripFires(ms)) {
      const before = t;
      t = t.replace(/<margin[^>]*>([\s\S]*?)<\/margin>\n?/gi, (m, inner) => {
        const l = inner.replace(/<[^>]+>/g, ' ').trim(); const w = l.match(/[\p{L}ſ]+/gu) || [];
        return (!/\d/.test(l) && w.length <= 2 && letters(l) <= 10) ? '' : m;
      });
      if (t !== before) rules.push('margin-fragments');
    }
  }
  // (ii) a <column-break/> tail on an image with a facing strip: the strip read as a second column
  const cb = t.split(/<column-break\s*\/?>/i);
  if (cb.length === 2 && strip && (strip.left || strip.right)) {
    const tailLen = lineLen(cb[1]), headLen = lineLen(cb[0]);
    if (tailLen <= headLen * 0.6 || (nbG.size && share(fold(cb[1]), nbG) >= 0.5)) {
      // keep page furniture that follows the tail (<vocab>, <sig>, …) — only the prose of the tail goes
      const furn = (cb[1].match(/<(vocab|sig|catchword|page-num|meta)[^>]*>[\s\S]*?<\/\1>/gi) || []).join('\n');
      t = cb[0].replace(/\s+$/, '') + '\n\n' + furn; rules.push('column-break-tail');
    }
  }
  // (iii) a <margin> note that is the neighbour page's text (≥ 8 letters, ≥ 60% of its 4-grams in the neighbour)
  if (nbG.size) {
    const before = t;
    t = t.replace(/<margin[^>]*>([\s\S]*?)<\/margin>\n?/gi, (m, inner) => { const f = fold(inner); return f.length >= 8 && share(f, nbG) >= 0.6 ? '' : m; });
    if (t !== before) rules.push('margin-matches-neighbour');
  }
  return { text: t, changed: t !== String(text || ''), rules };
}

// ---------------------------------------------------------------- CLI
const rdJsonl = f => (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString('utf8') : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map(JSON.parse);
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd === 'detect') {
    const out = {};
    for (const f of fs.readdirSync(a).filter(f => f.endsWith('.jpg')).sort()) out[f.slice(0, -4)] = await edgeStrip(fs.readFileSync(path.join(a, f)));
    fs.writeFileSync(b, JSON.stringify(out, null, 1));
    const v = Object.values(out); console.log(JSON.stringify({ pages: v.length, left: v.filter(x => x.left).length, right: v.filter(x => x.right).length }));
  } else if (cmd === 'fix') {
    const det = JSON.parse(fs.readFileSync(b, 'utf8')), nbr = JSON.parse(fs.readFileSync(c, 'utf8'));
    const D = await import('../latin-repair-census-5924/detectors.mjs');
    const { loadModels } = await import('../latin-repair-census-5924/controls.mjs');
    const { lex } = loadModels();
    const last = new Map(); for (const r of rdJsonl(a)) last.set(r.page_id, r);
    const rows = [...last.values()].map(r => {
      const n = nbr[r.page_id] || {}; const f = fixText(r.text, { strip: det[r.page_id], nbr: [n['-1']?.text, n['1']?.text], marginStrip: D.marginStrip, marginStripFires: D.marginStripFires, lex });
      return { page_id: r.page_id, text: f.text, rules: f.rules };
    });
    fs.writeFileSync(d, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
    const by = {}; for (const r of rows) for (const k of r.rules) by[k] = (by[k] || 0) + 1;
    console.log(JSON.stringify({ pages: rows.length, changed: rows.filter(r => r.rules.length).length, by }));
  } else if (cmd === 'crop') {
    const det = JSON.parse(fs.readFileSync(b, 'utf8')); fs.mkdirSync(c, { recursive: true }); let n = 0;
    for (const [id, v] of Object.entries(det)) {
      if (!v.left && !v.right) continue;
      const x0 = v.left ? v.left.cut : 0, x1 = v.right ? v.right.cut : v.w;
      await sharp(fs.readFileSync(path.join(a, `${id}.jpg`))).extract({ left: x0, top: 0, width: x1 - x0, height: v.h }).jpeg({ quality: 92 }).toFile(path.join(c, `${id}.jpg`)); n++;
    }
    console.log(JSON.stringify({ cropped: n }));
  } else { console.error('usage: detect|fix|crop …'); process.exit(2); }
}
