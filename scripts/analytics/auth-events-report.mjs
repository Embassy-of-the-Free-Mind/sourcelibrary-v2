#!/usr/bin/env node
/**
 * Read the auth event log: sign-ins per day, split by provider, plus the
 * magic-link send→sign-in gap.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/analytics/auth-events-report.mjs [--days=14]
 *
 * The magic-link section is the one worth reading after any auth dependency
 * change: links sent with no sign-ins following them means the mail is going
 * out and nobody can use it (or is not going out at all). That was the open
 * question after #3431 and it previously took a human signing in to answer.
 */

import { MongoClient } from 'mongodb';

const days = parseInt((process.argv.find(a => a.startsWith('--days=')) || '').split('=')[1] || '14', 10);
const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = new MongoClient(uri);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const col = db.collection('auth_events');

const total = await col.estimatedDocumentCount();
if (total === 0) {
  console.log('auth_events is empty.');
  console.log('Expected until the first sign-in AFTER this shipped — the log is');
  console.log('append-only and not backfilled (nothing to backfill from: users.lastLogin');
  console.log('records no provider and keeps no history). Meanwhile:');
  console.log('  db.users.find({lastLogin:{$exists:true}}).sort({lastLogin:-1}).limit(5)');
  await client.close();
  process.exit(0);
}

const since = new Date(Date.now() - days * 86400_000);

const byDay = await col.aggregate([
  { $match: { ts: { $gte: since } } },
  { $group: { _id: { day: '$day', kind: '$kind', provider: '$provider' }, n: { $sum: 1 } } },
  { $sort: { '_id.day': -1 } },
]).toArray();

console.log(`auth_events — last ${days} days (${total} rows total)\n`);

const dayMap = new Map();
for (const r of byDay) {
  const d = dayMap.get(r._id.day) || {};
  d[`${r._id.kind}:${r._id.provider}`] = r.n;
  dayMap.set(r._id.day, d);
}
if (dayMap.size === 0) {
  console.log(`(no events in the last ${days} days)`);
} else {
  for (const [day, counts] of [...dayMap.entries()].sort().reverse()) {
    const parts = Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ');
    console.log(`  ${day}  ${parts}`);
  }
}

// Magic-link health. Deliberately compares SENDS to SIGN-INS rather than
// reporting a bare success rate: a rate needs both numbers to exist, and the
// failure being watched for is one of them being zero.
const sent = await col.countDocuments({ kind: 'magic_link_sent', ts: { $gte: since } });
const usedIn = await col.countDocuments({ kind: 'signin', provider: 'nodemailer', ts: { $gte: since } });
console.log(`\nmagic link: ${sent} sent -> ${usedIn} completed sign-ins`);
if (sent === 0) {
  console.log('  NOT MEASURABLE — no links requested in the window. Absence of');
  console.log('  sends is not evidence the flow works.');
} else if (usedIn === 0) {
  console.log('  WARNING: links are being sent and none are completing. Check the');
  console.log('  nodemailer/next-auth peer range and the Resend key before assuming');
  console.log('  users simply ignored them.');
}

// Unclassified rows are reported, never silently folded into "human".
const unclassified = await col.countDocuments({ traffic_class: null, ts: { $gte: since } });
if (unclassified) console.log(`\nnote: ${unclassified} event(s) written with no request scope (traffic_class null).`);

await client.close();
