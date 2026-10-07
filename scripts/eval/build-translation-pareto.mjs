#!/usr/bin/env node
/**
 * build-translation-pareto.mjs — translation cost against fidelity, one chart per language, for
 * /quality and /quality/pareto (#5983, Derek's addition of 2026-10-06).
 *
 * PRIOR ART: scripts/eval/build-ocr-pareto.mjs — the OCR charts this sits beside; same rules, same
 * output shape where it can be, but it reads CER rows, not judged translations.
 * scripts/eval/results/xlref-synthesis-2026-10/build.mjs — reads the five #5695 tracks' per-page rows
 * and recomputes the SERVED arm per language; it carries no cost and never puts the engine arms side
 * by side. Its per-track field adapters are mirrored here, extended with cost and packet.
 *
 * Reads only committed files, calls no model:
 *   #5695 T1–T5  results/xlref-t{1..5}-2026-10/ (per-page rows: fidelity per judge, reversal, billed cost)
 *   #5497        results/tengyur-arms-2026-10/ (judge families F1, F2 and the metered cost.json)
 *   production   scripts/lib/translate-core.mjs getTranslateModelForBook, the router for new pages
 * Writes src/data/translation-pareto.json. No timestamps: unchanged inputs give an identical file.
 *   node scripts/eval/build-translation-pareto.mjs           # write
 *   node scripts/eval/build-translation-pareto.mjs --check   # exit 1 if the committed file is stale
 *
 * The rules (.claude/docs/eval-design.md §7, as for the OCR charts):
 *   - engines are compared ONLY on pages every plotted engine translated, judged in the SAME packet
 *     by the same blind judges against the same published translation;
 *   - y = mean fidelity (1–5; mean of the two judges, or the one judge where the write-up used one),
 *     with a seeded bootstrap 95% CI; this is model-judged, not human-scored, and not accuracy;
 *   - the ring is the reversed-statement rate: pages where either judge quoted a reversal, per 100;
 *   - x = the run's billed tokens at the Batch rate (how production translates), per 1,000 pages;
 *   - a thinking arm is plotted only where thinking was really billed (a thinkingBudget is a ceiling:
 *     in T1 and T5 it billed none, so that arm is a second plain Flash run, not an engine);
 *   - Claude ran on the subscription, so it has no metered cost: it is listed under the chart with
 *     its score on the pages it read and the production engine's score on the same pages;
 *   - the frontier is drawn only with ≥ 3 placed engines; a language under MIN_PAGES gets no chart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wilson } from './lib/agreement-stats.mjs';
import { getTranslateModelForBook } from '../lib/translate-core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, '..', '..');
const RES = path.join(__dirname, 'results');
const OUT = path.join(REPO, 'src', 'data', 'translation-pareto.json');
const MIN_PAGES = 10;   // the synthesis gives no interval below 10 pages (Dutch, Spanish, Aramaic)
const FRONTIER_MIN = 3;
const rel = p => path.relative(REPO, p);

const LITE = 'gemini-3.1-flash-lite', FLASH = 'gemini-3-flash-preview', THINK = 'gemini-3-flash-preview+thinking', THINK_DYN = 'gemini-3-flash-preview+dynamic-thinking', OPUS = 'claude-opus';
const LABEL = { [LITE]: 'Gemini 3.1 Flash-Lite', [FLASH]: 'Gemini 3 Flash', [THINK]: 'Gemini 3 Flash, thinking on', [THINK_DYN]: 'Gemini 3 Flash, dynamic thinking', [OPUS]: 'Claude Opus' };
// Never run as the translator on any of these pages. (Gemini 3.1 Pro ran on Tibetan only as a
// find-and-replace pass over flagged reversals, #5497 arm E — not a translation.)
const NOT_TESTED = ['Gemini 3.1 Pro (as the translator)', 'Claude through the metered API', 'GPT'];

// ── small statistics, seeded so the file is byte-stable (as build-ocr-pareto.mjs) ─────────────
const r3 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 1000) / 1000);
const r1 = x => Math.round(x * 10) / 10;
const avg = xs => xs.reduce((s, x) => s + x, 0) / xs.length;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
function bootstrapMeanCI(xs, seed, B = 2000) {
  const rand = rng(seed), ms = [];
  for (let b = 0; b < B; b++) { let s = 0; for (let i = 0; i < xs.length; i++) s += xs[Math.floor(rand() * xs.length)]; ms.push(s / xs.length); }
  ms.sort((a, b) => a - b);
  return [r3(ms[Math.floor(0.025 * B)]), r3(ms[Math.floor(0.975 * B)])];
}

const jsonl = f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const either = (byJudge, key) => Object.values(byJudge || {}).some(j => { const v = j?.[key]; return Array.isArray(v) ? v.length > 0 : !!v; });

// The Batch rate is half the realtime rate. Checked, not assumed: T5's arm files carry both prices.
const BATCH = (() => {
  const rs = jsonl(path.join(RES, 'xlref-t5-2026-10/arms/flash-thinkon.jsonl')).filter(r => r.cost_usd_realtime > 0);
  const ratios = new Set(rs.map(r => r3(r.cost_usd_batch_equiv / r.cost_usd_realtime)));
  if (ratios.size !== 1) throw new Error(`batch/realtime ratio is not one number in T5: ${[...ratios]}`);
  return [...ratios][0];
})();

// ── rows: one per page × arm → { page, book, lang, packet, engine, fidelity, reversal, usd_batch, thinking } ──
// Each track names its arms differently; ENGINE maps the arms that are an engine run as production
// would run it (fresh, prompt v13, single page). Context, check-and-fix and corrected-OCR arms are
// levers, not engines, and are left out. `packet` keeps arms judged in different reads apart.
const TRACKS = [
  {
    id: 'T1', writeup: 'scripts/eval/experiments/2026-10-03-xlref-t1-latin-vs-reference-5695.md', judges: 2,
    file: 'xlref-t1-2026-10/rows.jsonl',
    engine: { 'prod-A': LITE, 'flash-0': FLASH, 'flash-think': THINK, 'flash-dyn': THINK_DYN, opus: OPUS },
    row: r => ({ page: `${r.book_id}_${r.page_number}`, book: r.book_id, lang: r.lang, packet: r.pass, fidelity: r.fidelity, reversal: !!r.reversal, usd_rt: r.cost_usd_realtime, thinking: r.thinking_tokens }),
  },
  {
    // The arms were read by one judge (the core packet's two judges read only the served page).
    id: 'T2', writeup: 'scripts/eval/experiments/2026-10-03-greek-served-english-vs-published-translations-5695-t2.md', judges: 1,
    file: 'xlref-t2-2026-10/pages.jsonl',
    engine: { 'lite-a': LITE, flash: FLASH, opus: OPUS },
    // On 26 pages every arm was judged against a corrected transcription (fidelity to the page); the
    // write-up's arm figures include them, so they stay. Arms that TRANSLATED a corrected text do not.
    keep: r => r.arms_packet && !r.source_is_corrected_transcription,
    row: r => ({ page: r.id, book: r.book_id, lang: 'Greek', packet: 'arms', fidelity: r.arms_packet.fidelity, reversal: !!r.arms_packet.reversal, usd_rt: r.cost_usd, thinking: 0, against: r.arms_packet.judged_against }),
  },
  {
    id: 'T3', writeup: 'scripts/eval/experiments/2026-10-03-translation-vs-reference-vernaculars-t3-5695.md', judges: 2,
    file: 'xlref-t3-2026-10/pages.jsonl',
    engine: { L1: LITE, F0: FLASH, FT: THINK, O: OPUS },
    row: r => ({ page: r.id, book: r.book_id, lang: r.lang, packet: 'main', fidelity: r.fidelity, reversal: r.reversal > 0, usd_rt: r.usd, thinking: r.thinking_tokens }),
  },
  {
    id: 'T4', writeup: 'scripts/eval/experiments/2026-10-03-translation-vs-reference-t4-hebrew-arabic-persian-5695.md', judges: 2,
    file: 'xlref-t4-2026-10/pages.jsonl',
    engine: { 'prod-A': LITE, 'flash-0': FLASH, 'flash-think8k': THINK, opus: OPUS },
    keep: r => r.packet === 1,
    row: r => ({ page: r.id, book: r.book_id, lang: r.lang, packet: `p${r.packet}`, fidelity: r.fidelity, reversal: either(r.by_judge, 'reversal'), usd_rt: r.cost_usd, thinking: r.thinking_tokens }),
  },
  {
    // T5's page rows carry no cost; its summary prices each arm from the run's usage rows (Batch).
    id: 'T5', writeup: 'scripts/eval/experiments/2026-10-03-xlref-t5-sanskrit-pali-chinese-vs-reference.md', judges: 2,
    file: 'xlref-t5-2026-10/pages.jsonl',
    engine: { lite: LITE, flash: FLASH, 'flash-think': THINK, opus: OPUS },
    costScope: 'the arm\'s average over all 68 pages of the track (its page rows carry no cost)',
    row: (r, t) => {
      const c = t.summary.arms[r.arm]?.cost;
      return { page: r.id, book: r.book_id, lang: r.lang, packet: 'main', fidelity: r.fidelity, reversal: either(r.by_judge, 'reversal'), usd_batch: c?.usd_per_page_batch ?? null, thinking: c?.thinking_tokens_per_page ?? (r.arm === 'opus' ? 0 : null) };
    },
    summary: 'xlref-t5-2026-10/summary.json',
  },
];

const rows = [];
for (const t of TRACKS) {
  if (t.summary) t.summary = JSON.parse(fs.readFileSync(path.join(RES, t.summary), 'utf8'));
  for (const r of jsonl(path.join(RES, t.file))) {
    const engine = t.engine[r.arm];
    if (!engine || (t.keep && !t.keep(r))) continue;
    const x = t.row(r, t);
    if (typeof x.fidelity !== 'number') continue;
    rows.push({ ...x, track: t.id, arm: r.arm, engine, usd_batch: x.usd_batch ?? (typeof x.usd_rt === 'number' ? x.usd_rt * BATCH : null) });
  }
}

// Tibetan (#5497): the quality-arms judge families. F1 = {B, B2, D, X2} on 113 sides; F2 = {B, E, C, X3}.
// B is Flash, one page per request, no context, as production runs it; X2 is B with thinking; X3 is Opus.
// B ran in tengyur-ref's Batch rounds mixed with arm A, so its own spend is not separable there; B2 is
// the same request re-run alone and metered, so B is priced from B2.
const TIB_DIR = path.join(RES, 'tengyur-arms-2026-10');
const TIB_WRITEUP = 'scripts/eval/experiments/2026-10-03-tengyur-quality-arms-5497.md';
{
  const cost = JSON.parse(fs.readFileSync(path.join(TIB_DIR, 'cost.json'), 'utf8'));
  const priced = { B: cost[`B2|${FLASH}`], X2: cost[`X2|${FLASH}`] };
  const engine = { B: FLASH, X2: THINK, X3: OPUS };
  for (const fam of ['F1', 'F2']) {
    const key = JSON.parse(fs.readFileSync(path.join(TIB_DIR, 'judge', fam, 'key.json'), 'utf8'));
    const verdicts = ['J1', 'J2'].map(j => new Map(jsonl(path.join(TIB_DIR, 'judge', fam, `verdicts-${j}.jsonl`)).map(v => [v.id, v.scores])));
    for (const [id, k] of Object.entries(key)) {
      if (k.kind !== 'multi') continue;   // controls
      for (const [slot, arm] of Object.entries(k.labels)) {
        if (!engine[arm]) continue;
        const sc = verdicts.map(m => m.get(id)?.[slot]).filter(Boolean);
        if (sc.length !== 2) throw new Error(`tengyur ${fam} ${id} ${slot}: ${sc.length} judges`);
        const c = priced[arm];
        rows.push({
          track: 'Tib', arm, engine: engine[arm], page: k.page_id, book: k.toh, lang: 'Tibetan', packet: fam,
          fidelity: avg(sc.map(s => s.fidelity)), reversal: sc.some(s => (s.inversions || []).length > 0),
          usd_batch: c ? c.batch_usd_per_call : null, thinking: c ? c.think_per_call : 0,
        });
      }
    }
  }
  // Check the parse against the family's own scorer: B's reversal pages in F1.
  const own = JSON.parse(fs.readFileSync(path.join(TIB_DIR, 'judge', 'F1', 'scores.json'), 'utf8')).arms.B.stats;
  const mine = rows.filter(r => r.track === 'Tib' && r.packet === 'F1' && r.arm === 'B');
  if (mine.length !== own.n || mine.filter(r => r.reversal).length !== own.inversion_pages_either) throw new Error('tengyur F1 parse does not reproduce scores.json for B');
}
TRACKS.push({ id: 'Tib', writeup: TIB_WRITEUP, judges: 2 });

// ── panels ───────────────────────────────────────────────────────────────────────────────────
const LANGS = [
  ['Latin', 'T1'], ['Greek', 'T2'], ['German', 'T3'], ['French', 'T3'], ['Italian', 'T3'], ['Dutch', 'T3'], ['Spanish', 'T3'],
  ['Hebrew', 'T4'], ['Aramaic', 'T4'], ['Arabic', 'T4'], ['Persian', 'T4'], ['Sanskrit', 'T5'], ['Pali', 'T5'], ['Chinese', 'T5'], ['Tibetan', 'Tib'],
];
const REFERENCE = { Tib: "84000's published English", default: 'a published English translation of the same passage' };
const dateOf = f => f.match(/(\d{4}-\d{2}-\d{2})/)[1];

function stats(rs, seed) {
  const f = rs.map(r => r.fidelity), rev = rs.filter(r => r.reversal).length;
  return {
    fidelity: r3(avg(f)), fidelity_ci95: bootstrapMeanCI(f, seed),
    share_ge4: r3(f.filter(x => x >= 4).length / f.length),
    reversals: { pages: rev, n: rs.length, per_100: r1((100 * rev) / rs.length), ci95: wilson(rev, rs.length).map(x => r1(100 * x)) },
  };
}

const charts = [], noChart = [];
for (const [lang, trackId] of LANGS) {
  const track = TRACKS.find(t => t.id === trackId);
  const lr = rows.filter(r => r.lang === lang);
  const production = getTranslateModelForBook({ language: lang });
  // The production engine's packet is the chart's packet; every other arm must have been read in it.
  const prodPackets = [...new Set(lr.filter(r => r.engine === production).map(r => r.packet))];
  const packet = prodPackets.sort((a, b) => lr.filter(r => r.packet === b && r.engine === production).length - lr.filter(r => r.packet === a && r.engine === production).length)[0];
  const inPacket = lr.filter(r => r.packet === packet);
  const by = new Map();
  for (const r of inPacket) { if (!by.has(r.engine)) by.set(r.engine, new Map()); by.get(r.engine).set(r.page, r); }
  const prodPages = new Set(by.get(production)?.keys() || []);
  if (prodPages.size < MIN_PAGES) {
    noChart.push({ title: lang, why: `${prodPages.size} page${prodPages.size === 1 ? '' : 's'} with a published translation; at least ${MIN_PAGES} are needed for an interval`, source: track.writeup });
    continue;
  }
  const excluded = [];
  // Placed: engines with a billed cost, read on every page the production engine read in this packet.
  const placedEngines = [], subsetEngines = [];
  for (const [e, m] of by) {
    const rs = [...m.values()];
    const costed = rs.every(r => typeof r.usd_batch === 'number');
    if (e === THINK && !(avg(rs.map(r => r.thinking ?? 0)) > 0)) {
      excluded.push({ label: LABEL[e], pages: rs.length, why: 'the thinking budget billed no thinking tokens, so it is a second plain Flash run' });
      by.delete(e);
      continue;
    }
    const full = [...prodPages].every(p => m.has(p));
    if (costed && full) placedEngines.push(e); else subsetEngines.push(e);
  }
  const pages = [...prodPages].filter(p => placedEngines.every(e => by.get(e).has(p)));
  const point = (e, ps, seedKey) => {
    const rs = ps.map(p => by.get(e).get(p));
    const costs = rs.map(r => r.usd_batch).filter(x => typeof x === 'number');
    const thinking = avg(rs.map(r => r.thinking ?? 0));
    return {
      engine: e, label: LABEL[e], production: e === production, ...stats(rs, hash(`${lang}|${seedKey}|${e}`)),
      cost: costs.length === rs.length ? {
        usd_per_1k: r3(avg(costs) * 1000), basis: 'metered',
        detail: `billed tokens of this run at the Batch rate${thinking ? `, ${Math.round(thinking).toLocaleString('en-US')} thinking tokens per page` : ''}; ${track.costScope || `averaged over these ${rs.length} pages`}`,
        source: track.writeup,
      } : null,
    };
  };
  const placed = placedEngines.map(e => point(e, pages, 'panel'));
  for (const a of placed) a.on_frontier = placed.length >= FRONTIER_MIN && !placed.some(b => b !== a
    && b.cost.usd_per_1k <= a.cost.usd_per_1k && b.fidelity >= a.fidelity && (b.cost.usd_per_1k < a.cost.usd_per_1k || b.fidelity > a.fidelity));
  placed.sort((a, b) => a.cost.usd_per_1k - b.cost.usd_per_1k || a.engine.localeCompare(b.engine));
  // Not plotted: read on a subset of the pages (Opus: 20 or fewer) or with no metered cost. Scored on
  // its own pages, with the production engine on the same pages beside it, so the gap is like for like.
  const noCost = [];
  for (const e of subsetEngines) {
    const own = [...by.get(e).keys()].filter(p => prodPages.has(p));
    if (own.length < 5) { excluded.push({ label: LABEL[e], pages: own.length, why: 'too few pages to compare' }); continue; }
    const p = point(e, own, 'subset');
    p.cost = null;
    p.subset = { n_pages: own.length, production_label: LABEL[production], production_fidelity: point(production, own, 'subset').fidelity };
    p.note = e === OPUS ? 'run on the subscription, so no metered cost; the judges are also Opus, which may flatter it' : 'no metered cost';
    noCost.push(p);
  }
  // An engine judged only in another read of this write-up. If the production engine was graded in
  // that same read on the same pages, the pair is like for like and goes under the chart with that
  // read's production score beside it; otherwise it is listed, never mixed in.
  for (const e of [...new Set(lr.filter(r => r.packet !== packet).map(r => r.engine))].sort()) {
    if (by.has(e)) continue;
    const other = lr.filter(r => r.packet !== packet && r.engine === e);
    const pair = [...new Set(other.map(r => r.packet))].map(pk => {
      const ps = other.filter(r => r.packet === pk).map(r => r.page)
        .filter(pg => lr.some(r => r.packet === pk && r.engine === production && r.page === pg));
      return { pk, ps: [...new Set(ps)] };
    }).sort((a, b) => b.ps.length - a.ps.length)[0];
    if (pair && pair.ps.length >= 5 && !other.every(r => typeof r.usd_batch === 'number')) {
      const pick = eng => pair.ps.map(pg => lr.find(r => r.packet === pair.pk && r.engine === eng && r.page === pg));
      const p = { engine: e, label: LABEL[e], production: false, ...stats(pick(e), hash(`${lang}|other|${e}`)), cost: null };
      p.subset = { n_pages: pair.ps.length, production_label: LABEL[production], production_fidelity: r3(avg(pick(production).map(r => r.fidelity))), separate_read: true };
      p.note = e === OPUS ? 'run on the subscription, so no metered cost; the judges are also Opus, which may flatter it' : 'no metered cost';
      noCost.push(p);
    } else {
      excluded.push({ label: LABEL[e], pages: new Set(other.map(r => r.page)).size, why: 'judged in a separate read, without the engine in use beside it' });
    }
  }
  const books = new Set(pages.map(p => by.get(production).get(p).book));
  const notes = [];
  const against = pages.map(p => by.get(production).get(p).against).filter(Boolean);
  const corrected = against.filter(a => a !== 'ocr').length;
  if (corrected) notes.push(`On ${corrected} of these pages every engine was judged against a corrected transcription, that is, for fidelity to the page`);
  charts.push({
    id: lang.toLowerCase(), title: lang, production_engine: production, production_label: LABEL[production],
    panels: [{
      kind: 'most-pages', n_pages: pages.length, n_books: books.size,
      frontier: placed.length >= FRONTIER_MIN,
      frontier_note: placed.length >= FRONTIER_MIN ? null : `too few for a frontier: ${placed.length} engine${placed.length === 1 ? '' : 's'} with a measured cost on these pages`,
      judges: track.judges,
      references: [{ stratum: track.id, reference: REFERENCE[track.id] || REFERENCE.default, pages: pages.length, date: dateOf(track.writeup) }],
      date: dateOf(track.writeup), files: [track.writeup], notes,
      placed, no_cost: noCost.sort((a, b) => a.engine.localeCompare(b.engine)),
    }],
    not_on_shared_pages: excluded.map(x => ({ engine: x.label, label: x.label, pages: x.pages, why: x.why })),
    not_tested: NOT_TESTED,
  });
}

const out = {
  issue: 5983,
  generated_by: 'scripts/eval/build-translation-pareto.mjs',
  measure: 'fidelity: mean score 1–5 from blind Opus judges reading the English beside a published human translation of the same passage, on pages every engine in the panel translated. Model-judged, not human-scored; not accuracy.',
  ring: 'reversed statements: pages where either judge quoted a statement the English reverses, per 100 pages',
  production_rule: 'the engine scripts/lib/translate-core.mjs getTranslateModelForBook assigns to new pages in the language',
  batch_over_realtime: BATCH,
  sources: TRACKS.map(t => ({ track: t.id, writeup: t.writeup })),
  charts,
  no_chart: [
    ...noChart,
    { title: 'Sanskrit, Pali and Chinese (#5606)', why: 'its 57 pages and references were reused, re-cut and re-judged in the #5695 T5 track, which is what the charts above plot', source: 'scripts/eval/experiments/2026-10-02-translation-flash-vs-lite-sanskrit-pali-chinese-5606.md' },
    { title: 'OCR engines feeding the translation (#5870)', why: 'it compares OCR engines by the lift they give the English, not translators, so it belongs beside the OCR charts', source: 'scripts/eval/experiments/2026-10-05-engine-contest-5870.md' },
    { title: 'The stored Tengyur draft (#5797)', why: 'one engine scored against 84000, with nothing beside it to compare', source: 'scripts/eval/experiments/2026-10-04-tengyur-stored-draft-vs-84000-5797.md' },
  ],
};
for (const n of out.no_chart) if (!fs.existsSync(path.join(REPO, n.source))) throw new Error(`no_chart source missing: ${n.source}`);
for (const t of TRACKS) if (!fs.existsSync(path.join(REPO, t.writeup))) throw new Error(`write-up missing: ${t.writeup}`);

const json = JSON.stringify(out, null, 1) + '\n';
if (process.argv.includes('--check')) {
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (have !== json) { console.error(`${rel(OUT)} is stale — run node scripts/eval/build-translation-pareto.mjs`); process.exit(1); }
  console.log('translation-pareto.json is current');
  process.exit(0);
}
fs.writeFileSync(OUT, json);
for (const c of charts) for (const p of c.panels) console.log(`${c.title} ${p.n_pages}pp/${p.n_books}bk · ${p.placed.map(x => `${x.label} ${x.fidelity} [${x.fidelity_ci95}] rev ${x.reversals.per_100} @$${x.cost.usd_per_1k}${x.on_frontier ? '*' : ''}${x.production ? ' (prod)' : ''}`).join(' | ')}${p.no_cost.length ? ` · off-plot: ${p.no_cost.map(x => `${x.label} ${x.fidelity} on ${x.subset.n_pages} (prod ${x.subset.production_fidelity})`).join(', ')}` : ''}${c.not_on_shared_pages.length ? ` · excluded: ${c.not_on_shared_pages.map(x => `${x.label} (${x.pages}): ${x.why}`).join('; ')}` : ''}`);
for (const n of out.no_chart) console.log(`no chart: ${n.title} — ${n.why}`);
console.log(`wrote ${rel(OUT)}`);
