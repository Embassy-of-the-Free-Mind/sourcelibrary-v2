#!/usr/bin/env node
/**
 * One-time scrub of full IP addresses persisted before 2026-09 (privacy PR).
 *
 * Writers were fixed in the same PR to never store a full IP again:
 *   - /api/feedback           → stores ip_hash (sha256/16) instead of ip
 *   - volunteers upsert       → same
 *   - dataset logAccess()     → anonymizes ip_address at the write boundary
 *
 * This script brings EXISTING rows in line with /privacy's "we do not store
 * full IP addresses" claim:
 *   - feedback:            ip → ip_hash (same sha256/16 as the writer), $unset ip
 *   - volunteers:          ip → ip_hash, $unset ip
 *   - dataset_access_log:  ip_address → anonymized (last octet / last groups zeroed)
 *
 * Hashing (not deleting) preserves same-submitter correlation for abuse triage.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/anonymize-stored-ips-2026-09.mjs           # dry run
 *   node --env-file=.env.production.local scripts/maintenance/anonymize-stored-ips-2026-09.mjs --apply   # write
 */
import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';

const APPLY = process.argv.includes('--apply');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

function hashIp(ip) {
  return createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// Mirror of src/lib/anonymize-ip.ts
function anonymizeIp(ip) {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes('.') && !ip.includes(':')) {
    const parts = ip.split('.');
    if (parts.length === 4) { parts[3] = '0'; return parts.join('.'); }
  }
  if (ip.includes(':')) {
    const parts = ip.split(':');
    if (parts.length >= 4) return parts.slice(0, 3).join(':') + '::0';
  }
  return 'unknown';
}

function isAlreadyAnonymized(ip) {
  return ip === 'unknown' || ip.endsWith('.0') || ip.endsWith('::0');
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

// --- feedback + volunteers: ip → ip_hash ---
for (const collName of ['feedback', 'volunteers']) {
  const coll = db.collection(collName);
  const cursor = coll.find(
    { ip: { $exists: true, $type: 'string' } },
    { projection: { ip: 1 } }
  );
  let seen = 0, changed = 0;
  for await (const doc of cursor) {
    seen++;
    if (APPLY) {
      await coll.updateOne(
        { _id: doc._id },
        { $set: { ip_hash: hashIp(doc.ip) }, $unset: { ip: '' } }
      );
      changed++;
    }
  }
  console.log(`${collName}: ${seen} rows with a stored ip${APPLY ? `, ${changed} rewritten to ip_hash` : ' (dry run — would rewrite to ip_hash)'}`);
}

// --- dataset_access_log: anonymize ip_address in place ---
{
  const coll = db.collection('dataset_access_log');
  const cursor = coll.find(
    { ip_address: { $exists: true, $type: 'string' } },
    { projection: { ip_address: 1 } }
  );
  let seen = 0, changed = 0, skipped = 0;
  for await (const doc of cursor) {
    seen++;
    if (isAlreadyAnonymized(doc.ip_address)) { skipped++; continue; }
    if (APPLY) {
      await coll.updateOne(
        { _id: doc._id },
        { $set: { ip_address: anonymizeIp(doc.ip_address) } }
      );
      changed++;
    }
  }
  console.log(`dataset_access_log: ${seen} rows, ${skipped} already anonymized${APPLY ? `, ${changed} anonymized now` : ` (dry run — would anonymize ${seen - skipped})`}`);
}

await client.close();
console.log(APPLY ? 'Done.' : 'Dry run complete. Re-run with --apply to write.');
