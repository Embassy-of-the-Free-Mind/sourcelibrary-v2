#!/usr/bin/env node
/**
 * spend-reconcile — compare what we THINK we spent to what the vendor BILLED,
 * and show the whole spend surface in one place.
 *
 * WHY THIS EXISTS
 * ---------------
 * We already have three spend instruments and all three are INTERNAL:
 *
 *   - `true-gemini-spend.mjs`  reads every meter we write
 *   - `spend-perimeter.mjs`    checks every spender asks the dial
 *   - `daily-health-snapshot`  reports `batch_jobs.cost_usd` daily
 *
 * None of them ever asks Google what it actually charged. That is exactly how
 * a **17x** gap survived three months: in August 2026 the meters reported
 * $499.74 against a billed $8,389.32 (#4581). Two independent causes, both
 * invisible to an internal-only meter:
 *
 *   1. `cost_usd` is computed from `MODEL_PRICING` constants, not billed, so a
 *      wrong constant is undetectable (#3379). The `gemini-3.1-flash-lite` row
 *      was 3.3x/5x below list for months.
 *   2. The meters recorded `candidatesTokenCount`, which EXCLUDES
 *      `thoughtsTokenCount`. Google bills both at the output rate. Measured on
 *      20 real pages: 7,648 reasoning tokens per page against 1,122 visible.
 *
 * This script closes the loop. It reads BILLED token counts from Cloud
 * Monitoring and LIVE prices from the Cloud Billing SKU catalogue, prices them,
 * and diffs that against our own meters. It also prints the rest of the spend
 * surface — R2, Vercel, and the vendors we cannot read — so the run rate is
 * observable in one place rather than reconstructed by hand every few weeks.
 *
 * TRAPS THIS ENCODES (each cost real time to learn)
 * -------------------------------------------------
 * A. Cloud Monitoring `crossSeriesReducer=REDUCE_SUM` DOUBLE-COUNTS token
 *    series — measured ~1.9x on daily alignment. Align per series and sum the
 *    series yourself. This script never passes a cross-series reducer.
 * B. The `thinking_enabled` metric label reads "true" even on requests that set
 *    `thinkingBudget: 0`. It is NOT evidence of thought billing. Never branch
 *    on it; use tokens-per-page.
 * C. `gcloud billing projects list` DEFAULT-PAGINATES. Six projects are billing
 *    enabled, not the five an unpaginated call returns. PROJECTS is explicit
 *    below and the drift check flags anything new.
 * D. Prices differ by SERVING TIER. Standard vs batch vs flex vs priority are
 *    separate SKUs (batch is exactly half; priority output is 1.8x standard).
 *    Match the tier or the number is wrong.
 * E. Absence is reported, never silently skipped. A vendor we cannot read
 *    prints as UNREADABLE with the reason — an omitted line reads as $0.
 *
 * EXIT CODES
 *   0  reconciled within tolerance, no drift
 *   1  usage error / could not run at all
 *   2  PRICE DRIFT: MODEL_PRICING disagrees with Google's catalogue, or a model
 *      with real traffic has no price entry. This is the CI-usable signal.
 *
 * Run:
 *   node --env-file=.env.production.local scripts/audit/spend-reconcile.mjs
 *   node --env-file=.env.production.local scripts/audit/spend-reconcile.mjs --month=2026-08
 *   node --env-file=.env.production.local scripts/audit/spend-reconcile.mjs --month=2026-08 --json
 *
 * Google auth: uses `gcloud auth print-access-token` if available, else
 * GOOGLE_OAUTH_ACCESS_TOKEN. Without one the Gemini half prints UNREADABLE
 * rather than zero — see trap E.
 */

import { execFileSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const arg = (k, d) => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;

// Default to last complete month — the only month with a settled invoice.
const now = new Date();
const defMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  .toISOString().slice(0, 7);
const MONTH = arg('month', defMonth);
if (!/^\d{4}-\d{2}$/.test(MONTH)) {
  console.error('Usage: spend-reconcile.mjs [--month=YYYY-MM] [--json]');
  process.exit(1);
}
const start = new Date(`${MONTH}-01T00:00:00Z`);
const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));

/**
 * Every billing-enabled project that can reach the Gemini API.
 * Trap C: this list is explicit because `gcloud billing projects list`
 * paginates by default and silently returned five of six.
 * Re-derive with: gcloud billing projects list --billing-account=<id> --limit=100
 */
const PROJECTS = [
  { id: 'gen-lang-client-0278315411', name: 'booksplit', note: 'primary pipeline key lives here; also holds smartpaper + Kaiju Rampage keys' },
  { id: 'gen-lang-client-0352480887', name: 'Sourcelibrary', note: '' },
  { id: 'gen-lang-client-0720939617', name: 'soma', note: 'GEMINI_API_KEY_TIER3 lives here; also non-SL keys' },
];

/** Gemini API service in the Cloud Billing catalogue. */
const GEMINI_SERVICE = 'services/AEFD-7695-64FA';

const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2);
const M = n => (n / 1e6).toFixed(1) + 'M';

// ─────────────────────────────────────────── Google auth

function googleToken() {
  if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) return process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000,
    }).trim();
  } catch {
    return null;
  }
}

async function gapi(token, url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `HTTP ${r.status}`);
  return j;
}

// ─────────────────────────────────────────── live prices (SKU catalogue)

const normDesc = s => s.toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();

/** "gemini-3-flash-preview" -> "gemini 3 flash" (Google drops the -preview suffix). */
const modelPhrase = m => normDesc(m).replace(/ preview$/, '');

/**
 * Resolve one model to {input, output} USD per 1M tokens for a serving tier.
 * Returns {input, output, ambiguous:[...]} — ambiguity is REPORTED, never
 * silently resolved by picking the first match (Google splits some models by
 * long/short input and thinking/non-thinking, e.g. gemini-2.5-flash).
 */
function resolvePrice(skus, model, { batch = false } = {}) {
  const phrase = modelPhrase(model);
  const pick = dir => skus.filter(s => {
    const d = normDesc(s.description);
    if (!d.includes(phrase)) return false;
    // Guard against a shorter model name matching a longer one:
    // "gemini 3 flash" must not match "gemini 3 flash lite" / "... image".
    const after = d.split(phrase)[1] || '';
    if (/^\s*(lite|image|live)/.test(after)) return false;
    if (!/\btext\b/.test(d)) return false;
    if (!new RegExp(`\\b${dir}\\b`).test(d)) return false;
    if (/cached|storage|flex|priority|audio|video/.test(d)) return false;   // trap D
    return batch ? /batch/.test(d) : !/batch/.test(d);
  });
  const price = s => {
    const pe = s.pricingInfo?.[0]?.pricingExpression || {};
    const rates = (pe.tieredRates || [])
      .map(r => Number(r.unitPrice?.units || 0) + Number(r.unitPrice?.nanos || 0) / 1e9)
      .filter(v => v > 0);
    return rates.length ? rates[rates.length - 1] * 1e6 : null;
  };
  const i = pick('input'), o = pick('output');
  return {
    input: i.length === 1 ? price(i[0]) : null,
    output: o.length === 1 ? price(o[0]) : null,
    ambiguous: [...(i.length > 1 ? [`input x${i.length}`] : []), ...(o.length > 1 ? [`output x${o.length}`] : [])],
  };
}

async function fetchSkus(token) {
  const j = await gapi(token, `https://cloudbilling.googleapis.com/v1/${GEMINI_SERVICE}/skus?pageSize=2000&currencyCode=USD`);
  return j.skus || [];
}

// ─────────────────────────────────────────── billed tokens (Cloud Monitoring)

async function timeSeries(token, projectId, filter, groupBy = []) {
  const p = new URLSearchParams();
  p.set('filter', filter);
  p.set('interval.startTime', start.toISOString());
  p.set('interval.endTime', end.toISOString());
  p.set('aggregation.alignmentPeriod', '86400s');
  p.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
  // Trap A: deliberately NO crossSeriesReducer — it double-counts ~1.9x.
  for (const g of groupBy) p.append('aggregation.groupByFields', g);
  const j = await gapi(token, `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${p}`);
  return j.timeSeries || [];
}

const sumPoints = s => (s.points || []).reduce((a, b) => a + Number(b.value?.int64Value || b.value?.doubleValue || 0), 0);

/** Billed OUTPUT tokens per model. Includes thinking — that is the point. */
async function billedOutput(token, projectId) {
  const ts = await timeSeries(token, projectId,
    'metric.type="generativelanguage.googleapis.com/generate_content_usage_output_token_count"');
  const byModel = {};
  for (const s of ts) {
    const m = s.metric?.labels?.model || 'unknown';
    byModel[m] = (byModel[m] || 0) + sumPoints(s);
  }
  return byModel;
}

/** Billed INPUT tokens per model, summed across the paid-tier quota buckets. */
async function billedInput(token, projectId) {
  const byModel = {};
  for (const q of [
    'generate_content_paid_tier_input_token_count',
    'generate_content_paid_tier_2_input_token_count',
    'generate_content_paid_tier_3_input_token_count',
  ]) {
    const ts = await timeSeries(token, projectId,
      `metric.type="generativelanguage.googleapis.com/quota/${q}/usage"`);
    for (const s of ts) {
      const m = s.metric?.labels?.model || 'unknown';
      byModel[m] = (byModel[m] || 0) + sumPoints(s);
    }
  }
  return byModel;
}

// ─────────────────────────────────────────── our own meters

async function meteredCost(db) {
  const rows = await db.collection('gemini_usage').aggregate([
    { $match: { timestamp: { $gte: start, $lt: end } } },
    { $group: { _id: '$model', calls: { $sum: 1 }, cost: { $sum: '$cost_usd' },
                inTok: { $sum: '$input_tokens' }, outTok: { $sum: '$output_tokens' } } },
  ], { allowDiskUse: true }).toArray();
  const byModel = {};
  let calls = 0, cost = 0;
  for (const r of rows) {
    byModel[r._id || 'unknown'] = { calls: r.calls, cost: r.cost || 0, inTok: r.inTok || 0, outTok: r.outTok || 0 };
    calls += r.calls; cost += r.cost || 0;
  }
  return { byModel, calls, cost };
}

/** Successful GenerateContent calls Google saw — the denominator for meter coverage. */
async function googleCallCount(token, projectId) {
  const ts = await timeSeries(token, projectId,
    'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"');
  let ok = 0;
  for (const s of ts) {
    const code = s.metric?.labels?.response_code;
    const method = s.resource?.labels?.method || '';
    if (/GenerateContent/.test(method) && (!code || code === '200')) ok += sumPoints(s);
  }
  return ok;
}

// ─────────────────────────────────────────── R2 (Cloudflare)

// R2 published rates. Storage is GB-month; ops are per million requests.
const R2 = { storagePerGbMonth: 0.015, classAPerM: 4.50, classBPerM: 0.36 };
const R2_CLASS_A = new Set(['PutObject', 'ListObjects', 'CopyObject', 'CompleteMultipartUpload',
  'CreateMultipartUpload', 'UploadPart', 'ListBuckets', 'PutBucket', 'LifecycleStorageTierTransition']);

/** Some .env values carry literal quotes; an unstripped one silently becomes a
 *  malformed accountTag and Cloudflare answers "not authorized for that
 *  account" — which reads as a permissions problem and is not one. */
const envStr = k => (process.env[k] || '').trim().replace(/^["']|["']$/g, '');

async function r2Cost() {
  const token = envStr('CLOUDFLARE_API_TOKEN') || envStr('CF_API_TOKEN');
  const account = envStr('R2_ACCOUNT_ID');
  if (!token || !account) return { unreadable: 'CLOUDFLARE_API_TOKEN or R2_ACCOUNT_ID not set' };
  // Cloudflare caps analytics queries at ~4w4d, so clamp to the last 30 days.
  const to = new Date(Math.min(end.getTime(), Date.now()));
  const from = new Date(to.getTime() - 29 * 864e5);
  const d = x => x.toISOString().slice(0, 10);
  const q = `query { viewer { accounts(filter: {accountTag: "${account}"}) {
    storage: r2StorageAdaptiveGroups(limit: 200, orderBy: [date_DESC], filter: {date_geq: "${d(from)}", date_leq: "${d(to)}"}) {
      max { payloadSize objectCount } dimensions { date bucketName } }
    ops: r2OperationsAdaptiveGroups(limit: 500, filter: {date_geq: "${d(from)}", date_leq: "${d(to)}"}) {
      sum { requests } dimensions { actionType } }
  } } }`;
  const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: q }),
  });
  const j = await r.json().catch(() => ({}));
  const acct = j?.data?.viewer?.accounts?.[0];
  if (!acct) {
    const msg = j?.errors?.[0]?.message || `HTTP ${r.status}`;
    // Measured 2026-09-03: the production CLOUDFLARE_API_TOKEN is scoped to R2
    // object access and answers exactly this on the analytics endpoint. It is a
    // scope problem, not a wrong account id — the id resolves fine.
    return { unreadable: /not authorized/i.test(msg)
      ? `${msg} — the token needs the "Account Analytics Read" permission added (R2 object scopes are not enough)`
      : msg };
  }

  // Latest observation per bucket, not a sum across days.
  const latest = {};
  for (const s of acct.storage || []) {
    const b = s.dimensions.bucketName, dt = s.dimensions.date;
    if (!latest[b] || dt > latest[b].date) latest[b] = { date: dt, bytes: s.max.payloadSize, objects: s.max.objectCount };
  }
  const bytes = Object.values(latest).reduce((a, b) => a + b.bytes, 0);
  const objects = Object.values(latest).reduce((a, b) => a + b.objects, 0);
  let a = 0, b = 0;
  for (const o of acct.ops || []) (R2_CLASS_A.has(o.dimensions.actionType) ? (a += o.sum.requests) : (b += o.sum.requests));

  const gb = bytes / 1e9;
  return {
    buckets: latest, bytes, objects,
    storage: gb * R2.storagePerGbMonth,
    classA: (a / 1e6) * R2.classAPerM,
    classB: (b / 1e6) * R2.classBPerM,
    get total() { return this.storage + this.classA + this.classB; },
  };
}

// ─────────────────────────────────────────── report

async function main() {
  const out = { month: MONTH, generatedAt: new Date().toISOString() };
  let exitCode = 0;
  const log = (...a) => { if (!JSON_OUT) console.log(...a); };

  log(`\n═══ Spend reconciliation — ${MONTH} ═══\n`);

  // ---- Gemini: billed vs metered -----------------------------------------
  const token = googleToken();
  if (!token) {
    // Trap E: say so, loudly. An omitted line reads as zero.
    out.gemini = { unreadable: 'no Google access token (run `gcloud auth login`, or set GOOGLE_OAUTH_ACCESS_TOKEN)' };
    log('GEMINI: UNREADABLE — no Google access token.');
    log('        Run `gcloud auth login`, or set GOOGLE_OAUTH_ACCESS_TOKEN.\n');
  } else {
    const skus = await fetchSkus(token);
    log(`Price catalogue: ${skus.length} Gemini SKUs loaded (live from Cloud Billing).\n`);

    const billedOut = {}, billedIn = {};
    let googleCalls = 0;
    for (const p of PROJECTS) {
      const [o, i, c] = await Promise.all([
        billedOutput(token, p.id), billedInput(token, p.id), googleCallCount(token, p.id),
      ]);
      for (const [m, v] of Object.entries(o)) billedOut[m] = (billedOut[m] || 0) + v;
      for (const [m, v] of Object.entries(i)) billedIn[m] = (billedIn[m] || 0) + v;
      googleCalls += c;
    }

    // Positive control: a month with no series at all is a broken query, not a
    // quiet month. Say which, rather than reporting $0.
    const anyTokens = Object.values(billedOut).reduce((a, b) => a + b, 0);
    if (anyTokens === 0) {
      log('!! Cloud Monitoring returned ZERO output tokens for every project.');
      log('   That is a broken query or an out-of-retention month, NOT a $0 month.');
      log('   Monitoring retains ~6 weeks of this metric — re-run for a recent month.\n');
    }

    const models = [...new Set([...Object.keys(billedOut), ...Object.keys(billedIn)])]
      .filter(m => (billedOut[m] || 0) + (billedIn[m] || 0) > 0)
      .sort((a, b) => (billedOut[b] || 0) - (billedOut[a] || 0));

    log('BILLED (Cloud Monitoring tokens x live SKU prices)');
    log('  model                          input      output     est. cost');
    let est = 0;
    const perModel = [];
    for (const m of models) {
      const px = resolvePrice(skus, m);
      const i = billedIn[m] || 0, o = billedOut[m] || 0;
      const cost = px.input != null && px.output != null ? (i / 1e6) * px.input + (o / 1e6) * px.output : null;
      if (cost != null) est += cost;
      perModel.push({ model: m, inTok: i, outTok: o, price: px, cost });
      const note = px.ambiguous.length ? `  AMBIGUOUS SKU (${px.ambiguous.join(', ')}) — not priced`
        : px.input == null || px.output == null ? '  NO SKU MATCH — not priced' : '';
      log(`  ${m.padEnd(30)} ${M(i).padStart(8)} ${M(o).padStart(10)}   ${(cost != null ? money(cost) : '—').padStart(9)}${note}`);
    }
    log(`  ${''.padEnd(30)} ${''.padStart(8)} ${'TOTAL'.padStart(10)}   ${money(est).padStart(9)}`);

    // ---- our meters -------------------------------------------------------
    const uri = process.env.MONGODB_URI;
    let metered = null;
    if (uri) {
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
      try {
        await client.connect();
        metered = await meteredCost(client.db(process.env.MONGODB_DB || 'bookstore'));
      } finally { await client.close().catch(() => {}); }
    }

    log('\nMETERED (our own gemini_usage rows)');
    if (!metered) {
      log('  UNREADABLE — MONGODB_URI not set.');
    } else {
      log(`  cost_usd sum ............ ${money(metered.cost)}`);
      log(`  calls logged ............ ${metered.calls.toLocaleString()}`);
      log(`  calls Google saw ........ ${googleCalls.toLocaleString()}`);
      const cov = googleCalls ? (100 * metered.calls / googleCalls) : 0;
      log(`  meter coverage .......... ${cov.toFixed(0)}% of successful GenerateContent calls`);
      if (googleCalls > metered.calls) {
        log(`  UNLOGGED ................ ${(googleCalls - metered.calls).toLocaleString()} calls write no usage row (#4599)`);
      }
      const gap = est - metered.cost;
      log(`\nRECONCILIATION`);
      log(`  billed (est. from tokens) ${money(est)}`);
      log(`  metered (cost_usd)        ${money(metered.cost)}`);
      log(`  gap                       ${money(gap)}${metered.cost > 0 ? `  (${(est / metered.cost).toFixed(1)}x)` : ''}`);
      log(`  NB: compare the billed estimate to the Gemini SKUs on the invoice,`);
      log(`      never to the invoice total — the billing account carries six projects.`);
      out.reconciliation = { estimated: est, metered: metered.cost, gap, meterCoveragePct: cov };
    }

    // ---- price drift guard (the durable bit) ------------------------------
    //
    // There are TWO price tables, not one: `src/lib/ai.ts` for the TypeScript
    // Lambda/Next paths and `scripts/lib/model-pricing.mjs` for the .mjs
    // workers. They have drifted from each other AND from Google before —
    // `gemini-3.1-flash-lite` sat at 0.075/0.30 in one lane and 0.25/1.50 in
    // the other for months. Checking only one table misses exactly that.
    const TABLES = [
      { label: 'src/lib/ai.ts', url: new URL('../../src/lib/ai.ts', import.meta.url), symbol: 'MODEL_PRICING' },
      { label: 'scripts/lib/model-pricing.mjs', url: new URL('../lib/model-pricing.mjs', import.meta.url), symbol: 'MODEL_PRICING' },
    ];
    let drift = 0;
    const allKnown = new Set();

    for (const t of TABLES) {
      log(`\nPRICE DRIFT — ${t.label} vs Google catalogue`);
      let table = null;
      try {
        // Parse the object literal rather than importing: ai.ts is TypeScript
        // and needs a loader, and a parse works identically for both files.
        // The declaration may carry a TS type annotation between the name and
        // the `= {`, so match that rather than a literal `NAME = {`.
        const src = await (await import('node:fs/promises')).readFile(t.url, 'utf8');
        const decl = new RegExp(`${t.symbol}\\s*(?::[^=]+)?=\\s*\\{`).exec(src);
        if (decl) {
          const at = decl.index + decl[0].length;
          const body = src.slice(at, src.indexOf('};', at));
          table = {};
          for (const [, k, i, o] of body.matchAll(/'([^']+)':\s*\{\s*input:\s*([\d.]+),\s*output:\s*([\d.]+)/g)) {
            table[k] = { input: Number(i), output: Number(o) };
          }
          if (!Object.keys(table).length) table = null;
        }
      } catch { /* leave null */ }

      if (!table) {
        // A table we cannot read is a FAILED check, not a passed one. Silently
        // skipping it is how an unpriced lane hides.
        drift++;
        log(`  UNREADABLE — could not parse ${t.symbol} from ${t.label} (counted as drift)`);
        continue;
      }

      for (const [model, ours] of Object.entries(table)) {
        if (model === 'default') continue;
        allKnown.add(model.replace(/-preview$/, ''));
        const px = resolvePrice(skus, model);
        if (px.input == null || px.output == null) { log(`  ${model.padEnd(28)} no unambiguous SKU — cannot verify`); continue; }
        const bad = Math.abs(ours.input - px.input) > 1e-9 || Math.abs(ours.output - px.output) > 1e-9;
        if (bad) { drift++; log(`  ${model.padEnd(28)} DRIFT  ours $${ours.input}/$${ours.output}  vs list $${px.input}/$${px.output}`); }
        else log(`  ${model.padEnd(28)} ok     $${ours.input}/$${ours.output}`);
      }
    }

    // A model with real traffic and no entry in EITHER table falls through to a
    // default and is mispriced silently. That is a drift too.
    //
    // Careful: Monitoring labels the model WITHOUT the `-preview` suffix our
    // keys carry (`gemini-3-flash` vs `gemini-3-flash-preview`). Normalise, or
    // the check cries wolf on the busiest model in the fleet.
    log('\nPRICE COVERAGE — models with real traffic but no entry in either table');
    let missing = 0;
    for (const { model, outTok } of perModel) {
      if (outTok > 1e6 && !allKnown.has(model.replace(/-preview$/, ''))) {
        missing++; drift++;
        log(`  ${model.padEnd(28)} MISSING — ${M(outTok)} output tokens billed`);
      }
    }
    if (!missing) log('  every model with >1M billed output tokens is priced.');

    if (drift) { log(`\n  ${drift} pricing problem(s) — exit code 2.`); exitCode = 2; }
    else log('\n  No drift in either table.');

    out.gemini = { estimated: est, perModel, googleCalls, drift };
  }

  // ---- the rest of the surface -------------------------------------------
  log('\n─── the rest of what we spend on ───\n');
  const r2 = await r2Cost();
  if (r2.unreadable) {
    log(`R2 / Cloudflare ........... UNREADABLE — ${r2.unreadable}`);
  } else {
    log(`R2 storage ................ ${money(r2.storage)}/mo   (${(r2.bytes / 1e12).toFixed(2)} TB, ${(r2.objects / 1e6).toFixed(1)}M objects)`);
    log(`R2 class A ops ............ ${money(r2.classA)}/mo`);
    log(`R2 class B ops ............ ${money(r2.classB)}/mo`);
    log(`R2 total .................. ${money(r2.total)}/mo`);
  }
  out.r2 = r2;

  // Vendors with no machine-readable usage source. Named, never omitted.
  log('');
  for (const [vendor, why] of [
    ['Vercel', 'receipts only — Gmail from:invoice+statements@vercel.com (hosting is one of three subscriptions)'],
    ['Supabase', 'dashboard only — Organization > Billing > Invoices'],
    ['MongoDB Atlas', 'dashboard only — STILL UNKNOWN, the last unmeasured line'],
    ['Hetzner', 'receipts only — Gmail from:billing@hetzner.com'],
    ['GitHub', 'receipts only — $20/mo Team, Embassy-of-the-Free-Mind org'],
  ]) log(`${vendor.padEnd(26)} UNREADABLE — ${why}`);

  log('\nTo make the Google half exact rather than estimated, enable the Cloud');
  log('Billing export to BigQuery. It is NOT retroactive, so it only helps from');
  log('the day it is switched on.\n');

  if (JSON_OUT) console.log(JSON.stringify(out, null, 2));
  process.exit(exitCode);
}

main().catch(e => { console.error('spend-reconcile failed:', e.message); process.exit(1); });
