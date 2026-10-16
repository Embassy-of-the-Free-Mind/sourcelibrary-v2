// PRIOR ART: scripts/eval/paddle-table-6388/analyze.mjs + an2.mjs (the #6388 rule search — scored inside the 495
// strict-flagged pages, before Opus had labelled the 4,379 the rule flags, so it could not measure the rule's own
// precision) and scripts/eval/paddle-table-6388/parity.mjs (runs the shipped rule, no labels). Neither has the
// 4,379 layout labels or a held-out split.
//
// #6561 item 3: precision of paddleTableRisk() (scripts/lib/paddle-table-detect.mjs) on the 4,379 pages it flagged,
// with recall on the 136 known invented pages held at 100 %. Pure: reads two files, no Mongo, no model.
//
//   node scripts/eval/paddle-table-precision-6561/eval.mjs <corrections.jsonl> <labels.jsonl> [--out=results.json]
//
// corrections.jsonl  one row per flagged page: the staging collection paddle_table_corrections_6561, dumped read-only
//                    (book_id, page_number, title, layout, paddle_text = the withhold snapshot the rule ran on,
//                    corrected_text = Opus's correction of it). Dump command in the experiment note.
// labels.jsonl       the #6388 judged pages (job table-detect-6388 w/labels.jsonl; `verdict: invented` = the 136).
import fs from 'node:fs';
import { paddleTableRisk, pageShape, longestDittoRun, TABLE_TITLE, T_V2 as T, T_V1 } from '../../lib/paddle-table-detect.mjs';
import { textVerdict } from '../../lib/first-ocr-guard.mjs';
import { longestCharRun, MAX_CHAR_RUN } from '../../lib/paddle-zh-lane.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

const [corrPath, labelPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const outArg = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (!corrPath || !labelPath) { console.error('usage: eval.mjs <corrections.jsonl> <labels.jsonl> [--out=results.json]'); process.exit(2); }
const jsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

const HAN = /\p{Script=Han}/u;
const ENVELOPE = /<language>[\s\S]*?<\/language>|<script>[\s\S]*?<\/script>/g;
const hanCounts = (s) => { const m = new Map(); for (const c of s) if (HAN.test(c)) m.set(c, (m.get(c) || 0) + 1); return m; };
/** Share of Paddle's Han characters that Opus's correction did not keep (per character, beyond its count). */
function excessShare(paddle, corrected) {
  const P = hanCounts(String(paddle).replace(ENVELOPE, '')), C = hanCounts(corrected);
  let ex = 0, tot = 0;
  for (const [c, n] of P) { tot += n; ex += Math.max(0, n - (C.get(c) || 0)); }
  return tot ? ex / tot : 0;
}

// ---- pages -------------------------------------------------------------------------------------------------------
const labels = jsonl(labelPath);
const invented = new Map();
for (const r of labels) if (r.verdict === 'invented' && !invented.has(r.key)) invented.set(r.key, r);
const pages = [];
const seen = new Set();
for (const r of jsonl(corrPath)) {
  const key = `${r.book_id}_${r.page_number}`; seen.add(key);
  pages.push({ key, bid: r.book_id, title: r.title, text: r.paddle_text, pop: true, inv: invented.has(key), layout: r.layout,
    excess: excessShare(r.paddle_text, r.corrected_text) });
}
// Invented pages not in the 4,379 (contained by eye before the withhold): scored on the text they were judged on.
for (const [key, r] of invented) if (!seen.has(key)) pages.push({ key, bid: r.bid, title: r.title, text: r.text, pop: false, inv: true, layout: null, excess: null });
// The 70 invented pages that ARE in the population must carry the text they were judged on.
const textMismatch = [...invented].filter(([k, r]) => seen.has(k) && pages.find((p) => p.key === k).text !== r.text).length;

// Classes. INV: one of the 136. Otherwise by Opus's layout call and how much of Paddle's Han Opus removed:
//   TAB  layout table / diagram / map / illustration       (what the detector is for)
//   MIX  layout mixed                                     (prose with a table or figure on the page)
//   FA   layout prose and excess < 5 %                    (the false alarm: prose Paddle read about right)
//   BAD  layout prose and excess >= 10 %                  (prose, but Paddle's text is largely not on the page)
//   UNC  layout prose, excess 5–10 %
const LO = 0.05, HI = 0.10;
const cls = (p) => p.inv ? 'INV' : p.layout === 'prose' ? (p.excess < LO ? 'FA' : p.excess >= HI ? 'BAD' : 'UNC') : p.layout === 'mixed' ? 'MIX' : 'TAB';
for (const p of pages) p.cls = cls(p);

// ---- the rule, parameterised (mirrors paddle-table-detect.mjs; parity-checked below) ------------------------------
const SF = new Set(['local_loop', 'line_loop', 'exact_loop']);
function feats(text, title) {
  const f = pageShape(text);
  const raw = String(text || '').replace(ENVELOPE, '').trim();
  const v = textVerdict(stripMarkupTags(raw, ''));
  return { ...f, strict: v.flags.some((x) => SF.has(x)) || longestCharRun(raw) > MAX_CHAR_RUN, rl: v.flags.includes('repeated_line'),
    title: TABLE_TITLE.test(String(title || '').normalize('NFC')) };
}
const gs = (f, t) => (f.strict || (f.rl && f.run >= t.gateRun && f.dup_lines > 0))
  && (f.run >= t.shapeRun || f.dup_lines > 0 || (f.han > 0 && f.distinct_ratio < t.distinctMax) || f.title);
for (const p of pages) {
  p.a = feats(p.text, p.title);
  p.b = p.text.includes('丨') ? feats(p.text.replaceAll('丨', ''), p.title) : p.a;
  p.dittoRun = longestDittoRun(p.text);
}
const tableLike = (f, t) => f.title || (f.han > 0 && f.distinct_ratio < t.distinctMax);
const flagOf = (p, t) => gs(p.a, t) && !(t.dittoMinRun > 0 && !tableLike(p.a, t) && p.dittoRun > 0 && !gs(p.b, t) && p.dittoRun < t.dittoMinRun);

// Parity: the parameterised copy must equal the shipped function for both T_V1 and T (= T_V2), page for page.
const parity = { v1: 0, v2: 0 };
for (const p of pages) {
  p.old = paddleTableRisk(p.text, { title: p.title }, T_V1).flag;
  const nv = paddleTableRisk(p.text, { title: p.title }, T);   // T here is T_V2, the opt-in ditto term
  p.neu = nv.flag; p.dittoOnly = nv.ditto_only;
  if (p.old !== flagOf(p, T_V1)) parity.v1++;
  if (p.neu !== flagOf(p, T)) parity.v2++;
}
if (parity.v1 || parity.v2) { console.error('PARITY FAILED', parity); process.exit(3); }

// ---- scoring -----------------------------------------------------------------------------------------------------
const CLASSES = ['INV', 'TAB', 'MIX', 'BAD', 'UNC', 'FA'];
const wilson = (k, n, z = 1.96) => { if (!n) return [0, 0]; const ph = k / n, d = 1 + z * z / n, c = ph + z * z / (2 * n), h = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)); return [+((c - h) / d).toFixed(3), +((c + h) / d).toFixed(3)]; };
function summary(set, flag) {
  const pop = set.filter((p) => p.pop), inv = set.filter((p) => p.inv);
  const fl = pop.filter(flag);
  const by = Object.fromEntries(CLASSES.map((c) => [c, fl.filter((p) => p.cls === c).length]));
  const layout = {}; for (const p of fl) layout[p.layout] = (layout[p.layout] || 0) + 1;
  const invHit = inv.filter(flag).length;
  const nonProse = fl.filter((p) => p.layout !== 'prose').length;
  return {
    flagged: fl.length, by_class: by, by_layout: layout,
    recall_invented: `${invHit}/${inv.length}`, recall_invented_wilson95: wilson(invHit, inv.length),
    // proxy 1 (layout only, mixed counted positive): share of flagged pages Opus did not call prose
    precision_nonprose: +(nonProse / fl.length).toFixed(3),
    // proxy 1b: mixed counted negative
    precision_table_only: +((by.INV + by.TAB) / fl.length).toFixed(3),
    // proxy 2 (layout + Opus's correction): share of flagged pages that are not FA
    precision_not_fa: +(1 - by.FA / fl.length).toFixed(3),
  };
}

// ---- held-out tuning: split books in half, tune on A, report on B (and the reverse) ------------------------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const books = [...new Set(pages.map((p) => p.bid))].sort();
function split(seed) { const r = rng(seed); const A = new Set(books.filter(() => r() < 0.5)); return [pages.filter((p) => A.has(p.bid)), pages.filter((p) => !A.has(p.bid))]; }
const GRID = [];
for (const gateRun of [5, 6, 8]) for (const shapeRun of [4, 5, 6]) for (const distinctMax of [0.3, 0.25, 0.2]) for (const dittoMinRun of [0, 3, 4, 5, 6, 8, 99]) GRID.push({ gateRun, shapeRun, distinctMax, dittoMinRun });
for (const p of pages) p.fg = GRID.map((t) => flagOf(p, t));
const V1 = GRID.findIndex((t) => t.gateRun === T_V1.gateRun && t.shapeRun === T_V1.shapeRun && t.distinctMax === T_V1.distinctMax && t.dittoMinRun === 0);
const RISKY = new Set(['TAB', 'MIX', 'BAD']);
/** Most FA removed, subject to: every invented page in the tuning half flagged, and ≥ 99.5 % of its risky pages kept. */
function tune(train) {
  const base = train.filter((p) => p.pop && RISKY.has(p.cls) && p.fg[V1]).length;
  let best = null;
  GRID.forEach((t, g) => {
    if (train.some((p) => p.inv && !p.fg[g])) return;
    const risky = train.filter((p) => p.pop && RISKY.has(p.cls) && p.fg[g]).length;
    if (risky < 0.995 * base) return;
    const fa = train.filter((p) => p.pop && p.cls === 'FA' && p.fg[g]).length;
    const fl = train.filter((p) => p.pop && p.fg[g]).length;
    if (!best || fa < best.fa || (fa === best.fa && fl < best.fl)) best = { t, fa, fl };
  });
  return best.t;
}
const SEED = 6561;
const [A, B] = split(SEED);
const tA = tune(A), tB = tune(B);
const holdout = {
  seed: SEED, books_A: new Set(A.map((p) => p.bid)).size, books_B: new Set(B.map((p) => p.bid)).size,
  tuned_on_A: tA, B_before: summary(B, (p) => flagOf(p, T_V1)), B_after: summary(B, (p) => flagOf(p, tA)),
  tuned_on_B: tB, A_before: summary(A, (p) => flagOf(p, T_V1)), A_after: summary(A, (p) => flagOf(p, tB)),
};
// 200 more splits: how often does tuning on one half pick a rule that misses an invented page in the other?
const reps = { splits: 200, test_recall_100: 0, test_invented_missed: [], chosen: {} };
for (let i = 1; i <= 200; i++) {
  const [tr, te] = split(SEED + i);
  const t = tune(tr); const k = JSON.stringify(t); reps.chosen[k] = (reps.chosen[k] || 0) + 1;
  const miss = te.filter((p) => p.inv && !flagOf(p, t)).length;
  if (!miss) reps.test_recall_100++; reps.test_invented_missed.push(miss);
}
const missHist = {}; for (const m of reps.test_invented_missed) missHist[m] = (missHist[m] || 0) + 1;
reps.test_invented_missed = missHist;

// ---- what the ditto term moves, and the ditto-only tier -----------------------------------------------------------
const dropped = pages.filter((p) => p.pop && p.old && !p.neu);
const dittoTier = pages.filter((p) => p.pop && p.neu && p.dittoOnly);
const titleCount = (xs) => { const m = {}; for (const p of xs) { const w = p.title.replace(/[·(（].*$/u, '').trim(); m[w] = (m[w] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8)); };

const result = {
  issue: 6561, detector: 'scripts/lib/paddle-table-detect.mjs', T_V1, T,
  population: { flagged_pages: pages.filter((p) => p.pop).length, invented_known: invented.size, invented_in_population: pages.filter((p) => p.pop && p.inv).length, invented_text_mismatch: textMismatch },
  classes: { LO, HI, note: 'INV = one of the 136; TAB = Opus layout table/diagram/map/illustration; MIX = mixed; FA = prose with < 5% of Paddle Han removed by Opus; BAD = prose with >= 10% removed; UNC = between' },
  parity,
  before: summary(pages, (p) => p.old),
  after: summary(pages, (p) => p.neu),
  dropped: { pages: dropped.length, by_class: Object.fromEntries(CLASSES.map((c) => [c, dropped.filter((p) => p.cls === c).length])), titles: titleCount(dropped) },
  ditto_only_tier: { pages: dittoTier.length, by_class: Object.fromEntries(CLASSES.map((c) => [c, dittoTier.filter((p) => p.cls === c).length])), invented_known: pages.filter((p) => p.inv && p.neu && p.dittoOnly).length, titles: titleCount(dittoTier) },
  grid_full_data: (() => { // the frontier on all data, for the write-up: per config, FA / risky / invented kept
    const base = pages.filter((p) => p.pop && RISKY.has(p.cls) && p.old).length;
    return GRID.map((t) => ({ ...t, flagged: pages.filter((p) => p.pop && flagOf(p, t)).length, fa: pages.filter((p) => p.pop && p.cls === 'FA' && flagOf(p, t)).length,
      risky_lost: base - pages.filter((p) => p.pop && RISKY.has(p.cls) && flagOf(p, t)).length, invented: pages.filter((p) => p.inv && flagOf(p, t)).length }))
      .filter((r) => r.invented === invented.size).sort((a, b) => a.risky_lost - b.risky_lost || a.fa - b.fa).slice(0, 12);
  })(),
  holdout, splits: reps,
};
const fmt = (s) => `flagged ${s.flagged}  recall ${s.recall_invented}  nonprose ${s.precision_nonprose}  table-only ${s.precision_table_only}  not-FA ${s.precision_not_fa}  ${JSON.stringify(s.by_class)}`;
console.log('before', fmt(result.before)); console.log('after ', fmt(result.after));
console.log('dropped', JSON.stringify(result.dropped)); console.log('ditto-only tier', JSON.stringify(result.ditto_only_tier));
console.log('holdout A→B', JSON.stringify(tA), '\n  B before', fmt(holdout.B_before), '\n  B after ', fmt(holdout.B_after));
console.log('holdout B→A', JSON.stringify(tB), '\n  A before', fmt(holdout.A_before), '\n  A after ', fmt(holdout.A_after));
console.log('200 splits', JSON.stringify(reps));
if (outArg) fs.writeFileSync(outArg, JSON.stringify(result, null, 1) + '\n');
