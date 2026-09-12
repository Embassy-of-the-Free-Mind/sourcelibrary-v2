#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spend-reconcile.mjs — answers "did the vendor bill more than we
 * metered?" (billed vs metered dollars, per model). It cannot answer "WHICH KEY made these
 * calls, and which of our machines holds that key", because the token metrics carry a `model`
 * label and no credential label. This script is the per-credential half. Also checked:
 * spend-perimeter.mjs (classifies our own spenders, reads no vendor data) and
 * scripts/lib/ — no key inventory exists.
 *
 * gemini-key-attribution — which API key made the calls, and who holds that key.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Gemini bill covers six projects and sixteen keys, several named after whatever they were
 * first created for. In Aug 2026 the single largest consumer — 265,559 calls — was a key named
 * `smartpaper`, and it turned out to be what Source Library's Lambda workers run on. Reading the
 * bill by key NAME would have charged a quarter of a million calls to the wrong project.
 *
 * The only per-call attribution Google exposes is `resource.label.credential_id` on
 * `serviceruntime.googleapis.com/api/request_count`. That identifies a KEY, never an app. This
 * script closes the last step: it hashes each key's actual string and matches it against the keys
 * installed in each of our runtimes, so "key" becomes "machine".
 *
 * It never prints a key string — only the first 12 hex of its SHA-256.
 *
 * WHAT IT FLAGS
 * -------------
 *   UNATTRIBUTED  a key with real traffic that no runtime we can read is holding. Either a
 *                 machine we did not check, another project sharing the billing account, or
 *                 someone else using our key. Investigate before assuming the first.
 *   SHARED        one key held by two different runtimes. Attribution by key collapses here:
 *                 you can no longer tell whose calls are whose. Split it.
 *   MISNAMED      the key's display name does not match the runtime holding it. Cosmetic, but
 *                 it is exactly how the `smartpaper` confusion happened.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/gemini-key-attribution.mjs [--days=7] [--json]
 *
 * Google auth: `gcloud auth print-access-token`, or GOOGLE_OAUTH_ACCESS_TOKEN.
 * Lambda runtime is read only if AWS credentials are present; Hetzner only with --hetzner
 * (needs ssh). Absent runtimes are reported as NOT CHECKED — never as absent, because an
 * unchecked machine is the most likely explanation for an UNATTRIBUTED key.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const WITH_HETZNER = args.includes('--hetzner');
const DAYS = Number(args.find(a => a.startsWith('--days='))?.split('=')[1] ?? 7);

/** Trap C from spend-reconcile: this list is explicit because `gcloud billing projects list` paginates. */
const PROJECTS = [
  { id: 'gen-lang-client-0278315411', name: 'booksplit' },
  { id: 'gen-lang-client-0352480887', name: 'Sourcelibrary' },
  { id: 'gen-lang-client-0720939617', name: 'soma' },
];

const HETZNER = 'root@46.224.122.120';
const LAMBDAS = [
  'sourcelibrary-ocr-processor',
  'sourcelibrary-translation-processor',
  'sourcelibrary-image-extraction-processor',
];

const h12 = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
const sh = (cmd, cmdArgs, timeout = 30000) =>
  execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout }).trim();

// ─────────────────────────────────────────── auth

function googleToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  try { return sh('gcloud', ['auth', 'print-access-token']); }
  catch { return null; }
}

async function gapi(token, url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (j.error) throw new Error(`${j.error.code} ${j.error.message}`);
  return j;
}

// ─────────────────────────────────────────── who Google saw

/**
 * Calls per credential over the window.
 * Alignment: the interval MUST start at a UTC midnight or Google's day buckets straddle two of
 * our days and every daily comparison shows a phantom surplus followed by a phantom deficit.
 */
async function callsByCredential(token, projectId, start, end) {
  const p = new URLSearchParams();
  p.set('filter',
    'metric.type="serviceruntime.googleapis.com/api/request_count" ' +
    'AND resource.type="consumed_api" ' +
    'AND resource.label.service="generativelanguage.googleapis.com"');
  p.set('interval.startTime', start.toISOString());
  p.set('interval.endTime', end.toISOString());
  p.set('aggregation.alignmentPeriod', '86400s');
  p.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  p.append('aggregation.groupByFields', 'resource.label.credential_id');
  p.append('aggregation.groupByFields', 'resource.label.method');
  // No crossSeriesReducer — it double-counts (~1.9x measured, see spend-reconcile trap A).

  const out = {};
  let url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${p}`;
  let page;
  do {
    const j = await gapi(token, url + (page ? `&pageToken=${page}` : ''));
    for (const s of j.timeSeries || []) {
      const cred = (s.resource?.labels?.credential_id || 'none').replace(/^apikey:/, '');
      const method = s.resource?.labels?.method || '';
      const n = (s.points || []).reduce((a, b) => a + Number(b.value?.int64Value || 0), 0);
      out[cred] ??= { total: 0, generate: 0 };
      out[cred].total += n;
      if (/GenerateContent/.test(method)) out[cred].generate += n;
    }
    page = j.nextPageToken;
  } while (page);
  return out;
}

// ─────────────────────────────────────────── which keys exist

function listKeys(projectId) {
  const raw = sh('gcloud', ['services', 'api-keys', 'list', `--project=${projectId}`,
    '--format=json(uid,displayName)'], 60000);
  return JSON.parse(raw || '[]');
}

function keyHash(uid, projectId) {
  try { return h12(sh('gcloud', ['services', 'api-keys', 'get-key-string', uid, `--project=${projectId}`,
    '--format=value(keyString)'], 30000)); }
  catch { return null; }
}

// ─────────────────────────────────────────── which keys our machines hold

/** name -> { hash -> [var names] }. A runtime that could not be read is recorded as null. */
function runtimeHoldings() {
  const held = {};

  // Whatever the caller sourced (Vercel prod env, via --env-file or `set -a; source`).
  const local = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^GEMINI_API_KEY/.test(k) && v) (local[h12(v)] ??= []).push(k);
  }
  held.local = Object.keys(local).length ? local : null;

  // Lambda: needs lambda:GetFunctionConfiguration (granted 2026-09-04, scoped to these functions).
  const lambda = {};
  let lambdaOk = false;
  for (const fn of LAMBDAS) {
    try {
      const raw = sh('aws', ['lambda', 'get-function-configuration', '--function-name', fn,
        '--query', 'Environment.Variables', '--output', 'json'], 30000);
      lambdaOk = true;
      for (const [k, v] of Object.entries(JSON.parse(raw || '{}'))) {
        if (/^GEMINI_API_KEY/.test(k) && v) (lambda[h12(v)] ??= []).push(`${fn.replace(/^sourcelibrary-|-processor$/g, '')}:${k}`);
      }
    } catch { /* permission or credentials missing — reported as NOT CHECKED below */ }
  }
  held.lambda = lambdaOk ? lambda : null;

  if (WITH_HETZNER) {
    const hetzner = {};
    try {
      const raw = sh('ssh', ['-o', 'ConnectTimeout=10', '-o', 'BatchMode=yes', HETZNER,
        'grep -E "^GEMINI_API_KEY" /root/sourcelibrary/.env.production.local'], 30000);
      for (const line of raw.split('\n')) {
        const i = line.indexOf('=');
        if (i < 0) continue;
        const k = line.slice(0, i), v = line.slice(i + 1).replace(/^"|"$/g, '');
        if (v) (hetzner[h12(v)] ??= []).push(k);
      }
      held.hetzner = hetzner;
    } catch { held.hetzner = null; }
  }

  return held;
}

// ─────────────────────────────────────────── report

const token = googleToken();
if (!token) {
  console.error('No Google credentials — run `gcloud auth login`, or set GOOGLE_OAUTH_ACCESS_TOKEN.');
  console.error('Refusing to print a key inventory with no traffic data: a key with zero observed');
  console.error('calls and a key we could not measure look identical, and that is the whole point.');
  process.exit(2);
}

const end = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));
const start = new Date(end.getTime() - DAYS * 86400000);

const held = runtimeHoldings();
const rows = [];

for (const project of PROJECTS) {
  const traffic = await callsByCredential(token, project.id, start, end);
  for (const key of listKeys(project.id)) {
    const uid = key.uid;
    const t = traffic[uid];
    if (!t || t.total === 0) continue;           // dormant keys are not the question here
    const hash = keyHash(uid, project.id);
    const holders = [];
    for (const [runtime, map] of Object.entries(held)) {
      if (!map || !hash) continue;
      if (map[hash]) holders.push(`${runtime}(${map[hash].join(',')})`);
    }
    rows.push({
      uid, name: key.displayName || '(unnamed)', project: project.name,
      calls: t.total, generate: t.generate, hash, holders,
    });
  }
  // Traffic on a credential that is not an API key at all (OAuth/ADC — console, gcloud, audits).
  for (const [cred, t] of Object.entries(traffic)) {
    if (cred === 'UNKNOWN' || cred === 'none') {
      rows.push({ uid: cred, name: '(OAuth / ADC — not an API key)', project: project.name,
        calls: t.total, generate: t.generate, hash: null, holders: ['n/a'] });
    }
  }
}

rows.sort((a, b) => b.calls - a.calls);

const notChecked = Object.entries(held).filter(([, v]) => v === null).map(([k]) => k);
if (!WITH_HETZNER) notChecked.push('hetzner (pass --hetzner)');

if (JSON_OUT) {
  console.log(JSON.stringify({ window: { start, end, days: DAYS }, notChecked, keys: rows }, null, 2));
} else {
  console.log(`\n═══ Gemini key attribution — last ${DAYS} days (${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}) ═══\n`);
  console.log('  calls  generate  key name                  project        sha256  held by');
  for (const r of rows) {
    console.log(
      String(r.calls).padStart(7),
      String(r.generate).padStart(9),
      '  ' + r.name.slice(0, 24).padEnd(24),
      r.project.padEnd(14),
      (r.hash || '—').padEnd(13),
      r.holders.length ? r.holders.join(' + ') : 'UNATTRIBUTED');
  }

  const findings = [];
  for (const r of rows) {
    if (r.holders.length === 0) findings.push(`UNATTRIBUTED  ${r.name} (${r.uid.slice(0, 8)}, ${r.project}) — ${r.calls} calls, held by no runtime we read`);
    if (r.holders.length > 1) findings.push(`SHARED        ${r.name} (${r.uid.slice(0, 8)}) — held by ${r.holders.join(' AND ')}; per-key attribution cannot separate them`);
    // A key that one of OUR runtimes holds but whose name does not say so. This is the
    // `smartpaper` case: the name sends the next reader to the wrong project entirely.
    if (r.holders.length && r.holders[0] !== 'n/a' && !/sourcelibrary/i.test(r.name))
      findings.push(`MISNAMED      "${r.name}" (${r.project}) is held by ${r.holders.map(x => x.split('(')[0]).join(' + ')} — rename it, or the next reader charges ${r.calls} calls to the wrong project`);
  }
  console.log('\n' + (findings.length ? findings.join('\n') : 'No unattributed, shared, or misnamed keys with traffic.'));

  if (notChecked.length) {
    console.log(`\nNOT CHECKED: ${notChecked.join(', ')}.`);
    console.log('An UNATTRIBUTED key is most likely held by one of these — check before concluding misuse.');
  }
  console.log('\nAttribution is by key POSSESSION, not authorship: a leaked key bills to the same row.');
}
