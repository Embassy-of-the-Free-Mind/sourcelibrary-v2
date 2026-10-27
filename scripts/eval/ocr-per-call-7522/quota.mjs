#!/usr/bin/env node
// PRIOR ART: scripts/eval/experiments/2026-10-27-agy-quota-pool-6740.md read `agy -p "/quota"` by hand; nothing in the
// repo appends readings with the other callers' calls between them, which is what a per-arm delta needs.
/**
 * #7522: one `/quota` reading of an agy account, appended to FILE as a JSON line with the calls every OTHER job made
 * on this box since the previous reading (/root/agy-quota/jobs/<UTC date>.csv, agy-cli.mjs's ledger), so a fraction
 * delta can be read against what else spent the pool in the same window.
 *
 *   node scripts/eval/ocr-per-call-7522/quota.mjs --file=F --label=A1:before [--job=ocr-percall-7522]
 * AGY_HOME selects the account, as for agy itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const FILE = arg('file'), LABEL = arg('label'), JOB = arg('job') || 'ocr-percall-7522';
const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', timeout: 120_000 });
let buckets = null;
try { buckets = JSON.parse(r.stdout).command.data.groups.flatMap((g) => g.buckets.map((b) => ({ group: g.name, id: b.id, remaining_fraction: b.remaining_fraction, reset_time: b.reset_time }))); } catch { /* recorded as null */ }
const prev = fs.existsSync(FILE) ? fs.readFileSync(FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).pop() : null;
const now = new Date();
const since = prev ? new Date(prev.at) : now;
const ledger = (d) => { try { return fs.readFileSync(path.join('/root/agy-quota/jobs', `${d.toISOString().slice(0, 10)}.csv`), 'utf8').split('\n').filter(Boolean); } catch { return []; } };
const rows = [...new Set([since, now].map((d) => d.toISOString().slice(0, 10)))].flatMap((d) => ledger(new Date(d)));
const window = rows.map((l) => l.split(',')).filter(([at]) => new Date(at) > since && new Date(at) <= now);
const others = {};
for (const [, job, model] of window) if (!String(job).startsWith(JOB)) others[`${job}|${model}`] = (others[`${job}|${model}`] || 0) + 1;
const row = { at: now.toISOString(), label: LABEL, account: process.env.AGY_HOME || 'default', buckets, own_calls: window.filter(([, job]) => String(job).startsWith(JOB)).length, other_calls: window.length - window.filter(([, job]) => String(job).startsWith(JOB)).length, others };
fs.appendFileSync(FILE, JSON.stringify(row) + '\n');
console.log(JSON.stringify({ label: LABEL, buckets: buckets?.map((b) => `${b.group}/${b.id}=${b.remaining_fraction?.toFixed(5)}`), own: row.own_calls, other: row.other_calls }));
