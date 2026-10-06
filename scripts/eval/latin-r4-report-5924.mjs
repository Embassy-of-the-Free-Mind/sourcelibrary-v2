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
 *   report  --scored=<dir per arm, comma list arm:dir> --work=<refs work dir> --root=<bench root> --out=<json>
 *           per century cell and arm: book-level Δ vs lite, bootstrap CI by book, sign test, the checks, verdict;
 *           seams; long-s and abbreviation counts; population failure rates and agreement
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

function report() {
  const WORK = args.work, ROOT = args.root;
  const al = readJson(path.join(WORK, 'align.json'));
  const lc = new Map(readJson(path.join(WORK, 'leaf-check.json')).rows.map(r => [`${r.book_id}|${r.page}`, r]));
  const pd = readJson(path.join(WORK, 'popdraw.json'));
  const arms = String(args.scored).split(',').map(x => x.split(':'));   // engine:scored-dir (each in its own bench root)
  const out = { built_at: new Date().toISOString(), unit: 'book (3-page run)', arms: {}, population: {}, seams: {}, longs: {} };
  const text = (eng, st, slug) => { for (const [e, , rt] of arms) if (e === eng || eng === LITE || eng === LITE_B) { const f = path.join(rt || ROOT, st, 'out', eng, `${slug}.txt`); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } return null; };
  for (const [engine, dir] of arms) {
    const S = latestFile(dir, 'latin-r4-acc'); if (!S) { console.log(`! no scored latin-r4-acc in ${dir}`); continue; }
    const P = new Map(S.pages.map(p => [p.slug, p]));
    const cells = {};
    for (const [book, a] of Object.entries(al)) {
      if (a.status !== 'aligned') continue;
      const textPages = [], blank = [];
      for (const pg of a.pages) {
        const v = lc.get(`${book}|${pg.page}`)?.verdict;
        if (v === 'ok') textPages.push(pg); else if (v === 'no-text') blank.push(pg);
      }
      if (!textPages.length) continue;
      const rows = textPages.map(pg => P.get(pg.slug)).filter(p => p && typeof p.engines?.[engine]?.cer === 'number' && typeof p.engines?.[LITE]?.cer === 'number');
      if (!rows.length) continue;
      const blankFail = e => blank.filter(pg => letters(text(e, 'latin-r4-acc', pg.slug) || '') > 25).length;
      const b = {
        book, n_text: rows.length, n_blank: blank.length,
        cer: { [engine]: mean(rows.map(p => p.engines[engine].cer)), [LITE]: mean(rows.map(p => p.engines[LITE].cer)) },
        cer_b: rows.every(p => typeof p.engines[LITE_B]?.cer === 'number') ? mean(rows.map(p => p.engines[LITE_B].cer)) : null,
        cata: { [engine]: rows.filter(p => p.engines[engine].cer > 0.5).length + blankFail(engine), [LITE]: rows.filter(p => p.engines[LITE].cer > 0.5).length + blankFail(LITE) },
        blank_invented: { [engine]: blankFail(engine), [LITE]: blankFail(LITE) },
        inv: { [engine]: mean(rows.map(p => p.engines[engine].invention_ref ?? 0)), [LITE]: mean(rows.map(p => p.engines[LITE].invention_ref ?? 0)) },
        loop: { [engine]: rows.some(p => p.engines[engine].loop), [LITE]: rows.some(p => p.engines[LITE].loop) },
      };
      (cells[a.century] ||= []).push(b);
    }
    out.arms[engine] = {};
    for (const [cen, bs] of Object.entries(cells)) {
      const d = bs.map(b => b.cer[engine] - b.cer[LITE]); const d0 = bs.filter(b => b.cer_b != null).map(b => b.cer_b - b.cer[LITE]);
      const wins = d.filter(x => x < 0).length, losses = d.filter(x => x > 0).length;
      const medD = median(d), ci = bootMedianCI(d), medD0 = median(d0);
      const cata = e => bs.filter(b => b.cata[e] > 0).length, loops = e => bs.filter(b => b.loop[e]).length;
      const inv = e => median(bs.map(b => b.inv[e]));
      const minN = cen === '1600s' ? 50 : 30;
      const checks = { median_delta_le_002: medD <= 0.02, ci_upper_le_005: !!ci && ci[1] <= 0.05, noise_lt_002: d0.length ? Math.abs(medD0) < 0.02 : null,
        catastrophic_books_le_lite_plus_1: cata(engine) <= cata(LITE) + 1, invention_le_lite: inv(engine) <= inv(LITE), loops_le_lite: loops(engine) <= loops(LITE) };
      const pass = Object.values(checks).every(v => v !== false);
      const p = binomTwoSided(wins, wins + losses);
      out.arms[engine][cen] = {
        books: bs.length, text_pages: bs.reduce((s, b) => s + b.n_text, 0), blank_pages: bs.reduce((s, b) => s + b.n_blank, 0), grade: bs.length >= minN ? 'decision' : 'not enough refs',
        median_book_cer: { [engine]: r3(median(bs.map(b => b.cer[engine]))), [LITE]: r3(median(bs.map(b => b.cer[LITE]))) },
        delta: { median: r3(medD), ci95: ci, wins, losses, ties: d.length - wins - losses, p_sign: r3(p) }, noise: { n: d0.length, median_delta0: r3(medD0) },
        catastrophic_books: { [engine]: cata(engine), [LITE]: cata(LITE) }, catastrophic_pages: { [engine]: bs.reduce((s, b) => s + b.cata[engine], 0), [LITE]: bs.reduce((s, b) => s + b.cata[LITE], 0) },
        blank_invented: { [engine]: bs.reduce((s, b) => s + b.blank_invented[engine], 0), [LITE]: bs.reduce((s, b) => s + b.blank_invented[LITE], 0) },
        invention_median: { [engine]: r3(inv(engine)), [LITE]: r3(inv(LITE)) }, loop_books: { [engine]: loops(engine), [LITE]: loops(LITE) },
        checks, passes_rule: pass, better_than_lite: p < 0.05 && wins > losses && medD < 0,
        verdict: bs.length < minN ? 'not enough refs' : pass ? `${engine} (no worse than lite)` : 'keep lite',
      };
    }
  }
  // seams + long-s + abbreviations, per arm, on both strata
  const engines = [...new Set([LITE, LITE_B, ...arms.map(a => a[0])])];
  const runsAcc = Object.entries(al).filter(([, a]) => a.status === 'aligned').map(([book, a]) => ({ book, st: 'latin-r4-acc', century: a.century, slugs: a.pages.map(p => p.slug) }));
  const runsPop = Object.entries(pd.strata).flatMap(([st, s]) => s.drawn.filter(x => !x.skip).map(b => ({ book: b.book_id, st: 'latin-r4-pop', century: st, slugs: b.pages.map(pn => `r4p-${b.book_id.replace(/[^0-9a-z]/gi, '')}-p${pn}`), meta: b })));
  const refText = slug => { const f = path.join(__dirname, 'benchmark', 'refs', `${slug}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };
  const refWords = new Set(); for (const r of runsAcc) for (const s of r.slugs) { const t = refText(s); if (t) for (const w of fwords(t)) refWords.add(w); }
  for (const e of engines) {
    const sm = { seams: 0, duplicated_across_boundary: 0, pulled_from_neighbour: 0, seams_with_ref: 0 }; const ls = { pages: 0, long_s_glyph: 0, f_for_s: 0, abbrev_marks: 0, ref_abbrev_marks: 0 };
    for (const r of [...runsAcc, ...runsPop]) {
      const T = r.slugs.map(s => text(e, r.st, s)); if (T.some(t => t == null)) continue;
      for (let i = 0; i + 1 < 3; i++) {
        sm.seams++;
        const a = ngrams(fwords(T[i]), 10), b = ngrams(fwords(T[i + 1]), 10);
        if ([...a].some(g => b.has(g))) sm.duplicated_across_boundary++;
        if (r.st === 'latin-r4-acc') {
          const ri = refText(r.slugs[i]), rj = refText(r.slugs[i + 1]); if (!ri || !rj) continue; sm.seams_with_ref++;
          const own = [ngrams(fwords(ri), 10), ngrams(fwords(rj), 10)], nb = [own[1], own[0]];
          for (const [k, g] of [[0, a], [1, b]]) if ([...g].some(x => nb[k].has(x) && !own[k].has(x))) sm.pulled_from_neighbour++;
        }
      }
      for (const [k, t] of T.entries()) {
        ls.pages++; ls.long_s_glyph += (t.match(/ſ/g) || []).length; ls.abbrev_marks += (t.normalize('NFC').match(ABBR) || []).length;
        const ref = r.st === 'latin-r4-acc' ? refText(r.slugs[k]) : null; if (ref) ls.ref_abbrev_marks += (ref.normalize('NFC').match(ABBR) || []).length;
        // f-for-s: an output word with f that is not a known word but becomes one with f→s (known = this page's
        // reference where there is one, else every reference word of the accuracy sample — the population has none)
        const known = ref ? new Set(fwords(ref)) : refWords;
        for (const w of fwords(t)) if (w.includes('f') && !known.has(w) && known.has(w.replace(/f/g, 's'))) ls.f_for_s++;
      }
    }
    out.seams[e] = sm; out.longs[e] = ls;
  }
  // population: failure rates per arm (no reference)
  for (const [engine, dir, rt] of arms) {
    const S = latestFile(dir, 'latin-r4-pop'); if (!S) continue; const P = new Map(S.pages.map(p => [p.slug, p]));
    const by = {};
    for (const r of runsPop) for (const s of r.slugs) {
      const p = P.get(s); if (!p) continue; const m = p.engines?.[engine]; const l = p.engines?.[LITE]; if (!m) continue;
      const v = (by[r.century] ||= { pages: 0, empty_where_others_read: 0, loops: 0, refused: 0, agree_with_lite: [], catastrophic_vs_lite: 0, lite_loops: 0, lite_refused: 0 });
      v.pages++; const others = Object.entries(p.engines).filter(([k]) => k !== engine).some(([, x]) => x.n_content >= 200);
      if (m.n_content < 30 && others) v.empty_where_others_read++; if (m.loop) v.loops++; if (m.refused) v.refused++;
      if (l?.loop) v.lite_loops++; if (l?.refused) v.lite_refused++;
      const ag = m.agree?.[LITE] ?? (typeof m.cer === 'number' && engine !== LITE ? 1 - m.cer : null); if (ag != null) { v.agree_with_lite.push(ag); if (ag < 0.5) v.catastrophic_vs_lite++; }
    }
    out.population[engine] = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, { ...v, agree_with_lite: r3(median(v.agree_with_lite)) }]));
  }
  fs.writeFileSync(args.out, JSON.stringify(out, null, 1) + '\n');
  for (const [e, cs] of Object.entries(out.arms)) for (const [c, v] of Object.entries(cs)) console.log(`${e.padEnd(26)} ${c} books ${v.books} lite ${v.median_book_cer[LITE]} arm ${v.median_book_cer[e]} Δ ${v.delta.median} ${JSON.stringify(v.delta.ci95)} ${v.delta.wins}/${v.delta.losses} p ${v.delta.p_sign} cata ${v.catastrophic_books[e]}/${v.catastrophic_books[LITE]} → ${v.verdict}`);
}

const MAIN = { hybrid, report, norm };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!MAIN[CMD]) { console.error(`usage: ${Object.keys(MAIN).join(' | ')}`); process.exit(1); }
  MAIN[CMD]();
}
