/**
 * Aggregate Resend email events (logged by /api/webhooks/resend) into
 * bounce / open / complaint / click rates, per broadcast.
 *
 *   node scripts/email-broadcast-stats.mjs                 # all broadcasts, summary
 *   node scripts/email-broadcast-stats.mjs <broadcast_id>  # one broadcast
 *
 * Source via: set -a; source .env.production.local; set +a
 */

import { getScriptClient } from './lib/mongo.mjs';

const wantId = process.argv[2] || null;

const { db, cleanup } = await getScriptClient({ timeoutMs: 60000 });
try {
  const match = wantId ? { broadcast_id: wantId } : {};
  const rows = await db.collection('email_events').aggregate([
    { $match: match },
    // one row per (broadcast, email, type)
    { $group: { _id: { b: '$broadcast_id', e: '$to', t: '$type' } } },
    // collapse to per-(broadcast,email): which event types fired
    { $group: { _id: { b: '$_id.b', e: '$_id.e' }, types: { $addToSet: '$_id.t' } } },
    // tally per broadcast
    { $group: {
      _id: '$_id.b',
      recipients: { $sum: 1 },
      delivered: { $sum: { $cond: [{ $in: ['email.delivered', '$types'] }, 1, 0] } },
      bounced:   { $sum: { $cond: [{ $in: ['email.bounced', '$types'] }, 1, 0] } },
      complained:{ $sum: { $cond: [{ $in: ['email.complained', '$types'] }, 1, 0] } },
      opened:    { $sum: { $cond: [{ $in: ['email.opened', '$types'] }, 1, 0] } },
      clicked:   { $sum: { $cond: [{ $in: ['email.clicked', '$types'] }, 1, 0] } },
    } },
    { $sort: { _id: 1 } },
  ]).toArray();

  if (!rows.length) {
    console.log('No email_events yet' + (wantId ? ` for broadcast ${wantId}` : '') + '.');
  }
  for (const r of rows) {
    const denom = r.delivered || r.recipients || 1;
    const pct = (n) => `${((100 * n) / denom).toFixed(1)}%`;
    console.log(`\nBroadcast ${r._id || '(none)'}`);
    console.log(`  recipients seen: ${r.recipients}  delivered: ${r.delivered}`);
    console.log(`  bounced:    ${r.bounced} (${pct(r.bounced)})`);
    console.log(`  complaints: ${r.complained} (${pct(r.complained)})`);
    console.log(`  opened:     ${r.opened} (${pct(r.opened)})`);
    console.log(`  clicked:    ${r.clicked} (${pct(r.clicked)})`);
  }
} finally {
  cleanup();
}
