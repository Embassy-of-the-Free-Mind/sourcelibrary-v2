#!/usr/bin/env node
/**
 * Generate a gold standard labeling set for dedup evaluation.
 *
 * Samples 1,000 record pairs across four strata:
 *   1. Positive: pairs from existing Jaro-Winkler clusters (likely matches)
 *   2. Negative: same-block pairs NOT matched (likely non-matches)
 *   3. Hard negatives: similar titles from different works
 *   4. Cross-source: pairs spanning different libraries
 *
 * Outputs JSON with pairs ready for human labeling.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node research/dedup-paper/generate-gold-standard.mjs
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

console.log('Generating gold standard labeling set...\n');

const col = db.collection('import_candidates');

// ── Helper: normalize for display ────────────────────────────────────────

function pairRecord(rec) {
  return {
    id: rec._id.toString(),
    source: rec.source,
    source_id: rec.source_id,
    title: rec.title,
    author: rec.author,
    language: rec.language,
    date_text: rec.date_text,
    date_earliest: rec.date_earliest,
    manifest_url: rec.manifest_url,
  };
}

const pairs = [];

// ── Stratum 1: Positive pairs from dedup clusters (400) ─────────────────

console.log('Sampling positive pairs from dedup clusters...');

// Same-source same-edition (BSB internal dupes) — 150 pairs
const bsbClusters = await col.aggregate([
  { $match: { source: 'bsb', dedup_cluster: { $exists: true }, dedup_cluster_size: { $gte: 2, $lte: 5 } } },
  { $group: { _id: '$dedup_cluster', records: { $push: '$$ROOT' }, size: { $first: '$dedup_cluster_size' } } },
  { $sample: { size: 150 } },
]).toArray();

for (const cluster of bsbClusters) {
  if (cluster.records.length >= 2) {
    pairs.push({
      stratum: 'positive_same_source',
      expected_label: 'same_manifestation',
      a: pairRecord(cluster.records[0]),
      b: pairRecord(cluster.records[1]),
      cluster_id: cluster._id,
      label: null, // to be filled by human
      notes: '',
    });
  }
}
console.log(`  Same-source pairs: ${bsbClusters.length}`);

// Cross-source same-edition — 100 pairs
const crossClusters = await col.aggregate([
  { $match: { dedup_cluster: { $exists: true } } },
  { $group: { _id: '$dedup_cluster', records: { $push: '$$ROOT' }, sources: { $addToSet: '$source' } } },
  { $match: { 'sources.1': { $exists: true } } }, // at least 2 sources
  { $sample: { size: 100 } },
]).toArray();

for (const cluster of crossClusters) {
  // Pick one record from each source
  const sourceGroups = {};
  cluster.records.forEach(r => {
    if (!sourceGroups[r.source]) sourceGroups[r.source] = r;
  });
  const sources = Object.values(sourceGroups);
  if (sources.length >= 2) {
    pairs.push({
      stratum: 'positive_cross_source',
      expected_label: 'same_manifestation_or_work',
      a: pairRecord(sources[0]),
      b: pairRecord(sources[1]),
      cluster_id: cluster._id,
      label: null,
      notes: '',
    });
  }
}
console.log(`  Cross-source pairs: ${crossClusters.length}`);

// Borderline matches (from large clusters, size 10+) — 50 pairs
const largeClusters = await col.aggregate([
  { $match: { dedup_cluster: { $exists: true }, dedup_cluster_size: { $gte: 8 } } },
  { $group: { _id: '$dedup_cluster', records: { $push: '$$ROOT' }, size: { $first: '$dedup_cluster_size' } } },
  { $sample: { size: 50 } },
]).toArray();

for (const cluster of largeClusters) {
  // Pick the two most dissimilar records in the cluster
  const first = cluster.records[0];
  const last = cluster.records[cluster.records.length - 1];
  pairs.push({
    stratum: 'positive_borderline',
    expected_label: 'unknown',
    a: pairRecord(first),
    b: pairRecord(last),
    cluster_id: cluster._id,
    cluster_size: cluster.size,
    label: null,
    notes: '',
  });
}
console.log(`  Borderline pairs: ${largeClusters.length}`);

// Related editions (same author, different dates) — 100 pairs
// Sample first to avoid memory limits, then group locally
const relatedSample = await col.aggregate([
  { $match: { author: { $nin: ['Unknown', '[s.n.]', ''] }, date_earliest: { $ne: null } } },
  { $sample: { size: 10000 } },
  { $project: { title: 1, author: 1, language: 1, date_text: 1, date_earliest: 1, source: 1, source_id: 1, manifest_url: 1 } },
]).toArray();
const authorGroups = {};
relatedSample.forEach(r => {
  if (!authorGroups[r.author]) authorGroups[r.author] = [];
  authorGroups[r.author].push(r);
});
const relatedEditions = Object.entries(authorGroups)
  .filter(([, recs]) => {
    const dates = new Set(recs.map(r => r.date_earliest));
    return dates.size >= 2;
  })
  .slice(0, 100);

for (const [author, recs] of relatedEditions) {
  const byDate = {};
  recs.forEach(r => {
    if (r.date_earliest && !byDate[r.date_earliest]) byDate[r.date_earliest] = r;
  });
  const dateRecs = Object.values(byDate);
  if (dateRecs.length >= 2) {
    pairs.push({
      stratum: 'positive_related_edition',
      expected_label: 'same_work_different_edition',
      a: pairRecord(dateRecs[0]),
      b: pairRecord(dateRecs[1]),
      label: null,
      notes: '',
    });
  }
}
console.log(`  Related edition pairs: ${relatedEditions.length}`);

// ── Stratum 2: True negatives (400) ─────────────────────────────────────

console.log('\nSampling negative pairs...');

// Different works by same author — 150 pairs
const negSample = await col.aggregate([
  { $match: { author: { $nin: ['Unknown', '[s.n.]', ''], $regex: /^[A-Z]/ } } },
  { $sample: { size: 8000 } },
  { $project: { title: 1, author: 1, language: 1, date_text: 1, date_earliest: 1, source: 1, source_id: 1, manifest_url: 1 } },
]).toArray();
const negAuthorGroups = {};
negSample.forEach(r => {
  if (!negAuthorGroups[r.author]) negAuthorGroups[r.author] = [];
  negAuthorGroups[r.author].push(r);
});
const sameAuthorDiffWork = Object.entries(negAuthorGroups)
  .filter(([, recs]) => {
    const titles = new Set(recs.map(r => r.title.slice(0, 40)));
    return titles.size >= 2;
  })
  .slice(0, 150);

for (const [author, recs] of sameAuthorDiffWork) {
  const seen = new Set();
  const distinct = recs.filter(r => {
    const key = r.title.slice(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (distinct.length >= 2) {
    pairs.push({
      stratum: 'negative_same_author',
      expected_label: 'different_work',
      a: pairRecord(distinct[0]),
      b: pairRecord(distinct[1]),
      label: null,
      notes: '',
    });
  }
}
console.log(`  Same-author different-work pairs: ${sameAuthorDiffWork.length}`);

// Same generic title, different author — 100 pairs
const genericTitles = ['Opera', 'Epistolae', 'Gedichte', 'Catechismus', 'Theses ex universa theologia',
  'Grammaticae institutiones', 'Sermones', 'Meditationes', 'Commentarii', 'Orationes'];

for (const title of genericTitles.slice(0, 10)) {
  const recs = await col.find({ title, source: 'bsb' }).limit(20).toArray();
  const authors = {};
  recs.forEach(r => { if (!authors[r.author]) authors[r.author] = r; });
  const authorRecs = Object.values(authors);
  if (authorRecs.length >= 2) {
    pairs.push({
      stratum: 'negative_generic_title',
      expected_label: 'different_work',
      a: pairRecord(authorRecs[0]),
      b: pairRecord(authorRecs[1]),
      label: null,
      notes: `Generic title: "${title}"`,
    });
  }
}
console.log(`  Generic title pairs: ${Math.min(10, genericTitles.length)}`);

// Random same-block non-matches — 150 pairs
const randomBlocks = await col.aggregate([
  { $match: { date_earliest: { $ne: null }, author: { $ne: 'Unknown' } } },
  { $sample: { size: 5000 } },
]).toArray();

// Group by decade+author prefix and pick pairs within blocks
const blocks = {};
randomBlocks.forEach(r => {
  const decade = Math.floor((r.date_earliest || 0) / 10) * 10;
  const authPre = (r.author || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 4);
  const key = `${decade}:${authPre}`;
  if (!blocks[key]) blocks[key] = [];
  blocks[key].push(r);
});

let randomNegCount = 0;
for (const [key, recs] of Object.entries(blocks)) {
  if (randomNegCount >= 150) break;
  if (recs.length < 2) continue;
  // Pick a pair that our dedup did NOT cluster together
  for (let i = 0; i < recs.length && randomNegCount < 150; i++) {
    for (let j = i + 1; j < recs.length && randomNegCount < 150; j++) {
      if (recs[i].dedup_cluster !== recs[j].dedup_cluster || !recs[i].dedup_cluster) {
        pairs.push({
          stratum: 'negative_same_block',
          expected_label: 'likely_different',
          a: pairRecord(recs[i]),
          b: pairRecord(recs[j]),
          label: null,
          notes: `Block: ${key}`,
        });
        randomNegCount++;
        break;
      }
    }
  }
}
console.log(`  Same-block non-match pairs: ${randomNegCount}`);

// ── Stratum 3: Hard cases (200) ─────────────────────────────────────────

console.log('\nSampling hard cases...');

// Anonymous works with similar titles — 50 pairs
const anonSimilar = await col.aggregate([
  { $match: { author: { $in: ['Unknown', '[s.n.]'] }, date_earliest: { $ne: null } } },
  { $sample: { size: 2000 } },
]).toArray();

// Find pairs with similar-looking titles among anonymous works
let anonCount = 0;
for (let i = 0; i < anonSimilar.length && anonCount < 50; i++) {
  for (let j = i + 1; j < Math.min(i + 20, anonSimilar.length) && anonCount < 50; j++) {
    // Quick check: do first 20 chars match?
    const a = anonSimilar[i].title.toLowerCase().slice(0, 20);
    const b = anonSimilar[j].title.toLowerCase().slice(0, 20);
    if (a === b && anonSimilar[i].title !== anonSimilar[j].title) {
      pairs.push({
        stratum: 'hard_anonymous',
        expected_label: 'unknown',
        a: pairRecord(anonSimilar[i]),
        b: pairRecord(anonSimilar[j]),
        label: null,
        notes: '',
      });
      anonCount++;
    }
  }
}
console.log(`  Anonymous similar pairs: ${anonCount}`);

// Multi-volume vs single — 50 pairs
const volumePairs = await col.aggregate([
  { $match: { title: /\/ [12345]$|Tomus [IVX]+|Band \d|Vol\.? \d|Pars [IVX]+/i } },
  { $sample: { size: 200 } },
]).toArray();

let volCount = 0;
for (let i = 0; i < volumePairs.length && volCount < 50; i++) {
  // Find a non-volume version of the same work
  const baseTitle = volumePairs[i].title.replace(/\s*[\/:]?\s*(Tomus|Band|Vol\.?|Pars|Part)\s*[IVX\d]+.*$/i, '').trim();
  if (baseTitle.length < 10) continue;
  const match = await col.findOne({
    title: { $regex: baseTitle.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' },
    _id: { $ne: volumePairs[i]._id },
    title: { $not: /\/ [12345]$|Tomus [IVX]+|Band \d|Vol\.? \d|Pars [IVX]+/i },
  });
  if (match) {
    pairs.push({
      stratum: 'hard_multivolume',
      expected_label: 'same_work_different_volume',
      a: pairRecord(volumePairs[i]),
      b: pairRecord(match),
      label: null,
      notes: '',
    });
    volCount++;
  }
}
console.log(`  Multi-volume pairs: ${volCount}`);

// ── Output ──────────────────────────────────────────────────────────────

console.log(`\nTotal pairs: ${pairs.length}`);

// Shuffle
for (let i = pairs.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
}

// Add pair IDs
pairs.forEach((p, i) => { p.pair_id = i + 1; });

// Stratum distribution
const strata = {};
pairs.forEach(p => { strata[p.stratum] = (strata[p.stratum] || 0) + 1; });
console.log('\nStratum distribution:');
Object.entries(strata).sort().forEach(([s, c]) => console.log(`  ${s}: ${c}`));

// Write output
const outputPath = new URL('./gold-standard-pairs.json', import.meta.url).pathname;
writeFileSync(outputPath, JSON.stringify(pairs, null, 2));
console.log(`\nWritten to ${outputPath}`);

// Also write a simplified TSV for quick labeling
const tsvPath = new URL('./gold-standard-pairs.tsv', import.meta.url).pathname;
const tsvHeader = 'pair_id\tstratum\texpected_label\ta_source\ta_title\ta_author\ta_date\tb_source\tb_title\tb_author\tb_date\tlabel\tnotes';
const tsvRows = pairs.map(p =>
  `${p.pair_id}\t${p.stratum}\t${p.expected_label}\t${p.a.source}\t${p.a.title.slice(0, 80)}\t${p.a.author}\t${p.a.date_text || ''}\t${p.b.source}\t${p.b.title.slice(0, 80)}\t${p.b.author}\t${p.b.date_text || ''}\t\t`
);
writeFileSync(tsvPath, tsvHeader + '\n' + tsvRows.join('\n'));
console.log(`TSV written to ${tsvPath}`);

await client.close();
