#!/usr/bin/env node
// PRIOR ART: none — scripts/eval/hard-hands-6731/score.mjs reports sec/call per arm from its own rows, not from a
// cli-ocr.mjs read directory. Per read dir: calls, failures by class, median seconds per page, and wall seconds per
// page (first start to last finish over pages read) — the rate a full run at the same concurrency would see.
import fs from 'node:fs';
import path from 'node:path';
for (const dir of process.argv.slice(2)) {
  const m = fs.readdirSync(dir).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  const secs = m.map((x) => (new Date(x.finished_at) - new Date(x.started_at)) / 1000).sort((a, b) => a - b);
  const t0 = Math.min(...m.map((x) => +new Date(x.started_at))), t1 = Math.max(...m.map((x) => +new Date(x.finished_at)));
  const cls = {}; for (const x of m) { const k = x.exit === 0 ? 'ok' : (x.error_class || `exit ${x.exit}`); cls[k] = (cls[k] || 0) + 1; }
  const calls = m.reduce((s, x) => s + (x.calls || 1), 0);
  console.log(JSON.stringify({ dir: path.basename(dir), pages: m.length, final_state: cls, calls_last_attempt: calls, median_secs_page: secs[secs.length >> 1], p90_secs_page: secs[Math.floor(secs.length * 0.9)], chars_median: m.map((x) => x.chars).sort((a, b) => a - b)[m.length >> 1], tool_calls_pages: m.filter((x) => (x.tool_calls?.length || x.tool_calls) > 0).length, nudged: m.filter((x) => x.nudged).length, rereads: m.filter((x) => x.rereads).length, wall_hours: Math.round((t1 - t0) / 36e5 * 100) / 100, wall_secs_per_page: Math.round((t1 - t0) / 1000 / m.length) }));
}
