#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/zh-cohort-5547-gpu.sh (one box, driven by hand) and scripts/workers/ndl-koten-lane.mjs
 * (#4925: plan/apply around a box someone else drives). Nothing in the repo drives SEVERAL leased boxes from
 * cron for days; this does, for the #5600 lane only, through scripts/gpu/paddle-zh-gpu.sh (one box's
 * lifecycle) and scripts/workers/paddle-zh-lane.mjs (plan with holds, apply with every writer guard).
 *
 * paddle-zh-fleet.mjs — one CYCLE of the #5600 Paddle fleet. Run by cron every 10 minutes under flock,
 * from a FIXED copy of the repo in /root/paddle-zh-5600/code (the lane must not change under a running fleet).
 *
 * Per cycle:
 *   0. STOP file, or the € ledger at the stop line (STOP_EUR, default 950, of the €1,000 cap) → pull, stop and
 *      delete every box, comment on #5600 once, exit. Spend = Σ Scaleway box (deleted_at or now − created_at) × €/h
 *      + Σ RunPod pod (terminated_at or now − created_at) × its $/h × USD_EUR + PRIOR_EUR (spend not in either ledger).
 *   1. Every box: provider state. Running → renew its lease to now+LEASE_H (a dead driver lets every lease run
 *      out within hours; the Hetzner watchdog stops it), pull outputs, read its queue. Stopped or gone →
 *      delete, give its unfinished chunks back. No new output for STALL_CYCLES cycles while it has work, or ssh
 *      dead that long → delete-now, chunks back.
 *   2. Keep every box fed: ≤ QUEUE_DEPTH chunks waiting on it. A chunk = CHUNK_PAGES manifest rows; chunks are
 *      cut from the plan in TWO WAVES across the whole cohort — never-read pages first, then the 25-page
 *      previews lite already read — so a budget stop leaves the most new text. Planning a book HOLDS it first.
 *   3. Apply: paddle-zh-lane.mjs apply --apply (every book whose wave is fully back is written, under its guards).
 *   4. Grow: below MAX_BOXES, try to create one Scaleway box per cycle (zones in order, skipping a zone whose
 *      availability API says `shortage`; stock is the usual refusal). OVERFLOW: when no Scaleway box could be
 *      created for RUNPOD_AFTER_MIN (30) minutes, a RunPod pod (RTX 4090 / 3090, community first; vLLM, CLIENTS
 *      8 — c16 was unstable on the 4090) fills the slot instead, at most MAX_PODS; named sl-5600-<box>-until-<UTC>
 *      so scripts/maintenance/runpod-pod-watchdog.mjs (Hetzner cron) terminates it at the deadline or when its
 *      progress dir stops growing. The fleet retires a pod POD_RETIRE_MIN before its deadline.
 *   Waves: 1 never-read pages, 2 the lite-read previews, 3 ONE retry of every page a box failed (.err → .err.1).
 *   5. Finished (every chunk read and applied) → FINISH every box, delete, final comment on #5600, state=done.
 * Log: /root/paddle-zh-5600/fleet.log (one line per action, running € on every cycle line). State:
 * fleet-state.json (written after every step that changes it). Stop: `touch /root/paddle-zh-5600/STOP`.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local code/scripts/gpu/paddle-zh-fleet.mjs [--dry]
 * Env: MAX_BOXES (6, Scaleway + RunPod), MAX_PODS (2), ZONES (pl-waw-2,fr-par-2,fr-par-1,pl-waw-1,pl-waw-3,nl-ams-1,
 *      nl-ams-2,nl-ams-3), TYPE (L4-1-24G), STOP_EUR (950), CHUNK_PAGES (2500), QUEUE_DEPTH (1), LEASE_H (3),
 *      BOX_ENV (the benchmark's choice: "BACKEND=server CLIENTS=8"), RUNPOD_AFTER_MIN (30), POD_MINUTES (720),
 *      USD_EUR (0.86), PRIOR_EUR (0). RunPod needs RUNPOD_API_KEY in the environment (never logged).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DIR = process.env.LANE_DIR || '/root/paddle-zh-5600';
const DRY = process.argv.includes('--dry');
const E = (k, d) => process.env[k] ?? d;
const MAX_BOXES = +E('MAX_BOXES', 6), STOP_EUR = +E('STOP_EUR', 950), CHUNK_PAGES = +E('CHUNK_PAGES', 2500);
const QUEUE_DEPTH = +E('QUEUE_DEPTH', 1), LEASE_H = +E('LEASE_H', 3), STALL_CYCLES = +E('STALL_CYCLES', 4);
const ZONES = E('ZONES', 'pl-waw-2,fr-par-2,fr-par-1,pl-waw-1,pl-waw-3,nl-ams-1,nl-ams-2,nl-ams-3').split(','), TYPE = E('TYPE', 'L4-1-24G');
const EUR = { 'L4-1-24G': 0.7875, 'L40S-1-48G': 1.469916, 'H100-1-80G': 2.8665 };
const VOL_EUR_H = 80 * 0.000118;   // 80 GB sbs volume, ≈ €0.086/GB-month
const BOX_ENV = E('BOX_ENV', 'BACKEND=server CLIENTS=8');
const MAX_PODS = +E('MAX_PODS', 2), RUNPOD_AFTER_MIN = +E('RUNPOD_AFTER_MIN', 30), POD_MINUTES = +E('POD_MINUTES', 720);
const POD_RETIRE_MIN = +E('POD_RETIRE_MIN', 30), USD_EUR = +E('USD_EUR', 0.86), PRIOR_EUR = +E('PRIOR_EUR', 0);
// RunPod classes in preference order (#5600 benchmark: 4090 vLLM c8 passes the gate; the 3090 is the same
// 24 GB Ampere-class card at a third of the price, in stock when the 4090 is not)
const POD_GPUS = [['NVIDIA GeForce RTX 4090', 'COMMUNITY'], ['NVIDIA GeForce RTX 3090', 'COMMUNITY'], ['NVIDIA GeForce RTX 4090', 'SECURE'], ['NVIDIA GeForce RTX 3090', 'SECURE']];
const F = { state: path.join(DIR, 'fleet-state.json'), log: path.join(DIR, 'fleet.log'), stop: path.join(DIR, 'STOP'), chunks: path.join(DIR, 'chunks'), boxes: path.join(DIR, 'boxes'), out: path.join(DIR, 'out'), plan: path.join(DIR, 'plan'), dedup: path.join(DIR, 'dedup.json') };
const GPU = path.join(HERE, 'paddle-zh-gpu.sh');
const POD = path.join(HERE, 'paddle-zh-runpod.sh');
const isPod = (box) => S.boxes[box]?.provider === 'runpod';
const LANE = path.join(REPO, 'scripts/workers/paddle-zh-lane.mjs');

const log = (m) => { const l = `${new Date().toISOString()} [fleet] ${m}`; console.log(l); fs.appendFileSync(F.log, l + '\n'); };
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; } };
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const S = readJson(F.state, { created_at: new Date().toISOString(), status: 'running', boxes: {}, chunks: {}, next_box: 1, wave: 1, cursor: 0, comments: {} });
const save = () => { if (!DRY) { fs.writeFileSync(F.state + '.tmp', JSON.stringify(S, null, 1)); fs.renameSync(F.state + '.tmp', F.state); } };
function gpu(box, cmd, args = [], { env = {}, timeout = 900 } = {}) {
  const r = spawnSync('bash', [isPod(box) ? POD : GPU, cmd, ...args], { env: { ...process.env, BOX: box, POD: box, LANE_DIR: DIR, ...env }, encoding: 'utf8', timeout: timeout * 1000 });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}`.trim() };
}
function comment(key, body) {
  if (S.comments[key] || DRY) return;
  try { execFileSync('gh', ['issue', 'comment', '5600', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', body], { stdio: 'ignore', timeout: 60000 }); S.comments[key] = new Date().toISOString(); save(); log(`commented on #5600: ${key}`); }
  catch (e) { log(`comment ${key} FAILED: ${String(e.message).slice(0, 120)}`); }
}

// ── spend: every box this lane ever created, from its own files (bench + pilot boxes included) ─────────────
function spend() {
  let eur = 0, live = 0;
  if (!fs.existsSync(F.boxes)) return { eur: 0, live: 0 };
  for (const b of fs.readdirSync(F.boxes)) {
    const d = path.join(F.boxes, b);
    const t0 = +(readText(path.join(d, 'created-at')) || 0); if (!t0) continue;   // a create the API refused never billed
    const type = fs.existsSync(path.join(d, 'type')) ? fs.readFileSync(path.join(d, 'type'), 'utf8').trim() : 'L4-1-24G';
    const deleted = fs.readdirSync(d).filter(f => f.startsWith('server-id.deleted.')).map(f => +f.split('.').pop()).sort((x, y) => y - x)[0];
    const t1 = fs.existsSync(path.join(d, 'server-id')) ? Date.now() / 1000 : (deleted || t0);
    if (fs.existsSync(path.join(d, 'server-id'))) live++;
    eur += (t1 - t0) / 3600 * ((EUR[type] || 0.7875) + VOL_EUR_H);
  }
  let pod = 0;
  const PD = path.join(DIR, 'runpod-pods');
  if (fs.existsSync(PD)) for (const b of fs.readdirSync(PD)) {
    const d = path.join(PD, b);
    const t0 = +(readText(path.join(d, 'created-at')) || 0); if (!t0) continue;   // a refused create never billed
    const t1 = +(readText(path.join(d, 'terminated-at')) || 0) || (fs.existsSync(path.join(d, 'pod-id')) ? Date.now() / 1000 : t0);
    if (fs.existsSync(path.join(d, 'pod-id'))) live++;
    pod += (t1 - t0) / 3600 * (+readText(path.join(d, 'cost-per-hr')) || 0) * USD_EUR;
  }
  return { eur: +(eur + pod + PRIOR_EUR).toFixed(2), scw: +eur.toFixed(2), runpod: +pod.toFixed(2), live };
}

// ── chunks: cut from the plan in two waves ─────────────────────────────────────────────────────────────────
const keepIds = () => readJson(F.dedup, { keep: [] }).keep.slice().sort();
const planOf = (bid) => readJson(path.join(F.plan, `${bid}.json`), null);
const doneTxt = (bid, pn) => fs.existsSync(path.join(F.out, bid, `${pn}.txt`)) || fs.existsSync(path.join(F.out, bid, `${pn}.err`));
function cutChunk() {
  const ids = keepIds();
  const rows = [];
  while (rows.length < CHUNK_PAGES && S.wave <= 3) {
    if (S.cursor >= ids.length) { S.wave++; S.cursor = 0; continue; }
    const batch = ids.slice(S.cursor, S.cursor + 25);
    // plan (and HOLD) the batch's books that have no plan yet — the hold comes before any page of theirs is read
    const unplanned = batch.filter(b => !fs.existsSync(path.join(F.plan, `${b}.json`)));
    if (unplanned.length && !DRY && S.wave < 3) {
      const lf = path.join(DIR, 'plan-batch.txt'); fs.writeFileSync(lf, unplanned.join('\n') + '\n');
      const r = spawnSync('node', [LANE, 'plan', '--books', lf, '--apply', '--dir', DIR], { encoding: 'utf8', timeout: 600000 });
      if (r.status !== 0) { log(`plan FAILED for ${unplanned.length} books: ${(r.stderr || '').slice(-300)}`); return null; }
    }
    for (const bid of batch) {
      const pl = planOf(bid); if (!pl) continue;
      for (const p of pl.pages) {
        if (S.wave === 3) {
          // the one retry: a page a box failed (fetch error, timeout, a GPU allocation failure at start-up) is
          // read again; its first .err is kept as .err.1, so a second failure is final (.err stays)
          const e = path.join(F.out, bid, `${p.pn}.err`);
          if (fs.existsSync(e) && !fs.existsSync(`${e}.1`) && !fs.existsSync(path.join(F.out, bid, `${p.pn}.txt`))) { if (!DRY) fs.renameSync(e, `${e}.1`); rows.push([bid, p.pn, p.src].join('\t')); }
        } else if (!!p.first_write === (S.wave === 1) && !doneTxt(bid, p.pn)) rows.push([bid, p.pn, p.src].join('\t'));
      }
    }
    S.cursor += batch.length;
  }
  if (!rows.length) return null;
  const name = `c${String(Object.keys(S.chunks).length + 1).padStart(4, '0')}-w${Math.min(S.wave, 3)}`;
  fs.mkdirSync(F.chunks, { recursive: true });
  fs.writeFileSync(path.join(F.chunks, `${name}.tsv`), rows.join('\n') + '\n');
  S.chunks[name] = { rows: rows.length, box: null, status: 'unassigned', cut_at: new Date().toISOString() };
  save();
  return name;
}
const chunkRows = (name) => fs.readFileSync(path.join(F.chunks, `${name}.tsv`), 'utf8').split('\n').filter(Boolean).map(l => l.split('\t'));
const chunkBack = (name) => chunkRows(name).every(([bid, pn]) => doneTxt(bid, pn));
function nextChunk() {
  const free = Object.entries(S.chunks).find(([, c]) => c.status === 'unassigned');
  return free ? free[0] : cutChunk();
}

// ── one box ────────────────────────────────────────────────────────────────────────────────────────────────
function giveBack(box) {
  for (const [n, c] of Object.entries(S.chunks)) if (c.box === box && c.status === 'assigned') {
    if (chunkBack(n)) { c.status = 'done'; continue; }
    // write what is still missing as a fresh chunk file under the same name: rows already back are not re-read
    const left = chunkRows(n).filter(([bid, pn]) => !doneTxt(bid, pn));
    fs.writeFileSync(path.join(F.chunks, `${n}.tsv`), left.map(r => r.join('\t')).join('\n') + '\n');
    Object.assign(c, { status: 'unassigned', box: null, rows: left.length });
  }
}
function deleteBox(box, why) {
  log(`${box}: deleting (${why})`);
  if (DRY) return;
  gpu(box, isPod(box) ? 'pullout' : 'pull', isPod(box) ? [F.out, path.join(F.boxes, box)] : [F.out], { timeout: 1800 });
  const r = gpu(box, isPod(box) ? 'terminate' : 'delete-now', [], { timeout: 1200 });
  log(`${box}: ${r.ok ? 'deleted' : 'DELETE FAILED: ' + r.out.slice(-300)}`);
  giveBack(box);
  if (r.ok) S.boxes[box].status = 'deleted';
  save();
}
function feed(box) {
  const mine = Object.entries(S.chunks).filter(([, c]) => c.box === box && c.status === 'assigned');
  for (const [n] of mine) if (chunkBack(n)) S.chunks[n].status = 'done';
  const waiting = Object.entries(S.chunks).filter(([, c]) => c.box === box && c.status === 'assigned').length;
  for (let k = waiting; k < QUEUE_DEPTH + 1; k++) {
    const n = nextChunk(); if (!n) break;
    if (DRY) { log(`${box}: would push ${n}`); break; }
    const tmp = path.join(DIR, `push-${n}.tsv`); fs.copyFileSync(path.join(F.chunks, `${n}.tsv`), tmp);
    // the file goes over ssh stdin, written to .part and renamed, so the box never sees half a manifest
    // a retry chunk (-w3): the box's loop moves its own .err aside for the chunk's rows before reading it
    const r2 = spawnSync('bash', ['-c', `BOX=${box} POD=${box} LANE_DIR=${DIR} bash ${isPod(box) ? POD : GPU} ssh "mkdir -p /root/pz/queue && cat > /root/pz/queue/${n}.tsv.part && mv /root/pz/queue/${n}.tsv.part /root/pz/queue/${n}.tsv" < ${tmp}`], { encoding: 'utf8', timeout: 300000 });
    fs.rmSync(tmp, { force: true });
    if (r2.status !== 0) { log(`${box}: push ${n} FAILED ${(r2.stderr || '').slice(-200)}`); break; }
    Object.assign(S.chunks[n], { box, status: 'assigned', assigned_at: new Date().toISOString() });
    // the lane's apply names the box a page was read on (ocr.engine.run/host/gpu, from boxes/<box>/box.json)
    // by assign.json — without it every page says `unknown-box` (caught on the pilot, 2026-10-02)
    const af = path.join(DIR, 'assign.json'), assign = readJson(af, {});
    for (const [bid] of chunkRows(n)) assign[bid] = box;
    fs.writeFileSync(af + '.tmp', JSON.stringify(assign)); fs.renameSync(af + '.tmp', af);
    log(`${box}: queued ${n} (${S.chunks[n].rows} rows)`); save();
  }
}
function podState(box) {
  const d = path.join(DIR, 'runpod-pods', box);
  if (!fs.existsSync(path.join(d, 'pod-id'))) return 'gone';
  const r = spawnSync('bash', [POD, 'status'], { env: { ...process.env, POD: box, LANE_DIR: DIR }, encoding: 'utf8', timeout: 60000 });
  const m = /'desiredStatus': '(\w+)'/.exec(r.stdout || '');
  return m ? (m[1] === 'RUNNING' ? 'running' : m[1].toLowerCase()) : 'unknown';
}
function tend(box) {
  const b = S.boxes[box];
  const st = gpu(box, 'ssh', ['true'], { timeout: 60 });
  const prov = isPod(box) ? podState(box) : spawnSync('bash', ['-c', `set -a; . /root/.scaleway.env; set +a; curl -s -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" https://api.scaleway.com/instance/v1/zones/$(cat ${F.boxes}/${box}/zone)/servers/$(cat ${F.boxes}/${box}/server-id) | python3 -c 'import json,sys; s=json.load(sys.stdin).get("server"); print(s["state"] if s else "gone")'`], { encoding: 'utf8' }).stdout.trim();
  if (prov !== 'running') return deleteBox(box, `provider state ${prov || 'unknown'}`);
  // a pod's deadline is in its name and the RunPod watchdog terminates it there: retire it first, chunks back
  if (isPod(box) && b.deadline && Date.now() > b.deadline - POD_RETIRE_MIN * 60000) return deleteBox(box, `pod deadline ${new Date(b.deadline).toISOString()} near`);
  if (!st.ok) { b.ssh_fail = (b.ssh_fail || 0) + 1; save(); if (b.ssh_fail >= STALL_CYCLES) return deleteBox(box, `ssh failing ${b.ssh_fail} cycles (a Scaleway reboot drops the key)`); return log(`${box}: ssh failed (${b.ssh_fail})`); }
  b.ssh_fail = 0;
  if (!DRY && !isPod(box)) gpu(box, 'lease', [String(LEASE_H)], { timeout: 120 });
  if (!DRY) gpu(box, isPod(box) ? 'pullout' : 'pull', isPod(box) ? [F.out, path.join(F.boxes, box)] : [F.out], { timeout: 1800 });
  const n = +(gpu(box, 'ssh', ['find /root/pz/out -name "*.txt" -o -name "*.err" | wc -l'], { timeout: 120 }).out.split('\n').pop() || 0);
  const job = gpu(box, 'ssh', ['cat /root/pz/job.exit 2>/dev/null; ls /root/pz/queue 2>/dev/null | grep -c "\\.tsv$"'], { timeout: 60 }).out;
  const hasWork = Object.values(S.chunks).some(c => c.box === box && c.status === 'assigned');
  if (/exit=/.test(job)) return deleteBox(box, `box job ended (${job.split('\n')[0]})`);
  if (n > (b.last_out || 0)) { b.last_out = n; b.stall = 0; } else if (hasWork && Date.now() / 1000 - b.started > 1800) b.stall = (b.stall || 0) + 1;
  save();
  if ((b.stall || 0) >= STALL_CYCLES) return deleteBox(box, `no new output for ${b.stall} cycles`);
  feed(box);
  log(`${box}: ${n} pages out, stall ${b.stall || 0}`);
}
function zoneShort(zone) {
  // the availability API is a pre-filter only: `available` has still refused a poweron (measured 2026-10-02)
  const r = spawnSync('bash', ['-c', `set -a; . /root/.scaleway.env; set +a; curl -s -H "X-Auth-Token: $SCALEWAY_SECRET_KEY" "https://api.scaleway.com/instance/v1/zones/${zone}/products/servers/availability?per_page=100"`], { encoding: 'utf8', timeout: 60000 });
  try { const a = JSON.parse(r.stdout).servers?.[TYPE]?.availability; return !a || a === 'shortage'; } catch { return false; }
}
function startBox(box, env) {
  const tmp = path.join(DIR, 'empty.tsv'); fs.writeFileSync(tmp, '');
  const p = isPod(box) ? gpu(box, 'lane-push', [], { timeout: 900 }) : gpu(box, 'push', [tmp], { timeout: 600 });
  const r = gpu(box, isPod(box) ? 'lane-run' : 'run', [], { env: { MODE: 'loop', LINGER: '60', ...env }, timeout: 300 });
  return `push ${p.ok ? 'ok' : 'FAILED'}; run ${r.ok ? 'launched' : 'FAILED ' + r.out.slice(-200)}`;
}
function grow() {
  const live = Object.entries(S.boxes).filter(([, b]) => b.status === 'live');
  if (live.length >= MAX_BOXES) { S.scw_short_since = null; return save(); }
  if (!Object.values(S.chunks).some(c => c.status === 'unassigned') && !nextChunk()) return;
  const env = Object.fromEntries(BOX_ENV.split(/\s+/).filter(Boolean).map(kv => kv.split('=')));
  const box = `f${String(S.next_box).padStart(2, '0')}`;
  if (DRY) return log(`would try to create ${box} (${TYPE}) in ${ZONES.join('/')}`);
  for (const zone of ZONES) {
    if (zoneShort(zone)) continue;
    S.next_box++; save();
    const c = gpu(box, 'create', [], { env: { TYPE, ZONE: zone, LEASE_H: String(LEASE_H) }, timeout: 1500 });
    if (!c.ok) { log(`${box}: create in ${zone} failed: ${c.out.split('\n').slice(-2).join(' | ').slice(0, 300)}`); if (fs.existsSync(path.join(F.boxes, box, 'server-id'))) deleteBox(box, 'create half-failed'); continue; }
    S.boxes[box] = { status: 'live', provider: 'scaleway', zone, type: TYPE, started: Math.floor(Date.now() / 1000) }; S.scw_short_since = null; save();
    log(`${box}: created in ${zone}; ${startBox(box, env)} (${BOX_ENV})`);
    feed(box);
    return;
  }
  // no Scaleway L4 anywhere this cycle
  S.scw_short_since = S.scw_short_since || Date.now(); save();
  const shortMin = (Date.now() - S.scw_short_since) / 60000;
  const pods = live.filter(([b]) => isPod(b)).length;
  if (shortMin < RUNPOD_AFTER_MIN || pods >= MAX_PODS || !process.env.RUNPOD_API_KEY) return log(`no Scaleway ${TYPE} in ${ZONES.join('/')} (short ${shortMin.toFixed(0)} min; RunPod overflow after ${RUNPOD_AFTER_MIN} min, ${pods}/${MAX_PODS} pods${process.env.RUNPOD_API_KEY ? '' : ', RUNPOD_API_KEY not set'})`);
  for (const [g, cloud] of POD_GPUS) {
    // one name (and ledger dir) per attempt: a pod that billed and then failed ssh keeps its own created-at
    const pod = `p${String(S.next_box).padStart(2, '0')}`;
    S.next_box++;
    S.boxes[pod] = { status: 'creating', provider: 'runpod' }; save();
    const c = gpu(pod, 'create', [], { env: { GPU: g, CLOUD: cloud, MINUTES: String(POD_MINUTES) }, timeout: 1200 });
    if (!c.ok) { log(`${pod}: RunPod ${g} ${cloud}: ${c.out.split('\n').pop().slice(0, 200)}`); if (fs.existsSync(path.join(DIR, 'runpod-pods', pod, 'pod-id'))) gpu(pod, 'terminate', [], { timeout: 300 }); S.boxes[pod].status = 'deleted'; save(); continue; }
    const t0 = +readText(path.join(DIR, 'runpod-pods', pod, 'created-at'));
    S.boxes[pod] = { status: 'live', provider: 'runpod', type: `${g} ${cloud}`, started: t0, deadline: (t0 + POD_MINUTES * 60) * 1000 }; save();
    log(`${pod}: RunPod ${g} ${cloud} (Scaleway short ${shortMin.toFixed(0)} min); ${startBox(pod, { ...env, CLIENTS: '8' })}`);
    feed(pod);
    return;
  }
}

// ── the cycle ──────────────────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(F.out, { recursive: true });
if (S.status === 'done') { process.exit(0); }
let sp = spend();
const live = () => Object.keys(S.boxes).filter(b => S.boxes[b].status === 'live');
if (fs.existsSync(F.stop) || sp.eur + sp.live * 0.5 * ((EUR[TYPE] || 0.79)) >= STOP_EUR) {
  const why = fs.existsSync(F.stop) ? 'STOP file' : `spend €${sp.eur} at the €${STOP_EUR} stop line`;
  log(`STOPPING: ${why}`);
  for (const b of live()) deleteBox(b, why);
  const ap = DRY ? null : spawnSync('node', [LANE, 'apply', '--apply', '--dir', DIR], { encoding: 'utf8', timeout: 3 * 3600 * 1000 });
  if (ap) log(`apply: ${(ap.stdout || '').trim().split('\n').pop()}`);
  sp = spend();
  if (!fs.existsSync(F.stop)) comment('budget-stop', `**#5600 Paddle fleet stopped itself: ${why}.** Spend €${sp.eur} (ledger: \`${DIR}/boxes/*\`). Every box is deleted. Pages read so far are applied; the rest of the cohort is unread and stays held (\`paddle-zh-5600-ocr-only\`). Status: \`node ${LANE} status\`. Log: \`${F.log}\`.`);
  S.status = fs.existsSync(F.stop) ? 'stopped' : 'budget-stopped'; save();
  process.exit(0);
}
for (const b of live()) { try { tend(b); } catch (e) { log(`${b}: tend error ${String(e.message).slice(0, 200)}`); } }
const ap = DRY ? null : spawnSync('node', [LANE, 'apply', '--apply', '--dir', DIR], { encoding: 'utf8', timeout: 3 * 3600 * 1000 });
if (ap) log(`apply: ${(ap.stdout || '').trim().split('\n').pop()}${ap.status ? ' (exit ' + ap.status + ')' : ''}`);
const allCut = S.wave > 3;
const open = Object.values(S.chunks).filter(c => c.status !== 'done').length;
if (allCut && open === 0) {
  for (const b of live()) { gpu(b, 'ssh', ['touch /root/pz/queue/FINISH']); deleteBox(b, 'all chunks read'); }
  const st = JSON.parse(spawnSync('node', [LANE, 'status', '--dir', DIR], { encoding: 'utf8' }).stdout || '{}');
  sp = spend();
  // where the QA flags sit: a few books (a wrong Kanripo witness, a dictionary layout) carry most of them
  const byBook = {};
  for (const l of readText(path.join(DIR, 'qa-flagged.jsonl')).split('\n').filter(Boolean)) { try { const x = JSON.parse(l); byBook[x.title || x.bid] = (byBook[x.title || x.bid] || 0) + 1; } catch { /* partial line */ } }
  const top = Object.entries(byBook).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t, n]) => `${t} ${n}`).join('; ');
  comment('done', `**DONE — #5600 Paddle fleet.** Books applied ${st.books_applied} of ${st.books_planned} planned; pages read ${st.pages_read} (box errors ${st.pages_box_error}), written ${st.pages_written}, refused ${st.pages_refused}, skipped ${JSON.stringify(st.skipped_by_reason)}. QA screen (Kanripo WYG, Dice < 0.6): ${st.qa?.flagged}/${st.qa?.screened} flagged = ${st.qa?.rate}; ${Object.keys(byBook).length} books have a flag, the most-flagged: ${top}. Skipped duplicates: ${st.dedup?.skip_books} books / ${st.dedup?.skip_pages} pages (\`${DIR}/skipped-duplicates.tsv\`). GPU spend €${sp.eur}. Every box and pod deleted (Scaleway €${sp.scw}, RunPod €${sp.runpod}${PRIOR_EUR ? `, prior €${PRIOR_EUR}` : ''}). ${st.books_planned} books stay held (\`paddle-zh-5600-ocr-only\`) — translation is its own decision. Log: \`${F.log}\`.`);
  S.status = 'done'; save();
  process.exit(0);
}
grow();
sp = spend();
const cut = Object.values(S.chunks);
log(`CYCLE live=${live().length} (${live().filter(isPod).length} RunPod) chunks done=${cut.filter(c => c.status === 'done').length}/${cut.length} wave=${Math.min(S.wave, 3)} cursor=${S.cursor} spend=€${sp.eur} (Scaleway €${sp.scw} + RunPod €${sp.runpod}${PRIOR_EUR ? ` + prior €${PRIOR_EUR}` : ''}; stop at €${STOP_EUR})`);
