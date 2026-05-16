#!/usr/bin/env node
/**
 * Size the anonymous API rate limit from real api_usage data.
 *
 * Reads the last N days of api_usage (default 7), focuses on anon callers,
 * and reports:
 *   1. Per-IP hourly distribution (p50/p90/p99/max)
 *   2. Top anon IPs by volume — for spotting scrapers
 *   3. Tool/route mix among anon traffic
 *   4. User-agent distribution
 *   5. Block rate at candidate limits (current observe-mode would_block,
 *      plus hypothetical limits if you wanted to flip enforcement now)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/analyze-anon-rate-limit.mjs [--days N] [--candidates 60,120,200,500]
 */

import { MongoClient } from 'mongodb';

const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const eq = arg.match(/^--([^=]+)=(.*)$/);
  if (eq) { args[eq[1]] = eq[2]; continue; }
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i++; }
    else { args[key] = 'true'; }
  }
}

const DAYS = Number(args.days || 7);
const CANDIDATES = (args.candidates || '60,120,200,500')
  .split(',').map(n => Number(n.trim())).filter(n => n > 0);

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set. Source .env.production.local first.');
  process.exit(1);
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmtPct(n) { return (n * 100).toFixed(1) + '%'; }
function fmtNum(n) { return n.toLocaleString(); }

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const col = db.collection('api_usage');

  const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
  console.log(`Source Library — anonymous API rate-limit sizing report`);
  console.log(`Window: ${since.toISOString()} → now (${DAYS} days)`);
  console.log('='.repeat(72));

  // --- 1. Totals + identity breakdown ---
  const byIdentity = await col.aggregate([
    { $match: { ts: { $gte: since } } },
    { $group: { _id: '$identity_kind', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  const total = byIdentity.reduce((s, r) => s + r.count, 0);
  console.log(`\nTotal gated calls: ${fmtNum(total)}`);
  console.log('Identity breakdown:');
  for (const r of byIdentity) {
    console.log(`  ${(r._id || 'unknown').padEnd(10)} ${fmtNum(r.count).padStart(10)}  ${fmtPct(r.count / total)}`);
  }

  const anonTotal = byIdentity.find(r => r._id === 'anon')?.count || 0;
  if (anonTotal === 0) {
    console.log('\nNo anonymous traffic in the window — nothing to size.');
    await client.close();
    return;
  }

  // --- 2. Per-IP hourly volume distribution ---
  // Bucket anon calls into (ip_hash, hour) cells and count.
  const hourlyCells = await col.aggregate([
    { $match: { ts: { $gte: since }, identity_kind: 'anon' } },
    {
      $group: {
        _id: {
          ip: '$ip_hash',
          hour: { $dateTrunc: { date: '$ts', unit: 'hour' } },
        },
        n: { $sum: 1 },
      },
    },
  ]).toArray();

  const counts = hourlyCells.map(c => c.n);
  console.log(`\nPer-IP hourly volume (${fmtNum(hourlyCells.length)} (ip, hour) cells across ${DAYS} days):`);
  console.log(`  p50: ${pct(counts, 50)}`);
  console.log(`  p90: ${pct(counts, 90)}`);
  console.log(`  p95: ${pct(counts, 95)}`);
  console.log(`  p99: ${pct(counts, 99)}`);
  console.log(`  max: ${Math.max(...counts)}`);
  console.log(`  mean: ${(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)}`);

  // --- 3. Candidate-limit block rate ---
  console.log(`\nIf API_AUTH_ENFORCE=1 with anon limit set to N, what fraction of (ip, hour)`);
  console.log(`cells would have been at-or-past the limit? (i.e. blocked some calls):`);
  console.log(`  ${'limit'.padStart(6)}  ${'cells_capped'.padStart(13)}  ${'%_capped'.padStart(9)}  ${'calls_blocked'.padStart(14)}  ${'%_calls_blocked'.padStart(16)}`);
  for (const lim of CANDIDATES) {
    const capped = counts.filter(n => n > lim).length;
    const callsBlocked = counts.filter(n => n > lim).reduce((s, n) => s + (n - lim), 0);
    console.log(
      `  ${String(lim).padStart(6)}  ${String(capped).padStart(13)}  ${fmtPct(capped / hourlyCells.length).padStart(9)}  ${String(callsBlocked).padStart(14)}  ${fmtPct(callsBlocked / anonTotal).padStart(16)}`,
    );
  }

  // --- 4. Top anon IPs by total volume ---
  const topIps = await col.aggregate([
    { $match: { ts: { $gte: since }, identity_kind: 'anon' } },
    {
      $group: {
        _id: '$ip_hash',
        total: { $sum: 1 },
        first_seen: { $min: '$ts' },
        last_seen: { $max: '$ts' },
        sample_ua: { $first: '$user_agent' },
        unique_routes: { $addToSet: '$route' },
      },
    },
    { $sort: { total: -1 } },
    { $limit: 15 },
  ]).toArray();

  console.log(`\nTop 15 anon IP-hashes by total volume:`);
  console.log(`  ${'ip_hash'.padEnd(18)} ${'calls'.padStart(7)}  ${'span (hrs)'.padStart(11)}  ${'routes'.padEnd(20)}  user_agent`);
  for (const r of topIps) {
    const hrs = ((r.last_seen - r.first_seen) / 3600000).toFixed(1);
    const routes = (r.unique_routes || []).slice(0, 3).join(',');
    const ua = (r.sample_ua || '').slice(0, 50);
    console.log(`  ${r._id.padEnd(18)} ${String(r.total).padStart(7)}  ${hrs.padStart(11)}  ${routes.padEnd(20)}  ${ua}`);
  }

  // --- 5. Route mix among anon traffic ---
  const byRoute = await col.aggregate([
    { $match: { ts: { $gte: since }, identity_kind: 'anon' } },
    { $group: { _id: '$route', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 12 },
  ]).toArray();
  console.log(`\nAnon traffic by route:`);
  for (const r of byRoute) {
    console.log(`  ${(r._id || '?').padEnd(20)} ${fmtNum(r.count).padStart(9)}  ${fmtPct(r.count / anonTotal).padStart(7)}`);
  }

  // --- 6. User-agent distribution (best-effort, top stems) ---
  const byUaStem = await col.aggregate([
    { $match: { ts: { $gte: since }, identity_kind: 'anon' } },
    {
      $project: {
        ua_stem: { $substr: ['$user_agent', 0, 40] },
      },
    },
    { $group: { _id: '$ua_stem', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 12 },
  ]).toArray();
  console.log(`\nTop anon user-agent prefixes (first 40 chars):`);
  for (const r of byUaStem) {
    console.log(`  ${(r._id || '(none)').padEnd(42)} ${fmtNum(r.count).padStart(9)}  ${fmtPct(r.count / anonTotal).padStart(7)}`);
  }

  // --- 7. Observe-mode would_block summary ---
  const wouldBlockNow = await col.aggregate([
    { $match: { ts: { $gte: since }, identity_kind: 'anon' } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        would_block: { $sum: { $cond: ['$would_block', 1, 0] } },
      },
    },
  ]).toArray();
  if (wouldBlockNow[0]) {
    const { total: t, would_block: wb } = wouldBlockNow[0];
    console.log(`\nObserve-mode (current limit=API_ANON_LIMIT_PER_HOUR): would_block flag is set on ${fmtNum(wb)}/${fmtNum(t)} anon calls (${fmtPct(wb / t)})`);
  }

  console.log('\n' + '='.repeat(72));
  console.log('Read: "cells_capped" is the # of (ip, hour) buckets that EXCEEDED the limit.');
  console.log('      "calls_blocked" is how many requests would have hit 401, summed across all buckets.');
  console.log('Pick a limit where calls_blocked stays below the noise level you can tolerate.');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
