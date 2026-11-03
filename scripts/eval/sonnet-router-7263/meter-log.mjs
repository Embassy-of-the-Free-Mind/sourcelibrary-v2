#!/usr/bin/env node
// PRIOR ART: scripts/eval/lane-judge-sampler.mjs claudeMeter (the climits-then-usage-endpoint reading, imported); it
// prefers the 5-minute integer climits file, which carries no 5-hour figure on this login, and it reads once. This logs
// the usage endpoint every minute beside it, so a meter delta can be set against the background rate of other jobs.
/** Append one meter reading a minute to --out=FILE until killed. Never refreshes the token. Stdout: nothing. */
import fs from 'node:fs';
import { claudeMeter } from '../lane-judge-sampler.mjs';
import * as limits from '../../lib/model-limits.mjs';
const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
if (!out) { console.error('--out=FILE'); process.exit(2); }
for (;;) {
  const usageOnly = { ...limits, claudeUsage: () => null };   // skip climits: the endpoint carries the 5-hour figure
  const u = await claudeMeter(usageOnly).catch((e) => ({ error: e.message }));
  let c = null; try { c = limits.claudeUsage(); } catch { /* none */ }
  fs.appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), usage: u, climits: c && { weekly: c.weekly, session: c.session } }) + '\n');
  await new Promise((r) => setTimeout(r, 60e3));
}
