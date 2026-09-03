#!/usr/bin/env node
/**
 * Measure what rate Gallica's IIIF manifest endpoint actually sustains.
 *
 * WHY. The import wave used a 20s delay picked by guesswork and failed 169 times
 * in a row on 429. "Slow down a bit" is not a measurement, and a wrong guess
 * costs a partner institution an hour of refused requests.
 *
 * Two phases:
 *  1. RECOVERY — poll one manifest until it answers 200, to learn how long a
 *     throttled IP stays throttled.
 *  2. SUSTAIN — fetch N manifests at a candidate interval and report the success
 *     rate, so the import delay is set from evidence.
 *
 * Read-only: fetches manifests, writes nothing.
 *
 * Usage:
 *   node scripts/import/gallica-rate-probe.mjs --interval 45 --samples 8
 */

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const INTERVAL = parseInt(arg('--interval', '45'), 10) * 1000;
const SAMPLES = parseInt(arg('--samples', '8'), 10);
const MAX_WAIT_MIN = parseInt(arg('--max-wait', '20'), 10);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

// Distinct arks — hitting the same one repeatedly could be answered from cache
// and would measure the cache, not the rate limit.
const ARKS = [
  'btv1b10545065q', 'btv1b10721363h', 'btv1b52509699g', 'btv1b11001770s',
  'btv1b52504032v', 'btv1b110025567', 'btv1b10884453n', 'btv1b10884637c',
  'btv1b84229648', 'btv1b10037531k', 'btv1b10037511r', 'btv1b100374998',
];

async function probe(ark) {
  const t0 = Date.now();
  try {
    const r = await fetch(`https://gallica.bnf.fr/iiif/ark:/12148/${ark}/manifest.json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) });
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { status: e.name, ms: Date.now() - t0 }; }
}

// ── phase 1: how long does a throttled IP stay throttled? ───────────────────
console.log('PHASE 1 — recovery. Polling one manifest every 60s until it answers 200.');
const start = Date.now();
let recovered = false;
for (let i = 0; i < MAX_WAIT_MIN; i++) {
  const r = await probe(ARKS[0]);
  const mins = ((Date.now() - start) / 60000).toFixed(1);
  console.log(`  t+${String(mins).padStart(5)}min  ${r.status}  (${r.ms}ms)`);
  if (r.status === 200) { recovered = true; console.log(`  RECOVERED after ~${mins} minutes`); break; }
  await new Promise(s => setTimeout(s, 60000));
}
if (!recovered) {
  console.log(`\nStill throttled after ${MAX_WAIT_MIN} minutes. Do not start an import.`);
  process.exit(3);
}

// ── phase 2: what interval does it sustain? ─────────────────────────────────
console.log(`\nPHASE 2 — sustain. ${SAMPLES} distinct manifests at ${INTERVAL / 1000}s spacing.`);
let ok = 0, throttled = 0;
for (let i = 0; i < SAMPLES; i++) {
  const r = await probe(ARKS[(i + 1) % ARKS.length]);
  if (r.status === 200) ok++; else if (r.status === 429) throttled++;
  console.log(`  ${String(i + 1).padStart(2)}/${SAMPLES}  ${r.status}  (${r.ms}ms)`);
  if (i < SAMPLES - 1) await new Promise(s => setTimeout(s, INTERVAL));
}
const rate = (100 * ok / SAMPLES).toFixed(0);
console.log(`\nAt ${INTERVAL / 1000}s spacing: ${ok}/${SAMPLES} succeeded (${rate}%), ${throttled} throttled.`);
console.log(ok === SAMPLES
  ? `SUSTAINED. Use --delay ${INTERVAL} for the import.`
  : `NOT sustained. Try a longer interval before importing; do not just retry.`);
