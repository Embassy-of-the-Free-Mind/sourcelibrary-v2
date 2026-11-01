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
// A lane derives the routes it runs from its own flags (servedByFirstRead, servedByCorrect, servedByReread) and calls checkBinding.
// Each served cell gets one status:
//   ok         the lane runs the decided route (keep or switch)
//   mismatch   the decision is keep/switch and the lane runs something else, with no live waiver
//   waived     a mismatch with a live waiver
//   undecided  the cell is HOLD / UNTESTED / planned / held: the lane runs an undecided cell (reported, not an error)
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
    const row = read(c.table).rows.find((r) => r.id === cell);
    if (!row) throw new Error(`current.json cells: ${c.table} has no cell ${cell}`);
    rows.set(cell, { ...row, table: c.table });
  }
  return { name: pointer.table, rows, waivers: pointer.waivers || [], pointer };
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
    if (!/^(keep|switch)\b/.test(decision) || /UNTESTED/.test(decision)) return { ...f, status: 'undecided' };
    if (row.route === route) return { ...f, status: 'ok' };
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
 * A lane's start-up check. mode: off | warn (print, page once a day per cell) | refuse (also exit 9 on a mismatch).
 * `page` is called with (title, body) for mismatches not yet paged today; a page failure never stops the lane.
 */
export async function laneRouteCheck(served, { mode = 'warn', page, stampDir = '/tmp', log = console.log, today } = {}) {
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
    log(`route-check: REFUSED (--route-check=refuse): ${bad.length} cell(s) not on their decided route`);
    process.exit(9);
  }
  return findings;
}
