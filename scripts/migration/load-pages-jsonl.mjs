#!/usr/bin/env node
/**
 * Load pages from JSONL file into Supabase. Reads from local disk (fast),
 * blasts parallel batches to Supabase REST API.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/load-pages-jsonl.mjs /tmp/pages-dump.jsonl
 *
 * Options:
 *   --batch=N        Rows per API call (default 20)
 *   --concurrency=N  Parallel requests (default 20)
 *   --skip=N         Skip first N lines (for resume)
 */

import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_SERVICE_KEY) { console.error('Missing SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--')) || '/tmp/pages-dump.jsonl';
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '20', 10);
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '20', 10);
const SKIP = parseInt(args.find(a => a.startsWith('--skip='))?.split('=')[1] || '0', 10);

let errors = 0;

async function upsertBatch(rows) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      Prefer: 'resolution=ignore-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(30000),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`(${resp.status}): ${text.substring(0, 200)}`);
  }
}

async function upsertWithRetry(rows, depth = 0) {
  try {
    await upsertBatch(rows);
    return rows.length;
  } catch (err) {
    if (depth >= 3 || rows.length <= 1) {
      errors++;
      return 0;
    }
    const mid = Math.ceil(rows.length / 2);
    return (await upsertWithRetry(rows.slice(0, mid), depth + 1)) +
           (await upsertWithRetry(rows.slice(mid), depth + 1));
  }
}

async function main() {
  console.log(`Loading from ${inputFile}, batch=${BATCH_SIZE}, concurrency=${CONCURRENCY}, skip=${SKIP}`);

  const rl = createInterface({ input: createReadStream(inputFile), crlfDelay: Infinity });
  let lineNum = 0;
  let copied = 0;
  let buffer = [];
  let inflight = [];
  const startTime = Date.now();

  for await (const line of rl) {
    lineNum++;
    if (lineNum <= SKIP) continue;
    if (!line.trim()) continue;

    try {
      buffer.push(JSON.parse(line));
    } catch { continue; }

    if (buffer.length >= BATCH_SIZE) {
      inflight.push(upsertWithRetry(buffer));
      buffer = [];

      if (inflight.length >= CONCURRENCY) {
        const results = await Promise.all(inflight);
        copied += results.reduce((a, b) => a + b, 0);
        inflight = [];

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const rate = (copied / (elapsed || 1)).toFixed(0);
        process.stdout.write(`\r  ${copied.toLocaleString()} copied — ${rate} rows/s — ${errors} errors (line ${lineNum.toLocaleString()})`);
      }
    }
  }

  // Flush
  if (buffer.length > 0) inflight.push(upsertWithRetry(buffer));
  if (inflight.length > 0) {
    const results = await Promise.all(inflight);
    copied += results.reduce((a, b) => a + b, 0);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n\nDone: ${copied.toLocaleString()} copied, ${errors} errors in ${elapsed}s (${(copied / (elapsed || 1)).toFixed(0)} rows/s)`);
}

main().catch(err => { console.error(err); process.exit(1); });
