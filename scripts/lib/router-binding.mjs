// PRIOR ART: scripts/workers/brief-route-check.sh — checks that a job brief NAMES a router cell, not that the lane runs
// the cell's decided route; scripts/lib/ocr-routing.mjs + ocr-routing-table.json — the hand-edited production routes,
// whose `page_check` block is display only ("It routes nothing"). Neither compares a running lane with the k/n table.
//
// Router binding (#7809, part of #7611): does a lane run the route the router table decided for each cell it serves?
//
// The router table (scripts/eval/estimator/router-table/, #6740) decides per cell: keep / switch → a route, or HOLD /
// UNTESTED / planned. Until now nothing read those decisions: a person turned them into cron flags, sometimes not at
// all (2026-10-30: the table said German first reads switch to read + correct; both gex45 cron lines ran read only).
//
// current.json in the router-table directory names the table whose decisions are live. Moving that pointer IS the
// decision; the other tables (scenarios such as -unsplit, -router-tests) stay what-ifs. It also holds waivers: a cell
// may run another route than the decided one until a date at most 14 days after the waiver was set, with a reason.
// `cells` (#7853) moves the pointer for named cells only: {"<cell>": {table, set, why}} takes that cell's row from a
// newer build while every other cell stays on `table`, so a decision about two cells does not carry along every other
// change a rebuild makes.
//
// BINDING (#8283): a build's rows carry `bound_route`, what the cell runs (build.py bind): a HOLD cell runs it too, and the
// nightly rebuild moves this pointer by itself (planBind; scripts/eval/lane-judge-sampler.mjs). An older build's row binds its
// route only when the decision is keep or switch. boundRoute answers for both.
//
// A lane derives the routes it runs from its own flags (servedByFirstRead, servedByCorrect, servedByReread) and calls checkBinding.
// Each served cell gets one status:
//   ok         the lane runs the decided route (keep or switch)
//   mismatch   the cell binds a route and the lane runs something else, with no live waiver
//   waived     a mismatch with a live waiver
//   undecided  the cell binds no route (held, planned, or an older build's HOLD / UNTESTED): reported, not an error
//   no-cell    the current table has no such cell
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROUTER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../eval/estimator/router-table');
export const WAIVER_MAX_DAYS = 14;

// ISO 639-3 → the router's cell prefix. Only languages the router table has cells for.
const CELL_LANGUAGE = Object.freeze({ lat: 'latin', deu: 'german', fra: 'french', ita: 'italian', eng: 'english' });

/**
 * The current table: { name, rows: Map(cell id → row), waivers, pointer }. A cell named in pointer.cells takes its row
 * from that entry's table (the row carries `table`). Throws when the pointer, a table, or a moved cell's row is missing.
 */
export function loadCurrentTable(dir = ROUTER_DIR) {
  const pointer = JSON.parse(fs.readFileSync(path.join(dir, 'current.json'), 'utf8'));
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
  const rows = new Map(read(pointer.table).rows.map((r) => [r.id, r]));
  for (const [cell, c] of Object.entries(pointer.cells || {})) {
    if (!c.table) { rows.delete(cell); continue; }   // a new cell not bound yet (planBind)
    const row = read(c.table).rows.find((r) => r.id === cell);
    if (!row) throw new Error(`current.json cells: ${c.table} has no cell ${cell}`);
    rows.set(cell, { ...row, table: c.table });
  }
  return { name: pointer.table, rows, waivers: pointer.waivers || [], pointer };
}

/** A keep or switch the evidence decided, not an UNTESTED keep. */
export const isDecided = (row) => /^(keep|switch)\b/.test(row?.decision || '') && !/UNTESTED/.test(row.decision);

/** What the cell runs: the build's bound_route (null: nothing), or an older build's decided route. */
export function boundRoute(row) {
  if (row && 'bound_route' in row) return row.bound_route;
  return isDecided(row) ? row.route : null;
}

/** A route id's reading stage ('agy-flash-low@4>agy-flash-low-written' → agy, 4 a call): what a router can act on. */
export function routeReader(route) {
  const stages = String(route).split('>');
  const name = (s) => s.split(/[@+]/)[0];
  const first = name(stages[0]), last = name(stages[stages.length - 1]);
  const reader = /^agy-flash-low\b/.test(last) ? 'agy' : /^opus\b/.test(last) ? 'opus' : null;
  const reading = stages.find((s) => /^(agy|opus)/.test(s));
  return {
    first_read: !['lite', '3flash', 'flash3', 'stored', 'scans-only'].includes(first), reader,
    draft: stages.length > 1 && !/^(agy|opus)/.test(first) ? first : null,
    per_call: Number(reading?.match(/@(\d+)/)?.[1] ?? 1),
  };
}

/**
 * Cells and routes the first-read lane (`run --cohort=visible-unread`) runs, from its own flags. The route id is the
 * router's: agy-flash-low, `@N` when N pages go in a call (only for perCallLanguages), `>agy-flash-low` when the
 * correction pass runs, `-written` because the lane scores what it writes. Print only: the lane skips manuscripts.
 * `perCallByLanguage` (the lane's FIRST_READ_PER_CALL_BY_LANGUAGE) raises N for a language when perCall > 1.
 */
export function servedByFirstRead({ languages, correct = [], perCall = 1, perCallLanguages, perCallByLanguage = {} }) {
  if (!Array.isArray(perCallLanguages)) throw new Error('servedByFirstRead: pass the lane\'s FIRST_READ_PER_CALL_LANGUAGES');
  const langs = languages && languages.length ? languages : Object.keys(CELL_LANGUAGE);
  return langs.map((lang) => {
    const n = perCall > 1 && perCallLanguages.includes(lang) ? Math.max(perCall, perCallByLanguage[lang] ?? perCall) : 1;
    let route = n > 1 ? `agy-flash-low@${n}` : 'agy-flash-low';
    if (correct.includes(lang)) route += '>agy-flash-low';
    route += '-written';
    return { lane: 'first-read', cell: CELL_LANGUAGE[lang] ? `${CELL_LANGUAGE[lang]}-blank/print` : `${lang}-blank/print`, route };
  });
}

/**
 * Cells the correction lane (`correct`, Gemini mode) runs: books in `languages` (the lane's CORRECT_LANGUAGES names)
 * with Flash-Lite text, corrected by agy Flash-low. It does not exclude manuscripts, so those cells are served too.
 */
export function servedByCorrect({ languages = ['German', 'French'] } = {}) {
  return languages.flatMap((name) => ['print', 'unknown', 'manuscript'].map((script) => (
    { lane: 'correct', cell: `${name.toLowerCase()}-lite/${script}`, route: 'lite>agy-flash-low' })));
}

/**
 * Cells the re-read mode (`correct --reread-per-call=N`, #7853) runs: the correction lane's books and pages, read fresh
 * by agy Flash-low, N pages a call. Print only: the writer runs --print-only, so a page the reader does not tag printed
 * keeps its stored text, and no manuscript or unknown-script page is written.
 */
export function servedByReread({ languages = ['German', 'French'], perCall = 4 } = {}) {
  const route = perCall > 1 ? `agy-flash-low@${perCall}-read` : 'agy-flash-low-read';
  return languages.map((name) => ({ lane: 'reread', cell: `${name.toLowerCase()}-lite/print`, route }));
}

/**
 * Cells the arm-c lane (`armc --frame=first-read`, #7567) runs: the language's GPU draft (la PERO-OCR, it LightOnOCR)
 * corrected by agy Flash-low, scored as written. Other frames correct a stored draft and are not checked yet.
 */
export function servedByArmcFirstRead({ langs = ['la'] } = {}) {
  const draft = { la: 'pero', it: 'lighton' }, iso = { la: 'lat', it: 'ita' };
  return langs.map((l) => ({ lane: 'armc-first-read', cell: `${CELL_LANGUAGE[iso[l]] || l}-blank/print`, route: `${draft[l] || l}>agy-flash-low-written` }));
}

function liveWaiver(waivers, cell, lane, today) {
  return waivers.find((w) => {
    if (w.cell !== cell || (w.lane && w.lane !== lane) || !w.reason || !w.set || !w.until) return false;
    const days = (Date.parse(w.until) - Date.parse(w.set)) / 864e5;
    return days >= 0 && days <= WAIVER_MAX_DAYS && today <= w.until;
  });
}

const kn = (row, route) => {
  const r = row?.routes?.find((x) => x.id === route);
  return r && r.n ? `${r.k}/${r.n}` : null;
};

/** One finding per served cell (see the header for the statuses). `today` is YYYY-MM-DD. */
export function checkBinding(table, served, { today = new Date().toISOString().slice(0, 10) } = {}) {
  return served.map(({ lane, cell, route }) => {
    const row = table.rows.get(cell);
    const base = { lane, cell, runs: route, runs_kn: kn(row, route), table: row?.table || table.name };
    if (!row) return { ...base, status: 'no-cell' };
    const decision = String(row.decision || '');
    const f = { ...base, decision, decided: row.route, decided_kn: kn(row, row.route), pages_waiting: row.pages_waiting ?? null };
    const bound = boundRoute(row);
    if (!bound) return { ...f, status: 'undecided' };
    f.decided = bound; f.decided_kn = kn(row, bound);
    if (bound === route) return { ...f, status: 'ok' };
    const w = liveWaiver(table.waivers, cell, lane, today);
    return w ? { ...f, status: 'waived', waiver: w } : { ...f, status: 'mismatch' };
  });
}

export function describeFinding(f) {
  const runs = `${f.runs}${f.runs_kn ? ` ${f.runs_kn}` : ''}`;
  if (f.status === 'no-cell') return `${f.lane} ${f.cell}: no such cell in ${f.table} (runs ${runs})`;
  const decided = `${f.decision} → ${f.decided}${f.decided_kn ? ` ${f.decided_kn}` : ''}`;
  if (f.status === 'waived') return `${f.lane} ${f.cell}: WAIVED until ${f.waiver.until} (${f.waiver.reason}); runs ${runs}, table says ${decided}`;
  return `${f.lane} ${f.cell}: ${f.status.toUpperCase()}; runs ${runs}, table ${f.table} says ${decided}`;
}

/**
 * #7913: ROUTER_BINDING_REFUSE=1 turns a lane's `warn` into `refuse`: a lane that runs a route contradicting its cell's
 * decision, with no live waiver, exits 9 instead of paging and running. OFF by default until Derek's go is recorded on
 * #7913 (the router paper's build step 5: refuse once V1-V3 pass); then the env is set in the lane crontabs. An
 * explicit --route-check=off still skips the check; `refuse` stays `refuse`.
 */
export function effectiveMode(mode, env = process.env) {
  return mode === 'warn' && env.ROUTER_BINDING_REFUSE === '1' ? 'refuse' : mode;
}

/**
 * A lane's start-up check. mode: off | warn (print, page once a day per cell) | refuse (also exit 9 on a mismatch;
 * effectiveMode: warn becomes refuse under ROUTER_BINDING_REFUSE=1).
 * `page` is called with (title, body) for mismatches not yet paged today; a page failure never stops the lane.
 */
export async function laneRouteCheck(served, { mode = 'warn', page, stampDir = '/tmp', log = console.log, today, env = process.env } = {}) {
  mode = effectiveMode(mode, env);
  if (mode === 'off') return [];
  let table;
  try { table = loadCurrentTable(); } catch (e) {
    log(`route-check: no current router table (${e.message}); not checked`);
    return [];
  }
  const findings = checkBinding(table, served, { today });
  for (const f of findings) log(`route-check: ${describeFinding(f)}`);
  const bad = findings.filter((f) => f.status === 'mismatch');
  const day = today || new Date().toISOString().slice(0, 10);
  const fresh = bad.filter((f) => {
    const stamp = path.join(stampDir, `router-binding-${day}-${f.lane}-${f.cell.replace(/\W+/g, '_')}`);
    if (fs.existsSync(stamp)) return false;
    try { fs.writeFileSync(stamp, ''); } catch { /* paging twice beats not paging */ }
    return true;
  });
  if (fresh.length && page) {
    try {
      await page(`Router decision not followed: ${fresh.map((f) => f.cell).join(', ')}`,
        `${fresh.map(describeFinding).join('\n')}\nChange the lane's flags, or add a dated waiver to scripts/eval/estimator/router-table/current.json (#7809).`);
    } catch { /* never stop a lane for a page */ }
  }
  if (bad.length && mode === 'refuse') {
    log(`route-check: REFUSED (${env.ROUTER_BINDING_REFUSE === '1' ? 'ROUTER_BINDING_REFUSE=1' : '--route-check=refuse'}): ${bad.length} cell(s) not on their decided route`);
    process.exit(9);
  }
  return findings;
}

const TRANSLATION_ROUTE_ENGINE = Object.freeze({ 'opus-cli': 'claude-opus-5-5', 'agy-flash-low': 'gemini-3.8-flash+agy-cli', 'flash-lite': 'gemini-3.1-flash-lite', flash3: 'gemini-3-flash-preview' });

/**
 * A translation cell whose bound route the translation router does not run (#8283): the reason, or null. Only `<lang>-tr-first`
 * cells have a router rule to compare (first translations, translateLaneForBook on the language); translation's rows stay
 * hand-written, so a move it would not follow waits for a person. `lane` is translateLaneForBook(translationTable, book).
 */
export function translationDisagrees(row, lane) {
  const route = boundRoute(row);
  if (!route) return null;
  const [name, n] = route.split('@');
  const same = TRANSLATION_ROUTE_ENGINE[name] === lane.engine && (!n || Number(n) === (lane.row?.per_call ?? 1));
  return same ? null : `the translation router runs ${lane.engine}${lane.row?.per_call ? `@${lane.row.per_call}` : ''}, the cell binds ${route}`;
}

/** The book language of a `<lang>-tr-first` cell, or null for any other cell. */
export const trFirstLanguage = (id) => id.match(/^([a-z]+)-tr-first\//)?.[1].replace(/^./, (c) => c.toUpperCase()) ?? null;

/**
 * A first-read OCR cell bound to an Opus read (#8283): the reason, or null. getOcrModelForBook would answer Opus for the cell's books,
 * and no lane reads an unread book on Opus (cli-ocr-lane has no CLI model for it, its first-read cohort skips it), so they would stop
 * being read and nothing would fail. `bases` is FIRST_READ_CELL's values. A person can still pin it; the nightly does not.
 */
export function ocrCellNoLane(row, bases) {
  const route = boundRoute(row), reads = route && routeReader(route);
  return reads?.first_read && reads.reader === 'opus' && bases.includes(row.id.split('/')[0]) ? `no OCR lane reads an unread book on ${route}` : null;
}

/**
 * What the nightly rebuild does with a new build (#8283), pure. A cell whose bound route changes MOVES when a V3-tested rule
 * pick passes V3 (row.v3.passes; an annotated row has v3, null when the rule compared nothing), the judge gate did not hold it,
 * and `refuse(row)` (the routers cannot follow) gives no reason. A default, a held-over live route or a person's planned
 * decision is no rule pick, so V3 has nothing to say of it. A cell that fails stays where it runs, by a `cells` pin. Waivers
 * are copied verbatim and expire on their dates. {moved, blocked, pointer}; moved empty = no PR.
 */
export function planBind(table, next, { name, today, refuse = () => null }) {
  const moved = [], blocked = [], pins = {};
  const nextRows = new Map(next.rows.map((r) => [r.id, r]));
  const pin = (id, why) => { pins[id] = table.pointer.cells?.[id] ?? { table: table.name, set: today, why }; };   // a cell the live table lacks: table null, it stays out
  for (const id of table.rows.keys()) if (!nextRows.has(id)) pin(id, `${name} has no such cell (#8283).`);
  for (const row of next.rows) {
    const old = table.rows.get(row.id), from = boundRoute(old), to = boundRoute(row);
    if (from === to) continue;
    const rulePick = isDecided(row) && row.route === to && !/\(default:/.test(row.decision) && !row.rule_alone;
    if (rulePick && row.v3 === undefined) throw new Error(`planBind: ${row.id} has no V3 result: run v3_sim.py --annotate first`);
    const why = rulePick && row.v3 && !row.v3.passes ? `V3 false-pick rate ${(100 * row.v3.false_pick_boundary).toFixed(1)}% over the 5% bar`
      : row.judge_validity?.held ? `judge not valid: ${row.judge_validity.held}` : refuse(row);
    if (!why) { moved.push({ cell: row.id, from, to, decision: row.decision, pages_waiting: row.pages_waiting ?? 0 }); continue; }
    blocked.push({ cell: row.id, from, to, why });
    pins[row.id] = table.pointer.cells?.[row.id] ?? { table: old ? table.name : null, set: today, why: `Not auto-bound on ${today} (#8283): ${why}.` };
  }
  const { cells: _old, ...pointer } = table.pointer;
  return { moved, blocked, pointer: { ...pointer, table: name, set: today, why: `Nightly rebuild (#8283): ${moved.length} cell(s) moved; the PR body is the diff. Rollback: revert the PR.`, cells: pins, waivers: table.waivers } };
}

/**
 * #8111: the write share a '-written' route showed in its tests, from rules.json: every evidence entry of the route in
 * the cell (`<base>/<script>` reads the base cell) that carries written_of_drawn, summed. null when none does.
 */
export function testWriteShare(rules, cell, route) {
  const c = rules.cells?.find((x) => x.id === cell.split('/')[0]);
  const r = c?.routes?.find((x) => x.id === route);
  const wds = (r?.evidence || []).map((e) => e.written_of_drawn).filter(Boolean);
  if (!wds.length) return null;
  const [written, drawn] = [0, 1].map((i) => wds.reduce((t, v) => t + Number(v.split('/')[i]), 0));
  return { written, drawn };
}

/**
 * A lane ledger (jsonl, one row a page tried, `outcome: 'written'` when the page was written): pages tried and written.
 * `lang` keeps the rows of one language (rows with no lang are kept: a one-language lane writes none). A page that
 * got OCR from elsewhere before the read (`has_ocr_now`) was not the route's to write and is left out.
 */
export function ledgerYield(text, { lang = null, sinceIso = null } = {}) {
  let tried = 0, written = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if ((lang && r.lang && r.lang !== lang) || (sinceIso && r.at && r.at < sinceIso) || r.outcome === 'has_ocr_now') continue;
    tried++; if (r.outcome === 'written') written++;
  }
  return { tried, written };
}

/** P(X >= a), X ~ Binomial(n, x): the regularized incomplete beta I_x(a, n - a + 1) for integer a. */
function binomUpper(n, a, x) {
  let p = 0, term = Math.pow(1 - x, n);
  for (let k = 0; k <= n; k++) { if (k >= a) p += term; term *= ((n - k) / (k + 1)) * (x / (1 - x)); }
  return p;
}
/** The q quantile of Beta(a, b), integer a, b, by bisection. */
export function betaQuantile(a, b, q) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (binomUpper(a + b - 1, a, m) < q) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * #8111: a '-written' route's production yield against its tests. The tests' write share (written / drawn) has the
 * posterior Beta(1 + written, 1 + drawn - written); the lane's yield is FLAGGED when it falls below that posterior's
 * `q` quantile over at least `minTried` pages (arm C: 18/30 written in its test, 4,708 of 28,104 in the lane).
 * Status: yield-low | yield-ok | yield-unmeasured (too few pages tried) | no-test-share.
 */
export function checkYield(test, prod, { q = 0.01, minTried = 200 } = {}) {
  if (!test) return { status: 'no-test-share', prod };
  const floor = betaQuantile(1 + test.written, 1 + test.drawn - test.written, q);
  const share = prod.tried ? prod.written / prod.tried : null;
  const base = { test: `${test.written}/${test.drawn}`, prod: `${prod.written}/${prod.tried}`, prod_share: share, floor: Math.round(floor * 1000) / 1000 };
  if (prod.tried < minTried) return { ...base, status: 'yield-unmeasured' };
  return { ...base, status: share < floor ? 'yield-low' : 'yield-ok' };
}
