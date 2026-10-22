#!/usr/bin/env node
// PRIOR ART: scripts/eval/latin-r4-report-5924.mjs (round 4's lite+longs: ſ copied from a Calamari image read, needs
// Kraken segmentation and 61 CPU-s/page); scripts/eval/latin-bakeoff-5924/score.mjs (the fold this mirrors). No
// text-only long-s restorer in scripts/ or src/ (git grep "long-s pass|post-pass|longs", 2026-10-22).
/**
 * longs-pass.mjs — put back the long s (ſ) that gemini-3.1-flash-lite wrote as f, from the text alone (#5924).
 * PREREGISTRATION.md in this directory fixes the rules; this file is the pass and its model.
 *
 *   build:  node longs-pass.mjs build --corpus <corpus.jsonl.gz> --out <model.json.gz> [--dev-frac 0.1]
 *   dev:    node longs-pass.mjs dev   --corpus <corpus.jsonl.gz> --model <model.json.gz> [--pages 3000] [--grid]
 *   apply:  node longs-pass.mjs apply --model <model.json.gz> --in <arm.jsonl.gz> --out <arm.jsonl.gz> [--log <changes.jsonl>]
 *
 * The only edit the pass makes is f → ſ, on a lower-case f that is not word-final and not before b or k. Each token's
 * variants (each eligible f kept or flipped) are scored by
 *     log P(v | left word) + log P(right word | v) + bias · (flips)
 * P(word) = (count + α · Pchar(word)) / (N + α): word counts from our own flash-preview Latin, with a character
 * 5-gram (Witten-Bell) for forms never seen. The bigram terms are kept only for "ambiguous" words, those whose
 * s/f skeleton has two or more attested readings (fit/sit, fui/sui); elsewhere the unigram decides.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import readline from 'node:readline';
import crypto from 'node:crypto';

export const PARAMS = { alpha: 1, lam: 0.8, bias: Math.log(0.64), minCount: 2, ambigMin: 3, maxVariants: 256 };

// ── folding (view N's letters: marks dropped, lower case, ſ→s, v→u, j→i) ───────
export const fold = (w) => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i');
const WORD = /[\p{L}\p{M}]+/gu;
const HY = /[-¬⸗=]\s*\n\s*/g;                       // line-end hyphen: the two halves are one word
/** Folded word stream of a text, hyphenated breaks joined. */
export function words(text) { return (String(text).replace(HY, '').match(WORD) || []).map(fold).filter((w) => /^\p{L}+$/u.test(w)); }
/** Skeleton: every non-final s/f → '*', so readings that differ only in s/f share it. */
const skel = (w) => w.slice(0, -1).replace(/[sf]/g, '*') + w.slice(-1);
export const bookIsDev = (id, frac) => parseInt(crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 8), 16) / 2 ** 32 < frac;

/** A page written with lite's ſ-as-f habit is not training text (PREREGISTRATION step 3). */
const TELL = new Set(['eft', 'funt', 'effe', 'fed', 'ipfe', 'fuis', 'fic', 'quafi', 'poteft', 'fecundum', 'fua', 'fuo', 'fuum', 'ifta']
  .filter((w) => w.includes('f')));
export const hasTell = (ws) => ws.some((w) => TELL.has(w));

async function* readJsonl(file) {
  const rl = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield JSON.parse(l);
}

// ── character 5-gram, Witten-Bell interpolated ───────────────────────────────
const ORDER = 5;
class CharLM {
  constructor(o) { this.c = new Map(o?.c || []); this.t = new Map(o?.t || []); this.n = new Map(o?.n || []); this.V = o?.V || 30; }
  add(w, k = 1) {
    const s = '^'.repeat(ORDER - 1) + w + '$';
    for (let i = ORDER - 1; i < s.length; i++) for (let o = 0; o < ORDER; o++) {
      const h = s.slice(i - o, i), g = h + '\u0001' + s[i];
      if (!this.c.has(g)) this.t.set(h, (this.t.get(h) || 0) + 1);
      this.c.set(g, (this.c.get(g) || 0) + k); this.n.set(h, (this.n.get(h) || 0) + k);
    }
  }
  p(h, ch) {
    let p = 1 / this.V;
    for (let o = 0; o <= h.length; o++) {
      const hh = h.slice(h.length - o), n = this.n.get(hh); if (!n) continue;
      const t = this.t.get(hh), lam = n / (n + t);
      p = lam * ((this.c.get(hh + '\u0001' + ch) || 0) / n) + (1 - lam) * p;
    }
    return p;
  }
  logp(w) { const s = '^'.repeat(ORDER - 1) + w + '$'; let lp = 0; for (let i = ORDER - 1; i < s.length; i++) lp += Math.log(this.p(s.slice(i - ORDER + 1, i), s[i])); return lp; }
  toJSON() { return { c: [...this.c], t: [...this.t], n: [...this.n], V: this.V }; }
}

/** log(e^a + e^b), safe when either is -Infinity. */
const lse = (a, b) => { const m = Math.max(a, b); return m === -Infinity ? m : m + Math.log(Math.exp(a - m) + Math.exp(b - m)); };

// ── model ────────────────────────────────────────────────────────────────────
export class Model {
  constructor(o, params = {}) {
    this.P = { ...PARAMS, ...(o.params || {}), ...params };
    this.uni = new Map(o.uni); this.N = o.N; this.bi = new Map(o.bi); this.ambig = new Set(o.ambig);
    this.lm = new CharLM(o.lm); this.cache = new Map();
  }
  count(w) { return this.uni.get(w) || 0; }
  logPw(w) {
    let v = this.cache.get(w); if (v != null) return v;
    v = lse(Math.log(this.count(w)), Math.log(this.P.alpha) + this.lm.logp(w)) - Math.log(this.N + this.P.alpha);
    if (this.cache.size > 2e5) this.cache.clear(); this.cache.set(w, v); return v;
  }
  /**
   * log P(v | left) + log P(right | v) − log P(right), each bigram interpolated with fixed weight lam:
   * P(b | a) = lam · c(a b) / c(a) + (1 − lam) · P(b). A neighbour never seen (count 0) adds no term, so a garbled
   * neighbour cannot push a frequent reading down. Only for ambiguous skeletons; elsewhere the unigram decides.
   */
  score(v, left, right) {
    const lv = this.logPw(v);
    if (!this.ambig.has(skel(v))) return lv;
    const lam = this.P.lam, l1 = Math.log(lam), l0 = Math.log(1 - lam); let s = lv;
    const cl = left ? this.count(left) : 0, cr = right ? this.count(right) : 0, cv = this.count(v);
    if (cl) s = lse(l1 + Math.log(this.bi.get(left + ' ' + v) || 0) - Math.log(cl), l0 + lv);
    if (cr) { const lr = this.logPw(right); s += lse(cv ? l1 + Math.log(this.bi.get(v + ' ' + right) || 0) - Math.log(cv) : -Infinity, l0 + lr) - lr; }
    return s;
  }
}

export async function build(corpus, devFrac) {
  const uni = new Map(); let N = 0, pages = 0, dropped = 0;
  for await (const r of readJsonl(corpus)) {
    if (bookIsDev(r.book_id, devFrac)) continue;
    const ws = words(r.text); if (hasTell(ws)) { dropped++; continue; }
    pages++; for (const w of ws) { uni.set(w, (uni.get(w) || 0) + 1); N++; }
  }
  for (const [w, c] of uni) if (c < PARAMS.minCount) uni.delete(w);
  // ambiguous skeletons: ≥ 2 attested readings, each seen ≥ ambigMin times
  const groups = new Map();
  for (const [w, c] of uni) if (c >= PARAMS.ambigMin && /[sf]./.test(w)) { const k = skel(w); groups.set(k, (groups.get(k) || 0) + 1); }
  const ambig = new Set([...groups].filter(([, n]) => n > 1).map(([k]) => k));
  const bi = new Map(); const isA = (w) => ambig.has(skel(w));
  for await (const r of readJsonl(corpus)) {
    if (bookIsDev(r.book_id, devFrac)) continue;
    const ws = words(r.text); if (hasTell(ws)) continue;
    for (let i = 0; i + 1 < ws.length; i++) if (isA(ws[i]) || isA(ws[i + 1])) { const k = ws[i] + ' ' + ws[i + 1]; bi.set(k, (bi.get(k) || 0) + 1); }
  }
  for (const [k, c] of bi) if (c < 2) bi.delete(k);
  const lm = new CharLM(); for (const w of uni.keys()) lm.add(w);
  console.error(`build: ${pages} pages (${dropped} dropped for ſ-as-f tells), ${N} tokens, ${uni.size} types, ${ambig.size} ambiguous skeletons, ${bi.size} bigrams`);
  return { params: PARAMS, devFrac, pages, dropped, N, uni: [...uni], ambig: [...ambig], bi: [...bi], lm: lm.toJSON() };
}

// ── the pass ─────────────────────────────────────────────────────────────────
/** Eligible f positions (indexes into the joined word w): lower-case f, not final, not before b or k. */
const eligible = (w) => { const out = []; for (let i = 0; i < w.length - 1; i++) if (w[i] === 'f' && !/[bk]/i.test(w[i + 1])) out.push(i); return out; };

/**
 * Apply the pass to one text. Returns { text, changes: [{from, to, ambiguous}] }. Only f → ſ edits; the text's
 * length and every other character are unchanged.
 */
export function pass(text, model) {
  const src = String(text);
  // word spans over the raw text, hyphen-joined: each item = { parts: [[start, end]...], raw }
  const toks = []; const re = /[\p{L}\p{M}]+/gu; let m; const spans = [];
  while ((m = re.exec(src))) spans.push([m.index, m.index + m[0].length]);
  for (let i = 0; i < spans.length; i++) {
    const parts = [spans[i]];
    while (i + 1 < spans.length && /^[-¬⸗=]\s*\n\s*$/.test(src.slice(parts[parts.length - 1][1], spans[i + 1][0]))) parts.push(spans[++i]);
    toks.push({ parts, raw: parts.map(([a, b]) => src.slice(a, b)).join('') });
  }
  const out = src.split(''); const changes = []; let ambiguous = 0;
  const foldT = (t) => { const f = fold(t); return /^\p{L}+$/u.test(f) ? f : null; };
  /** The best variant of token t given folded neighbours (null = no context term). */
  const decide = (t, left, right) => {
    const chars = [...t.raw]; const el = eligible(chars).filter((i) => chars.slice(i + 1).some((c) => /\p{L}/u.test(c)));
    if (!el.length || !foldT(t.raw)) return null;
    const n = Math.min(el.length, 8); const pos = el.slice(0, n);
    let best = null, bestS = -Infinity, orig = null;
    for (let mask = 0; mask < (1 << n); mask++) {
      const c = chars.slice(); let flips = 0;
      for (let b = 0; b < n; b++) if (mask & (1 << b)) { c[pos[b]] = 'ſ'; flips++; }
      const s = model.score(fold(c.join('')), left, right) + model.P.bias * flips;
      if (mask === 0) orig = s;
      if (s > bestS) { bestS = s; best = { mask, c, pos, n, margin: s - orig }; }
    }
    return best;
  };
  // first pass: each token's unigram reading, so a right-hand neighbour is read corrected, not as lite wrote it
  const base = toks.map((t) => { const d = decide(t, null, null); return d ? fold(d.c.join('')) : foldT(t.raw); });
  let left = null;
  for (let ti = 0; ti < toks.length; ti++) {
    const t = toks[ti]; const best = decide(t, left, base[ti + 1] ?? null);
    if (!best) { left = foldT(t.raw); continue; }
    const isAmb = model.ambig.has(skel(foldT(t.raw)));
    if (isAmb) ambiguous++;
    if (best.mask) {
      // write back: map code-point indexes of the joined raw onto the source spans (UTF-16 offsets)
      const cps = []; for (const [a, b] of t.parts) { let k = a; for (const ch of src.slice(a, b)) { cps.push(k); k += ch.length; } }
      for (let b = 0; b < best.n; b++) if (best.mask & (1 << b)) out[cps[best.pos[b]]] = 'ſ';
      changes.push({ from: t.raw, to: best.c.join(''), ambiguous: isAmb, margin: +best.margin.toFixed(2) });
    }
    left = fold(best.c.join(''));
  }
  return { text: out.join(''), changes, ambiguous };
}

// ── dev: lite's habit simulated on held-out flash-preview books ─────────────
function simulate(text, rnd, p) {
  // each lower-case s / ſ that is not word-final (next char a letter) and not before b/k → f with probability p
  const c = [...text];
  for (let i = 0; i + 1 < c.length; i++) if ((c[i] === 's' || c[i] === 'ſ') && /\p{L}/u.test(c[i + 1]) && !/[bk]/i.test(c[i + 1]) && rnd() < p) c[i] = 'f';
  return c.join('');
}
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** s/f errors of hyp vs truth on aligned (same-length) folded text: missed = truth s, hyp f; over = truth f, hyp s. */
function sfErrors(truth, hyp) {
  const T = [...truth.toLowerCase().replace(/ſ/g, 's')], H = [...hyp.toLowerCase().replace(/ſ/g, 's')]; let missed = 0, over = 0, sTot = 0, fTot = 0;
  for (let i = 0; i < T.length; i++) { if (T[i] === 's' && H[i] !== T[i]) sTot++; if (T[i] === 's' && H[i] === 'f') missed++; if (T[i] === 'f') { fTot++; if (H[i] === 's') over++; } }
  return { missed, over, fTot };
}

async function main() {
  const [cmd, ...a] = process.argv.slice(2);
  const opt = (k, d) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : d; };
  if (cmd === 'build') {
    const m = await build(opt('corpus'), +opt('dev-frac', 0.1));
    fs.writeFileSync(opt('out'), zlib.gzipSync(JSON.stringify(m)));
    return;
  }
  const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
  if (cmd === 'dev') {
    const raw = load(opt('model')); const devFrac = raw.devFrac; const maxPages = +opt('pages', 3000);
    const pages = []; const rnd = mulberry32(5924);
    for await (const r of readJsonl(opt('corpus'))) {
      if (!bookIsDev(r.book_id, devFrac)) continue;
      if (hasTell(words(r.text))) continue;
      if (rnd() < 0.15) pages.push(r.text); if (pages.length >= maxPages) break;
    }
    const sims = pages.map((t, i) => { const r2 = mulberry32(i + 1); return { truth: t, lite: simulate(t, r2, 0.64) }; });
    const grid = a.includes('--grid')
      ? (() => { const g = []; for (const alpha of [0.1, 1, 10]) for (const lam of [0.2, 0.5, 0.8]) for (const bias of [-1.5, -1, Math.log(0.64), 0]) g.push({ alpha, lam, bias }); return g; })()
      : [{}];
    const base = { missed: 0, over: 0 }; for (const s of sims) { const e = sfErrors(s.truth, s.lite); base.missed += e.missed; base.over += e.over; }
    console.log(`dev: ${sims.length} pages; lite-sim s/f errors: missed ${base.missed}, over ${base.over}`);
    const res = [];
    for (const g of grid) {
      const model = new Model(raw, g); let missed = 0, over = 0, amb = 0; const t0 = Date.now();
      for (const s of sims) { const o = pass(s.lite, model); const e = sfErrors(s.truth, o.text); missed += e.missed; over += e.over; amb += o.ambiguous; }
      const row = { ...model.P, missed, over, errors: missed + over, ambiguous: amb, ms_per_page: +((Date.now() - t0) / sims.length).toFixed(1) };
      res.push(row); console.log(JSON.stringify(row));
    }
    res.sort((x, y) => x.errors - y.errors); console.log('best', JSON.stringify(res[0]));
    if (opt('out')) fs.writeFileSync(opt('out'), JSON.stringify({ pages: sims.length, base, grid: res }, null, 1));
    return;
  }
  if (cmd === 'apply') {
    const params = opt('params') ? JSON.parse(fs.readFileSync(opt('params'), 'utf8')) : {};
    const model = new Model(load(opt('model')), params);
    const gz = zlib.createGzip(); const ws = fs.createWriteStream(opt('out')); gz.pipe(ws);
    const log = opt('log') ? fs.createWriteStream(opt('log')) : null; let n = 0, ch = 0, amb = 0; const t0 = process.cpuUsage();
    for await (const r of readJsonl(opt('in'))) {
      const o = pass(r.text || '', model); n++; ch += o.changes.length; amb += o.ambiguous;
      gz.write(JSON.stringify({ ...r, text: o.text, longs_pass: { changes: o.changes.length, ambiguous: o.ambiguous } }) + '\n');
      if (log) log.write(JSON.stringify({ page_id: r.page_id || r.uid, changes: o.changes }) + '\n');
    }
    gz.end(); await new Promise((r) => ws.on('finish', r)); log?.end();
    const cpu = process.cpuUsage(t0);
    console.log(JSON.stringify({ pages: n, tokens_changed: ch, ambiguous_decisions: amb, params: model.P, cpu_ms_per_page: +((cpu.user + cpu.system) / 1000 / n).toFixed(1) }));
    return;
  }
  console.error('usage: build | dev | apply'); process.exit(2);
}
if (import.meta.url === `file://${process.argv[1]}`) main();
