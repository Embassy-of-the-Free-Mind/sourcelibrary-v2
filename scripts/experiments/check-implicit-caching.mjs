#!/usr/bin/env node
/**
 * Experiment B: Check for Implicit Caching in Batch Results
 *
 * Gemini 2.5+ has implicit caching — repeated prompt prefixes may be cached
 * automatically. This script checks recent batch results for cachedContentTokenCount
 * in the usage metadata to see if we're already benefiting.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/experiments/check-implicit-caching.mjs
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const keys = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);
const UNIQUE_KEYS = [...new Set(keys)];

async function checkKey(key, label) {
  // List succeeded jobs
  const listResp = await fetch(`${GEMINI_API_BASE}/batches?key=${key}&pageSize=20`);
  if (!listResp.ok) { console.log(`${label}: list failed (${listResp.status})`); return; }
  const { operations = [] } = await listResp.json();

  let checked = 0;
  for (const op of operations) {
    if (op.metadata?.state !== 'BATCH_STATE_SUCCEEDED') continue;
    // Find the result file
    const destFile = op.metadata?.output?.responsesFile || op.metadata?.destFile;
    const destFileName = op.metadata?.output?.fileName;
    const fileRef = destFile || destFileName;
    if (!fileRef) continue;

    try {
      const dlUrl = fileRef.startsWith('files/')
        ? `${GEMINI_API_BASE}/${fileRef}:download?alt=media&key=${key}`
        : `https://generativelanguage.googleapis.com/download/v1beta/${fileRef}:download?alt=media&key=${key}`;
      const dr = await fetch(dlUrl);
      if (!dr.ok) continue;
      const text = await dr.text();
      const lines = text.trim().split('\n').slice(0, 3); // Check first 3 responses

      for (const line of lines) {
        const parsed = JSON.parse(line);
        const usage = parsed.response?.usageMetadata || {};
        const cached = usage.cachedContentTokenCount;
        console.log(`${label} | ${op.name?.substring(0, 35)} | prompt=${usage.promptTokenCount} cached=${cached || 'NONE'} total=${usage.totalTokenCount}`);
        console.log(`  All usage keys: ${Object.keys(usage).join(', ')}`);
      }
      checked++;
      if (checked >= 3) break; // Check 3 jobs per key
    } catch (e) {
      continue;
    }
  }
  if (checked === 0) console.log(`${label}: no downloadable results found`);
}

async function run() {
  console.log('=== Implicit Caching Check ===\n');
  console.log(`Checking ${UNIQUE_KEYS.length} keys for cachedContentTokenCount in batch results...\n`);

  for (let i = 0; i < UNIQUE_KEYS.length; i++) {
    await checkKey(UNIQUE_KEYS[i], `Key${i}`);
    console.log();
  }
}

run().catch(err => { console.error(err); process.exit(1); });
