#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/work-board-push.mjs / pipeline-now-push.mjs — the
// pattern copied (one ops_reports document, upserted from cron; the page renders it and needs no deploy to refresh).
/**
 * router-board push (/admin/router, #7913): per router cell, what production runs against what the router decided.
 *
 *   node --env-file=.env.production.local scripts/maintenance/router-board-push.mjs [--dry-run]
 *
 * Reads, from the checkout it runs in (main on Hetzner): the live router table (current.json through
 * scripts/lib/router-binding.mjs loadCurrentTable), the repo crontabs and the two routing tables (driftFromRepo). One row per cell that is decided (keep / switch), served by a cron lane, or has pages waiting:
 * production route (the lanes' routes, box and cron schedule), the router's decision and route, the route's evidence
 * (accepted k/n, books, defects per 1,000 words, judge validity of its stratum), pages waiting, waivers and their
 * expiry. Upserts {_id: 'router-board:latest', type: 'router-board'} in ops_reports. Nothing but the admin page reads
 * it, so the write actuates nothing. No model, no page reads; the crontabs are the repo copies, not `crontab -l`.
 *
 *   node scripts/maintenance/router-board-push.mjs --yield --crontab=FILE [--since-days=N]     no Mongo; exit 1 on a low yield
 *
 * --yield (#8111): for each line that runs a '-written' route, reads the lane's ledger here and flags YIELD-LOW when the share
 * of pages tried that it wrote falls below what the route's tests wrote (rules.json written_of_drawn; lib checkYield). Arm C
 * wrote 18/30 in its test and 16.8% in the lane for six days before anyone looked (#7701).
 *
 * THE DRIFT (#7263, moved here from scripts/audit/router-table-drift.mjs by #8283): has each cell that binds a route shipped?
 * For each, every cron lane in the repo's crontabs (what sync installs) gives one status:
 *   served     a lane runs the bound route
 *   waived     a lane runs another route under a live waiver in current.json
 *   mismatch   a lane runs another route, no waiver
 *   unshipped  no lane serves the cell and pages are waiting: a decision that never reached production
 *   stored     no lane serves the cell, and its route is the text already served (a stage `none` route): no lane is owed (#7913)
 *   idle       no lane serves the cell and nothing is waiting (an experiment frame, or a drained queue)
 * The nightly lane-judge comment on #7263 posts driftMarkdown when it changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCurrentTable, checkBinding, boundRoute, servedByFirstRead, servedByCorrect, servedByReread, servedByArmcFirstRead, ROUTER_DIR, testWriteShare, ledgerYield, checkYield } from '../lib/router-binding.mjs';
import { FIRST_READ_PER_CALL_LANGUAGES, FIRST_READ_PER_CALL_BY_LANGUAGE, CORRECT_LANGUAGES } from '../batch/cli-ocr-lane.mjs';
import { toLanguageCodes } from '../lib/language-normalize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const COLLECTION = 'ops_reports';
export const TYPE = 'router-board';
export const DOC_ID = 'router-board:latest';

const ROUTING_TABLES = ['scripts/lib/ocr-routing-table.json', 'scripts/lib/translation-routing-table.json'];
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

const codes = (v) => (v ? v.split(',').map((l) => toLanguageCodes(l).codes[0] ?? l) : null);
const laneFlag = (line) => (n) => line.match(new RegExp(`--${n}=([^\\s"']+)`))?.[1];
const firstReadOf = (flag) => servedByFirstRead({ languages: codes(flag('languages')), correct: codes(flag('correct')) || [], perCall: Number(flag('per-call') || 1), perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES, perCallByLanguage: FIRST_READ_PER_CALL_BY_LANGUAGE });
const laneLines = (text) => text.split('\n').filter((line) => !/^\s*#/.test(line) && line.includes('cli-ocr-lane.mjs'));

/** Served cells for each cron line, from the line's own flags. */
export function servedByCrontab(text) {
  const served = [];
  for (const line of laneLines(text)) {
    const flag = laneFlag(line);
    const correctLanguages = () => CORRECT_LANGUAGES.source.match(/\(([^)]*)\)/)[1].split('|');
    if (/\srun\s+--cohort=/.test(line)) served.push(...firstReadOf(flag));
    // one pool's run in order (cli-ocr-lane.mjs latinFirstSteps): the Latin re-read at 4 a call, the German/French correction
    else if (/\slatin-first\s+--/.test(line)) served.push(...servedByReread({ languages: ['Latin'], perCall: 4 }), ...servedByCorrect({ languages: correctLanguages() }));
    // --reread-per-call=N (#7853): the same frame re-read, not corrected
    else if (/\scorrect\s+--/.test(line)) served.push(...(flag('reread-per-call') ? servedByReread({ languages: correctLanguages(), perCall: Number(flag('reread-per-call')) }) : servedByCorrect({ languages: correctLanguages() })));
    else if (/\sarmc\s+--frame=first-read/.test(line)) served.push(...servedByArmcFirstRead({ langs: (flag('langs') || 'la').split(',') }));
  }
  // two accounts run the same lane: one finding per lane and cell
  return [...new Map(served.map((s) => [`${s.lane} ${s.cell} ${s.route}`, s])).values()];
}

/**
 * #8111: each cron line that runs a '-written' route, with the ledger it writes one row a page tried to:
 * { lane, cell, route, ledger, lang, mixed }. first-read: DIR/../first-read-ledger.jsonl (--out=DIR) or --ledger; its
 * rows carry no language, so a line serving two languages is `mixed` (one yield for all of them). arm c:
 * --lane-dir/armc-ledger.jsonl, rows split by `lang`.
 */
export function ledgersByCrontab(text) {
  const out = [];
  for (const line of laneLines(text)) {
    const flag = laneFlag(line);
    if (/\srun\s+--cohort=/.test(line)) {
      const s = firstReadOf(flag);
      const ledger = flag('ledger') || (flag('out') ? path.join(path.dirname(flag('out')), 'first-read-ledger.jsonl') : null);
      out.push(...s.map((x) => ({ ...x, ledger, lang: null, mixed: s.length > 1 })));
    } else if (/\sarmc\s+--frame=first-read/.test(line)) {
      const langs = (flag('langs') || 'la').split(','), L = flag('lane-dir');
      out.push(...servedByArmcFirstRead({ langs }).map((x, i) => ({ ...x, ledger: L ? path.join(L, 'armc-ledger.jsonl') : null, lang: langs[i], mixed: false })));
    }
  }
  return [...new Map(out.map((s) => [`${s.ledger} ${s.cell} ${s.route}`, s])).values()];
}

/** The yield finding of each '-written' line: reads its ledger with `read(path)` (text, or null when missing). */
export function yieldFindings(text, rules, read, { sinceIso = null } = {}) {
  return ledgersByCrontab(text).map((s) => {
    const raw = s.ledger ? read(s.ledger) : null;
    if (raw == null) return { ...s, status: 'no-ledger' };
    return { ...s, ...checkYield(testWriteShare(rules, s.cell, s.route), ledgerYield(raw, { lang: s.lang, sinceIso })) };
  });
}

export function describeYield(f) {
  const what = `${f.lane} ${f.cell} ${f.route}`;
  if (f.status === 'no-ledger') return `${what}: no ledger (${f.ledger ?? 'no --out / --lane-dir on the line'})`;
  if (f.status === 'no-test-share') return `${what}: no test write share in rules.json (written_of_drawn); lane wrote ${f.prod.written}/${f.prod.tried}`;
  const pct = f.prod_share == null ? '—' : `${(100 * f.prod_share).toFixed(1)}%`;
  return `${what}: ${f.status.toUpperCase()}; the lane wrote ${f.prod} pages tried (${pct}), its tests ${f.test} (floor ${(100 * f.floor).toFixed(1)}%)${f.mixed ? '; ledger mixes this line\'s languages' : ''}`;
}

export function defaultCrontabs(root = ROOT) {
  const infra = path.join(root, 'infrastructure');
  return [...fs.readdirSync(infra).filter((f) => f.endsWith('-crontab')).map((f) => `infrastructure/${f}`), 'scripts/workers/crontab.production']
    .filter((f) => fs.existsSync(path.join(root, f)));
}

const days = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 864e5) : null);

function lastCommitDate(file, root) {
  try { return execFileSync('git', ['-C', root, 'log', '-1', '--format=%cs', '--', file], { encoding: 'utf8' }).trim() || null; } catch { return null; }
}

/**
 * The drift report, pure over its inputs (the test passes them): table (loadCurrentTable's shape), crontabs
 * ({name: text}), routingTables ({file: {text, as_of, changed}}), today (YYYY-MM-DD).
 */
export function driftReport({ table, crontabs, routingTables, today = new Date().toISOString().slice(0, 10) }) {
  const lanes = Object.entries(crontabs).flatMap(([box, text]) => servedByCrontab(text).map((s) => ({ ...s, box })));
  const findings = checkBinding(table, lanes, { today }).map((f, i) => ({ ...f, box: lanes[i].box }));
  const cells = [];
  for (const row of table.rows.values()) {
    const route = boundRoute(row);
    if (!route) continue;
    const mine = findings.filter((f) => f.cell === row.id);
    const order = ['ok', 'waived', 'mismatch'];
    const best = mine.map((f) => f.status).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    const stored = (row.routes || []).find((x) => x.id === route)?.stage === 'none';
    const status = best === 'ok' ? 'served' : best || (stored ? 'stored' : (row.pages_waiting || 0) > 0 ? 'unshipped' : 'idle');
    const set = table.pointer?.cells?.[row.id]?.set || table.pointer?.set || null;
    const named = Object.entries(routingTables).filter(([, t]) => t.text.includes(row.id)).map(([f]) => path.basename(f));
    cells.push({ cell: row.id, decision: String(row.decision).split(' ')[0], route, pages_waiting: row.pages_waiting ?? 0, table: row.table || table.name, decided_set: set,
      status, lanes: mine.map((f) => ({ box: f.box, lane: f.lane, runs: f.runs, status: f.status, ...(f.waiver && { waiver_until: f.waiver.until }) })), routing_row: named });
  }
  const rank = { unshipped: 0, mismatch: 1, waived: 2, served: 3, stored: 4, idle: 5 };
  cells.sort((a, b) => rank[a.status] - rank[b.status] || b.pages_waiting - a.pages_waiting || a.cell.localeCompare(b.cell));
  const tally = {}; for (const c of cells) { tally[c.status] = tally[c.status] || { cells: 0, pages_waiting: 0 }; tally[c.status].cells++; tally[c.status].pages_waiting += c.pages_waiting; }
  const tables = Object.entries(routingTables).map(([f, t]) => ({ file: f, as_of: t.as_of, changed: t.changed, days_behind_pointer: days(t.changed || t.as_of, table.pointer?.set) }));
  return { as_of: today, table: table.name, pointer_set: table.pointer?.set ?? null, crontabs: Object.keys(crontabs), tally, cells, routing_tables: tables,
    // what the nightly poster compares: a change in this is news, the same drift again is not
    signature: cells.filter((c) => !['served', 'stored', 'idle'].includes(c.status)).map((c) => `${c.cell}:${c.status}:${c.route}`).join('|') };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function driftMarkdown(r) {
  const t = (s) => r.tally[s] || { cells: 0, pages_waiting: 0 };
  const lines = [
    `**Router binding (#7263, \`scripts/maintenance/router-board-push.mjs\`)**: ${r.cells.length} cells bind a route in \`current.json\` (${r.table}, set ${r.pointer_set}). `
      + `Served on the bound route: ${t('served').cells}. Another route under a waiver: ${t('waived').cells}. Another route, no waiver: ${t('mismatch').cells} (${fmt(t('mismatch').pages_waiting)} pages waiting). `
      + `No lane at all: ${t('unshipped').cells} (${fmt(t('unshipped').pages_waiting)} pages waiting). Keeps the stored text (nothing to run): ${t('stored').cells} (${fmt(t('stored').pages_waiting)} pages). Nothing waiting: ${t('idle').cells}.`,
    '',
    `Routing tables: ${r.routing_tables.map((x) => `\`${path.basename(x.file)}\` last changed ${x.changed || x.as_of}${x.days_behind_pointer != null ? ` (${x.days_behind_pointer} days before the pointer)` : ''}`).join('; ')}. `
      + `${r.cells.filter((c) => c.routing_row.length).length} of ${r.cells.length} bound cells are named by a routing-table row.`,
    '',
    '| cell | decision → route | pages waiting | status | lanes (box: lane runs route) |', '|---|---|---|---|---|',
    ...r.cells.filter((c) => c.status !== 'idle' && c.status !== 'stored').map((c) => `| ${c.cell} | ${c.decision} → ${c.route} | ${fmt(c.pages_waiting)} | **${c.status}** | ${c.lanes.map((l) => `${l.box.replace(/^infrastructure\//, '')}: ${l.lane} ${l.runs} (${l.status}${l.waiver_until ? ` until ${l.waiver_until}` : ''})`).join('<br>') || 'none'} |`),
    '',
    `Keeps the stored text (decided route is the served draft or English, no lane owed): ${r.cells.filter((c) => c.status === 'stored').map((c) => `${c.cell} (${fmt(c.pages_waiting)})`).join(', ') || 'none'}.`,
    `Idle (no lane, nothing waiting): ${r.cells.filter((c) => c.status === 'idle').map((c) => c.cell).join(', ') || 'none'}.`,
    'Crontabs read: the repo copies (' + r.crontabs.map((c) => `\`${c}\``).join(', ') + '), not a live `crontab -l`.',
  ];
  return lines.join('\n');
}

/** Read the inputs from a checkout and build the report. */
export function driftFromRepo({ root = ROOT, crontabFiles = null, today } = {}) {
  const table = loadCurrentTable();
  const crontabs = Object.fromEntries((crontabFiles || defaultCrontabs(root)).map((f) => [f, fs.readFileSync(path.isAbsolute(f) ? f : path.join(root, f), 'utf8')]));
  const routingTables = Object.fromEntries(ROUTING_TABLES.map((f) => {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    return [f, { text, as_of: JSON.parse(text).as_of ?? null, changed: lastCommitDate(f, root) }];
  }));
  return driftReport({ table, crontabs, routingTables, today });
}

/** Each cron lane with its schedule and trailing comment: servedByCrontab run line by line. Exported for the test. */
export function cronLanes(crontabs) {
  const out = [];
  for (const [box, text] of Object.entries(crontabs)) {
    for (const line of text.split('\n')) {
      if (/^\s*#/.test(line) || !line.includes('cli-ocr-lane.mjs')) continue;
      const schedule = line.trim().split(/\s+/).slice(0, 5).join(' ');
      const comment = line.includes(' # ') ? line.slice(line.lastIndexOf(' # ') + 3).trim().slice(0, 200) : '';
      for (const s of servedByCrontab(line)) out.push({ ...s, box, schedule, comment });
    }
  }
  return out;
}

/** The evidence of one route of a table row: k/n, books, defects per 1,000 words, judge stratum. */
export function routeEvidence(row, routeId) {
  const r = (row.routes || []).find((x) => x.id === routeId);
  if (!r) return null;
  const d = r.defects;
  return {
    // n_eff: the judged pages after book scaling (build.py pool_sources), what the posterior really sees
    route: routeId, k_of_n: r.n ? `${r.k}/${r.n}` : null, n: r.n ?? null, n_eff: r3(r.eff?.[1]),
    accept_mean: r3(r.mean), wrong_text_pages: r.n ? `${r.wrong}/${r.n}` : null,
    defects: d ? { books: d.books, words: d.words, misleads_per_1k: r3(d.misleads_per_1k_posterior?.[1]), wrong_text_per_1k: r3(d.wrong_text_per_1k_posterior?.[1]) } : null,
  };
}

/** The board, pure over its inputs (the test passes them). */
export function routerBoard({ table, drift, lanes, today = new Date().toISOString().slice(0, 10) }) {
  const findings = checkBinding(table, lanes, { today }).map((f, i) => ({ ...f, box: lanes[i].box, schedule: lanes[i].schedule, comment: lanes[i].comment }));
  const status = Object.fromEntries(drift.cells.map((c) => [c.cell, c]));
  const cells = [];
  for (const row of table.rows.values()) {
    const mine = findings.filter((f) => f.cell === row.id);
    const route = boundRoute(row), isDecided = Boolean(route);
    if (!isDecided && !mine.length && !(row.pages_waiting > 0)) continue;
    const jv = row.judge_validity;
    const waivers = (table.waivers || []).filter((w) => w.cell === row.id).map((w) => ({ lane: w.lane || null, set: w.set, until: w.until, live: Boolean(w.until && today <= w.until), reason: String(w.reason || '').slice(0, 300) }));
    cells.push({
      cell: row.id, title: row.title || null,
      status: isDecided ? status[row.id]?.status ?? 'unshipped' : 'undecided',
      decision: String(row.decision || '').split(' (')[0], decision_label: String(row.decision || '').slice(0, 300),
      route: route ?? row.route, table: row.table || table.name, decided_set: table.pointer?.cells?.[row.id]?.set || table.pointer?.set || null,
      evidence: routeEvidence(row, route ?? row.route),
      judge: jv ? { stratum: jv.stratum, valid: jv.self_preference_valid ?? null } : null,
      pages_waiting: row.pages_waiting ?? 0,
      lanes: mine.map((f) => ({ box: f.box.replace(/^infrastructure\//, ''), lane: f.lane, runs: f.runs, runs_kn: f.runs_kn, status: f.status, schedule: f.schedule, comment: f.comment, ...(f.waiver && { waiver_until: f.waiver.until }) })),
      production: [...new Set(mine.map((f) => f.runs))],
      waivers,
      routing_row: (status[row.id]?.routing_row || []).length > 0,
    });
  }
  const rank = { mismatch: 0, unshipped: 1, waived: 2, served: 3, stored: 4, undecided: 5, idle: 6 };
  cells.sort((a, b) => rank[a.status] - rank[b.status] || b.pages_waiting - a.pages_waiting || a.cell.localeCompare(b.cell));
  return { _id: DOC_ID, type: TYPE, as_of: today, table: drift.table, pointer_set: drift.pointer_set, crontabs: drift.crontabs,
    tally: drift.tally, routing_tables: drift.routing_tables, cells };
}

function yieldMain(argv) {
  const opt = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
  const days = Number(opt('since-days') || 0);
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
  const found = yieldFindings(fs.readFileSync(opt('crontab'), 'utf8'), JSON.parse(fs.readFileSync(path.join(ROUTER_DIR, 'rules.json'), 'utf8')), read, { sinceIso: days ? new Date(Date.now() - days * 864e5).toISOString() : null });
  for (const y of found) console.log(describeYield(y));
  process.exit(found.some((y) => y.status === 'yield-low') ? 1 : 0);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--yield')) return yieldMain(argv);
  const dry = argv.includes('--dry-run');
  const table = loadCurrentTable();
  const drift = driftFromRepo();
  const crontabs = Object.fromEntries(defaultCrontabs(ROOT).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let commit = null;
  try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const doc = { ...routerBoard({ table, drift, lanes: cronLanes(crontabs) }), generated_at: new Date(), commit };
  if (dry) { console.log(JSON.stringify(doc, null, 1)); return; }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — use node --env-file=…/.env.production.local'); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  try {
    await client.db(process.env.MONGODB_DB || 'bookstore').collection(COLLECTION).replaceOne({ _id: DOC_ID }, doc, { upsert: true });
    console.log(`router-board: ${doc.cells.length} cells (${doc.table}, commit ${commit})`);
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
