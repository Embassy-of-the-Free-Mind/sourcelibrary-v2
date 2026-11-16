#!/usr/bin/env node
// PRIOR ART: scripts/audit/convergent-audit-weekly.sh with AUDIT_OPUS_ONLY=1 (the spare lane's round until #197: 80
// single pages, one Opus read each, a uniform 60 + risk 20 page draw) and scripts/audit/convergent-audit-pool.mjs (its
// pooled comment). This replaces them as the spare-lane round, not the Monday audit, which keeps running. The reads are
// scripts/eval/paired-fifths-check.mjs unchanged (the adopted book check, #8518); the risk stratum is
// scripts/maintenance/book-check-priority.mjs unchanged; the cells' print/manuscript rule is its formOf().
// scripts/eval/spot-check/served-draw.mjs draws served books stratified by lane, not by language x form, and runs on
// import. Nothing drew served BOOKS by language x form with a monthly floor per cell (v3#197).
/**
 * spare-paired-fifths: the spare lane's round (v3#197). Quota that would expire at the end of an account's week buys
 * paired-fifths checks (10 pages and 5 page breaks a book, 5 Opus calls) of two kinds of books:
 *
 *   uniform  served books (visible, pages_count > 0) drawn uniformly INSIDE language x print/manuscript cells, the
 *            cell with the fewest uniform books this calendar month first (book_checks, every box), so the rounds of
 *            a month are the repeat of the /quality draw with a floor per cell. Reported per cell, apart from risk.
 *   risk     the head of book-check-priority.mjs (reads x measured risk; its `priority` picks only), so findings go
 *            where repairs pay.
 *
 * Every verdict is a book_checks row (method paired-fifths-check, frame.stratum / frame.cell / frame.round). The
 * Monday loop reads book_checks (scripts/eval/error-zoo/labels.mjs): a serious OCR finding on a served page becomes a
 * repair-queue row (needs-second-read until a Gemini read agrees, then queued for its cell's route). This writes no
 * page text and withholds nothing.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/spare-paired-fifths.mjs draw --run DIR \
 *        [--seed N] [--uniform 24] [--risk 16]
 *   node --env-file=… scripts/audit/spare-paired-fifths.mjs run --run DIR [--concurrency 5] [--max-calls N] [--dry]
 *   node --env-file=… scripts/audit/spare-paired-fifths.mjs pool [--label L] [--post [--issue N] [--repo O/R]] DIR [DIR …]
 *
 * The daily lane (v3#381, scripts/audit/paired-fifths-daily.sh on cloudlayer) runs the same draw and run every day
 * with --max-calls 200 and the 85% pace guard, and pools its week on v3#381.
 *
 * `run` resumes: the check skips calls already in its evidence file and never doubles a row. `pool` is read-only
 * except for the GitHub comment with --post.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mulberry32, pairedFifths } from '../lib/paired-fifths.mjs';
import { formOf } from '../maintenance/book-check-priority.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const METHOD_ID = 'paired-fifths-check';
/** A language x form cell with fewer served books than this joins the `other` cell of its form (2026-11-13: 23 cells). */
export const CELL_MIN_BOOKS = 100;
/** A book checked by this method this recently is not drawn again: the draw is seeded by the book, so it would read the same pages. */
export const RECHECK_DAYS = 30;
/** Where the pooled comment goes: the standing QA thread the spare rounds have always posted to. */
export const POOL_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
export const POOL_ISSUE = 6420;
const TRIES_PER_CELL = 25;

// ── pure parts (tests/unit/spare-paired-fifths.test.ts) ──
export const langOf = (b) => String(b.language ?? '').trim() || 'unknown';
const rawCell = (b) => `${langOf(b)}/${formOf(b)}`;
/** The language x form cells with at least CELL_MIN_BOOKS served books; the rest join other/<form>. */
export function bigCells(books, min = CELL_MIN_BOOKS) {
  const n = new Map();
  for (const b of books) n.set(rawCell(b), (n.get(rawCell(b)) ?? 0) + 1);
  return new Set([...n].filter(([c, k]) => k >= min && !c.startsWith('unknown/')).map(([c]) => c));
}
export const cellOf = (b, big) => (big.has(rawCell(b)) ? rawCell(b) : `other/${formOf(b)}`);

/**
 * The cells to draw n uniform books from, one slot at a time to the cell with the fewest books so far this month
 * (tally) plus this round's; ties in a seeded order. A cell in `exhausted` takes no slot.
 */
export function allocate(cells, tally, n, rng, exhausted = new Set()) {
  const order = [...cells].sort();
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const given = new Map();
  const out = [];
  for (let k = 0; k < n; k++) {
    let best = null;
    for (const c of order) {
      if (exhausted.has(c)) continue;
      const v = (tally[c] ?? 0) + (given.get(c) ?? 0);
      if (best === null || v < best.v) best = { c, v };
    }
    if (!best) break;
    given.set(best.c, (given.get(best.c) ?? 0) + 1);
    out.push(best.c);
  }
  return out;
}

/**
 * A book_checks row's place in the report: stratum, cell, and what its pages found.
 * The check reads a page with no English as a serious translation error ("no English translation was supplied", T1).
 * That is a page not yet translated, not a wrong one, so here an English finding counts only on a page whose English
 * is served, and a book whose only findings are that ("untranslated_only") reads as show.
 */
export function summariseRow(r) {
  const served = new Set((r.exposure ?? []).filter((x) => x.exposure === 'served').map((x) => x.page_number));
  const ocrHit = (f) => f.wrong_page || (f.errors ?? []).some((e) => e.stage !== 'translation');
  const enHit = (f) => served.has(f.page_number) && (f.errors ?? []).some((e) => e.stage === 'translation');
  const all = r.page_findings ?? [];
  const pf = all.filter((f) => ocrHit(f) || enHit(f));
  const errs = pf.flatMap((f) => f.errors ?? []);
  const untranslatedOnly = all.length > 0 && pf.length === 0;
  return {
    book_id: r.book_id, run_id: r.run_id, stratum: r.frame?.stratum ?? 'unrecorded', cell: r.frame?.cell ?? null,
    verdict: untranslatedOnly ? 'show' : r.verdict, untranslated_only: untranslatedOnly,
    pages: (r.pages_read ?? []).length,
    serious_pages: pf.length,
    ocr_pages: pf.filter(ocrHit).length,
    translation_pages: pf.filter(enHit).length,
    break_findings: errs.filter((e) => /^page break:/.test(e.problem ?? '')).length,
    // Served pages with a serious OCR finding: the ones the Monday repair queue picks up.
    to_queue: pf.filter((f) => (f.wrong_page || (f.errors ?? []).some((e) => e.stage === 'ocr'))
      && (r.exposure ?? []).some((x) => x.page_number === f.page_number && x.exposure === 'served')).length,
  };
}

const pct = (k, n) => (n ? `${Math.round((100 * k) / n)}%` : '–');
/** The pooled markdown: uniform by cell and population-weighted, risk apart. population: cell → served books. */
export function poolMarkdown(rows, { label, title = 'Spare-lane paired-fifths rounds', population = {}, rounds = 0, notes = [] } = {}) {
  // A book in two rounds counts once: its latest row.
  const byBook = new Map();
  for (const r of rows) byBook.set(`${r.stratum}|${r.book_id}`, r);
  const all = [...byBook.values()];
  const strata = ['uniform', 'risk'].map((s) => [s, all.filter((r) => r.stratum === s)]);
  const line = (name, rs) => {
    const v = (x) => rs.filter((r) => r.verdict === x).length;
    const pages = rs.reduce((a, r) => a + r.pages, 0), ser = rs.reduce((a, r) => a + r.serious_pages, 0);
    return `| ${name} | ${rs.length} | ${v('show')} | ${v('caveat')} | ${v('fix')} | ${pages} | ${ser} (${pct(ser, pages)}) | ${rs.reduce((a, r) => a + r.ocr_pages, 0)} | ${rs.reduce((a, r) => a + r.translation_pages, 0)} | ${rs.reduce((a, r) => a + r.break_findings, 0)} |`;
  };
  const head = '| | books | show | caveat | fix | pages | serious pages | OCR | English | break findings |\n|---|---|---|---|---|---|---|---|---|---|';
  const out = [`**${title}** (${label}): ${rounds} round(s), ${all.length} books. Opus, one reader, against the page images; a pair of facing pages a call (paired-fifths-check v2, scripts/eval/methods/paired-fifths-check.md). Verdicts are book_checks rows; nothing was written to a page.`, '', head];
  for (const [s, rs] of strata) out.push(line(s, rs));
  const uni = strata[0][1];
  if (uni.length) {
    const cells = [...new Set(uni.map((r) => r.cell))].sort();
    out.push('', '**Uniform stratum by cell** (served books drawn uniformly inside each language × print/manuscript cell; equal books a cell, so the pooled row above is NOT the library rate):', '', head.replace('| |', '| cell |'));
    for (const c of cells) out.push(line(c, uni.filter((r) => r.cell === c)));
    // Library-wide, weighted by each cell's served books (a cell read this period stands for itself only).
    let w = 0, show = 0;
    for (const c of cells) {
      const rs = uni.filter((r) => r.cell === c), N = population[c];
      if (!N || !rs.length) continue;
      w += N; show += (N * rs.filter((r) => r.verdict === 'show').length) / rs.length;
    }
    const covered = Object.values(population).reduce((a, b) => a + b, 0);
    if (w) out.push('', `Weighted by served books a cell: **${pct(show, w)} of books show**, over the ${cells.length} cells read (${Math.round((100 * w) / (covered || w))}% of served books). One reader, a handful of books a cell: a period's figure, not a public one.`);
  }
  const un = all.filter((r) => r.untranslated_only).length;
  if (un) out.push('', `${un} book(s) whose only findings are pages with no English yet are counted as show: the check grades a missing translation as a serious English error (T1), which is a gap, not a wrong text.`);
  const q = all.reduce((a, r) => a + r.to_queue, 0);
  out.push('', `**To repair:** ${q} served page(s) with a serious OCR finding. The Monday loop reads book_checks (labels.mjs → repair-queue.mjs): each waits as needs-second-read until a Gemini read agrees, then is queued for its cell's route.`);
  if (notes.length) out.push('', ...notes.map((n) => `- ${n}`));
  return out.join('\n');
}

// ── Mongo parts ──
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

async function draw(run) {
  const { withMongo } = await import('../lib/mongo.mjs');
  const { eligiblePage } = await import('../eval/confidence-7866/lib.mjs');
  const { PAGE_PROJECTION } = await import('../eval/paired-fifths-8405/run.mjs');
  const seed = Number(arg('seed', Date.now() % 1e9)), U = Number(arg('uniform', 24)), R = Number(arg('risk', 16));
  const name = path.basename(run);
  // A re-run of a round's brief resumes: the draw is kept, so the books (and the run ids) stay the same.
  if (fs.existsSync(path.join(run, 'draw.json'))) { console.log(`draw ${name}: kept (draw.json exists)`); return; }
  fs.mkdirSync(run, { recursive: true });
  const rng = mulberry32(seed);
  const out = { name, seed, created_at: new Date().toISOString(), method: METHOD_ID, run_ids: { uniform: `${name}-uniform`, risk: `${name}-risk` }, cells: {}, uniform: [], risk: [] };
  await withMongo(async (db) => {
    const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, title: 1, language: 1, published: 1, 'image_source.provider': 1 } }).toArray();
    const big = bigCells(books);
    const byCell = new Map();
    for (const b of books) if (b.id) { const c = cellOf(b, big); if (!byCell.has(c)) byCell.set(c, []); byCell.get(c).push(b); }
    const since = new Date(Date.now() - RECHECK_DAYS * 864e5);
    const recent = new Set(await db.collection('book_checks').distinct('book_id', { method_id: METHOD_ID, checked_at: { $gte: since } }));
    const month = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
    const tally = {};
    for (const r of await db.collection('book_checks').aggregate([{ $match: { method_id: METHOD_ID, 'frame.stratum': 'uniform', checked_at: { $gte: month } } }, { $group: { _id: '$frame.cell', n: { $sum: 1 } } }]).toArray()) tally[r._id] = r.n;
    for (const [c, bs] of byCell) out.cells[c] = { served: bs.length, month_before: tally[c] ?? 0, drawn: 0, tried: 0, not_drawable: 0, recently_checked: 0 };
    // Each cell's books in a seeded order; a cell gives its next book when the allocation asks.
    const queue = new Map([...byCell].map(([c, bs]) => { const a = bs.slice().sort((x, y) => (x.id < y.id ? -1 : 1)); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return [c, a]; }));
    const drawable = async (id) => {
      const all = await db.collection('pages').find({ book_id: id }, { projection: PAGE_PROJECTION }).sort({ page_number: 1 }).toArray();
      return pairedFifths(all.map((p) => ({ page_number: p.page_number, eligible: eligiblePage(p) })), id).length >= 4;
    };
    const exhausted = new Set(), taken = new Set();
    // Re-allocate after each cell that runs dry, so its slots go to the next-emptiest cells.
    while (out.uniform.length < U) {
      const slots = allocate([...byCell.keys()], Object.fromEntries(Object.entries(out.cells).map(([c, v]) => [c, v.month_before + v.drawn])), 1, mulberry32(seed + out.uniform.length), exhausted);
      if (!slots.length) break;
      const c = slots[0], cs = out.cells[c], q = queue.get(c);
      let got = null;
      while (q.length && cs.tried < TRIES_PER_CELL * (cs.drawn + 1)) {
        const b = q.shift();
        if (recent.has(b.id)) { cs.recently_checked++; continue; }
        cs.tried++;
        if (await drawable(b.id)) { got = b; break; }
        cs.not_drawable++;
      }
      if (!got) { exhausted.add(c); continue; }
      cs.drawn++; taken.add(got.id);
      out.uniform.push({ book_id: got.id, stratum: 'uniform', cell: c, round: name, language: got.language ?? null, title: String(got.title ?? '').slice(0, 80) });
    }
    out.exhausted_cells = [...exhausted];
  }, { noTimeout: true });
  // The risk stratum: book-check-priority.mjs's own queue (it skips any book checked in 30 days), priority picks only.
  if (R > 0) {
    const qf = path.join(run, 'risk-queue.jsonl');
    const r = spawnSync('node', ['scripts/maintenance/book-check-priority.mjs', `--limit=${R * 2}`, `--seed=${seed}`, `--out=${qf}`], { cwd: ROOT, encoding: 'utf8', env: process.env, timeout: 1800e3 });
    if (r.status !== 0) out.risk_error = (r.stderr || r.stdout || `exit ${r.status}`).trim().slice(-400);
    else {
      const taken = new Set(out.uniform.map((b) => b.book_id));
      for (const l of fs.readFileSync(qf, 'utf8').split('\n').filter(Boolean)) {
        const q = JSON.parse(l);
        if (q.stratum !== 'priority' || taken.has(q.book_id) || out.risk.length >= R) continue;
        out.risk.push({ book_id: q.book_id, stratum: 'risk', cell: null, round: name, language: q.language ?? null, title: String(q.title ?? '').slice(0, 80), risk: q.risk, risk_basis: q.risk_basis, reads: q.reads });
      }
    }
  }
  for (const s of ['uniform', 'risk']) fs.writeFileSync(path.join(run, `${s}.jsonl`), out[s].map((b) => JSON.stringify({ book_id: b.book_id, stratum: b.stratum, ...(b.cell ? { cell: b.cell } : {}), round: b.round })).join('\n') + (out[s].length ? '\n' : ''));
  fs.writeFileSync(path.join(run, 'draw.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`draw ${name}: uniform ${out.uniform.length}/${U} over ${new Set(out.uniform.map((b) => b.cell)).size} cells, risk ${out.risk.length}/${R}${out.risk_error ? ` (risk draw failed: ${out.risk_error})` : ''}; seed ${seed}`);
  if (out.uniform.length + out.risk.length === 0) process.exitCode = 1;
}

/**
 * Calls already made under a round's run ids, failed ones included: paired-fifths-check counts them in its evidence
 * file (`attempts`). An evidence file from before that counter counts its stored calls, the floor of what was made.
 */
export function callsMade(evidence) {
  return evidence.reduce((a, ev) => a + (ev.attempts ?? Object.values(ev.books ?? {}).reduce((k, b) => k + Object.keys(b.calls ?? {}).length, 0)), 0);
}

function runRound(run) {
  const d = readJson(path.join(run, 'draw.json'));
  let failed = 0;
  // --max-calls caps the whole round, across both strata and every resume (the daily lane's 200, v3#381).
  const cap = arg('max-calls') === undefined ? Infinity : Number(arg('max-calls'));
  const evidence = () => Object.values(d.run_ids).map((id) => path.join(run, 'evidence', `${id}.json`)).filter((f) => fs.existsSync(f)).map(readJson);
  // Uniform first: it is the measurement; risk second.
  for (const s of ['uniform', 'risk']) {
    if (!d[s].length) continue;
    const left = cap - callsMade(evidence());
    if (left <= 0) { console.log(`== ${s}: not started, the round's cap of ${cap} calls is spent`); continue; }
    const args = ['scripts/eval/paired-fifths-check.mjs', `--books-file=${path.join(run, `${s}.jsonl`)}`, `--run-id=${d.run_ids[s]}`,
      `--evidence-dir=${path.join(run, 'evidence')}`, `--concurrency=${arg('concurrency', 5)}`, ...(Number.isFinite(left) ? [`--max-calls=${left}`] : []), ...(flag('dry') ? [] : ['--apply'])];
    console.log(`== ${new Date().toISOString()} ${s}: ${d[s].length} books, run ${d.run_ids[s]}`);
    // The drain runs to 99% of the week: the lane, not the check, decides when to stop (spare-lane.py decide()).
    const r = spawnSync('node', args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ROUTE_JUDGE_WEEKLY_MAX: process.env.ROUTE_JUDGE_WEEKLY_MAX || '99' } });
    if (r.status !== 0) { failed++; console.log(`== ${s} ended with exit ${r.status}: a re-run resumes from the evidence file`); }
  }
  console.log(`== ${new Date().toISOString()} round ${d.name} done${failed ? ` (${failed} stratum run(s) with failures)` : ''}`);
}

async function pool(runs) {
  const { withMongo } = await import('../lib/mongo.mjs');
  const draws = [];
  for (const R of runs) { try { draws.push(readJson(path.join(R, 'draw.json'))); } catch { console.error(`skip ${R}: no draw.json`); } }
  if (!draws.length) { console.error('no round has a draw'); process.exit(3); }
  const runIds = draws.flatMap((d) => Object.values(d.run_ids));
  let rows = [];
  await withMongo(async (db) => {
    rows = await db.collection('book_checks').find({ method_id: METHOD_ID, run_id: { $in: runIds } },
      { projection: { _id: 0, book_id: 1, run_id: 1, frame: 1, verdict: 1, pages_read: 1, page_findings: 1, exposure: 1, checked_at: 1 } }).sort({ checked_at: 1 }).toArray();
  });
  const population = {};
  for (const d of draws) for (const [c, v] of Object.entries(d.cells ?? {})) population[c] = v.served;
  const drawn = draws.reduce((a, d) => a + d.uniform.length + d.risk.length, 0);
  const notes = [];
  if (rows.length < drawn) notes.push(`${drawn - rows.length} of ${drawn} drawn books have no row: a round stopped (quota, the lane's stop) before their five calls, or a call failed.`);
  const dry = [...new Set(draws.flatMap((d) => d.exhausted_cells ?? []))];
  if (dry.length) notes.push(`Cells that ran out of drawable books: ${dry.join(', ')}.`);
  const md = poolMarkdown(rows.map(summariseRow), { label: arg('label', 'spare lane'), ...(arg('title') ? { title: arg('title') } : {}), population, rounds: draws.length, notes });
  console.log(md);
  if (flag('post')) {
    const r = spawnSync('gh', ['issue', 'comment', String(arg('issue', POOL_ISSUE)), '-R', arg('repo', POOL_REPO), '--body-file', '-'], { input: md, encoding: 'utf8' });
    if (r.status !== 0) { console.error(`post failed: ${r.stderr}`); process.exit(1); }
    console.log(r.stdout.trim());
  }
}

async function main() {
  const cmd = process.argv[2];
  const run = arg('run');
  if (cmd === 'draw' && run) return draw(path.resolve(run));
  if (cmd === 'run' && run) return runRound(path.resolve(run));
  if (cmd === 'pool') {
    const runs = process.argv.slice(3).filter((a, i, all) => !a.startsWith('--') && !['--label', '--title', '--issue', '--repo'].includes(all[i - 1]));
    if (runs.length) return pool(runs);
  }
  console.error('usage: spare-paired-fifths.mjs draw --run DIR [--seed N] [--uniform 24] [--risk 16] | run --run DIR [--concurrency 5] [--max-calls N] [--dry] | pool [--label L] [--post [--issue N] [--repo OWNER/NAME]] DIR…');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
