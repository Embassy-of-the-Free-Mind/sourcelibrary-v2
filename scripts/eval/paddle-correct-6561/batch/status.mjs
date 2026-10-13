#!/usr/bin/env node
// PRIOR ART: none — looked in scripts/eval/paddle-correct-6561/ and scripts/eval/paddle-table-pilot-6388/ (their
// runs were short enough to read from the log); this prints the state of run.mjs's checkpoint for the 6-hourly
// progress comment and for a person checking by hand.
// Usage: node status.mjs [scratch-dir]   (default: cwd). Prints markdown.
import fs from 'node:fs';
import { execSync } from 'node:child_process';

const W = process.argv[2] || '.';
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const pages = readJsonl(`${W}/pages.jsonl`), rows = readJsonl(`${W}/out.jsonl`);
const ok = new Set(rows.filter((r) => r.outcome === 'ok').map((r) => r.page_id));
const bad = {}; const fails = new Map();
for (const r of rows) if (r.outcome !== 'ok') { bad[r.outcome] = (bad[r.outcome] || 0) + 1; if (!ok.has(r.page_id)) fails.set(r.page_id, (fails.get(r.page_id) || 0) + (r.outcome === 'limit' ? 0 : 1)); }
const gaveUp = [...fails].filter(([id, n]) => !ok.has(id) && n >= 3).length;
const calls = rows.filter((r) => r.secs != null);
// rate from the last 60 calls' own span (`at` is each call's start), so a restart or a pause does not skew it
const recent = calls.slice(-60);
const span = recent.length > 5 ? (new Date(recent.at(-1).at) - new Date(recent[0].at)) / 3600e3 : 0;
const lastHour = span > 0 ? Math.round((recent.length - 1) / span) : 0;
const left = pages.length - ok.size - gaveUp;
let alive = false; try { alive = execSync('pgrep -fc "[b]atch/run\\.mjs" || true', { encoding: 'utf8' }).trim() !== '0'; } catch { /* not alive */ }
let weekly = '?'; try { weekly = execSync('/root/bin/claude-job.sh where', { encoding: 'utf8', timeout: 60000 }).match(/weekly_pct=(\d+)/)?.[1] ?? '?'; } catch { /* unknown */ }
const flags = rows.filter((r) => r.outcome === 'ok' && r.flags?.length).length;
const layouts = {}; for (const r of rows) if (r.outcome === 'ok') layouts[r.layout] = (layouts[r.layout] || 0) + 1;
console.log([
  `- Corrected: **${ok.size} of ${pages.length}** pages (${new Set(rows.filter((r) => r.outcome === 'ok').map((r) => r.book_id)).size} books). Left: ${left}. Gave up after 3 tries: ${gaveUp}.`,
  `- Calls: ${calls.length} Opus calls, about ${lastHour} an hour now${lastHour && left ? `, so about ${Math.ceil(left / lastHour)} h to go` : ''}.`,
  `- Replies not accepted: ${Object.keys(bad).length ? Object.entries(bad).map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}.`,
  `- Layout Opus reported: ${Object.entries(layouts).map(([k, v]) => `${k} ${v}`).join(', ')}. Guard flag "duplicated reply" (kept, for the reviewer): ${flags}.`,
  `- Runner ${alive ? 'running' : fs.existsSync(`${W}/runner.done`) ? 'finished' : 'NOT running'}. Account weekly use: ${weekly}%.`,
].join('\n'));
