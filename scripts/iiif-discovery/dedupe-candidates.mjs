#!/usr/bin/env node
/**
 * Probabilistic Deduplication for IIIF Candidates
 *
 * Three-level dedup following FRBR model:
 *   Level 1 (Item): same digitized object — different catalog records for same scan
 *   Level 2 (Manifestation): same edition — same printing at different libraries
 *   Level 3 (Work): same intellectual work — different editions/translations
 *
 * Approach:
 *   Phase 1: Exact matching — Biblissima manifest URL overlap with direct sources
 *   Phase 2: BSB internal dedup — same title+author+date = same edition, different copies
 *   Phase 3: Cross-source probabilistic — blocking + Jaro-Winkler similarity
 *   Phase 4: Cluster assignment — connected components, pick primary representative
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/dedupe-candidates.mjs
 *
 * Options:
 *   --apply              Actually write cluster IDs to the database
 *   --source=bsb         Only dedup within one source (for testing)
 *   --sample=10000       Process a random sample (for testing)
 *   --threshold=0.88     Jaro-Winkler threshold for title match (default: 0.88)
 */

import { MongoClient } from 'mongodb';

const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const APPLY = 'apply' in args;
const SOURCE_FILTER = args.source || null;
const SAMPLE_SIZE = parseInt(args.sample) || null;
const TITLE_THRESHOLD = parseFloat(args.threshold) || 0.88;
const AUTHOR_THRESHOLD = 0.82;

// ── Jaro-Winkler Similarity ─────────────────────────────────────────────

function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const maxDist = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  if (maxDist < 0) return 0.0;

  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - maxDist);
    const end = Math.min(i + maxDist + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - transpositions / 2) / matches) / 3;

  // Winkler prefix bonus (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

// ── Normalization ────────────────────────────────────────────────────────

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Strip HTML entities
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    // Strip leading articles (Latin, German, French, Italian, English, etc.)
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las|un|une|ein|eine)\s+/i, '')
    // Strip common Latin prefixes that don't distinguish works
    .replace(/^(d\.?\s*o\.?\s*m\.?\s*a\.?\s*|dn\.?\s*)/i, '')
    // Strip punctuation
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Take first 120 chars (long subtitles add noise)
    .slice(0, 120);
}

function normalizeAuthor(author) {
  if (!author || author === 'Unknown' || author === '[s.n.]') return '';
  return author
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    // Strip dates in parens
    .replace(/\s*\([^)]*\d{3,4}[^)]*\)\s*/g, '')
    // Strip honorifics
    .replace(/\b(dr|prof|rev|saint|st|sir|fr)\b\.?\s*/g, '')
    // Strip "Auteur du texte" (Gallica convention)
    .replace(/\.\s*auteur du texte\s*$/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Sort words (handles "Last, First" vs "First Last")
    .split(' ').filter(w => w.length > 1).sort().join(' ')
    // Take first 60 chars
    .slice(0, 60);
}

function getBlockKey(record) {
  const decade = record.date_earliest
    ? Math.floor(record.date_earliest / 10) * 10
    : 'nodate';
  const authorPrefix = normalizeAuthor(record.author).slice(0, 4) || 'unk';
  return `${decade}:${authorPrefix}`;
}

// ── Main ─────────────────────────────────────────────────────────────────

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

console.log(`\n=== Probabilistic Deduplication ===`);
console.log(`Title threshold: ${TITLE_THRESHOLD}`);
console.log(`Author threshold: ${AUTHOR_THRESHOLD}`);
console.log(`Apply: ${APPLY}`);
console.log('');

// ── Phase 1: Load candidates ────────────────────────────────────────────

const filter = {};
if (SOURCE_FILTER) filter.source = SOURCE_FILTER;

let cursor = db.collection('import_candidates').find(filter, {
  projection: {
    _id: 1, manifest_url: 1, title: 1, author: 1, source: 1,
    date_earliest: 1, date_text: 1, language: 1, source_id: 1,
  },
});

if (SAMPLE_SIZE) {
  // Random sample via aggregation
  const sampled = await db.collection('import_candidates').aggregate([
    { $match: filter },
    { $sample: { size: SAMPLE_SIZE } },
    { $project: { manifest_url: 1, title: 1, author: 1, source: 1, date_earliest: 1, date_text: 1, language: 1, source_id: 1 } },
  ]).toArray();
  cursor = { [Symbol.asyncIterator]: async function*() { for (const r of sampled) yield r; } };
  console.log(`Loaded ${sampled.length} sample candidates`);
} else {
  console.log('Loading all candidates...');
}

// Build blocks
const blocks = new Map();   // blockKey -> record[]
const recordMap = new Map(); // _id -> record
let totalLoaded = 0;

for await (const record of cursor) {
  const normTitle = normalizeTitle(record.title);
  const normAuthor = normalizeAuthor(record.author);
  const blockKey = getBlockKey(record);

  const rec = {
    _id: record._id,
    manifest_url: record.manifest_url,
    title: record.title,
    normTitle,
    author: record.author,
    normAuthor,
    source: record.source,
    date_earliest: record.date_earliest,
    language: record.language,
    source_id: record.source_id,
    blockKey,
    clusterId: null,
  };

  recordMap.set(rec._id.toString(), rec);

  if (!blocks.has(blockKey)) blocks.set(blockKey, []);
  blocks.get(blockKey).push(rec);

  totalLoaded++;
  if (totalLoaded % 100000 === 0) console.log(`  Loaded ${totalLoaded.toLocaleString()} candidates...`);
}

console.log(`Loaded ${totalLoaded.toLocaleString()} candidates into ${blocks.size.toLocaleString()} blocks\n`);

// Block size distribution
const blockSizes = [...blocks.values()].map(b => b.length);
const maxBlock = Math.max(...blockSizes);
const avgBlock = blockSizes.reduce((a, b) => a + b, 0) / blockSizes.length;
const bigBlocks = blockSizes.filter(s => s > 100).length;
console.log(`Block stats: avg=${avgBlock.toFixed(1)}, max=${maxBlock}, blocks>100=${bigBlocks}`);

// ── Phase 2: Pairwise matching within blocks ────────────────────────────

console.log('\nRunning pairwise comparisons...\n');

let totalComparisons = 0;
let totalMatches = 0;
let nextClusterId = 1;
const clusterMerge = new Map(); // record._id -> clusterId

// Union-Find for clustering
function find(parent, i) {
  if (parent.get(i) !== i) parent.set(i, find(parent, parent.get(i)));
  return parent.get(i);
}
function union(parent, rank, i, j) {
  const ri = find(parent, i);
  const rj = find(parent, j);
  if (ri === rj) return;
  if ((rank.get(ri) || 0) < (rank.get(rj) || 0)) parent.set(ri, rj);
  else if ((rank.get(ri) || 0) > (rank.get(rj) || 0)) parent.set(rj, ri);
  else { parent.set(rj, ri); rank.set(ri, (rank.get(ri) || 0) + 1); }
}

const parent = new Map();
const rank = new Map();

let blocksProcessed = 0;
const matchPairs = [];

for (const [blockKey, records] of blocks) {
  blocksProcessed++;

  // Skip huge blocks (author "Unknown" in a given decade) — too noisy
  if (records.length > 500) {
    continue;
  }

  // Initialize union-find for this block's records
  for (const rec of records) {
    const id = rec._id.toString();
    if (!parent.has(id)) { parent.set(id, id); rank.set(id, 0); }
  }

  // Pairwise comparison within block
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      totalComparisons++;

      const a = records[i];
      const b = records[j];

      // Quick reject: if both titles are empty/short, skip
      if (a.normTitle.length < 5 || b.normTitle.length < 5) continue;

      // Compute title similarity
      const titleSim = jaroWinkler(a.normTitle, b.normTitle);
      if (titleSim < TITLE_THRESHOLD) continue;

      // Compute author similarity (if both have authors)
      let authorSim = 1.0;
      if (a.normAuthor && b.normAuthor) {
        authorSim = jaroWinkler(a.normAuthor, b.normAuthor);
        if (authorSim < AUTHOR_THRESHOLD) continue;
      } else if (a.normAuthor || b.normAuthor) {
        // One has author, other doesn't — penalize but don't reject
        authorSim = 0.5;
      }
      // Both unknown author — rely on title match only

      // Date match bonus
      const dateSim = (a.date_earliest && b.date_earliest && a.date_earliest === b.date_earliest) ? 1.0
        : (a.date_earliest && b.date_earliest && Math.abs(a.date_earliest - b.date_earliest) <= 2) ? 0.9
        : 0.7;

      // Composite score
      const score = titleSim * 0.55 + authorSim * 0.30 + dateSim * 0.15;

      if (score >= 0.85) {
        totalMatches++;
        union(parent, rank, a._id.toString(), b._id.toString());

        // Determine match type
        const sameSource = a.source === b.source;
        const sameDate = a.date_earliest === b.date_earliest;
        const matchType = sameSource && sameDate ? 'same_edition_copies'
          : !sameSource && sameDate ? 'cross_source_same_edition'
          : 'related_edition';

        matchPairs.push({
          a: { source: a.source, id: a.source_id, title: a.title.slice(0, 60) },
          b: { source: b.source, id: b.source_id, title: b.title.slice(0, 60) },
          score: score.toFixed(3),
          titleSim: titleSim.toFixed(3),
          authorSim: authorSim.toFixed(3),
          matchType,
        });
      }
    }
  }

  if (blocksProcessed % 5000 === 0) {
    console.log(`  Blocks: ${blocksProcessed.toLocaleString()}/${blocks.size.toLocaleString()} | Comparisons: ${totalComparisons.toLocaleString()} | Matches: ${totalMatches.toLocaleString()}`);
  }
}

console.log(`\nComparisons: ${totalComparisons.toLocaleString()}`);
console.log(`Matches found: ${totalMatches.toLocaleString()}`);

// ── Phase 3: Build clusters ─────────────────────────────────────────────

console.log('\nBuilding clusters...');

const clusters = new Map(); // rootId -> [recordIds]
for (const [id] of parent) {
  const root = find(parent, id);
  if (!clusters.has(root)) clusters.set(root, []);
  clusters.get(root).push(id);
}

// Filter to clusters with >1 member (actual duplicates)
const dupeClusters = [...clusters.entries()].filter(([, members]) => members.length > 1);
const totalDuplicateRecords = dupeClusters.reduce((sum, [, m]) => sum + m.length, 0);
const totalUniqueAfterDedup = totalLoaded - totalDuplicateRecords + dupeClusters.length;

console.log(`\nDuplicate clusters: ${dupeClusters.length.toLocaleString()}`);
console.log(`Records in duplicate clusters: ${totalDuplicateRecords.toLocaleString()}`);
console.log(`Unique records after dedup: ${totalUniqueAfterDedup.toLocaleString()} (was ${totalLoaded.toLocaleString()})`);
console.log(`Reduction: ${(totalLoaded - totalUniqueAfterDedup).toLocaleString()} (${((totalLoaded - totalUniqueAfterDedup) / totalLoaded * 100).toFixed(1)}%)`);

// ── Phase 4: Analyze match types ────────────────────────────────────────

console.log('\n--- Match Type Breakdown ---');
const matchTypes = {};
matchPairs.forEach(p => { matchTypes[p.matchType] = (matchTypes[p.matchType] || 0) + 1; });
Object.entries(matchTypes).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
  console.log(`  ${type}: ${count.toLocaleString()}`);
});

// Cluster size distribution
console.log('\n--- Cluster Size Distribution ---');
const sizeHist = {};
dupeClusters.forEach(([, members]) => {
  const size = members.length;
  const bucket = size <= 5 ? String(size) : size <= 10 ? '6-10' : size <= 20 ? '11-20' : '21+';
  sizeHist[bucket] = (sizeHist[bucket] || 0) + 1;
});
Object.entries(sizeHist).sort((a, b) => parseInt(a[0]) - parseInt(b[0])).forEach(([size, count]) => {
  console.log(`  Size ${size}: ${count.toLocaleString()} clusters`);
});

// Cross-source dedup breakdown
console.log('\n--- Cross-Source Duplicates ---');
const crossSourceClusters = dupeClusters.filter(([, members]) => {
  const sources = new Set(members.map(id => recordMap.get(id)?.source));
  return sources.size > 1;
});
console.log(`Clusters spanning multiple sources: ${crossSourceClusters.length.toLocaleString()}`);

// Sample some matches for review
console.log('\n--- Sample Matches (for review) ---');
const sampleMatches = matchPairs
  .filter(p => p.matchType === 'cross_source_same_edition')
  .slice(0, 10);
sampleMatches.forEach(m => {
  console.log(`  [${m.score}] [${m.a.source}] ${m.a.title}`);
  console.log(`         [${m.b.source}] ${m.b.title}`);
  console.log('');
});

const sameEditionSamples = matchPairs
  .filter(p => p.matchType === 'same_edition_copies')
  .slice(0, 5);
if (sameEditionSamples.length > 0) {
  console.log('--- Sample Same-Edition Copies ---');
  sameEditionSamples.forEach(m => {
    console.log(`  [${m.score}] ${m.a.id} vs ${m.b.id}: ${m.a.title}`);
  });
}

// ── Phase 5: Apply to database ──────────────────────────────────────────

if (APPLY) {
  console.log('\n--- Applying cluster IDs to database ---');

  const bulkOps = [];
  let clusterNum = 0;

  for (const [rootId, members] of dupeClusters) {
    clusterNum++;
    const clusterId = `cluster_${clusterNum}`;

    // Pick primary: prefer best source, then earliest date
    const scored = members.map(id => {
      const rec = recordMap.get(id);
      const sourcePriority = { biblissima: 1, gallica: 2, erara: 3, bsb: 4 };
      return { id, score: (sourcePriority[rec?.source] || 5) * 1000 - (rec?.date_earliest || 0) };
    }).sort((a, b) => a.score - b.score);

    const primaryId = scored[0].id;

    for (const memberId of members) {
      const rec = recordMap.get(memberId);
      if (!rec) continue;

      bulkOps.push({
        updateOne: {
          filter: { _id: rec._id },
          update: {
            $set: {
              dedup_cluster: clusterId,
              dedup_is_primary: memberId === primaryId,
              dedup_cluster_size: members.length,
            },
          },
        },
      });

      if (bulkOps.length >= 1000) {
        await db.collection('import_candidates').bulkWrite(bulkOps);
        bulkOps.length = 0;
        if (clusterNum % 5000 === 0) console.log(`  Applied ${clusterNum.toLocaleString()} clusters...`);
      }
    }
  }

  if (bulkOps.length > 0) {
    await db.collection('import_candidates').bulkWrite(bulkOps);
  }

  console.log(`Applied ${clusterNum.toLocaleString()} clusters to database`);

  // Also mark non-primary duplicates as skipped
  const skipResult = await db.collection('import_candidates').updateMany(
    { dedup_is_primary: false, status: 'discovered' },
    { $set: { status: 'skipped', skip_reason: 'Duplicate (dedup cluster)' } }
  );
  console.log(`Marked ${skipResult.modifiedCount.toLocaleString()} duplicate records as skipped`);
}

// ── Summary ─────────────────────────────────────────────────────────────

console.log('\n=== Dedup Summary ===');
console.log(`Total candidates: ${totalLoaded.toLocaleString()}`);
console.log(`Duplicate clusters: ${dupeClusters.length.toLocaleString()}`);
console.log(`Records in clusters: ${totalDuplicateRecords.toLocaleString()}`);
console.log(`Estimated unique: ${totalUniqueAfterDedup.toLocaleString()}`);
console.log(`Reduction: ${((totalLoaded - totalUniqueAfterDedup) / totalLoaded * 100).toFixed(1)}%`);
if (!APPLY) {
  console.log('\nRun with --apply to write cluster IDs to the database.');
}

await client.close();
