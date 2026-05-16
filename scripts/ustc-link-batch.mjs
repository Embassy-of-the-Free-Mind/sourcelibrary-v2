#!/usr/bin/env node
/**
 * Phase 2 of GitHub #1809 — bulk USTC AI-matcher.
 *
 * Iterate Source Library books that are in USTC's scope (pre-1830 printed
 * editions, not artwork, with author + title) and invoke the production
 * `/api/books/[id]/match-ustc` endpoint to set `ustc_id` + `ustc_match`.
 *
 * Uses CRON_SECRET for auth. Existing matched books are skipped unless
 * --force. Concurrency-controlled.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/ustc-link-batch.mjs --limit 50         # dry sample
 *   set -a; source .env.production.local; set +a; node scripts/ustc-link-batch.mjs --apply --limit 50 # apply sample
 *   set -a; source .env.production.local; set +a; node scripts/ustc-link-batch.mjs --apply            # full run
 *
 * Flags:
 *   --apply              fire requests (default: dry-run, only counts candidates)
 *   --limit N            cap at N books (default: no cap)
 *   --concurrency K      parallel requests (default: 6)
 *   --min-year YYYY      lower year bound (default: 1450)
 *   --max-year YYYY      upper year bound (default: 1830)
 *   --force              re-match books that already have ustc_id
 *   --include-no-year    also match books missing a year (default: skip — riskier)
 *   --resource-type T    only books with resource_type=T (default: skip resource_type='artwork')
 */

import { MongoClient } from 'mongodb';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const INCLUDE_NO_YEAR = process.argv.includes('--include-no-year');
const LIMIT = Number(arg('--limit', 0)) || 0;
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', 6)));
const MIN_YEAR = Number(arg('--min-year', 1450));
const MAX_YEAR = Number(arg('--max-year', 1830));

const API_BASE = 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET) {
  console.error('CRON_SECRET not set in environment');
  process.exit(1);
}

function buildQuery() {
  // Books in USTC scope: printed editions, year in range, has author + title
  const q = {
    visible: { $ne: false },
    resource_type: { $ne: 'artwork' },
    title: { $exists: true, $nin: ['', null] },
    author: { $exists: true, $nin: ['', null] },
  };
  if (!FORCE) {
    q.$or = [
      { ustc_id: { $exists: false } },
      { ustc_id: null },
    ];
  }
  if (INCLUDE_NO_YEAR) {
    q.$and = [
      { $or: [{ year: { $gte: MIN_YEAR, $lte: MAX_YEAR } }, { year: { $exists: false } }, { year: null }] },
    ];
  } else {
    q.year = { $gte: MIN_YEAR, $lte: MAX_YEAR };
  }
  return q;
}

async function matchOne(bookId) {
  const url = `${API_BASE}/api/books/${encodeURIComponent(bookId)}/match-ustc`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force: FORCE }),
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  return { ok: r.ok, status: r.status, body: parsed };
}

async function main() {
  console.log(`Phase 2: USTC AI-matcher batch`);
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN (candidate count only)'}`);
  console.log(`Year range: ${MIN_YEAR}-${MAX_YEAR}, concurrency: ${CONCURRENCY}, limit: ${LIMIT || '∞'}, include-no-year: ${INCLUDE_NO_YEAR}, force: ${FORCE}`);
  console.log();

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const q = buildQuery();
  const total = await books.countDocuments(q);
  console.log(`Candidate books matching filter: ${total}`);

  if (!APPLY) {
    // Also show a small sample
    const samples = await books.find(q, { projection: { id: 1, title: 1, author: 1, year: 1 } }).limit(5).toArray();
    console.log(`\nSample candidates:`);
    for (const s of samples) {
      console.log(`  [${s.id}] ${(s.title || '').slice(0, 60)} — ${(s.author || '').slice(0, 30)} (${s.year ?? '?'})`);
    }
    console.log(`\n(dry run — pass --apply to fire AI-matcher requests)`);
    await client.close();
    return;
  }

  // Stream candidates
  const cursor = books.find(q, { projection: { id: 1, title: 1, author: 1, year: 1 } });
  const cap = LIMIT || Infinity;
  const startedAt = Date.now();

  let processed = 0;
  let matched = 0;
  let skipped = 0;
  let errors = 0;
  let totalCostUsd = 0;
  const byConfidence = { high: 0, medium: 0, low: 0 };
  const errorSamples = [];

  // Concurrency pool
  const workers = [];
  const queue = [];
  let queueDone = false;

  async function worker(id) {
    while (true) {
      if (queue.length === 0) {
        if (queueDone) return;
        await new Promise(r => setTimeout(r, 50));
        continue;
      }
      const book = queue.shift();
      processed++;
      try {
        const res = await matchOne(book.id);
        if (!res.ok) {
          errors++;
          if (errorSamples.length < 5) errorSamples.push({ id: book.id, status: res.status, body: res.body });
        } else if (res.body.skipped) {
          skipped++;
        } else if (res.body.match) {
          matched++;
          const c = res.body.match.confidence;
          if (byConfidence[c] !== undefined) byConfidence[c]++;
          if (res.body.match.cost_usd) totalCostUsd += res.body.match.cost_usd;
        } else {
          skipped++;
        }
      } catch (e) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push({ id: book.id, error: String(e).slice(0, 200) });
      }
      // Progress
      if (processed % 25 === 0 || processed === cap) {
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = processed / elapsed;
        const remaining = (Math.min(cap, total) - processed) / rate;
        process.stdout.write(
          `\r  ${processed}/${Math.min(cap, total)}  matched:${matched} (H:${byConfidence.high} M:${byConfidence.medium} L:${byConfidence.low}) skip:${skipped} err:${errors}  $${totalCostUsd.toFixed(4)}  ${rate.toFixed(1)}/s  ETA ${(remaining / 60).toFixed(1)}min        `,
        );
      }
    }
  }

  for (let i = 0; i < CONCURRENCY; i++) workers.push(worker(i));

  // Feed queue
  let count = 0;
  for await (const book of cursor) {
    if (count++ >= cap) break;
    while (queue.length > CONCURRENCY * 4) await new Promise(r => setTimeout(r, 25));
    queue.push(book);
  }
  queueDone = true;
  await Promise.all(workers);

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(`\n\nDone in ${(elapsed / 60).toFixed(1)} min.`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Matched  : ${matched}  (high:${byConfidence.high}  medium:${byConfidence.medium}  low:${byConfidence.low})`);
  console.log(`  Skipped  : ${skipped}`);
  console.log(`  Errors   : ${errors}`);
  console.log(`  Cost     : $${totalCostUsd.toFixed(4)}`);

  if (errorSamples.length > 0) {
    console.log(`\nError samples:`);
    for (const e of errorSamples) console.log(`  ${e.id}  status=${e.status ?? '?'}  ${JSON.stringify(e.body || e.error).slice(0, 200)}`);
  }

  const finalTotal = await books.countDocuments({ ustc_id: { $exists: true, $ne: null } });
  console.log(`\nTotal books with ustc_id now: ${finalTotal}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
