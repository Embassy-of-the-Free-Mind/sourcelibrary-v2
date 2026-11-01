#!/usr/bin/env node
// PRIOR ART: scripts/audit/router-binding.mjs — the per-crontab check this reuses (servedByCrontab, and through it
// scripts/lib/router-binding.mjs loadCurrentTable / checkBinding); it reads ONE crontab and lists the decided cells that
// crontab does not serve, so a cell another box serves reads as unserved and a cell no box serves is not called out as
// a decision that never shipped. scripts/audit/routing-drift.mjs — audits scripts/eval/DECISIONS.md against the live
// probes of getOcrModelForBook / getTranslateModelForBook, never the router table's current.json (#7263 audit,
// 2026-11-01: "it cannot see this gap"); its classes and issue-filing are for the ledger and do not fit cells.
//
// router-table-drift (#7263, build step 5 of .claude/docs/router-optimization-paper.md): has each DECIDED cell of the
// live router table shipped?
//
//   node scripts/audit/router-table-drift.mjs [--crontabs=FILE,FILE] [--json] [--strict]
//
// For every keep / switch cell of current.json (scripts/lib/router-binding.mjs loadCurrentTable; UNTESTED keeps are
// not decisions), it takes every cron lane in the repo's crontabs (infrastructure/*-crontab and
// scripts/workers/crontab.production by default: what sync installs, not a live `crontab -l`), derives the routes each
// line runs from its flags (router-binding.mjs servedByCrontab) and gives the cell one status:
//   served     a lane runs the decided route
//   waived     a lane runs another route under a live waiver in current.json
//   mismatch   a lane runs another route, no waiver
//   unshipped  no lane serves the cell and pages are waiting: a decision that never reached production
//   idle       no lane serves the cell and nothing is waiting (an experiment frame, or a drained queue)
// It also says whether either hand-edited routing table (scripts/lib/ocr-routing-table.json,
// translation-routing-table.json) names the cell, and how old those tables are against the decision.
// Markdown on stdout (the nightly lane-judge comment on #7263 posts it when it changes). Read-only: no Mongo, no model.
// Exit 0; with --strict, 1 when any cell is mismatch or unshipped.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCurrentTable, checkBinding } from '../lib/router-binding.mjs';
import { servedByCrontab } from './router-binding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTING_TABLES = ['scripts/lib/ocr-routing-table.json', 'scripts/lib/translation-routing-table.json'];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');

export function defaultCrontabs(root = ROOT) {
  const infra = path.join(root, 'infrastructure');
  return [...fs.readdirSync(infra).filter((f) => f.endsWith('-crontab')).map((f) => `infrastructure/${f}`), 'scripts/workers/crontab.production']
    .filter((f) => fs.existsSync(path.join(root, f)));
}

const decided = (row) => /^(keep|switch)\b/.test(row.decision || '') && !/UNTESTED/.test(row.decision);
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
    if (!decided(row)) continue;
    const mine = findings.filter((f) => f.cell === row.id);
    const order = ['ok', 'waived', 'mismatch'];
    const best = mine.map((f) => f.status).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    const status = best === 'ok' ? 'served' : best || ((row.pages_waiting || 0) > 0 ? 'unshipped' : 'idle');
    const set = table.pointer?.cells?.[row.id]?.set || table.pointer?.set || null;
    const named = Object.entries(routingTables).filter(([, t]) => t.text.includes(row.id)).map(([f]) => path.basename(f));
    cells.push({ cell: row.id, decision: String(row.decision).split(' ')[0], route: row.route, pages_waiting: row.pages_waiting ?? 0, table: row.table || table.name, decided_set: set,
      status, lanes: mine.map((f) => ({ box: f.box, lane: f.lane, runs: f.runs, status: f.status, ...(f.waiver && { waiver_until: f.waiver.until }) })), routing_row: named });
  }
  const rank = { unshipped: 0, mismatch: 1, waived: 2, served: 3, idle: 4 };
  cells.sort((a, b) => rank[a.status] - rank[b.status] || b.pages_waiting - a.pages_waiting || a.cell.localeCompare(b.cell));
  const tally = {}; for (const c of cells) { tally[c.status] = tally[c.status] || { cells: 0, pages_waiting: 0 }; tally[c.status].cells++; tally[c.status].pages_waiting += c.pages_waiting; }
  const tables = Object.entries(routingTables).map(([f, t]) => ({ file: f, as_of: t.as_of, changed: t.changed, days_behind_pointer: days(t.changed || t.as_of, table.pointer?.set) }));
  return { as_of: today, table: table.name, pointer_set: table.pointer?.set ?? null, crontabs: Object.keys(crontabs), tally, cells, routing_tables: tables,
    // what the nightly poster compares: a change in this is news, the same drift again is not
    signature: cells.filter((c) => c.status !== 'served' && c.status !== 'idle').map((c) => `${c.cell}:${c.status}:${c.route}`).join('|') };
}

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

export function driftMarkdown(r) {
  const t = (s) => r.tally[s] || { cells: 0, pages_waiting: 0 };
  const lines = [
    `**Router binding (#7263, \`scripts/audit/router-table-drift.mjs\`)**: ${r.cells.length} decided cells in \`current.json\` (${r.table}, set ${r.pointer_set}). `
      + `Served on the decided route: ${t('served').cells}. Another route under a waiver: ${t('waived').cells}. Another route, no waiver: ${t('mismatch').cells} (${fmt(t('mismatch').pages_waiting)} pages waiting). `
      + `No lane at all: ${t('unshipped').cells} (${fmt(t('unshipped').pages_waiting)} pages waiting). Nothing waiting: ${t('idle').cells}.`,
    '',
    `Routing tables: ${r.routing_tables.map((x) => `\`${path.basename(x.file)}\` last changed ${x.changed || x.as_of}${x.days_behind_pointer != null ? ` (${x.days_behind_pointer} days before the pointer)` : ''}`).join('; ')}. `
      + `${r.cells.filter((c) => c.routing_row.length).length} of ${r.cells.length} decided cells are named by a routing-table row.`,
    '',
    '| cell | decision → route | pages waiting | status | lanes (box: lane runs route) |', '|---|---|---|---|---|',
    ...r.cells.filter((c) => c.status !== 'idle').map((c) => `| ${c.cell} | ${c.decision} → ${c.route} | ${fmt(c.pages_waiting)} | **${c.status}** | ${c.lanes.map((l) => `${l.box.replace(/^infrastructure\//, '')}: ${l.lane} ${l.runs} (${l.status}${l.waiver_until ? ` until ${l.waiver_until}` : ''})`).join('<br>') || 'none'} |`),
    '',
    `Idle (no lane, nothing waiting): ${r.cells.filter((c) => c.status === 'idle').map((c) => c.cell).join(', ') || 'none'}.`,
    'Crontabs read: the repo copies (' + r.crontabs.map((c) => `\`${c}\``).join(', ') + '), not a live `crontab -l`. A switch ships through a routing PR on the hold list after its V4 confirmation run (`scripts/eval/router-confirm/`).',
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

function main() {
  const r = driftFromRepo({ crontabFiles: arg('crontabs')?.split(',') });
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 1));
  else console.log(driftMarkdown(r));
  process.exit(process.argv.includes('--strict') && r.cells.some((c) => c.status === 'mismatch' || c.status === 'unshipped') ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
