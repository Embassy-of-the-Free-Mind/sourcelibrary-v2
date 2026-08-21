/**
 * "How many distinct authors are in the USTC-derived census, and what
 * proportion do we hold at least one book by?" — computed two ways, because
 * the honest answer is a range:
 *
 *   - exact tier: NFD-normalized string identity between a census author and
 *     any of our name forms (thesaurus variants + every books.author string).
 *     Undercounts — "Luther, Martin, 1483-1546" won't meet "Martin Luther"
 *     unless a form coincides. This is the FLOOR.
 *   - cluster tier: the builder's canonicalKey (scripts/lib/author-name-key.mjs)
 *     on both sides — folded Latin stems, order-insensitive, dates stripped.
 *     Slightly overcounts (aggressive stemming can collide two people).
 *     This is the ESTIMATE; truth sits between the tiers.
 *
 * Also reports edition-weighted coverage: the census is heavily Pareto —
 * matched authors carry far more editions than their headcount suggests,
 * because we hold the head of the distribution.
 *
 * First measured 2026-08-09 (post-#3780): 157,880 distinct census authors;
 * exact tier 15,067 (9.5%) covering 41.6% of authored editions.
 *
 * Used by the ustc-author-coverage.mjs CLI and by the nightly
 * snapshot-stats.mjs (so the number becomes a tracked series, not a one-off).
 */
import { canonicalKey } from './author-name-key.mjs';

const normExact = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z\s,]/g, ' ').replace(/\s+/g, ' ').trim();

export async function computeUstcAuthorCoverage(db) {
  // Our name forms, both tiers. Tombstoned docs still count — their variants
  // point at a person we hold under the surviving doc.
  const exact = new Set();
  const cluster = new Set();
  const add = (v) => {
    if (!v) return;
    const e = normExact(v);
    if (e) exact.add(e);
    const k = canonicalKey(v);
    if (k) cluster.add(k);
  };
  for await (const a of db.collection('authors').find({}, { projection: { variants: 1, canonical_name: 1 } })) {
    add(a.canonical_name);
    for (const v of a.variants || []) add(v);
  }
  for (const s of await db.collection('books').distinct('author', { author: { $type: 'string', $ne: '' } })) add(s);

  const cursor = db.collection('catalog_coverage').aggregate([
    { $match: { author: { $type: 'string', $nin: ['', null] } } },
    { $group: { _id: '$author', editions: { $sum: 1 } } },
  ], { allowDiskUse: true });

  const out = {
    census_distinct_authors: 0,
    census_authored_editions: 0,
    matched_exact: 0,
    matched_cluster: 0,
    editions_matched_exact: 0,
    editions_matched_cluster: 0,
  };
  for await (const r of cursor) {
    out.census_distinct_authors++;
    out.census_authored_editions += r.editions;
    if (exact.has(normExact(r._id))) { out.matched_exact++; out.editions_matched_exact += r.editions; }
    if (cluster.has(canonicalKey(r._id))) { out.matched_cluster++; out.editions_matched_cluster += r.editions; }
  }
  out.pct_authors_exact = +(100 * out.matched_exact / out.census_distinct_authors).toFixed(2);
  out.pct_authors_cluster = +(100 * out.matched_cluster / out.census_distinct_authors).toFixed(2);
  out.pct_editions_exact = +(100 * out.editions_matched_exact / out.census_authored_editions).toFixed(2);
  out.pct_editions_cluster = +(100 * out.editions_matched_cluster / out.census_authored_editions).toFixed(2);
  out.our_name_forms = exact.size;
  return out;
}
