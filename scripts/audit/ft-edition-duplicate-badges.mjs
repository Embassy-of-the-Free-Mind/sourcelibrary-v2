#!/usr/bin/env node
/**
 * Same printing, badged "first" twice (#3726 Tier 5).
 *
 * The edition layer (#3710, `books.edition_key`) makes one over-count class
 * detectable: two scans of the SAME printing both carrying
 * `is_first_translation: true`. Under the grain policy this is the only
 * genuine over-count — different editions of a work can argue about
 * first_from_source; the same edition cannot be first twice.
 *
 * READ-ONLY. For each duplicate cluster, proposes a KEEPER (most translated
 * pages, then quality_score, then OCR coverage) and lists the rest as
 * cross-link candidates. Nothing is written; the output is a sign-off queue.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/ft-edition-duplicate-badges.mjs [--json out.json]
 */
import fs from 'fs';
import { MongoClient } from 'mongodb';

const jsonOut = (() => {
  const i = process.argv.indexOf('--json');
  return i > -1 ? process.argv[i + 1] : null;
})();

const client = await MongoClient.connect(process.env.MONGODB_URI);
const books = client.db('bookstore').collection('books');

const clusters = await books.aggregate([
  { $match: { is_first_translation: true, visible: true, edition_key: { $exists: true, $nin: [null, ''] } } },
  { $group: {
    _id: '$edition_key',
    n: { $sum: 1 },
    members: { $push: {
      id: '$id', slug: '$slug', title: '$display_title', raw_title: '$title',
      author: '$author', year: '$year', language: '$language',
      pages_count: '$pages_count', pages_ocr: '$pages_ocr',
      pages_translated: '$pages_translated', quality_score: '$quality_score',
      verdict: '$first_translation.verdict',
      evidence: '$first_translation.evidence_strength',
    } },
  } },
  { $match: { n: { $gt: 1 } } },
  { $sort: { n: -1 } },
]).toArray();

const rank = (b) => [b.pages_translated ?? 0, b.quality_score ?? 0, b.pages_ocr ?? 0];
const better = (a, b) => {
  const ra = rank(a), rb = rank(b);
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
  return 0;
};

/**
 * A cluster only counts as "the same printing scanned twice" if the members
 * LOOK like the same printing. edition_key is known to over-merge generic
 * titles and unnumbered multivolume sets (#3708/#3710 — same trap as the thor
 * bu false-canonicalization), and a false merge here would demote a genuine
 * first. Signal: page counts diverging >15% (or >20 pages) means different
 * items sharing a key — route those to identity work, never to badge changes.
 */
function suspectFalseMerge(members) {
  const counts = members.map((m) => m.pages_count ?? 0).filter((n) => n > 0);
  if (counts.length < 2) return true; // cannot compare — do not trust the merge
  const min = Math.min(...counts), max = Math.max(...counts);
  return max - min > Math.max(20, min * 0.15);
}

const report = clusters.map((c) => {
  const sorted = [...c.members].sort(better);
  return {
    edition_key: c._id,
    size: c.n,
    suspect_false_merge: suspectFalseMerge(c.members),
    keeper: sorted[0],
    duplicates: sorted.slice(1),
  };
});

const trueDupes = report.filter((c) => !c.suspect_false_merge);
const suspect = report.filter((c) => c.suspect_false_merge);
const excess = trueDupes.reduce((s, c) => s + c.duplicates.length, 0);
console.log(`SAME-EDITION DOUBLE BADGES — ${report.length} clusters total`);
console.log(`  likely true duplicates : ${trueDupes.length} clusters, ${excess} excess badges (the sign-off queue)`);
console.log(`  suspected FALSE merges : ${suspect.length} clusters (page counts diverge — route to identity work, do NOT touch badges)\n`);
for (const c of [...trueDupes, ...suspect]) {
  console.log(`[${c.size}]${c.suspect_false_merge ? ' ⚠ FALSE-MERGE?' : ''} ${c.edition_key}`);
  const k = c.keeper;
  console.log(`  KEEP  ${k.id}  ${String(k.title || k.raw_title).slice(0, 70)} (tr ${k.pages_translated ?? 0}/${k.pages_count ?? '?'}, q ${k.quality_score ?? '-'})`);
  for (const d of c.duplicates) {
    console.log(`  dup   ${d.id}  ${String(d.title || d.raw_title).slice(0, 70)} (tr ${d.pages_translated ?? 0}/${d.pages_count ?? '?'}, q ${d.quality_score ?? '-'})`);
  }
}
console.log('\nNothing was written. This is a sign-off queue: for each cluster, the');
console.log('duplicate keeps its book page but should cross-link the keeper rather');
console.log('than badge independently. Apply path: TBD with Derek (#3726 Tier 5).');

if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ measured_at: new Date().toISOString(), clusters: report }, null, 2));
  console.log(`\nJSON: ${jsonOut}`);
}
await client.close();
