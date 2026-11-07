#!/usr/bin/env node
// Transport only (#8142): `agy --mode plan` can print a complete SUCCESS envelope and then never exit, and run() in
// lib.mjs then SIGKILLs it at 340 s and discards a good reply. Put this first on PATH as `agy`: same args, env and
// prompt, unchanged reply; it returns once the envelope is complete and kills the whole process group, which also
// stops the orphans a SIGKILL of the guard's shell leaves behind. Frozen files stay byte-identical.
// PRIOR ART: scripts/lib/agy-cli.mjs agyCall has its own timeout but no early return on a finished envelope, and
// lib.mjs (frozen) starts the bare command from PATH; scripts/workers/agy-guard.sh is the guard this still goes through.
import { spawn } from 'node:child_process';

const child = spawn('/usr/local/bin/agy', process.argv.slice(2), { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
let out = '', settled = false;
const finish = (code) => {
  if (settled) return;
  settled = true;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  process.stdout.write(out, () => process.exit(code));
};
const complete = () => { try { const j = JSON.parse(out); return j && j.status === 'SUCCESS' && !!j.response; } catch { return false; } };
child.stdout.on('data', (d) => { out += d; if (complete()) finish(0); });
child.on('close', (code) => finish(code ?? 1));
setTimeout(() => finish(1), 330_000); // inside run()'s 340 s, so the group is never orphaned
