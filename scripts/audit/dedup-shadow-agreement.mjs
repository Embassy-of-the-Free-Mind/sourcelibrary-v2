#!/usr/bin/env node
/**
 * dedup-shadow-agreement — reads the flip criterion for #3730 §2.
 *
 * `checkDuplicate()` logs the edition-key tier's would-be verdict next to the
 * live tier-2 verdict on every real dedup decision (`dedup_shadow_decisions`).
 * This prints the per-day agreement so the flip ("a week of agreement") is a
 * measurement, not a feeling. Disagreements are listed newest-first — read
 * them: a shadow-only catch is usually the point of the flip (non-Latin,
 * author form, volume window; see PR #3787), a live-only catch is a potential
 * regression and blocks it.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/dedup-shadow-agreement.mjs [--days=14]
 */
import { MongoClient } from 'mongodb';

const DAYS = parseInt(process.argv.find((a) => a.startsWith('--days='))?.split('=')[1] || '14', 10);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const coll = db.collection('dedup_shadow_decisions');

const since = new Date(Date.now() - DAYS * 24 * 3600 * 1000);
const daily = await coll.aggregate([
  { $match: { at: { $gte: since } } },
  { $group: {
    _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
    total: { $sum: 1 },
    agree: { $sum: { $cond: ['$agree', 1, 0] } },
    shadowOnly: { $sum: { $cond: [{ $and: [{ $eq: [{ $size: '$live_tier2' }, 0] }, { $gt: [{ $size: '$shadow' }, 0] }] }, 1, 0] } },
    liveOnly: { $sum: { $cond: [{ $and: [{ $gt: [{ $size: '$live_tier2' }, 0] }, { $eq: [{ $size: '$shadow' }, 0] }] }, 1, 0] } },
  } },
  { $sort: { _id: 1 } },
]).toArray();

console.log(`dedup shadow agreement — last ${DAYS} days`);
if (!daily.length) {
  console.log('  no decisions logged yet (the shadow logs only on real checkDuplicate calls — imports and sweeps)');
} else {
  for (const d of daily) {
    const pct = ((100 * d.agree) / d.total).toFixed(2);
    console.log(`  ${d._id}  ${String(d.total).padStart(6)} decisions  ${pct}% agree  (shadow-only ${d.shadowOnly}, live-only ${d.liveOnly})`);
  }
  const totals = daily.reduce((a, d) => ({ total: a.total + d.total, agree: a.agree + d.agree, liveOnly: a.liveOnly + d.liveOnly }), { total: 0, agree: 0, liveOnly: 0 });
  console.log(`  overall: ${((100 * totals.agree) / totals.total).toFixed(2)}% over ${totals.total}; live-only (potential regressions): ${totals.liveOnly}`);
}

const disagreements = await coll.find({ agree: false, at: { $gte: since } }).sort({ at: -1 }).limit(20).toArray();
if (disagreements.length) {
  console.log(`  latest disagreements (${disagreements.length} shown):`);
  for (const d of disagreements) {
    const kind = d.live_tier2.length ? 'LIVE-ONLY' : 'shadow-only';
    console.log(`    ${d.at.toISOString().slice(0, 10)} [${kind}] ${JSON.stringify((d.title || '').slice(0, 70))} — ${d.author || '?'}, ${d.year ?? '?'}  live→[${d.live_tier2}] shadow→[${d.shadow}]`);
  }
}

await client.close();
