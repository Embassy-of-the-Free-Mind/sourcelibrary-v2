#!/usr/bin/env node
// PRIOR ART: scripts/lib/router-binding.mjs — the check itself (this is its command line over a crontab);
// scripts/workers/brief-route-check.sh — checks a job brief names a cell, not that a cron line runs its route.
//
// router-binding.mjs (#7809) — do a box's cron lanes run the routes the current router table decided?
//
//   node scripts/audit/router-binding.mjs [--crontab=FILE | --ssh=root@HOST] [--json] [--yield [--since-days=N]]
//
// Reads the crontab (default: `crontab -l` here), takes every non-comment cli-ocr-lane.mjs line in `run --cohort`,
// `correct` (or its `--reread-per-call` re-read) or `armc --frame=first-read` mode, derives the routes it runs from its flags, and prints each served cell's status (ok, mismatch,
// waived, undecided, no-cell; see scripts/lib/router-binding.mjs). Then lists the decided cells (keep/switch, pages
// waiting) that no line serves. Exit 1 on any mismatch, else 0. Read-only: no Mongo, no pages.
// --yield (#8111): for each line that runs a '-written' route (the first-read lane, arm c), reads the lane's ledger
// (here, or over --ssh) and flags YIELD-LOW when the share of pages tried that the lane wrote falls below what the
// route's tests wrote (rules.json written_of_drawn; lib checkYield). Arm C wrote 18/30 in its test and 16.8% in the
// lane for six days before anyone looked (#7701). Exit 1 on a low yield too.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadCurrentTable, checkBinding, describeFinding, servedByFirstRead, servedByCorrect, servedByReread, servedByArmcFirstRead, ROUTER_DIR, testWriteShare, ledgerYield, checkYield } from '../lib/router-binding.mjs';
import { FIRST_READ_PER_CALL_LANGUAGES, FIRST_READ_PER_CALL_BY_LANGUAGE, CORRECT_LANGUAGES } from '../batch/cli-ocr-lane.mjs';
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
      served.push(...servedByFirstRead({ languages: codes(flag('languages')), correct: codes(flag('correct')) || [], perCall: Number(flag('per-call') || 1), perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES, perCallByLanguage: FIRST_READ_PER_CALL_BY_LANGUAGE }));
    } else if (/\slatin-first\s+--/.test(line)) {
      // one pool's run in order (cli-ocr-lane.mjs latinFirstSteps): the Latin re-read at 4 a call, the German/French correction
      served.push(...servedByReread({ languages: ['Latin'], perCall: 4 }), ...servedByCorrect({ languages: CORRECT_LANGUAGES.source.match(/\(([^)]*)\)/)[1].split('|') }));
    } else if (/\scorrect\s+--/.test(line)) {
      const languages = CORRECT_LANGUAGES.source.match(/\(([^)]*)\)/)[1].split('|');
      // --reread-per-call=N (#7853): the same frame re-read, not corrected
      served.push(...(flag('reread-per-call') ? servedByReread({ languages, perCall: Number(flag('reread-per-call')) }) : servedByCorrect({ languages })));
    } else if (/\sarmc\s+--frame=first-read/.test(line)) {
      served.push(...servedByArmcFirstRead({ langs: (flag('langs') || 'la').split(',') }));
    }
  }
  // two accounts run the same lane: one finding per lane and cell
  return [...new Map(served.map((s) => [`${s.lane} ${s.cell} ${s.route}`, s])).values()];
}

/**
 * #8111: each cron line that runs a '-written' route, with the ledger it writes one row a page tried to:
 * { lane, cell, route, ledger, lang, mixed }. first-read: DIR/../first-read-ledger.jsonl (--out=DIR) or --ledger; its
 * rows carry no language, so a line serving two languages is `mixed` (one yield for all of them). arm c:
 * --lane-dir/armc-ledger.jsonl, rows split by `lang`. Exported for the test.
 */
export function ledgersByCrontab(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line) || !line.includes('cli-ocr-lane.mjs')) continue;
    const flag = (n) => line.match(new RegExp(`--${n}=([^\\s"']+)`))?.[1];
    if (/\srun\s+--cohort=/.test(line)) {
      const s = servedByFirstRead({ languages: codes(flag('languages')), correct: codes(flag('correct')) || [], perCall: Number(flag('per-call') || 1), perCallLanguages: FIRST_READ_PER_CALL_LANGUAGES, perCallByLanguage: FIRST_READ_PER_CALL_BY_LANGUAGE });
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

async function main() {
  const text = arg('crontab') ? fs.readFileSync(arg('crontab'), 'utf8')
    : arg('ssh') ? execFileSync('ssh', ['-o', 'ConnectTimeout=10', arg('ssh'), 'crontab -l'], { encoding: 'utf8' })
      : execFileSync('crontab', ['-l'], { encoding: 'utf8' });
  const table = loadCurrentTable();
  const findings = checkBinding(table, servedByCrontab(text));
  let yields = [];
  if (process.argv.includes('--yield')) {
    const read = (f) => {
      try {
        return arg('ssh') ? execFileSync('ssh', ['-o', 'ConnectTimeout=10', arg('ssh'), `cat ${JSON.stringify(f)} 2>/dev/null || true`], { encoding: 'utf8', maxBuffer: 1 << 30 }) || null
          : fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
      } catch { return null; }
    };
    const days = Number(arg('since-days') || 0);
    yields = yieldFindings(text, JSON.parse(fs.readFileSync(path.join(ROUTER_DIR, 'rules.json'), 'utf8')), read, { sinceIso: days ? new Date(Date.now() - days * 864e5).toISOString() : null });
  }
  const servedCells = new Set(findings.map((f) => f.cell));
  const unserved = [...table.rows.values()].filter((r) => /^(keep|switch)\b/.test(r.decision || '') && !/UNTESTED/.test(r.decision)
    && (r.pages_waiting || 0) > 0 && !servedCells.has(r.id));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ table: table.name, findings, yields, unserved: unserved.map((r) => ({ cell: r.id, decision: r.decision, route: r.route, pages_waiting: r.pages_waiting })) }, null, 1));
  } else {
    console.log(`router table: ${table.name} (scripts/eval/estimator/router-table/current.json)`);
    for (const f of findings) console.log(`  ${describeFinding(f)}`);
    console.log(`decided cells with pages waiting that no cron line here serves: ${unserved.length}`);
    for (const r of unserved) console.log(`  ${r.id}: ${r.decision} → ${r.route}, ${r.pages_waiting.toLocaleString('en-US')} pages waiting`);
    if (yields.length) console.log('production yield of the \'-written\' lines (#8111):');
    for (const y of yields) console.log(`  ${describeYield(y)}`);
  }
  process.exit(findings.some((f) => f.status === 'mismatch') || yields.some((y) => y.status === 'yield-low') ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
