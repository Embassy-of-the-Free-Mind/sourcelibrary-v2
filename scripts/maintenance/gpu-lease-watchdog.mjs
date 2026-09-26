#!/usr/bin/env node
/**
 * gpu-lease-watchdog.mjs — stop rented Scaleway GPUs whose lease has run out (#4909).
 *
 * PRIOR ART: scripts/maintenance/archiving-watchdog.mjs — watches Mongo pipeline state, not a
 * cloud provider's instances; scripts/workers/pipeline-health-alert.mjs — its Resend email
 * pattern is reused here (same from/to, same cooldown idea). Nothing in the repo talks to
 * the Scaleway API; the benchmark sessions used the `scw` CLI by hand, which is how an L4
 * sat idle for 43 h and then 5 h more after an in-guest poweroff (#4735).
 *
 * Runs on Hetzner (a host that stays up), every 10 minutes, with the Scaleway secret key in
 * the environment. A guest-side `shutdown -h` leaves a Scaleway instance "stopped in place"
 * and billed; only the provider API's `poweroff` action ends billing, so that is what this
 * calls — and then re-reads the state until it is `stopped`, because an unconfirmed stop is
 * not a stop.
 *
 * The lease is a TAG on the instance:   lease-until=2026-09-20T18:00:00Z   owner=4735
 * Set one at creation (`scw instance server create ... tags.0=lease-until=... tags.1=owner=...`)
 * or afterwards with this script: --lease <server-id> --zone fr-par-2 --hours 6 --owner 4735
 * Extending a lease is an explicit act, so continuing to spend is a decision, never a default.
 *
 * Per pass, for every RUNNING instance of a GPU type (or any instance carrying a lease tag):
 *   lease expired                    → poweroff via API (volumes and data are kept), confirm, email
 *   no lease tag                     → email (once per 6 h per server); never stopped — another
 *                                      project's training run is legitimate, the nag is the cost
 *                                      of not tagging
 *   lease ok + `progress=` tag       → IDLE CHECK: no new output for 30 min (after a 20-min
 *                                      start-up grace) → poweroff via API, confirm, email.
 *                                      A live lease no longer protects an idle GPU (2026-09-26:
 *                                      September's GPUs billed ~12x their busy-rate cost).
 *   lease ok, no progress tag        → one log line (the on-box watcher, scripts/gpu/
 *                                      idle-poweroff.sh, is then the only idle guard)
 * --weekly adds a section on stopped/archived instances that still hold block volumes
 * (storage bills while compute does not), with an approximate monthly cost, so leftovers
 * get deleted deliberately.
 *
 * Its own failure looks different from "nothing running": every pass writes a heartbeat file
 * (STATE_DIR/heartbeat) only after the API answered, an API failure exits 1 and emails
 * (6 h cooldown), and a stop that could not be confirmed exits 2 and emails.
 *
 * Usage (dry run lists and emails nothing):
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/gpu-lease-watchdog.mjs
 *   ... --apply            # stop expired leases, send emails
 *   ... --apply --weekly   # plus the leftover-volume section
 *   ... --lease <id> --zone <zone> --hours <n> --owner <issue> [--progress mongo:<ocr.source>]
 * Idle rule and tag grammar: scripts/lib/gpu-idle.mjs (GPU_IDLE_MINUTES, GPU_GRACE_MINUTES override).
 * Env: SCALEWAY_SECRET_KEY (required), RESEND_API_KEY + ALERT_EMAIL (email), GPU_WATCHDOG_STATE_DIR.
 */
import fs from 'node:fs';
import { idleDecision, parseProgressTag } from '../lib/gpu-idle.mjs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const APPLY = flag('apply');
const WEEKLY = flag('weekly');

const TOKEN = process.env.SCALEWAY_SECRET_KEY;
if (!TOKEN) { console.error('SCALEWAY_SECRET_KEY is not set'); process.exit(1); }
const ZONES = (process.env.SCALEWAY_ZONES || 'fr-par-1,fr-par-2,fr-par-3,nl-ams-1,nl-ams-2,nl-ams-3,pl-waw-1,pl-waw-2,pl-waw-3').split(',');
// Commercial types that carry a GPU. Anything with a lease tag is watched regardless.
const GPU_TYPE = /^(L4|L40S|H100|A100|B200|GPU|RENDER)/i;
const STATE_DIR = process.env.GPU_WATCHDOG_STATE_DIR || path.join(os.homedir(), '.gpu-lease-watchdog');
const NAG_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STOP_CONFIRM_MS = 4 * 60 * 1000;
// Scaleway Block Storage 5K IOPS list price, €/GB/month — approximate, for the weekly nudge only.
const SBS_EUR_PER_GB_MONTH = 0.08;

const API = 'https://api.scaleway.com';
async function scw(method, url, body) {
  const res = await fetch(API + url, { method, headers: { 'X-Auth-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

fs.mkdirSync(STATE_DIR, { recursive: true });
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { nagged: {}, api_failure_emailed_at: null };
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
const now = new Date();

async function email(subject, lines) {
  if (!APPLY) { console.log(`  [dry-run] would email: ${subject}`); return; }
  if (!process.env.RESEND_API_KEY) { console.log(`  (no RESEND_API_KEY; not emailed) ${subject}`); return; }
  const { Resend } = await import('resend');
  await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'Source Library <noreply@sourcelibrary.org>',
    to: process.env.ALERT_EMAIL || 'derek@sourcelibrary.org',
    subject: `[GPU] ${subject}`,
    text: [`${now.toISOString()} — gpu-lease-watchdog on ${os.hostname()}`, '', ...lines].join('\n'),
  });
  console.log(`  emailed: ${subject}`);
}

const parseTags = tags => Object.fromEntries((tags || []).filter(t => t.includes('=')).map(t => { const i = t.indexOf('='); return [t.slice(0, i), t.slice(i + 1)]; }));
const hours = ms => (ms / 3.6e6).toFixed(1);

// ── --lease: set or extend a lease on one server ─────────────────────────────
if (opt('lease')) {
  const id = opt('lease'), zone = opt('zone'), h = Number(opt('hours')), owner = opt('owner');
  if (!zone || !h || !owner) { console.error('--lease needs --zone <zone> --hours <n> --owner <issue>'); process.exit(1); }
  const s = await scw('GET', `/instance/v1/zones/${zone}/servers/${id}`).then(r => r.server);
  const until = new Date(Date.now() + h * 3.6e6).toISOString();
  const progress = opt('progress');
  if (progress && parseProgressTag(progress)?.kind !== 'mongo') { console.error('--progress must look like mongo:<ocr.source>, e.g. mongo:bdrc'); process.exit(1); }
  const keep = (s.tags || []).filter(t => !/^(lease-until|owner)=/.test(t) && !(progress && /^progress=/.test(t)));
  const tags = [...keep, `lease-until=${until}`, `owner=${owner}`, ...(progress ? [`progress=${progress}`] : [])];
  await scw('PATCH', `/instance/v1/zones/${zone}/servers/${id}`, { tags });
  console.log(`${s.name} (${s.commercial_type}, ${zone}): lease until ${until}, owner ${owner}${progress ? `, idle-stop on ${progress}` : ' (no progress tag: lease-only)'}`);
  process.exit(0);
}

// ── the pass ─────────────────────────────────────────────────────────────────
let exitCode = 0;
const servers = [];
try {
  for (const zone of ZONES) {
    const r = await scw('GET', `/instance/v1/zones/${zone}/servers?per_page=100`);
    for (const s of r.servers || []) servers.push({ ...s, zone });
  }
} catch (e) {
  console.error(`Scaleway API failed: ${e.message}`);
  const last = state.api_failure_emailed_at ? Date.now() - new Date(state.api_failure_emailed_at).getTime() : Infinity;
  if (last > NAG_COOLDOWN_MS) {
    await email('watchdog cannot reach the Scaleway API', [e.message, 'Leases are NOT being enforced until this clears.']);
    state.api_failure_emailed_at = now.toISOString(); saveState();
  }
  process.exit(1);
}
// The heartbeat means "a pass completed its listing" — written only after the API answered.
fs.writeFileSync(path.join(STATE_DIR, 'heartbeat'), now.toISOString() + '\n');

const watched = servers.filter(s => GPU_TYPE.test(s.commercial_type) || parseTags(s.tags)['lease-until']);
console.log(`${now.toISOString()} ${APPLY ? 'APPLY' : 'DRY RUN'} · ${servers.length} instances in ${ZONES.length} zones · ${watched.length} watched`);

/** Power off through the provider API and confirm; returns true when confirmed stopped. */
async function poweroff(s, label, why) {
  if (!APPLY) { console.log(`  [dry-run] would poweroff via API (${why})`); return false; }
  try {
    await scw('POST', `/instance/v1/zones/${s.zone}/servers/${s.id}/action`, { action: 'poweroff' });
    let final = null;
    const deadline = Date.now() + STOP_CONFIRM_MS;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 10000));
      final = (await scw('GET', `/instance/v1/zones/${s.zone}/servers/${s.id}`)).server.state;
      if (final === 'stopped') break;
    }
    if (final === 'stopped') {
      console.log(`  stopped  ${label} · confirmed`);
      await email(`stopped: ${s.name} (${why})`, [label, `${why}; poweroff confirmed, state=stopped.`, 'Volumes are kept. Delete them when the outputs are safe.']);
      return true;
    }
    exitCode = 2;
    console.log(`  UNCONFIRMED ${label} · state after ${STOP_CONFIRM_MS / 60000} min: ${final}`);
    await email(`STOP NOT CONFIRMED: ${s.name}`, [label, `poweroff (${why}) was requested but the state is "${final}" after ${STOP_CONFIRM_MS / 60000} min. It may still be billing.`, `Check: scw instance server get ${s.id} zone=${s.zone}`]);
  } catch (e) {
    exitCode = 2;
    console.log(`  FAILED   ${label} · ${e.message}`);
    await email(`could not stop ${s.name}`, [label, e.message]);
  }
  return false;
}

// Newest output for a `progress=mongo:<ocr.source>` tag, inside the idle window.
let mongoDb = null;
async function newestOutput(progress, windowMin) {
  if (!mongoDb) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
    await client.connect();
    mongoDb = { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
  }
  const since = new Date(Date.now() - windowMin * 60000);
  const doc = await mongoDb.db.collection('pages').findOne(
    { 'ocr.updated_at': { $gte: since }, 'ocr.source': progress.source },
    { sort: { 'ocr.updated_at': -1 }, projection: { _id: 0, 'ocr.updated_at': 1 }, maxTimeMS: 20000 });
  return doc?.ocr?.updated_at ? new Date(doc.ocr.updated_at) : null;
}
const IDLE_MIN = Number(process.env.GPU_IDLE_MINUTES) || undefined;
const GRACE_MIN = Number(process.env.GPU_GRACE_MINUTES) || undefined;

for (const s of watched) {
  const tags = parseTags(s.tags);
  const label = `${s.name} (${s.commercial_type}, ${s.zone}, ${s.id})`;
  if (s.state !== 'running') { console.log(`  ${s.state.padEnd(8)} ${label}`); continue; }
  const stateAge = hours(Date.now() - new Date(s.modification_date).getTime());
  if (!tags['lease-until']) {
    console.log(`  RUNNING  ${label} · NO LEASE TAG · state age ${stateAge} h`);
    const last = state.nagged[s.id] ? Date.now() - new Date(state.nagged[s.id]).getTime() : Infinity;
    if (last > NAG_COOLDOWN_MS) {
      await email(`untagged GPU running: ${s.name}`, [
        label, `running, no lease-until tag, state age ${stateAge} h.`, '',
        `Give it a lease:  node scripts/maintenance/gpu-lease-watchdog.mjs --lease ${s.id} --zone ${s.zone} --hours 6 --owner <issue>`,
        `Or stop it:       scw instance server stop ${s.id} zone=${s.zone}`,
      ]);
      state.nagged[s.id] = now.toISOString(); saveState();
    }
    continue;
  }
  const until = new Date(tags['lease-until']);
  if (Number.isNaN(until.getTime())) { console.log(`  RUNNING  ${label} · UNPARSEABLE lease-until "${tags['lease-until']}" — treated as untagged`); continue; }
  if (until > now) {
    const progress = parseProgressTag(tags.progress);
    if (!progress) { console.log(`  ok       ${label} · lease ${hours(until - now)} h left · owner ${tags.owner || '?'} · no progress tag`); continue; }
    if (progress.kind !== 'mongo') { console.log(`  ok       ${label} · lease ${hours(until - now)} h left · UNREADABLE progress tag "${progress.raw}" — idle check skipped`); continue; }
    let lastOutputAt;
    try { lastOutputAt = await newestOutput(progress, (IDLE_MIN || 30) + 5); }
    catch (e) {
      // An unreadable probe must not kill real work: keep running, say so. The lease still bounds it.
      console.log(`  ok       ${label} · idle probe FAILED (${e.message}) — kept running until lease end`);
      continue;
    }
    const d = idleDecision({ now, runningSince: new Date(s.modification_date), lastOutputAt, idleMinutes: IDLE_MIN, graceMinutes: GRACE_MIN });
    if (d.action === 'keep') { console.log(`  ok       ${label} · lease ${hours(until - now)} h left · ${progress.source}: ${d.reason}`); continue; }
    console.log(`  IDLE     ${label} · ${progress.source}: ${d.reason} · owner ${tags.owner || '?'}`);
    await poweroff(s, label, `idle — ${d.reason} (progress ${progress.source}, owner ${tags.owner || '?'})`);
    continue;
  }

  console.log(`  EXPIRED  ${label} · lease ended ${hours(now - until)} h ago · owner ${tags.owner || '?'}`);
  await poweroff(s, label, `lease expired ${until.toISOString()} (owner ${tags.owner || '?'})`);
}
if (mongoDb) await mongoDb.client.close().catch(() => {});

// ── weekly: storage that bills while compute does not ────────────────────────
if (WEEKLY) {
  const lines = [];
  for (const zone of ZONES) {
    let vols = [];
    try { vols = (await scw('GET', `/block/v1alpha1/zones/${zone}/volumes?per_page=100`)).volumes || []; } catch (e) { lines.push(`${zone}: block API failed — ${e.message}`); continue; }
    for (const v of vols) {
      const gb = Math.round((v.size || 0) / 1e9);
      const ref = (v.references || [])[0];
      const holder = ref ? servers.find(s => s.id === ref.product_resource_id) : null;
      if (holder && holder.state === 'running') continue;
      lines.push(`${zone} · ${v.name} · ${gb} GB · ≈ €${(gb * SBS_EUR_PER_GB_MONTH).toFixed(0)}/month · ${holder ? `attached to ${holder.name} (${holder.state})` : 'unattached'} · created ${String(v.created_at).slice(0, 10)}`);
    }
  }
  console.log(lines.length ? `Volumes billing without a running server:\n  ${lines.join('\n  ')}` : 'No idle volumes.');
  if (lines.length) await email(`${lines.length} idle volume(s) still billing`, ['Volumes on stopped or archived instances, or unattached:', '', ...lines, '', 'Delete deliberately: scw block volume delete <id> zone=<zone>  (after the outputs are safe).']);
}

process.exit(exitCode);
