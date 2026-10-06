#!/usr/bin/env node
// PRIOR ART: benchmark-cost-lane.mjs — the #4925 cost-lane rule over PAGES (median Δ, seeded bootstrap of the
// median, catastrophic/invention/loop checks); this applies the same checks with the BOOK as the unit
// (prereg Amendment 3: 3-page runs, mean CER of the run's text pages). open-engine-print-5660.mjs `tally` —
// the long-s / abbreviation counts, reused here per book. benchmark-score.mjs stays the only scorer: this
// reads its per-page output. Nothing in the repo restores ſ from a second reader; `hybrid` is that.
/**
 * latin-r4-report-5924.mjs — round 4 of #5660 (Latin print, #5924): hybrid arms, book-level verdicts, seams.
 *
 *   hybrid  --root=<bench root> --src=<engine> --cal=<calamari engine> --engine=<out name> --strata=a,b [--abbr]
 *           the src engine's text with ſ restored where Calamari's aligned word has ſ (rule below); --abbr adds the
 *           abbreviation restore (flash+Calamari arm)
 *   norm    --root --out-root --refs-out --strata [--stats]   the latin-norm@1 folded copy (primary view)
 *   report  --work --raw --norm --unfolded --out [--arms]   per century cell: the most accurate arm by book (prereg
 *           Amendment 3 J), runner-up, noise floor, Δ vs lite; seams; long-s and abbreviation counts; population rates
 *
 * ſ RESTORE (fixed in prereg Amendment 3 before any engine call). Words = maximal runs of letters (incl. ſ,
 * combining marks). Each word gets a KEY: NFD, marks dropped, lower case, ſ/f/s → s, v → u, j → i. The two pages'
 * key sequences are aligned by longest common subsequence. For every aligned pair whose keys are equal and whose
 * NFC letter strings have the same length, each position where Calamari has ſ and the engine has f or s becomes ſ.
 * Nothing else in the engine's text changes (no other letter, no spacing, no line). A word Calamari did not read,
 * or read differently, keeps the engine's letters.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { binomTwoSided, resetSeed, seededRand } from './lib/paired-stats.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CMD = process.argv[2];
const args = Object.fromEntries(process.argv.slice(3).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const median = xs => { const s = xs.filter(x => x != null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const LITE = 'gemini-3.1-flash-lite', LITE_B = 'gemini-3.1-flash-lite-b';

// ── ſ restore ────────────────────────────────────────────────────────────────
const WORD = /[\p{L}\p{M}ſ]+/gu;
const keyOf = w => w.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[ſf]/g, 's').replace(/v/g, 'u').replace(/j/g, 'i');
function lcsPairs(a, b) {
  const n = a.length, m = b.length; const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++; }
  return out;
}
export function restoreLongS(engineText, calText) {
  const ew = [...engineText.matchAll(WORD)].map(m => ({ w: m[0], at: m.index })), cw = [...calText.matchAll(WORD)].map(m => m[0]);
  if (!ew.length || !cw.length) return { text: engineText, changed: 0 };
  const pairs = lcsPairs(ew.map(x => keyOf(x.w)), cw.map(keyOf));
  const chars = [...engineText]; const idx = []; { let u = 0; for (let k = 0; k < chars.length; k++) { idx.push(u); u += chars[k].length; } }
  const byUnit = new Map(idx.map((u, k) => [u, k]));
  let changed = 0;
  for (const [i, j] of pairs) {
    const e = [...ew[i].w.normalize('NFC')], c = [...cw[j].normalize('NFC')];
    if (e.length !== c.length || ew[i].w !== ew[i].w.normalize('NFC')) continue;
    let u = ew[i].at;
    for (let k = 0; k < e.length; k++) { if (c[k] === 'ſ' && (e[k] === 'f' || e[k] === 's')) { chars[byUnit.get(u)] = 'ſ'; changed++; } u += e[k].length; }
  }
  return { text: chars.join(''), changed };
}
/**
 * ABBREVIATION RESTORE (the flash+Calamari arm only; prereg Amendment 3 K, fixed before any engine call). After the
 * ſ restore: the same word alignment, with Calamari's words extended by a trailing `;` or `:` after q/b (q; b;).
 * Where the two keys are equal and Calamari's word carries an abbreviation sign (combining macron/tilde, ꝑ ꝓ ꝗ ꝙ ꝯ ꝰ
 * ⁊, or the trailing q;/b;) that the engine's word lacks, the engine's word is replaced by Calamari's word.
 */
const CWORD = /[\p{L}\p{M}ſ]+(?:(?<=[qb])[;:])?/gu;
const SIGN = /[̃̄ꝑꝓꝗꝙꝯꝰ⁊]|[qb][;:]$/u;
export function restoreAbbrev(engineText, calText) {
  const ew = [...engineText.matchAll(WORD)].map(m => ({ w: m[0], at: m.index })), cw = [...calText.matchAll(CWORD)].map(m => m[0]);
  if (!ew.length || !cw.length) return { text: engineText, changed: 0 };
  const k = w => keyOf(w.replace(/[;:]$/, '').replace(/[ꝑꝓꝗꝙꝯꝰ⁊]/g, c => ({ 'ꝑ': 'p', 'ꝓ': 'p', 'ꝗ': 'q', 'ꝙ': 'q', 'ꝯ': 'c', 'ꝰ': '', '⁊': '' }[c])));
  const pairs = lcsPairs(ew.map(x => k(x.w)), cw.map(k));
  let out = '', last = 0, changed = 0;
  for (const [i, j] of pairs) {
    const e = ew[i].w, c = cw[j];
    if (!SIGN.test(c.normalize('NFD')) || SIGN.test(e.normalize('NFD')) || !k(c)) continue;
    out += engineText.slice(last, ew[i].at) + c; last = ew[i].at + e.length; changed++;
  }
  return { text: out + engineText.slice(last), changed };
}
function hybrid() {
  const { root, src, cal, engine } = args; const strata = String(args.strata).split(',');
  for (const st of strata) {
    const sd = path.join(root, st, 'out', src), cd = path.join(root, st, 'out', cal), od = path.join(root, st, 'out', engine);
    fs.mkdirSync(od, { recursive: true }); let n = 0, ch = 0, ab = 0, nocal = 0;
    for (const f of fs.readdirSync(path.join(root, st)).filter(f => f.endsWith('.jpg'))) {
      const slug = f.slice(0, -4); const sp = path.join(sd, `${slug}.txt`); if (!fs.existsSync(sp)) continue;
      const t = fs.readFileSync(sp, 'utf8'); const cp = path.join(cd, `${slug}.txt`);
      if (!fs.existsSync(cp)) { fs.writeFileSync(path.join(od, `${slug}.txt`), t); nocal++; n++; continue; }
      const ct = fs.readFileSync(cp, 'utf8'); const r = restoreLongS(t, ct); let out = r.text; ch += r.changed;
      if (args.abbr) { const a = restoreAbbrev(out, ct); out = a.text; ab += a.changed; }
      fs.writeFileSync(path.join(od, `${slug}.txt`), out); n++;
    }
    if (fs.existsSync(path.join(sd, '_meter.jsonl'))) fs.copyFileSync(path.join(sd, '_meter.jsonl'), path.join(od, '_meter.jsonl'));   // a refusal stays a refusal
    console.log(`${st}: ${engine} ← ${src} + ſ from Calamari: ${n} pages, ${ch} letters set to ſ, ${ab} words given Calamari's abbreviation, ${nocal} pages without a Calamari read (unchanged)`);
  }
}

// ── latin-norm@1: the PRIMARY view (prereg Amendment 3, I) ───────────────────
// Applied to the reference AND every engine's text before benchmark-score (whose own normAlpha then lower-cases,
// folds ſ → s, rejoins line-break hyphens and keeps letters only). u/v and i/j stay as printed; f stays f, so an
// ſ read as f is still an error.
//   1. deterministic, both sides: ligatures split (æ œ ﬀ ﬁ ﬂ ﬃ ﬄ ﬅ ﬆ ꜳ ꝏ), sigla expanded (⁊ & → et, &c → etc,
//      ꝑ → per, ꝓ → pro, ꝙ → quod, ꝯ → con, ꝰ → us, q; q: → que, b; → bus), NFC.
//   2. reference-guided, engine side only: a word that still carries an abbreviation mark (combining macron or
//      tilde, ꝗ ꝝ ꝫ ꝭ ꝟ ̄) on either side is replaced by the reference word when the two words are paired by the
//      alignment below and the marked word's letters (marks dropped) are an ordered subsequence of the other
//      word, with the same first letter and at most 4 extra letters per mark. Pairing: longest common
//      subsequence of word keys (NFD, marks dropped, lower case, ſ → s); between two anchors, words pair by
//      position when both gaps have the same length. Nothing else changes.
const LIGS = { 'æ': 'ae', 'Æ': 'Ae', 'œ': 'oe', 'Œ': 'Oe', 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'ſt', 'ﬆ': 'st', 'ꜳ': 'aa', 'ꝏ': 'oo' };
const SIGLA = [[/&c\b/g, 'etc'], [/[⁊&]/g, 'et'], [/ꝑ/g, 'per'], [/Ꝑ/g, 'Per'], [/ꝓ/g, 'pro'], [/Ꝓ/g, 'Pro'], [/ꝙ/g, 'quod'], [/ꝯ/g, 'con'], [/Ꝯ/g, 'Con'], [/ꝰ/g, 'us'],
  [/(\p{L})q[;:](?=\s|$|[.,])/gu, '$1que'], [/\bq[;:]/g, 'que'], [/(\p{L})b[;:](?=\s|$|[.,])/gu, '$1bus']];
export function foldDeterministic(t) {
  let s = String(t || '').normalize('NFC').replace(/[æÆœŒﬀﬁﬂﬃﬄﬅﬆꜳꝏ]/g, c => LIGS[c]);
  for (const [re, to] of SIGLA) s = s.replace(re, to);
  return s;
}
const MARKED = /[̃̄̅̆̑ꝗꝝꝫꝭꝟ]/u;
const NWORD = /[\p{L}\p{M}ꝗꝝꝫꝭꝟ]+/gu;
const skel = w => w.normalize('NFD').replace(/[\p{M}]/gu, '').replace(/[ꝗ]/g, 'q').replace(/[ꝝ]/g, 'r').replace(/[ꝫꝭꝟ]/g, '').toLowerCase().replace(/ſ/g, 's');
function isSubseq(a, b) { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; }
export function abbrevMatch(marked, plain) {
  const m = (marked.normalize('NFD').match(/[̃̄̅̆̑ꝗꝝꝫꝭꝟ]/gu) || []).length; if (!m) return false;
  const a = skel(marked), b = skel(plain); if (!a || !b || a[0] !== b[0] || b.length < a.length || b.length - a.length > 4 * m) return false;
  return isSubseq(a, b);
}
export function foldGuided(hyp, ref) {
  const H = [...hyp.matchAll(NWORD)].map(x => ({ w: x[0], at: x.index })), R = [...ref.matchAll(NWORD)].map(x => x[0]);
  if (!H.length || !R.length || !H.some(x => MARKED.test(x.w.normalize('NFD'))) && !R.some(w => MARKED.test(w.normalize('NFD')))) return { text: hyp, changed: 0 };
  const pairs = lcsPairs(H.map(x => skel(x.w)), R.map(skel));
  const pairsAll = []; let pi = -1, pj = -1;
  for (const [i, j] of [...pairs, [H.length, R.length]]) {
    if (i - pi === j - pj) for (let k = 1; k < i - pi; k++) pairsAll.push([pi + k, pj + k]);
    if (i < H.length) pairsAll.push([i, j]); pi = i; pj = j;
  }
  let out = '', last = 0, changed = 0;
  for (const [i, j] of pairsAll.sort((x, y) => x[0] - y[0])) {
    const h = H[i].w, r = R[j]; if (h === r) continue;
    const hm = MARKED.test(h.normalize('NFD')), rm = MARKED.test(r.normalize('NFD'));
    if ((hm && !rm && abbrevMatch(h, r)) || (rm && !hm && abbrevMatch(r, h))) { out += hyp.slice(last, H[i].at) + r; last = H[i].at + h.length; changed++; }
  }
  return { text: out + hyp.slice(last), changed };
}
/** norm --root=<raw bench root> --out-root=<folded root> --refs-out=<dir> --strata=a,b : the latin-norm@1 copy. */
function norm() {
  const { root } = args; const outRoot = args['out-root'], refsOut = args['refs-out']; const strata = String(args.strata).split(',');
  fs.mkdirSync(refsOut, { recursive: true }); const stats = {};
  const REFS = path.join(__dirname, 'benchmark', 'refs');
  for (const st of strata) {
    const src = path.join(root, st), dst = path.join(outRoot, st); fs.mkdirSync(path.join(dst, 'out'), { recursive: true });
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.jpg') || f === 'manifest.json')) { const d = path.join(dst, f); if (!fs.existsSync(d)) fs.linkSync(path.join(src, f), d); }
    const refOf = {};
    for (const f of fs.readdirSync(src).filter(f => f.endsWith('.jpg'))) {
      const slug = f.slice(0, -4); const rp = path.join(REFS, `${slug}.txt`); if (!fs.existsSync(rp)) continue;
      refOf[slug] = foldDeterministic(fs.readFileSync(rp, 'utf8')); fs.writeFileSync(path.join(refsOut, `${slug}.txt`), refOf[slug]);
      const rec = path.join(REFS, `${slug}.json`); if (fs.existsSync(rec)) fs.copyFileSync(rec, path.join(refsOut, `${slug}.json`));
    }
    for (const e of fs.readdirSync(path.join(src, 'out')).filter(e => fs.statSync(path.join(src, 'out', e)).isDirectory())) {
      const od = path.join(dst, 'out', e); fs.mkdirSync(od, { recursive: true }); let n = 0, ch = 0;
      for (const f of fs.readdirSync(path.join(src, 'out', e))) {
        const p = path.join(src, 'out', e, f);
        if (!f.endsWith('.txt')) { fs.copyFileSync(p, path.join(od, f)); continue; }
        let t = foldDeterministic(fs.readFileSync(p, 'utf8')); const ref = refOf[f.slice(0, -4)];
        if (ref) { const g = foldGuided(t, ref); t = g.text; ch += g.changed; }
        fs.writeFileSync(path.join(od, f), t); n++;
      }
      (stats[st] ||= {})[e] = { pages: n, guided_words: ch };
    }
  }
  console.log(JSON.stringify(stats));
  if (args.stats) fs.writeFileSync(args.stats, JSON.stringify({ fold: 'latin-norm@1', stats }, null, 1) + '\n');
}

// ── stats ────────────────────────────────────────────────────────────────────
function bootMedianCI(xs, B = 5000) {   // benchmark-cost-lane's: seeded 0x4925, 5,000 resamples, here over BOOKS
  if (xs.length < 2) return null; resetSeed(0x4925); const meds = [];
  for (let b = 0; b < B; b++) { const s = []; for (let j = 0; j < xs.length; j++) s.push(xs[Math.floor(seededRand() * xs.length)]); meds.push(median(s)); }
  meds.sort((a, b) => a - b); return [r3(meds[Math.floor(B * 0.025)]), r3(meds[Math.floor(B * 0.975)])];
}
const latestFile = (dir, st) => { const f = fs.readdirSync(dir).filter(x => x.startsWith(`${st}-`) && /^\d{4}-\d{2}-\d{2}\.json$/.test(x.slice(st.length + 1))).sort().pop(); return f ? readJson(path.join(dir, f)) : null; };
const fwords = t => (String(t).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i').match(/\p{L}+/gu) || []);
const ngrams = (ws, n) => { const s = new Set(); for (let i = 0; i + n <= ws.length; i++) s.add(ws.slice(i, i + n).join(' ')); return s; };
const letters = t => (String(t).match(/\p{L}/gu) || []).length;
const ABBR = /[āēīōūǣ̄ꝑꝓꝗꝙꝯꝫ̃ẽõũ⁊]|q;/gu;

/**
 * report --work=<refs work dir> --raw=<raw bench root> --norm=<scored dir, latin-norm@1> --unfolded=<scored dir, raw>
 *        --out=<json> [--arms=a,b,…]   the prereg Amendment 3 rule, per century cell, the BOOK as unit
 */
const capCer = (m) => (m == null || m.missing ? null : m.refused ? 1 : typeof m.cer === 'number' ? Math.min(1, m.cer) : null);
const quant = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
function bookTable(S, al, lc, arms, rawText) {
  // book → { century, pages: [{ slug, kind: text|blank }], cer: { arm: book CER | null } }
  const P = new Map(S.pages.map(p => [p.slug, p])); const out = []; const excluded = [];
  for (const [book, a] of Object.entries(al)) {
    if (a.status !== 'aligned') continue;
    const pages = [];
    for (const pg of a.pages) {
      const v = lc.get(`${book}|${pg.page}`);
      if (v?.verdict === 'ok' && v.leaf_language === 'lat') {
        const p = P.get(pg.slug);
        if (!p) { excluded.push({ slug: pg.slug, why: 'not in scorer output (textless?)' }); continue; }
        if (!p.has_ref) { excluded.push({ slug: pg.slug, why: 'no reference at score time' }); continue; }
        if (S.ref_mismatch?.includes(pg.slug)) { excluded.push({ slug: pg.slug, why: 'scorer reference-mismatch guard' }); continue; }
        pages.push({ slug: pg.slug, kind: 'text', p });
      } else if (v?.verdict === 'no-text') pages.push({ slug: pg.slug, kind: 'blank' });
      else if (v) excluded.push({ slug: pg.slug, why: `leaf ${v.verdict}${v.verdict === 'ok' ? '/' + v.leaf_language : ''}` });
    }
    if (!pages.some(x => x.kind === 'text')) continue;
    const cer = {}, cata = {}, blankInv = {};
    for (const e of arms) {
      const vals = []; let c = 0, bi = 0, ok = true;
      for (const x of pages) {
        if (x.kind === 'text') { const v = capCer(x.p.engines[e]); if (v == null) { ok = false; break; } vals.push(v); if (v > 0.5) c++; }
        else { const t = rawText(e, 'latin-r4-acc', x.slug); if (t == null) { ok = false; break; } const inv = letters(t) > 25; vals.push(inv ? 1 : 0); if (inv) { c++; bi++; } }
      }
      cer[e] = ok ? mean(vals) : null; cata[e] = ok ? c : null; blankInv[e] = ok ? bi : null;
    }
    out.push({ book, century: a.century, n_text: pages.filter(x => x.kind === 'text').length, n_blank: pages.filter(x => x.kind === 'blank').length, cer, cata, blankInv });
  }
  return { books: out, excluded };
}
function pairStats(bs, a, b) {
  const d = bs.filter(x => x.cer[a] != null && x.cer[b] != null).map(x => x.cer[a] - x.cer[b]);
  const w = d.filter(x => x < -1e-9).length, l = d.filter(x => x > 1e-9).length;
  return { n: d.length, median: r3(median(d)), mean: r3(mean(d)), ci95: bootMedianCI(d), wins: w, losses: l, ties: d.length - w - l, p_sign: d.length ? r3(binomTwoSided(Math.max(w, l), w + l)) : null };
}
function rankCell(bs, arms) {
  const full = arms.filter(e => bs.every(x => x.cer[e] != null));
  const stat = Object.fromEntries(full.map(e => [e, { median: median(bs.map(x => x.cer[e])), mean: mean(bs.map(x => x.cer[e])) }]));
  const order = full.sort((a, b) => stat[a].median - stat[b].median || stat[a].mean - stat[b].mean);
  const d0 = bs.filter(x => x.cer[LITE_B] != null).map(x => Math.abs(x.cer[LITE_B] - x.cer[LITE]));
  const floor = { n: d0.length, p95_abs_delta0: r3(quant(d0, 0.95)), median_abs_delta0: r3(median(d0)), identical_books: d0.filter(x => x < 1e-9).length };
  const [win, run] = order;
  const vsRun = run ? pairStats(bs, win, run) : null;
  const separated = !!vsRun && vsRun.p_sign < 0.05 && Math.abs(vsRun.median) > (floor.p95_abs_delta0 ?? 0);
  return { ranking: order.map(e => ({ arm: e, median_book_cer: r3(stat[e].median), mean_book_cer: r3(stat[e].mean) })), winner: win, runner_up: run, winner_vs_runner_up: vsRun, noise_floor: floor, separated,
    verdict: separated ? win : `tie: ${win} / ${run} (not separated)`, not_ranked: arms.filter(e => !order.includes(e)) };
}
function report() {
  const WORK = args.work, RAW = args.raw;
  const al = readJson(path.join(WORK, 'align.json'));
  const lc = new Map(readJson(path.join(WORK, 'leaf-check.json')).rows.map(r => [`${r.book_id}|${r.page}`, r]));
  const pd = readJson(path.join(WORK, 'popdraw.json'));
  const rawText = (e, st, slug) => { const f = path.join(RAW, st, 'out', e, `${slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const out = { built_at: new Date().toISOString(), unit: 'book (3-page run): mean of the run\'s scored pages; page CER capped at 1; refusal = 1; no-text page = 1 if > 25 letters written, else 0', views: {} };
  for (const [view, dir] of [['latin-norm@1', args.norm], ['unfolded', args.unfolded]]) {
    if (!dir) continue;
    const S = latestFile(dir, 'latin-r4-acc'); if (!S) { console.log(`! no scored latin-r4-acc in ${dir}`); continue; }
    const arms = args.arms ? String(args.arms).split(',') : [...new Set(S.pages.flatMap(p => Object.keys(p.engines)))].sort();
    const { books, excluded } = bookTable(S, al, lc, arms, rawText);
    const V = out.views[view] = { arms, excluded_pages: excluded, cells: {}, books };
    for (const cen of ['1500s', '1600s', '1700s']) {
      const bs = books.filter(b => b.century === cen); if (!bs.length) continue;
      const minN = cen === '1600s' ? 50 : cen === '1500s' ? 30 : Infinity;
      const R = rankCell(bs, arms);
      const vsLite = Object.fromEntries(arms.filter(e => e !== LITE).map(e => [e, pairStats(bs, e, LITE)]));
      const per = Object.fromEntries(arms.map(e => { const b = bs.filter(x => x.cer[e] != null); return [e, { books: b.length, median_book_cer: r3(median(b.map(x => x.cer[e]))), mean_book_cer: r3(mean(b.map(x => x.cer[e]))), catastrophic_pages: b.reduce((s, x) => s + x.cata[e], 0), books_with_catastrophic: b.filter(x => x.cata[e] > 0).length, blank_invented: b.reduce((s, x) => s + x.blankInv[e], 0) }]; }));
      V.cells[cen] = { books: bs.length, text_pages: bs.reduce((s, b) => s + b.n_text, 0), blank_pages: bs.reduce((s, b) => s + b.n_blank, 0), grade: bs.length >= minN ? 'decision' : 'not enough refs (exploratory)', ...R, verdict: bs.length >= minN ? R.verdict : `not enough refs (exploratory lean: ${R.verdict})`, vs_lite: vsLite, per_arm: per };
    }
  }
  // seams, long-s and abbreviation counts on RAW text, both strata
  const S0 = args.norm ? latestFile(args.norm, 'latin-r4-acc') : null;
  const engines = args.arms ? String(args.arms).split(',') : [...new Set((S0?.pages || []).flatMap(p => Object.keys(p.engines)))].sort();
  const runsAcc = Object.entries(al).filter(([b, a]) => a.status === 'aligned' && fs.existsSync(path.join(RAW, 'latin-r4-acc', `${a.pages[0].slug}.jpg`))).map(([book, a]) => ({ book, st: 'latin-r4-acc', century: a.century, slugs: a.pages.map(p => p.slug) }));
  const runsPop = Object.entries(pd.strata).flatMap(([st, s]) => s.drawn.filter(x => !x.skip).map(b => ({ book: b.book_id, st: 'latin-r4-pop', century: st, slugs: b.pages.map(pn => `r4p-${b.book_id.replace(/[^0-9a-z]/gi, '')}-p${pn}`), meta: b })));
  const refText = slug => { const f = path.join(__dirname, 'benchmark', 'refs', `${slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const refWords = new Set(); for (const r of runsAcc) for (const s of r.slugs) { const t = refText(s); if (t) for (const w of fwords(t)) refWords.add(w); }
  out.seams = {}; out.longs = {};
  for (const e of engines) {
    for (const [lab, runs] of [['acc', runsAcc], ['pop', runsPop]]) {
      const sm = { seams: 0, duplicated_across_boundary: 0, pulled_from_neighbour: 0, seams_with_ref: 0 }; const ls = { pages: 0, long_s_glyph: 0, f_for_s: 0, abbrev_marks: 0 };
      for (const r of runs) {
        const T = r.slugs.map(s => rawText(e, r.st, s));
        for (let i = 0; i + 1 < T.length; i++) {
          if (T[i] == null || T[i + 1] == null) continue; sm.seams++;
          const a = ngrams(fwords(T[i]), 10), b = ngrams(fwords(T[i + 1]), 10);
          if ([...a].some(g => b.has(g))) sm.duplicated_across_boundary++;
          if (r.st === 'latin-r4-acc') {
            const ri = refText(r.slugs[i]), rj = refText(r.slugs[i + 1]); if (!ri || !rj) continue; sm.seams_with_ref++;
            const own = [ngrams(fwords(ri), 10), ngrams(fwords(rj), 10)], nb = [own[1], own[0]];
            for (const [k, g] of [[0, a], [1, b]]) if ([...g].some(x => nb[k].has(x) && !own[k].has(x))) sm.pulled_from_neighbour++;
          }
        }
        for (const [k, t] of T.entries()) {
          if (t == null) continue; ls.pages++; ls.long_s_glyph += (t.match(/ſ/g) || []).length; ls.abbrev_marks += (t.normalize('NFC').match(ABBR) || []).length;
          const ref = r.st === 'latin-r4-acc' ? refText(r.slugs[k]) : null; const known = ref ? new Set(fwords(ref)) : refWords;
          for (const w of fwords(t)) if (w.includes('f') && !known.has(w) && known.has(w.replace(/f/g, 's'))) ls.f_for_s++;
        }
      }
      (out.seams[e] ||= {})[lab] = sm; (out.longs[e] ||= {})[lab] = ls;
    }
  }
  // population: failure rates per arm and stratum, from the latin-norm@1 scored pop file (CER there is vs lite)
  out.population = {};
  const SP = args.norm ? latestFile(args.norm, 'latin-r4-pop') : null;
  if (SP) {
    const P = new Map(SP.pages.map(p => [p.slug, p]));
    for (const e of engines) {
      const by = {};
      for (const r of runsPop) for (const s of r.slugs) {
        const t = rawText(e, 'latin-r4-pop', s); if (t == null) continue; const p = P.get(s); const m = p?.engines?.[e];
        const v = (by[r.century] ||= { pages: 0, textless_all: 0, empty_where_others_read: 0, loops: 0, refused: 0, dist_to_lite: [], far_from_lite: 0 });
        v.pages++; if (!p) { v.textless_all++; continue; }
        const others = Object.entries(p.engines).filter(([k, x]) => k !== e && !x.missing).some(([, x]) => x.n_content >= 200);
        if (m && m.n_content < 30 && others) v.empty_where_others_read++; if (m?.loop) v.loops++; if (m?.refused) v.refused++;
        if (e !== LITE && typeof m?.cer === 'number') { v.dist_to_lite.push(Math.min(1, m.cer)); if (m.cer > 0.5) v.far_from_lite++; }
      }
      out.population[e] = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, dist_to_lite: r3(median(v.dist_to_lite)) }]));
    }
  }
  fs.writeFileSync(args.out, JSON.stringify(out, null, 1) + '\n');
  for (const [view, V] of Object.entries(out.views)) for (const [c, v] of Object.entries(V.cells)) {
    console.log(`\n[${view}] ${c}: ${v.books} books (${v.text_pages} text, ${v.blank_pages} blank) — ${v.grade} → ${v.verdict}; floor p95 |Δ0| ${v.noise_floor.p95_abs_delta0}`);
    for (const r of v.ranking) { const s = v.vs_lite[r.arm]; console.log(`  ${r.arm.padEnd(28)} med ${r.median_book_cer} mean ${r.mean_book_cer}  vs lite ${s ? `Δ ${s.median} ${JSON.stringify(s.ci95)} ${s.wins}/${s.losses} p ${s.p_sign}` : '—'}  cata ${v.per_arm[r.arm].catastrophic_pages}`); }
    if (v.winner_vs_runner_up) console.log(`  winner vs runner-up: ${JSON.stringify(v.winner_vs_runner_up)}`);
    if (v.not_ranked.length) console.log(`  not ranked (incomplete): ${v.not_ranked.join(', ')}`);
  }
}

const MAIN = { hybrid, report, norm };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!MAIN[CMD]) { console.error(`usage: ${Object.keys(MAIN).join(' | ')}`); process.exit(1); }
  MAIN[CMD]();
}
