#!/usr/bin/env node
/**
 * Apply taxonomy expansion to MongoDB.
 * Reads taxonomy-expansion.json (nearest-centroid assignments for books
 * that have keyword indexes but were excluded from original clustering)
 * and writes taxonomy fields to each book.
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/analysis/apply-taxonomy-expansion.mjs [--dry-run]
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, '..', 'output');

// Same curated names as generate-taxonomy-mapping.py
const CURATED_NAMES = {
  21: "Western Alchemy",
  35: "Hermeticism & Theurgy",
  27: "Grimoires & Ceremonial Magic",
  26: "Solomonic Grimoires",
  25: "Demonology & Witchcraft",
  11: "Rosicrucian Fraternity Defenses",
  30: "Early Modern Rosicrucianism",
  18: "Animal Magnetism & Mesmerism",
  19: "New Thought & Self-Improvement",
  4:  "Christian Kabbalah",
  12: "Freemasonry & Secret Societies",
  47: "Continental Christian Mysticism",
  45: "Biblical Scholarship",
  41: "Syriac & Armenian Christianity",
  44: "Early Christianity",
  40: "Swedenborgian Theology",
  46: "Religious Persecution & Toleration",
  43: "Early Modern Prophecy and Apocalypse",
  36: "Classical Greek & Latin Texts",
  32: "Renaissance Philosophy",
  39: "Pseudo-Dionysius & Commentators",
  31: "Astrology & Astronomy",
  15: "Botany & Herbals",
  34: "Early Optics & Natural Philosophy",
  22: "Baconian Natural Philosophy",
  38: "Renaissance Anatomy & Engineering",
  37: "Ancient Mechanical Engineering",
  0:  "Music Theory & Harmony",
  20: "Medical Philosophy",
  6:  "Chinese Cosmology",
  9:  "Chinese Military (Wubei Zhi)",
  13: "Chinese Military (Hai Guo Tu Zhi)",
  14: "Ming Dynasty Coastal Defense",
  2:  "Chinese Materia Medica",
  3:  "Chinese Medical Texts",
  10: "Chinese Celestial & Terrestrial Lore",
  8:  "Sanskrit Jyotisha",
  5:  "Sanskrit Astronomical Treatises",
  16: "Sanskrit Divinatory Texts",
  17: "Hindu Philosophy",
  28: "Islamic Mysticism & Philosophy",
  29: "Early Modern Moral Philosophy",
  33: "Early Modern Philosophy",
  23: "Legal & Political Treatises",
  42: "Thirty Years' War Pamphlets",
  24: "Classical Political Economy",
  1:  "African & Indigenous Studies",
  7:  "Celtic & Irish Traditions",
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const expansionPath = join(OUTPUT_DIR, 'taxonomy-expansion.json');
  let expansion;
  try {
    expansion = JSON.parse(readFileSync(expansionPath, 'utf-8'));
  } catch (e) {
    console.error(`Missing ${expansionPath}`);
    console.error('Run: python3 scripts/analysis/expand-taxonomy.py');
    process.exit(1);
  }

  console.log(`Loaded expansion: ${expansion.assignments.length} books (method: ${expansion.method})`);
  console.log(`  High confidence: ${expansion.stats.high_confidence}`);
  console.log(`  Medium confidence: ${expansion.stats.medium_confidence}`);
  console.log(`  Avg similarity: ${expansion.stats.avg_similarity.toFixed(3)}\n`);

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const bulkOps = [];
  for (const entry of expansion.assignments) {
    const clusterName = CURATED_NAMES[entry.cluster] || `Cluster ${entry.cluster}`;
    const taxonomy = {
      cluster: clusterName,
      cluster_id: entry.cluster,
      probability: entry.probability,
      method: 'nearest-centroid',  // distinguish from original HDBSCAN assignments
    };

    bulkOps.push({
      updateOne: {
        filter: { id: entry.id, taxonomy: { $exists: false } },  // only set if not already assigned
        update: { $set: { taxonomy } },
      },
    });
  }

  console.log(`Prepared ${bulkOps.length} updates (skip-if-exists)`);

  if (dryRun) {
    // Show sample
    console.log('\nSample assignments:');
    for (const entry of expansion.assignments.slice(0, 15)) {
      const name = CURATED_NAMES[entry.cluster] || `Cluster ${entry.cluster}`;
      console.log(`  ${name} (sim=${entry.probability.toFixed(3)})`);
    }
    console.log('\n[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // Write in batches
  const BATCH = 500;
  let updated = 0;
  for (let i = 0; i < bulkOps.length; i += BATCH) {
    const batch = bulkOps.slice(i, i + BATCH);
    const result = await books.bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Written: ${Math.min(i + BATCH, bulkOps.length)}/${bulkOps.length}\r`);
  }
  console.log(`\nUpdated ${updated} books with expanded taxonomy.`);

  // Verify total
  const totalWithTax = await books.countDocuments({ taxonomy: { $exists: true }, hidden: { $ne: true } });
  const original = await books.countDocuments({ 'taxonomy.method': { $exists: false }, taxonomy: { $exists: true }, hidden: { $ne: true } });
  const expanded = await books.countDocuments({ 'taxonomy.method': 'nearest-centroid', hidden: { $ne: true } });
  console.log(`\nTaxonomy coverage:`);
  console.log(`  Original (HDBSCAN): ${original}`);
  console.log(`  Expanded (nearest-centroid): ${expanded}`);
  console.log(`  Total: ${totalWithTax}`);

  await client.close();
  console.log('Done.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
