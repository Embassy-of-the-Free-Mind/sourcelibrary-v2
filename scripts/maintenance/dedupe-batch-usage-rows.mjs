#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/reconcile-batch-usage.mjs — resolves PLACEHOLDER rows
 * (status submitted/pending) against batch_jobs. It never looks at a batch with two
 * TERMINAL rows, which is the defect here, and its `duplicate` verdict fires only when a
 * placeholder has a sibling. Extending it would mean a placeholder reconciler that also
 * rewrites terminal rows; the two questions are different and each wants its own dry run.
 * Also checked: scripts/audit/spend-reconcile.mjs (reads, never writes).
 *
 * dedupe-batch-usage-rows — one terminal usage row per batch job (#4822).
 *
 * WHY. `completeBatchUsage()` used to INSERT a fresh full-token row whenever the
 * placeholder PATCH matched nothing — and after the first collection the row is
 * terminal, not a placeholder, so every re-collection added a byte-identical row.
 * Measured 2026-09-01..13: 1,645 of 2,139 batch jobs, 50.6M phantom output tokens,
 * $39.51 of metered spend that was never spent, 4,747 phantom pages. #4822 stopped
 * new ones; this repairs the ones already written.
 *
 * WHAT IT DOES. For every batch_job_id with more than one row outside the placeholder
 * statuses, keep the EARLIEST (the collector's first reading, which carries the
 * endpoint label) and mark each later one `status: 'duplicate', cost_usd: 0,
 * output_tokens: 0, input_tokens: 0, page_count: 0`. That is the status
 * reconcile-batch-usage already uses for "the money is on another row", every sum
 * already excludes it, and the row keeps its timestamp for the record.
 *
 * NEVER DELETES. A marked row can be unmarked; a deleted one cannot be audited.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-batch-usage-rows.mjs --dry-run
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-batch-usage-rows.mjs --since=2026-08-01
 *   node --env-file=.env.production.local scripts/maintenance/dedupe-batch-usage-rows.mjs --since=2026-08-01 --apply
 *
 * Writes only with --apply. Prints the same tally either way, so the dry run IS the
 * number you approve.
 */

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const SINCE = (args.find(a => a.startsWith('--since=')) || '').split('=')[1] || '2026-08-01';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }
const PLACEHOLDER = new Set(['submitted', 'pending', 'duplicate', 'unknown']);

async function sb(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}`, ...(init.headers || {}) },
  });
  if (!r.ok && r.status !== 206) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

// Read every batch row since SINCE. Ordered, paged: an unordered range samples the
// query plan, and PostgREST caps a page at 1,000.
const rows = [];
for (let from = 0; ; from += 1000) {
  const r = await sb(`gemini_usage?mode=eq.batch&timestamp=gte.${SINCE}T00:00:00Z&batch_job_id=not.is.null&select=id,timestamp,batch_job_id,status,endpoint,input_tokens,output_tokens,cost_usd,page_count&order=id.asc`,
    { headers: { Range: `${from}-${from + 999}` } });
  const b = await r.json();
  rows.push(...b);
  if (b.length < 1000) break;
}

const byJob = new Map();
for (const r of rows) {
  if (PLACEHOLDER.has(r.status)) continue;
  byJob.set(r.batch_job_id, [...(byJob.get(r.batch_job_id) || []), r]);
}

const surplus = [];
let identical = 0, differing = 0;
for (const [, list] of byJob) {
  if (list.length < 2) continue;
  list.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)) || String(a.id).localeCompare(String(b.id)));
  const [keep, ...rest] = list;
  for (const x of rest) {
    const same = x.output_tokens === keep.output_tokens && x.input_tokens === keep.input_tokens && Math.abs((x.cost_usd || 0) - (keep.cost_usd || 0)) < 1e-9;
    if (same) identical++; else differing++;
    surplus.push({ row: x, keep, same });
  }
}

const sum = (k) => surplus.reduce((a, s) => a + (s.row[k] || 0), 0);
console.log(`batch rows read since ${SINCE} ....... ${rows.length.toLocaleString()}`);
console.log(`batch jobs with a terminal row ..... ${byJob.size.toLocaleString()}`);
console.log(`jobs with more than one ............ ${[...byJob.values()].filter(l => l.length > 1).length.toLocaleString()}`);
console.log(`surplus rows to mark duplicate ..... ${surplus.length.toLocaleString()}  (${identical} identical to the kept row, ${differing} differing)`);
console.log(`phantom output tokens withdrawn .... ${(sum('output_tokens') / 1e6).toFixed(2)}M`);
console.log(`phantom cost withdrawn ............. $${sum('cost_usd').toFixed(2)}`);
console.log(`phantom pages withdrawn ............ ${sum('page_count').toLocaleString()}`);

// A differing pair is not obviously a duplicate. Report them, never touch them
// without a human having seen the list.
const odd = surplus.filter(s => !s.same);
if (odd.length) {
  console.log(`\n${odd.length} DIFFERING pair(s) — left untouched, listed for review:`);
  for (const s of odd.slice(0, 20)) console.log(`  ${s.row.batch_job_id}  keep ${s.keep.output_tokens}/$${s.keep.cost_usd}  surplus ${s.row.output_tokens}/$${s.row.cost_usd}`);
}

if (!APPLY) { console.log('\n(dry run — re-run with --apply to mark the identical surplus rows duplicate)'); process.exit(0); }

let done = 0;
for (const s of surplus) {
  if (!s.same) continue;
  await sb(`gemini_usage?id=eq.${encodeURIComponent(s.row.id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'duplicate', cost_usd: 0, input_tokens: 0, output_tokens: 0, page_count: 0,
      error_message: `Dedupe #4822: same batch collected twice; spend is on row ${s.keep.id}`,
      completed_at: new Date().toISOString(),
    }),
  });
  done++;
  if (done % 200 === 0) console.log(`  marked ${done}`);
}
console.log(`\nmarked duplicate: ${done} rows`);
