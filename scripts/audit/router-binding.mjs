#!/usr/bin/env node
// PRIOR ART: scripts/lib/router-binding.mjs — the check itself (this is its command line over a crontab);
// scripts/workers/brief-route-check.sh — checks a job brief names a cell, not that a cron line runs its route.
//
// router-binding.mjs (#7809) — do a box's cron lanes run the routes the current router table decided?
//
//   node scripts/audit/router-binding.mjs [--crontab=FILE | --ssh=root@HOST] [--json]
//
// Reads the crontab (default: `crontab -l` here), takes every non-comment cli-ocr-lane.mjs line in `run --cohort`,
// `correct` or `armc --frame=first-read` mode, derives the routes it runs from its flags, and prints each served cell's status (ok, mismatch,
// waived, undecided, no-cell; see scripts/lib/router-binding.mjs). Then lists the decided cells (keep/switch, pages
// waiting) that no line serves. Exit 1 on any mismatch, else 0. Read-only: no Mongo, no pages.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { loadCurrentTable, checkBinding, describeFinding, servedByFirstRead, servedByCorrect, servedByArmcFirstRead } from '../lib/router-binding.mjs';
import { FIRST_READ_PER_CALL_LANGUAGES, CORRECT_LANGUAGES } from '../batch/cli-ocr-lane.mjs';
import { toLanguageCodes } from '../lib/language-normalize.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const codes = (v) => (v ? v.split(',').map((l) => toLanguageCodes(l).codes[0] ?? l) : null);

/** Served cells for each cron line, from the line's own flags. Exported for the test. */
export function servedByCrontab(text) {
  const served = [];
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || !line.includes('cli-ocr-lane.mjs')) continue;
    const flag = (n) => line.match(new RegExp(`--${n}=([^\\s"']+)`))?.[1];
    if (/\srun\s+--cohort=/.test(line)) {
      served.push(...servedByFirstRead({ languages: codes(flag('languages')), correct: codes(flag('correct')) || [], perCall: Number(flag('per-call') || 1), perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES }));
    } else if (/\scorrect\s+--/.test(line)) {
      served.push(...servedByCorrect({ languages: CORRECT_LANGUAGES.source.match(/\(([^)]*)\)/)[1].split('|') }));
    } else if (/\sarmc\s+--frame=first-read/.test(line)) {
      served.push(...servedByArmcFirstRead({ langs: (flag('langs') || 'la').split(',') }));
    }
  }
  // two accounts run the same lane: one finding per lane and cell
  return [...new Map(served.map((s) => [`${s.lane} ${s.cell} ${s.route}`, s])).values()];
}

async function main() {
  const text = arg('crontab') ? fs.readFileSync(arg('crontab'), 'utf8')
    : arg('ssh') ? execFileSync('ssh', ['-o', 'ConnectTimeout=10', arg('ssh'), 'crontab -l'], { encoding: 'utf8' })
      : execFileSync('crontab', ['-l'], { encoding: 'utf8' });
  const table = loadCurrentTable();
  const findings = checkBinding(table, servedByCrontab(text));
  const servedCells = new Set(findings.map((f) => f.cell));
  const unserved = [...table.rows.values()].filter((r) => /^(keep|switch)\b/.test(r.decision || '') && !/UNTESTED/.test(r.decision)
    && (r.pages_waiting || 0) > 0 && !servedCells.has(r.id));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ table: table.name, findings, unserved: unserved.map((r) => ({ cell: r.id, decision: r.decision, route: r.route, pages_waiting: r.pages_waiting })) }, null, 1));
  } else {
    console.log(`router table: ${table.name} (scripts/eval/estimator/router-table/current.json)`);
    for (const f of findings) console.log(`  ${describeFinding(f)}`);
    console.log(`decided cells with pages waiting that no cron line here serves: ${unserved.length}`);
    for (const r of unserved) console.log(`  ${r.id}: ${r.decision} → ${r.route}, ${r.pages_waiting.toLocaleString('en-US')} pages waiting`);
  }
  process.exit(findings.some((f) => f.status === 'mismatch') ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
