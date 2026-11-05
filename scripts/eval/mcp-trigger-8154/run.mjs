#!/usr/bin/env node
/**
 * Does Claude reach for the connector when it should, and leave it alone when it
 * should not? Runs each question once per arm through `claude -p` on the
 * subscription, in an empty directory, with the web and file tools denied.
 *
 * Decision rule, fixed before the run: ship the new instructions if history
 * questions trigger at least 5 more times of 30 (net, paired) and modern
 * questions at most 1 more of 10.
 *
 * Usage: node scripts/eval/mcp-trigger-8154/run.mjs <output-dir>
 *
 * PRIOR ART: scripts/eval/mcp-latency-probe.mjs — it measures server speed, not model behaviour; no script under scripts/eval measures whether a tool is chosen (searched INDEX.md for mcp, trigger, tool).
 */
import { spawn } from 'child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(process.argv[2] || join(HERE, 'out'));
const EMPTY = join(OUT, 'empty');
mkdirSync(EMPTY, { recursive: true });
const QUESTIONS = JSON.parse(readFileSync(join(HERE, 'questions.json'), 'utf8'));
const DENY = 'Bash,Edit,Write,Read,Glob,Grep,WebSearch,WebFetch,Agent,Task,TodoWrite,NotebookEdit';
const CONCURRENCY = 3;

const res = await fetch('https://sourcelibrary.org/api/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-06-18',
    'user-agent': 'sl-mcp-trigger-eval/1 (#8154)',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
});
const toolsFile = join(OUT, 'tools.json');
writeFileSync(toolsFile, JSON.stringify((await res.json()).result.tools));

const jobs = [];
for (const arm of ['old', 'new']) {
  writeFileSync(join(OUT, `mcp-${arm}.json`), JSON.stringify({
    mcpServers: {
      'source-library': { command: 'node', args: [join(HERE, 'shim.mjs'), toolsFile, join(HERE, `${arm}.txt`)] },
    },
  }));
  for (const [group, list] of Object.entries(QUESTIONS)) {
    list.forEach((q, i) => jobs.push({ arm, group, i, q }));
  }
}
jobs.sort((a, b) => a.i - b.i || a.group.localeCompare(b.group));

const runOne = (job) => new Promise((done) => {
  const child = spawn('claude', [
    '-p', job.q, '--model', 'sonnet', '--output-format', 'stream-json', '--verbose', '--max-turns', '4',
    '--strict-mcp-config', '--mcp-config', join(OUT, `mcp-${job.arm}.json`),
    '--setting-sources', '', '--disallowedTools', DENY, '--permission-mode', 'bypassPermissions',
  ], { cwd: EMPTY, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const timer = setTimeout(() => child.kill(), 180_000);
  child.on('close', (code) => {
    clearTimeout(timer);
    const names = [...out.matchAll(/"type":"tool_use","id":"[^"]*","name":"([^"]+)"/g)].map((m) => m[1]);
    const ours = names.filter((n) => n.startsWith('mcp__source-library__'));
    const row = {
      ...job, code, triggered: ours.length > 0, first: ours[0] || null,
      toolSearch: names.includes('ToolSearch'),
      serverUp: /"name":"source-library","status":"connected"/.test(out),
      len: out.length,
    };
    appendFileSync(join(OUT, 'results.jsonl'), `${JSON.stringify(row)}\n`);
    console.log(job.arm, job.group, job.i, row.triggered, row.first, code);
    done();
  });
});

let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < jobs.length) await runOne(jobs[next++]);
}));
console.log('DONE');
