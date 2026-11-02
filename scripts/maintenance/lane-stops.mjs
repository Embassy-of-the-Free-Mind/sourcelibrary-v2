#!/usr/bin/env node
// PRIOR ART: scripts/lib/lane-stop.mjs (the helper this drives; no CLI of its own), scripts/maintenance/
// pipeline-now-push.mjs (reports `stopped` for the Siku lane only, pages nobody). (#7912)
//
// A lane STOP with an owner: a ticket, a registry row, and one ntfy page a day while it stands.
//
//   stop      write a STOP and open its ticket — the way a PERSON stops a lane (instead of `touch …/STOP`)
//   register  give an existing STOP file (written before #7912, or by hand) a ticket and a registry row;
//             the file is not touched
//   check     daily: page ntfy sourcelibrary-uptime once per standing STOP; mark removed ones released
//   list      print the registry
//
//   node scripts/maintenance/lane-stops.mjs stop --lane=<name> --stop=<path> --reason="…" [--kind=containment|quality|ops]
//        [--issue=<lane issue>] [--evidence="label|url|note"]… [--pages-waiting=N] [--release="<cmd>"] [--by=<who>] [--dry-run]
//   node scripts/maintenance/lane-stops.mjs register --lane=… --stop=… --reason="…" [same flags]
//   node scripts/maintenance/lane-stops.mjs check [--dry-run]
//   node scripts/maintenance/lane-stops.mjs list
// Registry: $LANE_STOP_REGISTRY or /var/lib/sourcelibrary/lane-stops.json (--registry=<path> overrides).
// Proposed cron (not installed; each box that runs a lane):
//   15 8 * * * cd /root/sourcelibrary && node scripts/maintenance/lane-stops.mjs check >> /var/log/sourcelibrary/lane-stops.log 2>&1
// No Mongo, no paid calls: gh and ntfy only. Releasing a STOP is never done here.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { writeLaneStop, checkStops, readRegistry, REGISTRY_PATH } from '../lib/lane-stop.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const vals = (n) => argv.filter((a) => a.startsWith(`--${n}=`)).map((a) => a.split('=').slice(1).join('='));

/** "label|url|note" → { label, url, note }. */
export function parseEvidence(s) {
  const [label, url, ...note] = s.split('|');
  return { label: label.trim(), url: url?.trim() || null, note: note.join('|').trim() || null };
}

async function main() {
  const mode = argv[0];
  const registryPath = val('registry') ?? REGISTRY_PATH;
  const dryRun = flag('dry-run');
  if (mode === 'list') { console.log(JSON.stringify(readRegistry(registryPath), null, 1)); return; }
  if (mode === 'check') {
    const r = await checkStops({ registryPath, dryRun });
    for (const a of r.actions) console.log(a);
    if (dryRun) for (const p of r.pages) console.log(JSON.stringify(p));
    console.log(`[lane-stops] ${new Date().toISOString()} ${r.pages.length} page(s), ${r.released.length} released${dryRun ? ' (dry run)' : ''}`);
    return;
  }
  if (mode !== 'stop' && mode !== 'register') { console.error('usage: lane-stops.mjs stop|register|check|list [--dry-run] (see header)'); process.exit(2); }
  const pw = val('pages-waiting');
  const r = await writeLaneStop({
    lane: val('lane'), stopPath: val('stop'), reason: val('reason'), kind: val('kind') ?? 'containment',
    laneIssue: val('issue') ? Number(val('issue')) : null, evidence: vals('evidence').map(parseEvidence),
    pagesWaiting: pw != null ? Number(pw) : null, pagesWaitingAt: val('pages-waiting-at'),
    releaseCommand: val('release'), by: val('by') ?? process.env.USER ?? null, stoppedAt: val('stopped-at'),
    writeFile: mode === 'stop', dryRun, registryPath,
  });
  for (const a of r.actions) console.log(a);
  if (dryRun) console.log(`\n--- ticket (dry run) ---\n${r.title}\n\n${r.body}\n\n--- registry row ---\n${JSON.stringify(r.row, null, 1)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error(`[lane-stops] FAILED: ${e.message}`); process.exit(1); });
}
