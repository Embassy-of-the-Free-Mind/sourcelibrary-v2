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
 * Running Scaleway instances of a NON-GPU type with no lease-until tag and no role=permanent tag
 * are REPORTED (email digest once per 6 h, /admin/work) and never stopped (#5736).
 *
 * --hetzner: a separate hourly pass over the Hetzner Cloud account (HCLOUD_TOKEN, read-only is
 * enough). Leases are server LABELS (lease-until, owner, role=permanent — scripts/lib/infra-lease.mjs).
 * No lease / expired lease / leased but CPU < 5 % over 24 h → FLAG: one email digest per 6 h and
 * the /admin/work board (ops_reports work-board:infra-hetzner), each with €/month, age and CPU.
 * It NEVER powers off or deletes a Hetzner server: a stopped Hetzner server still bills, and
 * deletion destroys data — that is Derek's call. A missing token or a failed API call is flagged
 * the same way: an unreadable provider is not an empty one.
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
 *   ... --hetzner [--apply]  # the Hetzner pass (flag only); env HCLOUD_TOKEN from /root/.hcloud.env
 * Idle rule and tag grammar: scripts/lib/gpu-idle.mjs (GPU_IDLE_MINUTES, GPU_GRACE_MINUTES override).
 * Env: SCALEWAY_SECRET_KEY (required), RESEND_API_KEY + ALERT_EMAIL (email), GPU_WATCHDOG_STATE_DIR.
 */
import fs from 'node:fs';
import { idleDecision, parseProgressTag } from '../lib/gpu-idle.mjs';
import { leaseLabels, leaseVerdict, hetznerMonthlyEur, scalewayMonthlyEur, meanCpuPct, flagLine, IDLE_WINDOW_H } from '../lib/infra-lease.mjs';
import path from 'node:path';
import os from 'node:os';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const APPLY = flag('apply');
const WEEKLY = flag('weekly');
const HETZNER = flag('hetzner');
const ZONES = (process.env.SCALEWAY_ZONES || 'fr-par-1,fr-par-2,fr-par-3,nl-ams-1,nl-ams-2,nl-ams-3,pl-waw-1,pl-waw-2,pl-waw-3').split(',');
// Commercial types that carry a GPU. Anything with a lease tag is watched regardless.
const GPU_TYPE = /^(L4|L40S|H100|A100|B200|GPU|RENDER)/i;
const STATE_DIR = process.env.GPU_WATCHDOG_STATE_DIR || path.join(os.homedir(), '.gpu-lease-watchdog');
const NAG_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const STOP_CONFIRM_MS = 4 * 60 * 1000;
// Scaleway Block Storage 5K IOPS list price, €/GB/month — approximate, for the weekly nudge only.
const SBS_EUR_PER_GB_MONTH = 0.08;

const TOKEN = process.env.SCALEWAY_SECRET_KEY;
const API = 'https://api.scaleway.com';
async function scw(method, url, body) {
  const res = await fetch(API + url, { method, headers: { 'X-Auth-Token': TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

fs.mkdirSync(STATE_DIR, { recursive: true });
// The Hetzner pass runs from its own cron line; its own state file keeps the two passes from clobbering each other.
const STATE_FILE = path.join(STATE_DIR, HETZNER ? 'hetzner-state.json' : 'state.json');
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : { nagged: {}, api_failure_emailed_at: null };
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
const now = new Date();

async function email(subject, lines, tag = HETZNER ? '[INFRA]' : '[GPU]') {
  if (!APPLY) { console.log(`  [dry-run] would email: ${subject}`); return; }
  if (!process.env.RESEND_API_KEY) { console.log(`  (no RESEND_API_KEY; not emailed) ${subject}`); return; }
  const { Resend } = await import('resend');
  await new Resend(process.env.RESEND_API_KEY).emails.send({
    from: 'Source Library <noreply@sourcelibrary.org>',
    to: process.env.ALERT_EMAIL || 'derek@sourcelibrary.org',
    subject: `${tag} ${subject}`,
    text: [`${now.toISOString()} — gpu-lease-watchdog on ${os.hostname()}`, '', ...lines].join('\n'),
  });
  console.log(`  emailed: ${subject}`);
}

const parseTags = leaseLabels;
const hours = ms => (ms / 3.6e6).toFixed(1);

let mongoDb = null;
async function getMongo() {
  if (!mongoDb) {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    const { MongoClient } = await import('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
    await client.connect();
    mongoDb = { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
  }
  return mongoDb.db;
}

/**
 * Flags onto /admin/work (src/lib/work-board.ts reads `flags` on any work-board document). One
 * document per provider, replaced every pass, so a cleared flag disappears. The page is the only
 * reader: this write actuates nothing.
 */
async function pushBoard(box, flags, staleAfterMin) {
  const doc = { type: 'work-board', box, generated_at: now, generated_by: 'scripts/maintenance/gpu-lease-watchdog.mjs', host: os.hostname(), stale_after_min: staleAfterMin, jobs: [], chains: [], flags };
  if (!APPLY) { console.log(`  [dry-run] would push ${flags.length} flag(s) to ops_reports work-board:${box}`); return; }
  try {
    await (await getMongo()).collection('ops_reports').replaceOne({ _id: `work-board:${box}` }, doc, { upsert: true });
    console.log(`  board: ${flags.length} flag(s) → work-board:${box}`);
  } catch (e) {
    exitCode = exitCode || 1;
    console.log(`  board push FAILED: ${e.message}`);
  }
}

/** One digest email for every flag whose 6 h cooldown has passed. */
async function nagDigest(flags, subjectTail, footer) {
  const due = flags.filter(f => { const at = state.nagged[`${f.provider}:${f.id}`]; return !at || Date.now() - new Date(at).getTime() > NAG_COOLDOWN_MS; });
  if (!due.length) return;
  const total = flags.reduce((a, f) => a + (f.eur_month || 0), 0);
  await email(`${flags.length} ${subjectTail} · ≈ €${total.toFixed(0)}/month`, [...flags.map(flagLine), '', ...footer]);
  if (APPLY) { for (const f of due) state.nagged[`${f.provider}:${f.id}`] = now.toISOString(); saveState(); }
}

const ownerIssue = o => (/^#?\d{3,6}$/.test(String(o || '')) ? Number(String(o).replace('#', '')) : null);

let exitCode = 0;

// ── --hetzner: the flag-only pass over the Hetzner Cloud account ─────────────
if (HETZNER) {
  const HAPI = 'https://api.hetzner.cloud/v1';
  const HTOKEN = process.env.HCLOUD_TOKEN;
  const hcloud = async url => {
    const res = await fetch(HAPI + url, { headers: { Authorization: `Bearer ${HTOKEN}` } });
    if (!res.ok) throw new Error(`GET ${url.split('?')[0]} → ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };
  const unwatched = async why => {
    console.error(`Hetzner NOT watched: ${why}`);
    const last = state.api_failure_emailed_at ? Date.now() - new Date(state.api_failure_emailed_at).getTime() : Infinity;
    if (last > NAG_COOLDOWN_MS) {
      await email('watchdog cannot read the Hetzner account', [why, 'Hetzner servers are NOT being watched until this clears.',
        'Fix: create a READ-ONLY Hetzner Cloud API token (console.hetzner.cloud → project → Security → API tokens),',
        'then on the Hetzner box: echo HCLOUD_TOKEN=<token> > /root/.hcloud.env && chmod 600 /root/.hcloud.env']);
      if (APPLY) { state.api_failure_emailed_at = now.toISOString(); saveState(); }
    }
    await pushBoard('infra-hetzner', [{ provider: 'hetzner', id: 'account', name: 'Hetzner account', type: '—', location: null, status: 'unreadable', eur_month: null, age_days: null, cpu_24h: null, owner: '5736', issue: 5736, kind: 'unwatched', reason: why }], 150);
    if (mongoDb) await mongoDb.client.close().catch(() => {});
    process.exit(1);
  };
  if (!HTOKEN) await unwatched('HCLOUD_TOKEN is not set — create a read-only token and store it in /root/.hcloud.env');

  let servers = [];
  try {
    for (let page = 1; page < 50; page++) {
      const r = await hcloud(`/servers?per_page=50&page=${page}`);
      servers.push(...(r.servers || []));
      if (!r.meta?.pagination?.next_page) break;
    }
  } catch (e) { await unwatched(`Hetzner API failed: ${e.message}`); }
  fs.writeFileSync(path.join(STATE_DIR, 'heartbeat-hetzner'), now.toISOString() + '\n');
  console.log(`${now.toISOString()} ${APPLY ? 'APPLY' : 'DRY RUN'} · hetzner · ${servers.length} servers (flag only — never stopped)`);

  const flags = [];
  for (const s of servers) {
    const labels = leaseLabels(s.labels);
    const running = s.status === 'running';
    let cpu = null;
    if (running && labels.role !== 'permanent') {
      const end = now.toISOString(), start = new Date(now - IDLE_WINDOW_H * 3.6e6).toISOString();
      try {
        const m = await hcloud(`/servers/${s.id}/metrics?type=cpu&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&step=3600`);
        cpu = meanCpuPct(m.metrics?.time_series?.cpu?.values, s.server_type?.cores);
      } catch (e) { console.log(`  metrics failed for ${s.name}: ${e.message}`); }
    }
    const v = leaseVerdict({ labels, running, since: new Date(s.created), now, cpuPct: cpu });
    const f = {
      provider: 'hetzner', id: String(s.id), name: s.name, type: s.server_type?.name ?? '?',
      location: s.datacenter?.location?.name ?? null, status: s.status, eur_month: hetznerMonthlyEur(s),
      age_days: Math.floor((now - new Date(s.created)) / 864e5), cpu_24h: cpu,
      owner: labels.owner ?? null, issue: ownerIssue(labels.owner), kind: v.kind, reason: v.reason,
    };
    console.log(`  ${(v.action === 'flag' ? v.kind.toUpperCase() : v.action).padEnd(9)}${f.name} (${f.type}, ${f.status}, €${f.eur_month ?? '?'}/mo) · ${v.reason}`);
    if (v.action === 'flag') flags.push(f);
  }
  flags.sort((a, b) => (b.eur_month || 0) - (a.eur_month || 0));
  await nagDigest(flags, 'Hetzner server(s) flagged', [
    'Nothing was stopped: a stopped Hetzner server still bills; delete (after the data is safe) or label it.',
    'Lease it:      hcloud server add-label <name> lease-until=2026-10-31 && hcloud server add-label <name> owner=<issue>',
    'Keep it:       hcloud server add-label <name> role=permanent',
    'Board:         https://sourcelibrary.org/admin/work',
  ]);
  await pushBoard('infra-hetzner', flags, 150);
  if (mongoDb) await mongoDb.client.close().catch(() => {});
  process.exit(exitCode);
}

if (!TOKEN) { console.error('SCALEWAY_SECRET_KEY is not set'); process.exit(1); }

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
async function newestOutput(progress, windowMin) {
  const since = new Date(Date.now() - windowMin * 60000);
  const doc = await (await getMongo()).collection('pages').findOne(
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

// ── non-GPU instances: report, never stop (#5736) ────────────────────────────
// A CPU instance is often another project's long-lived service; the cost of not tagging it is the nag.
const products = {};
async function monthlyEur(s) {
  try {
    products[s.zone] ??= (await scw('GET', `/instance/v1/zones/${s.zone}/products/servers?per_page=100`)).servers || {};
    return scalewayMonthlyEur(products[s.zone][s.commercial_type]);
  } catch { return null; }
}
const scwFlags = [];
for (const s of servers) {
  if (s.state !== 'running') continue;
  const labels = parseTags(s.tags);
  const gpu = GPU_TYPE.test(s.commercial_type);
  if (gpu && labels['lease-until']) continue; // the lease rules above own it
  const v = gpu ? { action: 'flag', kind: 'no-lease', reason: 'GPU with no lease-until tag' }
    : labels['lease-until'] ? { action: 'ok' } // a leased CPU instance is in `watched` above
    : leaseVerdict({ labels, running: true, since: new Date(s.modification_date), now, checkCpu: false });
  if (v.action !== 'flag') continue;
  const f = {
    provider: 'scaleway', id: s.id, name: s.name, type: s.commercial_type, location: s.zone, status: s.state,
    eur_month: await monthlyEur(s), age_days: Math.floor((now - new Date(s.creation_date)) / 864e5), cpu_24h: null,
    owner: labels.owner ?? null, issue: ownerIssue(labels.owner), kind: v.kind, reason: v.reason,
  };
  if (!gpu) console.log(`  REPORT   ${s.name} (${s.commercial_type}, ${s.zone}) · non-GPU · ${v.reason} · €${f.eur_month ?? '?'}/mo`);
  scwFlags.push(f);
}
// Untagged GPUs already have their own per-server email above; the digest covers CPU instances only.
await nagDigest(scwFlags.filter(f => !GPU_TYPE.test(f.type)), 'untagged Scaleway CPU instance(s) running', [
  'Nothing was stopped. Tag it or stop it deliberately:',
  '  scw instance server update <id> zone=<zone> tags.0=role=permanent tags.1=owner=<project-or-issue>',
  'Board: https://sourcelibrary.org/admin/work',
]);
await pushBoard('infra-scaleway', scwFlags, 30);
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
