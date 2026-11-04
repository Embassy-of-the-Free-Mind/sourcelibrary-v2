#!/usr/bin/env node
// PRIOR ART: scripts/eval/lane-judge-sampler.mjs exportScore — writes the LIVE rows of lane_judge_verdicts as
// lane-judge-sampler.score.json, which rules.json then names by hand; it reads no test row (verdictQuery live-only).
// rules.json `evidence` lists — every source a cell reads is a hand edit; the 11-03 Chinese files were never added.
// Searched scripts/eval/estimator/router-table/ and scripts/eval/lib/: nothing reads test rows or unnamed score files.
/**
 * test-evidence (#7263 step 4): what the router table WOULD read without a hand edit to rules.json. A proposal file for
 * build.py --auto-evidence; it changes nothing (not rules.json, not current.json, not the store).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/estimator/router-table/test-evidence.mjs \
 *        [--rows=<plan.jsonl.gz>] [--out=<dir>]
 *   --rows: read test rows from a backfill plan instead of Mongo (the dry run before the rows are inserted)
 *
 * Two sources, one rule each:
 *  ROWS   origin:'test' rows of lane_judge_verdicts (verdictQuery tests:'only'), kind item, first judgment of a text
 *         (test.rep 0), on ONE scale: the route judge's own accept / wrong text (judge.instrument ROUTE_JUDGE, outcome
 *         non-null). Step T and every other instrument stay out (never pooled with the route judge) and are counted.
 *         A row's router cell is rules.json's own evidence entry for (test.evidence, cell, route) when there is one: then
 *         the hand entry already reads it ("hand-cited"). Else the row's `router` hint (the writer's derivation, basis
 *         stated). One k/n per test x router cell x route x script type; n is pages, books counted for the book scaling.
 *  FILES  evidence/*.score.json that rules.json does not name, where a cell id AND a route id are rules.json's own.
 *         Judge must be the route judge (its `judge` text names judgePrompt / the route-judge prompt). A file a test's
 *         rows already carry (test.evidence) is not read twice.
 * A (router cell, route) that already cites the test's score file, or a file derived from it (its generated_by /
 * provenance / source names the test's record folder), is "covered": never added (no double count).
 * selection: rows carry it; a file carries it only if it declares `selection`, else 'unknown'. ONLY random may decide
 * a cell (`evidence`); every other kind is `prior` (build.py adds it to the route's prior, capped at prior.pooled.pages).
 * Everything else is reported with why: unmapped (no router cell), other scale, covered, hand-cited.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { verdictQuery, ROUTE_JUDGE, COLLECTION } from '../../lib/judge-rows.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const R = (p) => path.join(ROOT, p);
const D = 'scripts/eval/estimator/router-table/';
const EVID = `${D}evidence/`;
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const readJson = (p) => JSON.parse(fs.readFileSync(R(p), 'utf8'));
const SCRIPTS = ['print', 'manuscript', 'unknown'];

/** rules.json read backwards: (score path, cell, route) -> [{cell, route}], and per router (cell, route) its cited files. */
export function ruleIndex(rules) {
  const back = new Map(), cites = new Map(), routes = new Map();
  const add = (score, c, r, rc, rr) => { const k = `${score}|${c}|${r}`; (back.get(k) ?? back.set(k, []).get(k)).push({ cell: rc, route: rr }); };
  for (const c of rules.cells) {
    routes.set(c.id, new Set(c.routes.map((r) => r.id)));
    for (const r of c.routes) {
      const files = new Set();
      if (r.pilot && c.pilot) { add(rules.inputs.pilot, c.pilot, r.pilot, c.id, r.id); files.add(rules.inputs.pilot); }
      for (const e of r.evidence || []) { add(e.score, e.cell, e.route, c.id, r.id); files.add(e.score); }
      cites.set(`${c.id}|${r.id}`, files);
    }
  }
  return { back, cites, routes };
}

/** The scale a score file's judge is on: route judge, or not. */
export const isRouteJudgeFile = (s) => { const j = String(s?.judge ?? ''); return /judgePrompt|the route-judge prompt/.test(j) && !/not the route-judge/.test(j); };

/** The score files a test's record is behind: its own evidence file, and every file whose metadata names its folder. */
function derivedFiles(test, fileMeta) {
  const marks = [test.evidence, test.record && test.record.endsWith('/') ? test.record.replace(/\/$/, '') : null].filter(Boolean);
  const out = new Set(test.evidence ? [test.evidence] : []);
  for (const [f, meta] of fileMeta) if (marks.some((m) => meta.includes(m))) out.add(f);
  return out;
}

const scriptOf = (row) => { const s = row.router?.script ?? row.script_type; return SCRIPTS.includes(s) ? s : s === 'mixed' ? 'print' : 'unknown'; };

/** Group rows into proposals. Pure: rules, rows, the metadata text of every evidence file. */
export function fromRows(rules, rows, fileMeta) {
  const { back, cites, routes } = ruleIndex(rules);
  const report = { rows_read: rows.length, other_scale: {}, retest: 0, not_item: 0, hand_cited: {}, covered: {}, unmapped: {} };
  const groups = new Map();
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const r of rows) {
    if (r.origin !== 'test') continue;
    if (r.kind !== 'item') { report.not_item++; continue; }
    if ((r.test?.rep ?? 0) !== 0) { report.retest++; continue; }
    if (r.judge?.instrument !== ROUTE_JUDGE || !r.outcome) { bump(report.other_scale, `${r.test.id} (${r.judge?.instrument}${r.outcome ? '' : ', outcome null'})`); continue; }
    const tag = `${r.test.id} ${r.cell} / ${r.route}`;
    if (back.has(`${r.test.evidence}|${r.cell}|${r.route}`)) { bump(report.hand_cited, tag); continue; }
    // the router cell: the writer's hint (basis stated), else the test's own ids where they are rules.json's (the FILES rule)
    const hint = r.router && !/^rules\.json/.test(r.router.basis ?? '') ? r.router : null;
    const h = hint ?? (routes.get(r.cell)?.has(r.route) ? { cell: r.cell, route: r.route, basis: "the test's cell and route ids are rules.json's own" } : null);
    const der = derivedFiles(r.test, fileMeta);
    if (!h || !routes.get(h.cell)?.has(h.route)) {
      // a test rules.json reads by hand through a file derived from it (fresh-7517 -> evidence/fresh-7517.score.json):
      // its rows are covered there, whatever that file renamed its cells to
      const via = [...der].filter((f) => f !== r.test.evidence && [...cites.values()].some((c) => c.has(f)));
      if (via.length) { bump(report.covered, `${tag} (read by hand through ${via.map((f) => path.basename(f)).join(', ')})`); continue; }
      bump(report.unmapped, tag + (h ? ` (hint ${h.cell} / ${h.route}: not a rules.json route)` : '')); continue;
    }
    const cited = cites.get(`${h.cell}|${h.route}`) ?? new Set();
    if ([...der].some((f) => cited.has(f))) { bump(report.covered, `${tag} -> ${h.cell} / ${h.route}`); continue; }
    const script = scriptOf(r);
    const k = [r.test.id, h.cell, h.route, script, r.selection].join('|');
    const g = groups.get(k) ?? groups.set(k, { test: r.test.id, test_cell: r.cell, test_route: r.route, evidence_file: r.test.evidence, router_cell: h.cell, router_route: h.route,
      script, selection: r.selection, basis: h.basis ?? null, n: 0, k: 0, wrong: 0, books: new Set(), classes: {} }).get(k);
    g.n++; if (r.outcome.accept) g.k++; if (r.outcome.wrong_text) g.wrong++; g.books.add(r.book_id);
    for (const c of new Set((r.verdict?.defects || []).map((d) => d?.class).filter(Boolean))) g.classes[c] = (g.classes[c] || 0) + 1;
  }
  return { groups: [...groups.values()], report };
}

/** Score files rules.json does not name, read where their cell and route ids are rules.json's own. */
export function fromFiles(rules, files, rowEvidence) {
  const { cites, routes } = ruleIndex(rules);
  const named = new Set([rules.inputs.pilot, ...rules.cells.flatMap((c) => [...c.routes.flatMap((r) => (r.evidence || []).map((e) => e.score)), ...(c.paired || []).map((p) => p.score)])]);
  const entries = [], report = [];
  for (const [f, S] of files) {
    if (named.has(f)) continue;
    if (rowEvidence.has(f)) { report.push({ file: f, status: 'read through its test rows' }); continue; }
    if (!isRouteJudgeFile(S)) { report.push({ file: f, status: 'other scale', judge: S.judge ?? null }); continue; }
    const sel = SELECTIONS_OK.has(S.selection) ? S.selection : 'unknown';
    for (const [cell, C] of Object.entries(S.cells || {})) {
      if (!routes.has(cell)) { report.push({ file: f, cell, status: 'unmapped: no rules.json cell of this id', routes: Object.keys(C.routes || {}) }); continue; }
      for (const [route, x] of Object.entries(C.routes || {})) {
        if (!routes.get(cell).has(route)) { report.push({ file: f, cell, route, status: 'unmapped: not a route of the rules.json cell' }); continue; }
        if (!x?.accept || !x.books) { report.push({ file: f, cell, route, status: 'no accept k/n or books' }); continue; }
        if (cites.get(`${cell}|${route}`)?.has(f)) continue;
        entries.push({ source: 'score-file', router_cell: cell, router_route: route, selection: sel, accept: x.accept, books: x.books, evidence: { score: f, cell, route },
          why: `${path.basename(f)}: cell and route ids are rules.json's own` + (sel === 'unknown' ? '; the file declares no `selection`, so it sets the prior only' : '') });
      }
    }
  }
  return { entries, report };
}
const SELECTIONS_OK = new Set(['random', 'hand-picked', 'hard-frame', 'unknown']);

/** The groups as a score file (cells keyed `<test>::<router cell>`), and its by-script cut (`...|<script>`). */
export function rowsScore(groups) {
  const route = (gs) => {
    const s = (f) => gs.reduce((a, g) => a + g[f], 0), cl = {};
    for (const g of gs) for (const [c, v] of Object.entries(g.classes)) cl[c] = (cl[c] || 0) + v;
    const n = s('n'), books = new Set(gs.flatMap((g) => [...g.books])).size;
    return { n, books, accept: `${s('k')}/${n}`, wrong_text_pages: `${s('wrong')}/${n}`, classes_k_of_n: Object.fromEntries(Object.entries(cl).map(([c, v]) => [c, `${v}/${n}`])), selection: gs[0].selection };
  };
  const whole = {}, cut = {};
  const by = (keyOf) => { const m = new Map(); for (const g of groups) { const k = keyOf(g); (m.get(k) ?? m.set(k, []).get(k)).push(g); } return m; };
  for (const [k, gs] of by((g) => `${g.test}::${g.router_cell}|${g.router_route}|${g.selection}`)) {
    const [cell, rr] = k.split('|'); ((whole[cell] ??= { routes: {} }).routes)[`${rr}#${gs[0].selection}`] = route(gs);
  }
  for (const [k, gs] of by((g) => `${g.test}::${g.router_cell}|${g.script}|${g.router_route}|${g.selection}`)) {
    const [cell, script, rr] = k.split('|'); ((cut[`${cell}|${script}`] ??= { routes: {} }).routes)[`${rr}#${gs[0].selection}`] = route(gs);
  }
  return { whole, cut };
}

async function loadRows() {
  const f = arg('rows');
  if (f) return zlib.gunzipSync(fs.readFileSync(f)).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  try { return await c.db('bookstore').collection(COLLECTION).find(verdictQuery({ kind: 'item' }, { tests: 'only' })).toArray(); } finally { await c.close(); }
}

async function main() {
  const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp', 'test-evidence'));
  fs.mkdirSync(OUT, { recursive: true });
  const rules = readJson(`${D}rules.json`);
  const files = new Map(fs.readdirSync(R(EVID)).filter((f) => f.endsWith('.score.json')).map((f) => [`${EVID}${f}`, readJson(`${EVID}${f}`)]));
  // every score file rules.json can cite, for the derived-from test (covered) check
  const cited = new Set(rules.cells.flatMap((c) => c.routes.flatMap((r) => (r.evidence || []).map((e) => e.score))).concat(rules.inputs.pilot));
  const fileMeta = new Map([...cited].filter((f) => fs.existsSync(R(f))).map((f) => { const S = readJson(f); return [f, [S.generated_by, S.provenance, S.source, S.file].filter(Boolean).join(' ')]; }));
  const rows = await loadRows();
  const { groups, report } = fromRows(rules, rows, fileMeta);
  const ff = fromFiles(rules, files, new Set(rows.map((r) => r.test?.evidence).filter(Boolean)));
  const { whole, cut } = rowsScore(groups);
  const scoreFile = path.join(OUT, 'test-rows.score.json'), cutFile = path.join(OUT, 'test-rows.by-script.score.json');
  const meta = { generated_by: `${D}test-evidence.mjs (#7263 step 4; no model calls)`, judge: `${ROUTE_JUDGE}: the route judge's own accept / wrong text, one scale` };
  fs.writeFileSync(scoreFile, JSON.stringify({ ...meta, cells: whole }, null, 1) + '\n');
  fs.writeFileSync(cutFile, JSON.stringify({ ...meta, cells: cut }, null, 1) + '\n');
  const entries = [
    ...groups.reduce((m, g) => { const k = `${g.test}|${g.router_cell}|${g.router_route}|${g.selection}`; if (!m.seen.has(k)) { m.seen.add(k); m.out.push(g); } return m; }, { seen: new Set(), out: [] }).out.map((g) => ({
      source: 'rows', router_cell: g.router_cell, router_route: g.router_route, selection: g.selection, test: g.test, test_cell: g.test_cell, test_route: g.test_route,
      evidence: { score: scoreFile, cell: `${g.test}::${g.router_cell}`, route: `${g.router_route}#${g.selection}` }, why: g.basis })),
    ...ff.entries,
  ];
  const kn = (e) => e.source === 'rows' ? whole[e.evidence.cell].routes[e.evidence.route] : { accept: e.accept, books: e.books };
  const out = { ...meta, rows_source: arg('rows') || `mongo ${COLLECTION} origin:test`, by_script: { [scoreFile]: cutFile },
    evidence: entries.filter((e) => e.selection === 'random').map((e) => ({ ...e, ...kn(e) })),
    prior: entries.filter((e) => e.selection !== 'random').map((e) => ({ ...e, ...kn(e) })),
    report: { rows: report, files: ff.report } };
  fs.writeFileSync(path.join(OUT, 'auto-evidence.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(`rows read ${rows.length}; groups ${groups.length}; evidence ${out.evidence.length}, prior ${out.prior.length}`);
  for (const e of [...out.evidence, ...out.prior]) console.log(`  ${e.selection === 'random' ? 'EVIDENCE' : 'PRIOR   '} ${e.router_cell} / ${e.router_route}: ${e.accept} (${e.books} books) from ${e.test ?? path.basename(e.evidence.score)}`);
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  console.log(`hand-cited ${sum(report.hand_cited)} rows; covered ${sum(report.covered)}; unmapped ${sum(report.unmapped)}; other scale ${sum(report.other_scale)}; retest ${report.retest}`);
  for (const [k, v] of Object.entries(report.unmapped)) console.log(`  unmapped ${v}: ${k}`);
  for (const [k, v] of Object.entries(report.covered)) console.log(`  covered ${v}: ${k}`);
  for (const [k, v] of Object.entries(report.other_scale)) console.log(`  other scale ${v}: ${k}`);
  for (const x of ff.report) console.log(`  file ${path.basename(x.file)}${x.cell ? ` ${x.cell}` : ''}${x.route ? ` / ${x.route}` : ''}: ${x.status}`);
  console.log(`wrote ${OUT}/auto-evidence.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e); process.exit(1); });
