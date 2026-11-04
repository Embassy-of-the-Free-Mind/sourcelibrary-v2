// PRIOR ART: scripts/eval/zh-planted-8171/score.mjs (book-cluster bootstrap of a group difference over text reads),
// whose measure is a planted TEXT edit; #8182 scores reads of composed IMAGES by bag flip over unit manifests, so the
// measures here are new and follow PREREGISTRATION.md exactly.
/**
 * #8182 scorer. Reads the engine outputs (Yigdzin, PaddleOCR-VL, Flash, Opus) on N / N_r2 / N2 / S / W / B and the
 * compose manifests, and writes the preregistered measures with 95 % page-bootstrap intervals (10,000 resamples).
 *   node scripts/eval/ocr-context-8182/score.mjs --build=$JOB_SCRATCH/build --reads=$JOB_SCRATCH/reads > results.json
 * Output: numbers only (ids, counts, rates); no page text.
 */
import fs from 'fs'; import path from 'path';
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const BUILD = argOf('build'), READS = argOf('reads'), B = +argOf('boot', 10000);

// ---- tokens: Han characters; Tibetan grapheme clusters (base + following marks); everything else ignored ----
const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}]/u;
const TBASE = (c) => (c >= 0x0f40 && c <= 0x0f6c) || (c >= 0x0f88 && c <= 0x0f8c);
const TMARK = (c) => (c >= 0x0f71 && c <= 0x0f87) || (c >= 0x0f8d && c <= 0x0fbc);
export function tokens(text, script) {
  const t = String(text || '').normalize('NFC');
  if (script === 'zh') return [...t].filter((ch) => HAN.test(ch));
  const out = []; let cur = null;
  for (const ch of t.normalize('NFD')) {
    const c = ch.codePointAt(0);
    if (TBASE(c)) { if (cur) out.push(cur); cur = ch; } else if (TMARK(c) && cur) cur += ch; else { if (cur) out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
const bag = (a) => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return m; };
const inter = (A, Bm) => { let s = 0; for (const [k, v] of A) s += Math.min(v, Bm.get(k) || 0); return s; };
const size = (A) => { let s = 0; for (const v of A.values()) s += v; return s; };
/** F(X, Y) = 1 − |X ∩ Y| / max(|X|, |Y|); null when both are empty. */
const F = (X, Y) => { const m = Math.max(size(X), size(Y)); return m ? 1 - inter(X, Y) / m : null; };
const minus = (X, Y) => size(X) - inter(X, Y);   // |X − Y| as multisets

// ---- reads ----
// Yigdzin's worker records each read's finish reason; 'length' = hit the token limit (a loop or a runaway)
const YFIN = {};
try { for (const l of fs.readFileSync(path.join(READS, 'yig', 'pages.jsonl'), 'utf8').split('\n')) if (l) { const r = JSON.parse(l); YFIN[r.id] = (r.leaf || []).some((x) => x.fin === 'length'); } } catch { /* no yig reads */ }
function readOf(engine, stem, im) {
  const id = `${stem}__${im}`;
  const tryF = (f, j) => { try { const s = fs.readFileSync(f, 'utf8'); return j ? JSON.parse(s) : { text: s }; } catch { return null; } };
  if (engine === 'yig') return tryF(path.join(READS, 'yig', 'txt', `${id}.txt`));
  if (engine === 'pad') return tryF(path.join(READS, 'pad', `${id}.txt`));
  const r = tryF(path.join(READS, engine, `${id}.json`), true);
  // Gemini's output filter (it fires on recitation) cuts the reply and appends this notice: an outcome, not a read
  if (r && /This request was blocked by Gemini's filters/.test(r.text)) return { text: '', cls: 'filter_blocked' };
  return r && !r.cls ? r : r ? { text: '', cls: r.cls } : null;
}

// ---- bootstrap ----
let seed = 8182; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };
const res = (a) => Array.from(a, () => a[Math.floor(rnd() * a.length)]);
function ci(a) { if (a.length < 2) return { n: a.length, mean: a.length ? r4(a[0]) : null }; const bs = Array.from({ length: B }, () => mean(res(a))); return { n: a.length, mean: r4(mean(a)), lo: r4(q(bs, 0.025)), hi: r4(q(bs, 0.975)), sd: r4(sd(a)) }; }
function diff(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const bs = Array.from({ length: B }, () => mean(res(a)) - mean(res(b)));
  const mde = 2.8 * Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length);
  return { diff: r4(mean(a) - mean(b)), lo: r4(q(bs, 0.025)), hi: r4(q(bs, 0.975)), mde: r4(mde) };
}
const r4 = (x) => (x == null || Number.isNaN(x) ? null : Math.round(x * 1e4) / 1e4);

// ---- per page ----
const todo = fs.readFileSync(path.join(BUILD, 'todo.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const man = (stem) => { try { return JSON.parse(fs.readFileSync(path.join(BUILD, stem, 'manifest.json'), 'utf8')); } catch { return { outcome: 'missing' }; } };
const ENGINES = { yig: ['TK', 'TO', 'TT'], pad: ['ZB', 'ZC'], F: ['TK', 'TO', 'ZB', 'ZC'], O: ['TK', 'TO', 'ZB', 'ZC'] };

const yieldByGroup = {};
const pages = [];   // {engine, group, stem, ...measures}
for (const r of todo) {
  const m = man(r.stem);
  const y = (yieldByGroup[r.group] ||= { drawn: 0, ok: 0, outcomes: {}, units: [], box_h: [] });
  y.drawn++; y.outcomes[m.outcome] = (y.outcomes[m.outcome] || 0) + 1;
  if (m.outcome !== 'ok') continue;
  y.ok++; y.units.push(m.units); if (m.seg?.box_h) y.box_h.push(m.seg.box_h);
  for (const [eng, groups] of Object.entries(ENGINES)) {
    if (!groups.includes(r.group)) continue;
    const rd = {}; for (const im of ['N', 'N__r2', 'N2', 'S', 'W', 'B']) rd[im] = readOf(eng, r.stem, im);
    if (!rd.N && !readOf(eng, r.stem, 'N')) continue;   // not read by this engine (controls read a subset)
    const cls = {}; for (const [k, v] of Object.entries(rd)) if (v?.cls) { cls[k] = v.cls; rd[k] = null; }
    const T = {}, Bg = {}; for (const [k, v] of Object.entries(rd)) if (v) { T[k] = tokens(v.text, r.script); Bg[k] = bag(T[k]); }
    const p = { engine: eng, group: r.group, stem: r.stem, units: m.units, box_h: m.seg?.box_h ?? null, nN: T.N?.length ?? 0, cls,
      empty: Object.fromEntries(Object.entries(T).map(([k, v]) => [k, v.length === 0])) };
    if (cls.N) { p.outcome = `N_${cls.N}`; pages.push(p); continue; }
    if (T.N.length === 0) { p.outcome = 'empty_N'; pages.push(p); continue; }
    p.outcome = 'ok';
    // read failures (NOT preregistered; a robustness pass): a read whose token count is under 0.5x or over 2x the
    // page's reference (median of the N, N2 and W counts, which show the same glyphs), or that hit the length limit
    const cnt = ['N', 'N2', 'W'].filter((k) => T[k]).map((k) => T[k].length).sort((a, b) => a - b);
    const ref = cnt[Math.floor(cnt.length / 2)];
    p.fail = Object.keys(T).filter((k) => T[k].length < 0.5 * ref || T[k].length > 2 * ref || (eng === 'yig' && YFIN[`${r.stem}__${k}`]));
    p.F_rep = Bg.N__r2 ? F(Bg.N, Bg.N__r2) : null;
    p.F_N2 = Bg.N2 ? F(Bg.N, Bg.N2) : null;
    p.F_S = Bg.S ? F(Bg.N, Bg.S) : null;
    p.F_B = Bg.B ? F(Bg.N, Bg.B) : null;
    // floor for E: the layout floor N2 where read; else (controls) the same-image floor where read; else none
    const floor = p.F_N2 ?? p.F_rep;
    p.floor_kind = p.F_N2 != null ? 'N2' : p.F_rep != null ? 'rep' : null;
    p.E = p.F_S != null && floor != null ? p.F_S - floor : null;
    p.E_raw = p.F_S;
    p.blur = p.F_B != null && floor != null ? p.F_B - floor : null;
    const k = Object.keys(m.swaps || {}).length;
    if (Bg.W && k) {
      p.W_base = Bg.N2 ? minus(Bg.N, Bg.N2) : Bg.N__r2 ? minus(Bg.N, Bg.N__r2) : null;
      p.W_raw = minus(Bg.N, Bg.W); p.W_k = k;
      p.W_C = p.W_base != null ? (p.W_raw - p.W_base) / k : null;
    }
    // Chinese, per glyph: tokens assigned to units in reading order where the read's Han count equals the units
    if (r.script === 'zh') {
      const flat = (o) => o.flat().map((u) => `${u[0]}.${u[1]}`);
      const ordN = flat(m.order.N), ordS = flat(m.order.S), ordW = flat(m.order.W);
      const al = (t) => t && t.length === m.units;
      p.align = { N: al(T.N), S: al(T.S), W: al(T.W) };
      if (al(T.N)) {
        const vN = Object.fromEntries(ordN.map((u, i) => [u, T.N[i]]));
        const vocab = new Set(T.N);
        if (al(T.S)) {
          let flip = 0, towardPage = 0;
          ordS.forEach((u, i) => { if (T.S[i] !== vN[u]) { flip++; if (vocab.has(T.S[i])) towardPage++; } });
          p.glyph_flip = flip / m.units; p.glyph_flips = flip; p.flip_toward_page = flip ? towardPage / flip : null;
        }
        if (al(T.W)) {
          const sw = m.swaps; let rev = 0, faith = 0, neither = 0, same = 0;
          ordW.forEach((u, i) => {
            const t = ordN[i]; if (!(t in sw)) return;
            const orig = vN[t], donor = vN[sw[t]], got = T.W[i];
            if (orig === donor) { same++; return; }
            if (got === orig) rev++; else if (got === donor) faith++; else neither++;
          });
          p.W_sharp = { rev, faith, neither, same_char: same };
        }
      }
    }
    pages.push(p);
  }
}

// controls read no N2 and N twice on only 10 pages per group: a page without its own floor takes the arm's mean
// same-image floor (floor_kind 'arm_rep'), stated in the record
for (const eng of Object.keys(ENGINES)) {
  const P = pages.filter((p) => p.engine === eng && p.outcome === 'ok');
  const fr = P.filter((p) => p.F_rep != null), fl = fr.length ? mean(fr.map((p) => p.F_rep)) : null;
  const wb = P.filter((p) => p.W_base != null && p.floor_kind), wbm = wb.length ? mean(wb.map((p) => p.W_base)) : null;
  for (const p of P) {
    if (p.E == null && p.F_S != null && fl != null) { p.E = p.F_S - fl; p.floor_kind = 'arm_rep'; }
    if (p.blur == null && p.F_B != null && fl != null) p.blur = p.F_B - fl;
    if (p.W_C == null && p.W_raw != null && wbm != null) p.W_C = (p.W_raw - wbm) / p.W_k;
  }
}

// ---- group summaries ----
const out = { yield: {}, engines: {} };
for (const [g, y] of Object.entries(yieldByGroup)) {
  const s = (a) => (a.length ? { median: q(a, 0.5), p10: q(a, 0.1), p90: q(a, 0.9) } : null);
  out.yield[g] = { drawn: y.drawn, ok: y.ok, outcomes: y.outcomes, units: s(y.units), box_h: s(y.box_h) };
}
const INSIDE = { yig: ['TK', 'TO'], pad: ['ZB', 'ZC'], F: null, O: null };
for (const eng of Object.keys(ENGINES)) {
  const P = pages.filter((p) => p.engine === eng); if (!P.length) continue;
  const e = (out.engines[eng] = { pages: P.length, outcomes: {}, groups: {} });
  for (const p of P) e.outcomes[p.outcome] = (e.outcomes[p.outcome] || 0) + 1;
  // per image type and group: reads that came back as an outcome (filter_blocked, error...) rather than text
  e.read_outcomes = {}; for (const p of P) for (const [im, c] of Object.entries(p.cls || {})) { const k = `${p.group}:${im}:${c}`; e.read_outcomes[k] = (e.read_outcomes[k] || 0) + 1; }
  const ok = P.filter((p) => p.outcome === 'ok');
  // c0: the group's median tokens per unit in N
  const c0 = {}; for (const g of ENGINES[eng]) { const a = ok.filter((p) => p.group === g).map((p) => p.nN / p.units); c0[g] = a.length ? q(a, 0.5) : null; }
  for (const p of ok) p.W_rev = p.W_C != null && c0[p.group] ? 1 - Math.min(1, Math.max(0, p.W_C) / c0[p.group]) : null;
  const pick = (g, k) => ok.filter((p) => (g === '*' || p.group === g) && p[k] != null).map((p) => p[k]);
  // ceiling (descriptive, not preregistered): F between the N reads of two DIFFERENT pages of the same group, adjacent
  // in draw order; how far apart two unrelated texts of this script and print land on the bag measure
  for (const g of ENGINES[eng]) {
    const G = ok.filter((p) => p.group === g); const c = [];
    for (let i = 1; i < G.length; i++) { const a = readOf(eng, G[i - 1].stem, 'N'), b = readOf(eng, G[i].stem, 'N'); const s = G[i].stem[0] === 'T' ? 'tib' : 'zh'; const v = F(bag(tokens(a?.text, s)), bag(tokens(b?.text, s))); if (v != null) c.push(v); }
    (e.ceiling ||= {})[g] = ci(c);
  }
  for (const g of [...ENGINES[eng], '*']) {
    const G = ok.filter((p) => g === '*' || p.group === g);
    const sharp = G.filter((p) => p.W_sharp).reduce((s, p) => { for (const k of Object.keys(p.W_sharp)) s[k] = (s[k] || 0) + p.W_sharp[k]; return s; }, {});
    e.groups[g] = {
      n: G.length, c0: c0[g] ?? null,
      F_rep: ci(pick(g, 'F_rep')), F_N2: ci(pick(g, 'F_N2')), F_S: ci(pick(g, 'F_S')), E: ci(pick(g, 'E')),
      blur: ci(pick(g, 'blur')), W_C: ci(pick(g, 'W_C')), W_rev: ci(pick(g, 'W_rev')),
      ...(G.some((p) => p.align) && {
        align_share: { N: r4(mean(G.map((p) => +!!p.align?.N))), NS: r4(mean(G.map((p) => +!!(p.align?.N && p.align?.S)))), NW: r4(mean(G.map((p) => +!!(p.align?.N && p.align?.W)))) },
        glyph_flip: ci(pick(g, 'glyph_flip')), flip_toward_page: ci(pick(g, 'flip_toward_page')), W_sharp: sharp,
      }),
    };
  }
  // robustness: the same measures on pages where none of N, N2/N_r2, S, W failed (B judged separately)
  const clean = ok.filter((p) => !p.fail.some((k) => ['N', 'N2', 'N__r2', 'S', 'W'].includes(k)));
  const pickC = (g, k, extra = () => true) => clean.filter((p) => (g === '*' || p.group === g) && p[k] != null && extra(p)).map((p) => p[k]);
  e.read_failures = {}; for (const p of ok) for (const k of p.fail) { const key = `${p.group}:${k}`; e.read_failures[key] = (e.read_failures[key] || 0) + 1; }
  e.clean = {};
  for (const g of [...ENGINES[eng], '*']) e.clean[g] = { n: pickC(g, 'nN').length, F_N2: ci(pickC(g, 'F_N2')), F_S: ci(pickC(g, 'F_S')), E: ci(pickC(g, 'E')), blur: ci(pickC(g, 'blur', (p) => !p.fail.includes('B'))), W_C: ci(pickC(g, 'W_C')), W_rev: ci(pickC(g, 'W_rev')) };
  const [inn, outg] = INSIDE[eng] || [];
  if (inn) e.clean.inside_minus_outside = { E: diff(pickC(inn, 'E'), pickC(outg, 'E')), W_rev: diff(pickC(inn, 'W_rev'), pickC(outg, 'W_rev')) };
  if (inn) {
    e.inside_minus_outside = { inside: inn, outside: outg, E: diff(pick(inn, 'E'), pick(outg, 'E')), W_rev: diff(pick(inn, 'W_rev'), pick(outg, 'W_rev')) };
    // legibility: within tertiles of line-box height (Tibetan), pooled over inside and outside
    const bh = ok.filter((p) => [inn, outg].includes(p.group) && p.box_h != null && p.E != null);
    if (bh.length > 9) {
      const cuts = [q(bh.map((p) => p.box_h), 1 / 3), q(bh.map((p) => p.box_h), 2 / 3)];
      e.by_box_h_tertile = [0, 1, 2].map((t) => {
        const T = bh.filter((p) => (t === 0 ? p.box_h < cuts[0] : t === 1 ? p.box_h >= cuts[0] && p.box_h < cuts[1] : p.box_h >= cuts[1]));
        const a = T.filter((p) => p.group === inn).map((p) => p.E), b = T.filter((p) => p.group === outg).map((p) => p.E);
        return { tertile: t, cuts, n_inside: a.length, n_outside: b.length, E_inside: ci(a), E_outside: ci(b), diff: diff(a, b) };
      });
    }
  }
  // controls: pooled E over all groups (the instrument check), and inside vs outside for interest
  if (!inn) e.pooled = { E: ci(pick('*', 'E')), blur: ci(pick('*', 'blur')) };
}
out.per_page = pages.map(({ fail, engine, group, stem, outcome, cls, units, nN, box_h, F_rep, F_N2, F_S, F_B, E, blur, W_C, W_rev, glyph_flip, align, W_sharp, floor_kind }) =>
  ({ engine, group, stem, outcome, cls, fail, units, nN, box_h, F_rep: r4(F_rep), F_N2: r4(F_N2), F_S: r4(F_S), F_B: r4(F_B), E: r4(E), blur: r4(blur), W_C: r4(W_C), W_rev: r4(W_rev), glyph_flip: r4(glyph_flip), align, W_sharp, floor_kind }));
console.log(JSON.stringify(out, null, 1));
