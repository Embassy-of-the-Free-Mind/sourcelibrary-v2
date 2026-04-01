#!/usr/bin/env node
/**
 * Backfill author_entity_id on all visible books.
 *
 * Strategy:
 *   1. Build name→entity index from all person entities (name + aliases)
 *   2. For each distinct book author string:
 *      a. Extract primary author (before semicolons, strip roles/brackets)
 *      b. Try exact match against entity index
 *      c. Try normalized match (lowercase, strip diacritics, comma-flip)
 *      d. If still unmatched and 2+ books, query Wikidata to create entity
 *   3. Apply links in throttled batches
 *   4. Generate review report (merged clusters for human spot-checking)
 *
 * Usage:
 *   node scripts/enrichment/backfill-author-entities.mjs [--dry-run] [--wikidata] [--limit N]
 *
 * GitHub issue: #680
 */

import { MongoClient, ObjectId } from 'mongodb';

// ── Config ──────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const USE_WIKIDATA = process.argv.includes('--wikidata');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 0;
const BATCH_SIZE = 50; // writes per batch
const BATCH_DELAY = 200; // ms between batches

const SKIP_AUTHORS = new Set([
  'Various', 'Anonymous', 'Unknown', 'Anonymous Sumerian',
  '(unknown)', '[s.n.]', '? (s.l.)', '',
]);

/** Non-person "authors" that should never get entity links */
const SKIP_PATTERNS = [
  /^splendor solis$/i,
  /^elzevir /i,
  /^corpus /i,
  /^theatrum /i,
  /collection$/i,
  /^catholic church$/i,
];

// ── Name Normalization ──────────────────────────────────────────────────

/** Strip diacritics and lowercase */
function normalize(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Extract primary author from a complex author string */
function extractPrimaryAuthor(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();

  // Strip outer brackets (uncertain attribution)
  s = s.replace(/^\[+/, '').replace(/\]+$/, '');

  // Take first author before semicolons, pipes, or ampersands
  s = s.split(/[;|]/)[0].trim();
  s = s.split(/\s+&\s+/)[0].trim();

  // Strip role qualifiers
  s = s.replace(/\s*\((ed\.|trans\.|translator|compiler|printer|comm\.).*?\)/gi, '');
  s = s.replace(/\s*\(printed by.*?\)/gi, '');
  s = s.replace(/\s*\(ed\.\s*&\s*trans\.\)/gi, '');
  s = s.replace(/\s*\(annotated by.*?\)/gi, '');
  s = s.replace(/\s*\(copied by.*?\)/gi, '');
  s = s.replace(/\s*\((German|Dutch|English)\s+trans\.\)/gi, '');

  // Strip "et al."
  s = s.replace(/\s+et\s+al\.?$/i, '');

  // Strip date suffixes like ", ca1577-1626" or ", 1646-1724" or ", ca. 2./4. Jh."
  s = s.replace(/,\s*(?:ca\.?\s*)?\d{4}(?:\s*-\s*\d{4})?$/, '');
  s = s.replace(/,\s*ca\.?\s*\d+\.?\/?\d*\.?\s*Jh\.?$/i, '');
  // Strip profession suffixes like ", prentgraveur" or ", publisher"
  s = s.replace(/,\s*(?:prentgraveur|publisher|printer|engraver|bookseller|libraire)$/i, '');

  // Strip leading/trailing brackets that might remain
  s = s.replace(/^\[+/, '').replace(/\]+$/, '');

  s = s.trim();
  if (!s || s.length < 2) return null;
  if (SKIP_AUTHORS.has(s)) return null;
  if (SKIP_PATTERNS.some(p => p.test(s))) return null;

  return s;
}

/** Flip "Surname, First" → "First Surname" */
function commaFlip(name) {
  const comma = name.indexOf(',');
  if (comma > 0 && comma < name.length - 1) {
    const parts = name.split(',').map(p => p.trim());
    if (parts.length === 2 && parts[1].length > 0) {
      return `${parts[1]} ${parts[0]}`;
    }
  }
  return name;
}

/** Generate all match keys for a name */
function matchKeys(name) {
  const keys = new Set();
  const n = normalize(name);
  keys.add(n);

  // Comma-flipped
  const flipped = normalize(commaFlip(name));
  keys.add(flipped);

  return [...keys].filter(k => k.length > 1);
}

// ── Wikidata Search ─────────────────────────────────────────────────────

async function searchWikidata(name) {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&limit=3&format=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    if (!data.search?.length) return null;

    // Get details for top result
    const qid = data.search[0].id;
    const detailUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|descriptions|aliases|claims&languages=en&format=json`;
    const detailRes = await fetch(detailUrl);
    if (!detailRes.ok) return null;
    const detailData = await detailRes.json();

    const entity = detailData.entities?.[qid];
    if (!entity) return null;

    // Check it's a human (P31 = Q5)
    const instanceOf = entity.claims?.P31;
    const isHuman = instanceOf?.some(c => c.mainsnak?.datavalue?.value?.id === 'Q5');
    if (!isHuman) return null;

    // Extract birth/death dates
    const birthClaim = entity.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
    const deathClaim = entity.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time;
    const birthDate = birthClaim ? birthClaim.replace(/^\+/, '').split('T')[0] : undefined;
    const deathDate = deathClaim ? deathClaim.replace(/^\+/, '').split('T')[0] : undefined;

    // Extract VIAF
    const viafClaim = entity.claims?.P214?.[0]?.mainsnak?.datavalue?.value;

    // Aliases
    const aliases = entity.aliases?.en?.map(a => a.value) || [];

    return {
      wikidata_id: qid,
      label: entity.labels?.en?.value || data.search[0].label,
      description: entity.descriptions?.en?.value || data.search[0].description,
      aliases,
      viaf_id: viafClaim,
      birth_date: birthDate,
      death_date: deathDate,
      search_label: data.search[0].label,
      search_description: data.search[0].description,
    };
  } catch (err) {
    console.error(`  Wikidata error for "${name}":`, err.message);
    return null;
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Author Entity Backfill — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${USE_WIKIDATA ? ' + Wikidata' : ''}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // ── Step 1: Build entity index ──────────────────────────────────────

  console.log('\n1. Building entity index...');
  const entityIndex = new Map(); // normalized name → entity { _id, name, canonical_name }

  const entities = await db.collection('entities').find(
    { type: 'person' },
    { projection: { name: 1, canonical_name: 1, aliases: 1, wikidata_id: 1 } }
  ).toArray();

  for (const ent of entities) {
    const id = ent._id.toString();
    const record = { _id: id, name: ent.name, canonical_name: ent.canonical_name, wikidata_id: ent.wikidata_id };

    // Index by name
    const nameKey = normalize(ent.name);
    if (nameKey.length > 1) {
      if (!entityIndex.has(nameKey)) entityIndex.set(nameKey, record);
    }
    // Index by canonical_name
    if (ent.canonical_name) {
      const canKey = normalize(ent.canonical_name);
      if (canKey.length > 1 && !entityIndex.has(canKey)) entityIndex.set(canKey, record);
    }
    // Index by aliases
    if (ent.aliases?.length) {
      for (const alias of ent.aliases) {
        const aliasKey = normalize(alias);
        if (aliasKey.length > 1 && !entityIndex.has(aliasKey)) entityIndex.set(aliasKey, record);
      }
    }
    // Index comma-flipped versions
    const flipped = normalize(commaFlip(ent.name));
    if (flipped !== nameKey && !entityIndex.has(flipped)) entityIndex.set(flipped, record);
    if (ent.canonical_name) {
      const canFlipped = normalize(commaFlip(ent.canonical_name));
      if (!entityIndex.has(canFlipped)) entityIndex.set(canFlipped, record);
    }
  }

  console.log(`  ${entities.length} person entities → ${entityIndex.size} index entries`);

  // ── Step 2: Get all distinct authors from books ─────────────────────

  console.log('\n2. Loading book author strings...');
  const authorAgg = await db.collection('books').aggregate([
    { $match: { visible: true, author: { $exists: true, $type: 'string' }, author_entity_id: { $exists: false } } },
    { $group: { _id: '$author', count: { $sum: 1 }, bookIds: { $push: '$id' } } },
    { $sort: { count: -1 } },
  ]).toArray();

  // Filter out skip authors
  const authorGroups = authorAgg.filter(a => a._id && !SKIP_AUTHORS.has(a._id));
  const limitedGroups = LIMIT > 0 ? authorGroups.slice(0, LIMIT) : authorGroups;

  console.log(`  ${authorGroups.length} distinct unlinked author strings (${authorAgg.reduce((s, a) => s + a.count, 0)} books)`);
  if (LIMIT > 0) console.log(`  Processing first ${LIMIT}`);

  // ── Step 3: Match authors to entities ──────────────────────────────

  console.log('\n3. Matching authors to entities...');

  const results = {
    matched: [],    // { authorString, entityId, entityName, method, bookIds }
    unmatched: [],  // { authorString, primaryAuthor, count, bookIds }
    skipped: [],    // author strings that couldn't be parsed
  };

  for (const group of limitedGroups) {
    const raw = group._id;
    const primary = extractPrimaryAuthor(raw);

    if (!primary) {
      results.skipped.push({ authorString: raw, count: group.count });
      continue;
    }

    // Try all match keys
    const keys = matchKeys(primary);
    // Also try keys from the raw string (for "Marsilio Ficino" when raw is exactly that)
    const rawKeys = matchKeys(raw);
    const allKeys = [...new Set([...keys, ...rawKeys])];

    let matched = null;
    let method = '';

    for (const key of allKeys) {
      if (entityIndex.has(key)) {
        matched = entityIndex.get(key);
        method = key === normalize(raw) ? 'exact_raw' :
                 key === normalize(primary) ? 'exact_primary' : 'normalized';
        break;
      }
    }

    if (matched) {
      results.matched.push({
        authorString: raw,
        primaryAuthor: primary,
        entityId: matched._id,
        entityName: matched.canonical_name || matched.name,
        wikidataId: matched.wikidata_id,
        method,
        count: group.count,
        bookIds: group.bookIds,
      });
    } else {
      results.unmatched.push({
        authorString: raw,
        primaryAuthor: primary,
        count: group.count,
        bookIds: group.bookIds,
      });
    }
  }

  console.log(`  Matched: ${results.matched.length} author strings (${results.matched.reduce((s, m) => s + m.count, 0)} books)`);
  console.log(`  Unmatched: ${results.unmatched.length} author strings (${results.unmatched.reduce((s, m) => s + m.count, 0)} books)`);
  console.log(`  Skipped: ${results.skipped.length} (unparseable)`);

  // ── Step 3b: Wikidata for unmatched with 2+ books ──────────────────

  let wikidataCreated = 0;
  if (USE_WIKIDATA) {
    const MIN_BOOKS = process.argv.includes('--all-authors') ? 1 : 2;
    const worthSearching = results.unmatched.filter(u => u.count >= MIN_BOOKS);
    console.log(`\n3b. Searching Wikidata for ${worthSearching.length} unmatched authors (2+ books)...`);

    for (let i = 0; i < worthSearching.length; i++) {
      const u = worthSearching[i];
      if (i > 0 && i % 10 === 0) {
        console.log(`  ${i}/${worthSearching.length}...`);
        await new Promise(r => setTimeout(r, 1000)); // rate limit
      }

      const wdResult = await searchWikidata(u.primaryAuthor);
      if (!wdResult) continue;

      // Check if entity already exists (by wikidata_id OR by name)
      const existing = await db.collection('entities').findOne(
        { $or: [
          { wikidata_id: wdResult.wikidata_id },
          { type: 'person', name: wdResult.label },
          { type: 'person', canonical_name: wdResult.label },
        ]},
        { projection: { _id: 1, name: 1, canonical_name: 1 } }
      );

      if (existing) {
        // Link to existing entity
        const entityId = existing._id.toString();
        results.matched.push({
          authorString: u.authorString,
          primaryAuthor: u.primaryAuthor,
          entityId,
          entityName: existing.canonical_name || existing.name,
          wikidataId: wdResult.wikidata_id,
          method: 'wikidata_existing',
          count: u.count,
          bookIds: u.bookIds,
        });
        // Remove from unmatched
        const idx = results.unmatched.indexOf(u);
        if (idx > -1) results.unmatched.splice(idx, 1);
        continue;
      }

      // Create new entity
      if (!DRY_RUN) {
        try {
          const newEntity = {
            type: 'person',
            name: wdResult.label,
            canonical_name: wdResult.label,
            description: wdResult.description,
            aliases: [u.primaryAuthor, ...wdResult.aliases].filter((v, i, a) =>
              v && a.indexOf(v) === i && normalize(v) !== normalize(wdResult.label)
            ),
            wikidata_id: wdResult.wikidata_id,
            viaf_id: wdResult.viaf_id,
            wikidata_birth_date: wdResult.birth_date,
            wikidata_death_date: wdResult.death_date,
            book_count: 0,
            books: [],
            total_mentions: 0,
            created_at: new Date(),
            updated_at: new Date(),
            created_by: 'backfill-author-entities',
          };
          const insertResult = await db.collection('entities').insertOne(newEntity);
          const entityId = insertResult.insertedId.toString();

          results.matched.push({
            authorString: u.authorString,
            primaryAuthor: u.primaryAuthor,
            entityId,
            entityName: wdResult.label,
            wikidataId: wdResult.wikidata_id,
            method: 'wikidata_created',
            count: u.count,
            bookIds: u.bookIds,
          });
          wikidataCreated++;
        } catch (err) {
          if (err.code === 11000) {
            // Duplicate name — find and link existing
            const dup = await db.collection('entities').findOne(
              { type: 'person', name: wdResult.label },
              { projection: { _id: 1, name: 1, canonical_name: 1 } }
            );
            if (dup) {
              results.matched.push({
                authorString: u.authorString,
                primaryAuthor: u.primaryAuthor,
                entityId: dup._id.toString(),
                entityName: dup.canonical_name || dup.name,
                wikidataId: wdResult.wikidata_id,
                method: 'wikidata_existing_by_name',
                count: u.count,
                bookIds: u.bookIds,
              });
            }
          } else {
            console.error(`  Error creating entity for "${u.primaryAuthor}":`, err.message);
          }
        }
      } else {
        console.log(`  [DRY] Would create entity: ${wdResult.label} (${wdResult.wikidata_id})`);
      }

      // Remove from unmatched
      const idx = results.unmatched.indexOf(u);
      if (idx > -1) results.unmatched.splice(idx, 1);
    }

    console.log(`  Created ${wikidataCreated} new entities from Wikidata`);
  }

  // ── Step 4: Apply links ────────────────────────────────────────────

  if (!DRY_RUN && results.matched.length > 0) {
    console.log(`\n4. Applying ${results.matched.length} entity links...`);

    let updated = 0;
    const allUpdates = [];

    for (const m of results.matched) {
      for (const bookId of m.bookIds) {
        allUpdates.push({ bookId, entityId: m.entityId });
      }
    }

    // Batch writes
    for (let i = 0; i < allUpdates.length; i += BATCH_SIZE) {
      const batch = allUpdates.slice(i, i + BATCH_SIZE);
      const ops = batch.map(u => ({
        updateOne: {
          filter: { id: u.bookId },
          update: { $set: { author_entity_id: u.entityId } },
        }
      }));
      const result = await db.collection('books').bulkWrite(ops, { ordered: false });
      updated += result.modifiedCount;

      if (i + BATCH_SIZE < allUpdates.length) {
        await new Promise(r => setTimeout(r, BATCH_DELAY));
      }
    }

    console.log(`  Updated ${updated} books`);
  } else if (DRY_RUN) {
    console.log(`\n4. [DRY RUN] Would update ${results.matched.reduce((s, m) => s + m.count, 0)} books`);
  }

  // ── Step 5: Generate review report ─────────────────────────────────

  console.log('\n5. Generating review report...');

  // Group matches by entity to show merged clusters
  const clusters = new Map();
  for (const m of results.matched) {
    const key = m.entityId;
    if (!clusters.has(key)) {
      clusters.set(key, {
        entityName: m.entityName,
        wikidataId: m.wikidataId,
        variants: [],
        totalBooks: 0,
      });
    }
    const cluster = clusters.get(key);
    cluster.variants.push({ authorString: m.authorString, count: m.count, method: m.method });
    cluster.totalBooks += m.count;
  }

  // Merged clusters (2+ variants → same entity) are highest review priority
  const mergedClusters = [...clusters.entries()]
    .filter(([_, c]) => c.variants.length > 1)
    .sort((a, b) => b[1].totalBooks - a[1].totalBooks);

  const report = [];
  report.push('# Author Entity Backfill — Review Report');
  report.push(`\nDate: ${new Date().toISOString().split('T')[0]}`);
  report.push(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  report.push('');
  report.push('## Summary');
  report.push(`- Matched: ${results.matched.length} author strings → ${clusters.size} entities (${results.matched.reduce((s, m) => s + m.count, 0)} books)`);
  report.push(`- Unmatched: ${results.unmatched.length} author strings (${results.unmatched.reduce((s, m) => s + m.count, 0)} books)`);
  report.push(`- Skipped: ${results.skipped.length} (unparseable)`);
  if (USE_WIKIDATA) report.push(`- Wikidata entities created: ${wikidataCreated}`);
  report.push('');

  report.push('## Merged Clusters (REVIEW PRIORITY)');
  report.push('');
  report.push('These author strings were mapped to the same entity. Check for false merges.');
  report.push('');

  for (const [entityId, cluster] of mergedClusters) {
    const wd = cluster.wikidataId ? ` ([${cluster.wikidataId}](https://www.wikidata.org/wiki/${cluster.wikidataId}))` : '';
    report.push(`### ${cluster.entityName}${wd}`);
    report.push(`Entity ID: ${entityId} | ${cluster.totalBooks} books`);
    report.push('');
    for (const v of cluster.variants) {
      report.push(`- "${v.authorString}" (${v.count} books, ${v.method})`);
    }
    report.push('');
  }

  report.push('## Single Matches (lower review priority)');
  report.push('');
  const singles = [...clusters.entries()]
    .filter(([_, c]) => c.variants.length === 1)
    .sort((a, b) => b[1].totalBooks - a[1].totalBooks)
    .slice(0, 50);

  for (const [entityId, cluster] of singles) {
    const v = cluster.variants[0];
    report.push(`- "${v.authorString}" → **${cluster.entityName}** (${v.count} books, ${v.method})`);
  }
  if (clusters.size - mergedClusters.length > 50) {
    report.push(`\n... and ${clusters.size - mergedClusters.length - 50} more single matches`);
  }

  report.push('');
  report.push('## Top Unmatched Authors');
  report.push('');
  const topUnmatched = results.unmatched
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  for (const u of topUnmatched) {
    report.push(`- "${u.authorString}" → extracted: "${u.primaryAuthor}" (${u.count} books)`);
  }
  if (results.unmatched.length > 50) {
    report.push(`\n... and ${results.unmatched.length - 50} more`);
  }

  const reportPath = 'scripts/output/author-entity-backfill-report.md';
  const fs = await import('fs');
  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync(reportPath, report.join('\n'));
  console.log(`  Report: ${reportPath}`);

  // ── Done ─────────────────────────────────────────────────────────────

  console.log('\n' + '─'.repeat(60));
  console.log('Done.');

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
