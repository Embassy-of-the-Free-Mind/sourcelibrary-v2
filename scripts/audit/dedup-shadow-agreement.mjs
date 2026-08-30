#!/usr/bin/env node
/**
 * dedup-shadow-agreement — reads the flip criterion for #3730 §2.
 *
 * `checkDuplicate()` logs the live tier-2 verdict next to a shadow matcher's
 * on every real dedup decision (`dedup_shadow_decisions`). Rows carry a
 * `regime`:
 *
 *   (absent)         pre-flip — live was title+author, shadow was edition-key.
 *                    A shadow-only row is usually the point of the flip
 *                    (non-Latin, author form, volume window; PR #3787).
 *   'edition_live'   post-flip (2026-08-08) — live IS the edition tier, shadow
 *                    is the retired title+author tier. Here the signature
 *                    flips too: a SHADOW-ONLY row means the old tier caught
 *                    something the new one lets through — the regression to
 *                    read carefully. A week clean means the shadow block and
 *                    titleAuthorTierMatches() can be deleted.
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
    _id: {
      day: { $dateToString: { format: '%Y-%m-%d', date: '$at' } },
      regime: { $ifNull: ['$regime', 'pre_flip'] },
    },
    total: { $sum: 1 },
    agree: { $sum: { $cond: ['$agree', 1, 0] } },
    shadowOnly: { $sum: { $cond: [{ $and: [{ $eq: [{ $size: '$live_tier2' }, 0] }, { $gt: [{ $size: '$shadow' }, 0] }] }, 1, 0] } },
    liveOnly: { $sum: { $cond: [{ $and: [{ $gt: [{ $size: '$live_tier2' }, 0] }, { $eq: [{ $size: '$shadow' }, 0] }] }, 1, 0] } },
  } },
  { $sort: { '_id.day': 1, '_id.regime': 1 } },
]).toArray();

console.log(`dedup shadow agreement — last ${DAYS} days`);
if (!daily.length) {
  console.log('  no decisions logged yet (the shadow logs only on real checkDuplicate calls — imports and sweeps)');
} else {
  for (const d of daily) {
    const pct = ((100 * d.agree) / d.total).toFixed(2);
    console.log(`  ${d._id.day} [${d._id.regime}]  ${String(d.total).padStart(6)} decisions  ${pct}% agree  (shadow-only ${d.shadowOnly}, live-only ${d.liveOnly})`);
  }
  const post = daily.filter((d) => d._id.regime === 'edition_live');
  const totals = post.reduce((a, d) => ({ total: a.total + d.total, agree: a.agree + d.agree, shadowOnly: a.shadowOnly + d.shadowOnly }), { total: 0, agree: 0, shadowOnly: 0 });
  if (totals.total) {
    console.log(`  post-flip: ${((100 * totals.agree) / totals.total).toFixed(2)}% over ${totals.total}; shadow-only (old tier caught, new one didn't — the regression class): ${totals.shadowOnly}`);
  }
}

const disagreements = await coll.find({ agree: false, at: { $gte: since } }).sort({ at: -1 }).limit(20).toArray();
if (disagreements.length) {
  console.log(`  latest disagreements (${disagreements.length} shown):`);
  for (const d of disagreements) {
    // Post-flip, shadow-only is the regression class; pre-flip it was live-only.
    const kind = d.live_tier2.length ? 'live-only' : 'shadow-only';
    const flag = (d.regime === 'edition_live') === (kind === 'shadow-only') ? ' <- REGRESSION CLASS' : '';
    console.log(`    ${d.at.toISOString().slice(0, 10)} [${d.regime || 'pre_flip'}|${kind}] ${JSON.stringify((d.title || '').slice(0, 70))} — ${d.author || '?'}, ${d.year ?? '?'}  live→[${d.live_tier2}] shadow→[${d.shadow}]${flag}`);
  }
}

await client.close();
